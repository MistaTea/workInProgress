import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { extractRequirementsJobInputSchema } from "@ba-workbench/ai-schemas";
import type { Prisma } from "@ba-workbench/database";
import { PrismaService } from "../database/prisma.service";
import { WorkspaceContextService } from "../database/workspace-context.service";
import { AiJobQueueService } from "./ai-job-queue.service";

export interface CreateAiJobDto {
  jobType: string;
  sourceArtefactIds?: string[];
  instructions?: string;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown queueing error.";
}

@Injectable()
export class AiOrchestrationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WorkspaceContextService) private readonly workspaceContext: WorkspaceContextService,
    @Inject(AiJobQueueService) private readonly aiJobQueue: AiJobQueueService
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
}
