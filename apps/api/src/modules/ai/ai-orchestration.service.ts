import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  extractRequirementsJobInputSchema,
  requirementExtractionSchema,
  reviewRequirementCandidateInputSchema,
  type RequirementExtraction
} from "@ba-workbench/ai-schemas";
import type { Prisma } from "@ba-workbench/database";
import type { AiDraftReviewDecision } from "@ba-workbench/shared";
import { PrismaService } from "../database/prisma.service";
import { WorkspaceContextService } from "../database/workspace-context.service";
import { RequirementsService, type CreateRequirementDto } from "../requirements/requirements.service";
import { AiJobQueueService } from "./ai-job-queue.service";

export interface CreateAiJobDto {
  jobType: string;
  sourceArtefactIds?: string[];
  instructions?: string;
}

export interface ReviewRequirementCandidateDto {
  decision?: AiDraftReviewDecision;
  comments?: string;
  requirement?: Record<string, unknown>;
}

const REQUIREMENT_CANDIDATE_ITEM_TYPE = "requirement_candidate";
const REVIEWABLE_DRAFT_STATUSES = new Set(["generated", "under_ba_review"]);

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown queueing error.";
}

@Injectable()
export class AiOrchestrationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WorkspaceContextService) private readonly workspaceContext: WorkspaceContextService,
    @Inject(AiJobQueueService) private readonly aiJobQueue: AiJobQueueService,
    @Inject(RequirementsService) private readonly requirementsService: RequirementsService
  ) {}

  async listJobs(projectId: string) {
    await this.workspaceContext.assertProjectAccess(projectId);

    return this.prisma.aiJob.findMany({
      where: { projectId },
      include: {
        outputs: {
          orderBy: {
            createdAt: "desc"
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    });
  }

  async createDraftJob(projectId: string, input: CreateAiJobDto) {
    const { owner } = await this.workspaceContext.assertProjectAccess(projectId);
    const jobType = input?.jobType;
    if (jobType !== "extract_requirements") {
      throw new BadRequestException(`Unsupported AI job type ${jobType ?? "missing"}.`);
    }

    const parsedInput = extractRequirementsJobInputSchema.safeParse({
      sourceArtefactIds: input?.sourceArtefactIds,
      instructions: input?.instructions
    });
    if (!parsedInput.success) {
      throw new BadRequestException(parsedInput.error.issues.map((issue) => issue.message).join(" "));
    }

    const sourceArtefactIds = [...new Set(parsedInput.data.sourceArtefactIds)];
    const sourceDocuments = await this.prisma.document.findMany({
      where: {
        projectId,
        id: {
          in: sourceArtefactIds
        }
      },
      select: {
        id: true,
        name: true,
        extractionStatus: true,
        _count: {
          select: {
            chunks: true
          }
        }
      }
    });

    if (sourceDocuments.length !== sourceArtefactIds.length) {
      throw new BadRequestException("One or more selected source documents do not belong to this project.");
    }

    const unavailableSources = sourceDocuments.filter(
      (document) => document.extractionStatus !== "completed" || document._count.chunks === 0
    );
    if (unavailableSources.length > 0) {
      throw new BadRequestException(
        `These source documents are not ready for AI extraction: ${unavailableSources.map((document) => document.name).join(", ")}.`
      );
    }

    const job = await this.prisma.$transaction(async (transaction) => {
      const createdJob = await transaction.aiJob.create({
        data: {
          projectId,
          jobType,
          status: "pending",
          input: {
            sourceArtefactIds,
            ...(parsedInput.data.instructions !== undefined ? { instructions: parsedInput.data.instructions } : {})
          } as Prisma.InputJsonValue
        }
      });

      await transaction.auditEvent.create({
        data: {
          projectId,
          actorId: owner.id,
          actorType: "user",
          action: "ai_job.created",
          artefactType: "ai_job",
          artefactId: createdJob.id,
          summary: "Queued an AI requirement extraction draft.",
          metadata: {
            jobType,
            sourceArtefactIds
          }
        }
      });

      return createdJob;
    });

    try {
      await this.aiJobQueue.enqueue({
        aiJobId: job.id,
        projectId
      });
      await this.prisma.aiJob.update({
        where: { id: job.id },
        data: {
          status: "queued",
          error: null
        }
      });
    } catch (error) {
      await this.prisma.aiJob.update({
        where: { id: job.id },
        data: {
          status: "queue_failed",
          error: errorMessage(error)
        }
      });
    }

    return this.getJob(projectId, job.id);
  }

  async getJob(projectId: string, aiJobId: string) {
    await this.workspaceContext.assertProjectAccess(projectId);
    const job = await this.prisma.aiJob.findFirst({
      where: {
        id: aiJobId,
        projectId
      },
      include: {
        outputs: {
          orderBy: {
            createdAt: "desc"
          }
        }
      }
    });

    if (!job) {
      throw new NotFoundException(`AI job ${aiJobId} was not found.`);
    }

    return {
      ...job,
      reviewModel: "ai_draft_requires_human_review"
    };
  }

  async getDraft(projectId: string, aiDraftOutputId: string) {
    await this.workspaceContext.assertProjectAccess(projectId);
    const draft = await this.requireDraft(projectId, aiDraftOutputId);
    const extraction = this.parseRequirementExtractionDraft(draft);
    const requirementCandidateReviews = draft.reviewItems.filter(
      (review) => review.itemType === REQUIREMENT_CANDIDATE_ITEM_TYPE
    );
    const reviewsByIndex = new Map(requirementCandidateReviews.map((review) => [review.itemIndex, review]));
    const acceptedCandidates = requirementCandidateReviews.filter((review) => review.decision === "accepted").length;
    const rejectedCandidates = requirementCandidateReviews.filter((review) => review.decision === "rejected").length;

    return {
      ...draft,
      reviewModel: "ai_draft_requires_human_review",
      reviewSummary: {
        totalCandidates: extraction.candidates.length,
        reviewedCandidates: requirementCandidateReviews.length,
        acceptedCandidates,
        rejectedCandidates,
        pendingCandidates: Math.max(0, extraction.candidates.length - requirementCandidateReviews.length)
      },
      requirementCandidates: extraction.candidates.map((candidate, candidateIndex) => ({
        candidateIndex,
        ...candidate,
        review: reviewsByIndex.get(candidateIndex) ?? null
      }))
    };
  }

  async reviewRequirementCandidate(
    projectId: string,
    aiDraftOutputId: string,
    candidateIndex: string,
    input: ReviewRequirementCandidateDto
  ) {
    const { owner } = await this.workspaceContext.assertProjectAccess(projectId);
    const parsedInput = reviewRequirementCandidateInputSchema.safeParse({
      candidateIndex: Number(candidateIndex),
      ...(input ?? {})
    });
    if (!parsedInput.success) {
      throw new BadRequestException(parsedInput.error.issues.map((issue) => issue.message).join(" "));
    }

    const draft = await this.requireDraft(projectId, aiDraftOutputId);
    const extraction = this.parseRequirementExtractionDraft(draft);
    const candidate = extraction.candidates[parsedInput.data.candidateIndex];
    if (!candidate) {
      throw new BadRequestException(`Requirement candidate ${parsedInput.data.candidateIndex} was not found.`);
    }

    if (!REVIEWABLE_DRAFT_STATUSES.has(draft.reviewStatus)) {
      throw new ConflictException(`AI draft ${aiDraftOutputId} is no longer open for BA review.`);
    }

    if (
      draft.reviewItems.some(
        (review) =>
          review.itemType === REQUIREMENT_CANDIDATE_ITEM_TYPE && review.itemIndex === parsedInput.data.candidateIndex
      )
    ) {
      throw new ConflictException(`Requirement candidate ${parsedInput.data.candidateIndex} has already been reviewed.`);
    }

    await this.prisma.$transaction(async (transaction) => {
      const currentDraft = await transaction.aiDraftOutput.findFirst({
        where: {
          id: aiDraftOutputId,
          projectId
        },
        select: {
          reviewStatus: true
        }
      });
      if (!currentDraft) {
        throw new NotFoundException(`AI draft output ${aiDraftOutputId} was not found.`);
      }
      if (!REVIEWABLE_DRAFT_STATUSES.has(currentDraft.reviewStatus)) {
        throw new ConflictException(`AI draft ${aiDraftOutputId} is no longer open for BA review.`);
      }

      const existingReview = await transaction.aiDraftReviewItem.findUnique({
        where: {
          aiDraftOutputId_itemType_itemIndex: {
            aiDraftOutputId,
            itemType: REQUIREMENT_CANDIDATE_ITEM_TYPE,
            itemIndex: parsedInput.data.candidateIndex
          }
        }
      });
      if (existingReview) {
        throw new ConflictException(`Requirement candidate ${parsedInput.data.candidateIndex} has already been reviewed.`);
      }

      let createdRequirement: Awaited<ReturnType<RequirementsService["createDraftInTransaction"]>> | undefined;
      let reviewedPayload: Prisma.InputJsonValue | undefined;

      if (parsedInput.data.decision === "accepted") {
        if (candidate.sourceReferences.length === 0) {
          throw new BadRequestException("A requirement candidate must have source references before it can be accepted.");
        }

        const finalRequirement = this.mergeRequirementCandidate(candidate, parsedInput.data.requirement);
        reviewedPayload = {
          requirement: finalRequirement,
          sourceReferences: candidate.sourceReferences
        } as unknown as Prisma.InputJsonValue;
        createdRequirement = await this.requirementsService.createDraftInTransaction(
          transaction,
          projectId,
          owner.id,
          finalRequirement,
          {
            sourceRefs: candidate.sourceReferences as Prisma.InputJsonValue,
            auditAction: "requirement.created_from_ai_draft",
            auditSummary: (reference) => `Created draft requirement ${reference} from an AI requirement candidate.`,
            auditMetadata: {
              aiDraftOutputId,
              candidateIndex: parsedInput.data.candidateIndex
            }
          }
        );

        await transaction.traceabilityLink.create({
          data: {
            projectId,
            sourceType: "requirement",
            sourceId: createdRequirement.id,
            targetType: "ai_draft_requirement_candidate",
            targetId: this.requirementCandidateKey(aiDraftOutputId, parsedInput.data.candidateIndex),
            linkType: "derived_from",
            status: "approved",
            createdBy: owner.id
          }
        });
      }

      await transaction.aiDraftReviewItem.create({
        data: {
          projectId,
          aiDraftOutputId,
          itemType: REQUIREMENT_CANDIDATE_ITEM_TYPE,
          itemIndex: parsedInput.data.candidateIndex,
          decision: parsedInput.data.decision,
          reviewedById: owner.id,
          ...(parsedInput.data.comments !== undefined ? { comments: parsedInput.data.comments } : {}),
          ...(reviewedPayload !== undefined ? { reviewedPayload } : {}),
          ...(createdRequirement !== undefined ? { createdRequirementId: createdRequirement.id } : {})
        }
      });

      const reviewedCandidates = await transaction.aiDraftReviewItem.count({
        where: {
          aiDraftOutputId,
          itemType: REQUIREMENT_CANDIDATE_ITEM_TYPE
        }
      });
      const acceptedCandidates = await transaction.aiDraftReviewItem.count({
        where: {
          aiDraftOutputId,
          itemType: REQUIREMENT_CANDIDATE_ITEM_TYPE,
          decision: "accepted"
        }
      });
      const reviewCompleted = reviewedCandidates === extraction.candidates.length;
      const reviewStatus = reviewCompleted
        ? acceptedCandidates > 0
          ? "accepted_by_ba"
          : "rejected_by_ba"
        : "under_ba_review";

      await transaction.aiDraftOutput.update({
        where: {
          id: aiDraftOutputId
        },
        data: {
          reviewStatus,
          reviewedAt: reviewCompleted ? new Date() : null
        }
      });

      await transaction.auditEvent.create({
        data: {
          projectId,
          actorId: owner.id,
          actorType: "user",
          action: `ai_draft_requirement_candidate.${parsedInput.data.decision}_by_ba`,
          artefactType: "ai_draft_output",
          artefactId: aiDraftOutputId,
          summary:
            parsedInput.data.decision === "accepted"
              ? `Accepted AI requirement candidate ${parsedInput.data.candidateIndex} as a draft requirement.`
              : `Rejected AI requirement candidate ${parsedInput.data.candidateIndex}.`,
          metadata: {
            candidateIndex: parsedInput.data.candidateIndex,
            decision: parsedInput.data.decision,
            ...(createdRequirement !== undefined ? { createdRequirementId: createdRequirement.id } : {})
          }
        }
      });
    });

    return this.getDraft(projectId, aiDraftOutputId);
  }

  private async requireDraft(projectId: string, aiDraftOutputId: string) {
    const draft = await this.prisma.aiDraftOutput.findFirst({
      where: {
        id: aiDraftOutputId,
        projectId
      },
      include: {
        reviewItems: {
          include: {
            reviewedBy: {
              select: {
                id: true,
                displayName: true,
                email: true
              }
            },
            createdRequirement: true
          },
          orderBy: {
            itemIndex: "asc"
          }
        }
      }
    });

    if (!draft) {
      throw new NotFoundException(`AI draft output ${aiDraftOutputId} was not found.`);
    }

    return draft;
  }

  private parseRequirementExtractionDraft(draft: { outputType: string; payload: Prisma.JsonValue }) {
    if (draft.outputType !== "requirement_extraction") {
      throw new BadRequestException(`AI draft output ${draft.outputType} does not contain requirement candidates.`);
    }

    const extraction = requirementExtractionSchema.safeParse(draft.payload);
    if (!extraction.success) {
      throw new BadRequestException("The AI draft output contains an invalid requirement extraction payload.");
    }

    return extraction.data;
  }

  private mergeRequirementCandidate(
    candidate: RequirementExtraction["candidates"][number],
    edits?: {
      title?: string | undefined;
      statement?: string | undefined;
      type?: CreateRequirementDto["type"] | undefined;
      priority?: CreateRequirementDto["priority"] | undefined;
      rationale?: string | null | undefined;
    }
  ): CreateRequirementDto {
    const rationale = edits?.rationale === null ? undefined : edits?.rationale ?? candidate.rationale;

    return {
      title: edits?.title ?? candidate.title,
      statement: edits?.statement ?? candidate.statement,
      type: edits?.type ?? candidate.type,
      priority: edits?.priority ?? candidate.priority,
      ...(rationale !== undefined ? { rationale } : {})
    };
  }

  private requirementCandidateKey(aiDraftOutputId: string, candidateIndex: number) {
    return `${aiDraftOutputId}:${REQUIREMENT_CANDIDATE_ITEM_TYPE}:${candidateIndex}`;
  }
}
