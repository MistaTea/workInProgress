import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@ba-workbench/database";
import type { ApprovalDecision } from "@ba-workbench/shared";
import { PrismaService } from "../database/prisma.service";
import { WorkspaceContextService } from "../database/workspace-context.service";

export interface CreateReviewPacketDto {
  name?: string;
  requirementIds?: string[];
  stakeholderName?: string;
  stakeholderEmail?: string;
  expiresInDays?: number;
}

export interface RecordReviewDecisionDto {
  decision?: ApprovalDecision;
  reviewerName?: string;
  reviewerEmail?: string;
  comments?: string;
}

const DEFAULT_REVIEW_WINDOW_DAYS = 14;
const REVIEW_BASE_URL = (process.env.PUBLIC_WEB_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function normaliseOptionalText(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function validateDecision(decision: ApprovalDecision | undefined): ApprovalDecision {
  if (decision === "approved" || decision === "changes_requested" || decision === "rejected") {
    return decision;
  }

  throw new BadRequestException("Decision must be approved, changes_requested, or rejected.");
}

@Injectable()
export class ReviewsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WorkspaceContextService) private readonly workspaceContext: WorkspaceContextService
  ) {}

  async listReviewPackets(projectId: string) {
    await this.workspaceContext.assertProjectAccess(projectId);

    return this.prisma.requirementBaseline.findMany({
      where: { projectId },
      include: {
        items: {
          include: {
            requirement: true,
            requirementVersion: true
          },
          orderBy: {
            requirement: {
              reference: "asc"
            }
          }
        },
        reviewLinks: {
          include: {
            stakeholder: true,
            approvals: {
              orderBy: {
                decidedAt: "desc"
              }
            }
          },
          orderBy: {
            createdAt: "desc"
          }
        },
        approvals: {
          orderBy: {
            decidedAt: "desc"
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    });
  }

  async createReviewPacket(projectId: string, input: CreateReviewPacketDto) {
    const { owner } = await this.workspaceContext.assertProjectAccess(projectId);
    const requirementIds = [...new Set(input.requirementIds ?? [])];
    if (requirementIds.length === 0) {
      throw new BadRequestException("Select at least one requirement for stakeholder review.");
    }

    const requirements = await this.prisma.requirement.findMany({
      where: {
        projectId,
        id: {
          in: requirementIds
        }
      },
      include: {
        versions: {
          orderBy: {
            version: "desc"
          },
          take: 1
        }
      },
      orderBy: {
        reference: "asc"
      }
    });

    if (requirements.length !== requirementIds.length) {
      throw new BadRequestException("One or more selected requirements do not belong to this project.");
    }

    const missingVersions = requirements.filter((requirement) => requirement.versions.length === 0);
    if (missingVersions.length > 0) {
      throw new BadRequestException("Every selected requirement must have a version before stakeholder review.");
    }

    const latestBaseline = await this.prisma.requirementBaseline.findFirst({
      where: { projectId },
      orderBy: {
        version: "desc"
      }
    });
    const nextBaselineVersion = (latestBaseline?.version ?? 0) + 1;
    const stakeholderName = normaliseOptionalText(input.stakeholderName);
    const stakeholderEmail = normaliseOptionalText(input.stakeholderEmail);
    const expiresInDays = input.expiresInDays && input.expiresInDays > 0 ? Math.min(input.expiresInDays, 60) : DEFAULT_REVIEW_WINDOW_DAYS;
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

    const packet = await this.prisma.$transaction(async (transaction) => {
      const stakeholder =
        stakeholderName || stakeholderEmail
          ? await transaction.stakeholder.create({
              data: {
                projectId,
                name: stakeholderName ?? stakeholderEmail ?? "Stakeholder reviewer",
                ...(stakeholderEmail !== undefined ? { email: stakeholderEmail } : {}),
                approvalRole: "reviewer"
              }
            })
          : null;

      const baseline = await transaction.requirementBaseline.create({
        data: {
          projectId,
          name: normaliseOptionalText(input.name) ?? `Stakeholder review packet v${nextBaselineVersion}`,
          version: nextBaselineVersion,
          status: "sent_for_review",
          createdById: owner.id,
          items: {
            create: requirements.map((requirement) => ({
              requirementId: requirement.id,
              requirementVersionId: requirement.versions[0]!.id
            }))
          }
        }
      });

      await transaction.reviewLink.create({
        data: {
          tokenHash: tokenHash(token),
          ...(stakeholder !== null ? { stakeholderId: stakeholder.id } : {}),
          baselineId: baseline.id,
          artefactType: "requirement_baseline",
          artefactId: baseline.id,
          status: "active",
          expiresAt,
          emailRequired: false
        }
      });

      await transaction.requirement.updateMany({
        where: {
          id: {
            in: requirementIds
          }
        },
        data: {
          status: "in_review"
        }
      });

      await transaction.auditEvent.create({
        data: {
          projectId,
          actorId: owner.id,
          actorType: "user",
          action: "review_packet.created",
          artefactType: "requirement_baseline",
          artefactId: baseline.id,
          summary: `Created stakeholder review packet ${baseline.name}.`,
          metadata: {
            baselineVersion: nextBaselineVersion,
            requirementIds,
            ...(stakeholderEmail !== undefined ? { stakeholderEmail } : {})
          } as Prisma.InputJsonValue
        }
      });

      return baseline;
    });

    const [packetDetail] = await this.listReviewPackets(projectId);
    const createdPacket = packetDetail?.id === packet.id ? packetDetail : await this.getBaselineForProject(projectId, packet.id);

    return {
      ...createdPacket,
      reviewUrl: `${REVIEW_BASE_URL}/stakeholder-review/${token}`,
      token
    };
  }

  async createReviewLink(baselineId: string, stakeholderEmail?: string) {
    const baseline = await this.prisma.requirementBaseline.findUnique({
      where: { id: baselineId },
      include: {
        project: true
      }
    });
    if (!baseline) {
      throw new NotFoundException(`Review packet ${baselineId} was not found.`);
    }

    await this.workspaceContext.assertProjectAccess(baseline.projectId);
    const token = randomUUID();
    const stakeholderEmailValue = normaliseOptionalText(stakeholderEmail);
    const stakeholder =
      stakeholderEmailValue !== undefined
        ? await this.prisma.stakeholder.create({
            data: {
              projectId: baseline.projectId,
              name: stakeholderEmailValue,
              email: stakeholderEmailValue,
              approvalRole: "reviewer"
            }
          })
        : null;

    const reviewLink = await this.prisma.reviewLink.create({
      data: {
        tokenHash: tokenHash(token),
        ...(stakeholder !== null ? { stakeholderId: stakeholder.id } : {}),
        baselineId: baseline.id,
        artefactType: "requirement_baseline",
        artefactId: baseline.id,
        status: "active",
        expiresAt: new Date(Date.now() + DEFAULT_REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000),
        emailRequired: false
      }
    });

    return {
      ...reviewLink,
      reviewUrl: `${REVIEW_BASE_URL}/stakeholder-review/${token}`,
      token
    };
  }

  async getReview(token: string) {
    const reviewLink = await this.findActiveReviewLink(token);

    return {
      token,
      artefactType: reviewLink.artefactType,
      artefactVersion: reviewLink.baseline ? `v${reviewLink.baseline.version}` : undefined,
      status: reviewLink.status,
      expiresAt: reviewLink.expiresAt,
      stakeholder: reviewLink.stakeholder,
      baseline: reviewLink.baseline,
      approvals: reviewLink.approvals,
      requiresEmailVerification: reviewLink.emailRequired
    };
  }

  async recordApproval(token: string, input: RecordReviewDecisionDto) {
    const decision = validateDecision(input.decision);
    const reviewerName = normaliseOptionalText(input.reviewerName);
    if (!reviewerName) {
      throw new BadRequestException("Reviewer name is required.");
    }

    const reviewLink = await this.findActiveReviewLink(token);
    if (!reviewLink.baselineId || !reviewLink.baseline) {
      throw new BadRequestException("This review link is not attached to a requirement review packet.");
    }
    const baselineId = reviewLink.baselineId;
    if (reviewLink.status !== "active") {
      throw new ConflictException("This review link has already been completed.");
    }
    if (reviewLink.expiresAt.getTime() < Date.now()) {
      await this.prisma.reviewLink.update({
        where: { id: reviewLink.id },
        data: { status: "expired" }
      });
      throw new ConflictException("This review link has expired.");
    }

    const reviewerEmail = normaliseOptionalText(input.reviewerEmail);
    const comments = normaliseOptionalText(input.comments);

    const evidence = await this.prisma.$transaction(async (transaction) => {
      const approvalEvidence = await transaction.approvalEvidence.create({
        data: {
          stakeholderId: reviewLink.stakeholderId,
          reviewLinkId: reviewLink.id,
          baselineId,
          artefactType: "requirement_baseline",
          artefactId: baselineId,
          artefactVersion: `v${reviewLink.baseline!.version}`,
          decision,
          ...(comments !== undefined ? { comments } : {}),
          reviewerName,
          ...(reviewerEmail !== undefined ? { reviewerEmail } : {})
        }
      });

      await transaction.reviewLink.update({
        where: { id: reviewLink.id },
        data: {
          status: "completed"
        }
      });

      await transaction.requirementBaseline.update({
        where: { id: baselineId },
        data: {
          status: decision,
          ...(decision === "approved" ? { approvedAt: new Date() } : {})
        }
      });

      await transaction.requirement.updateMany({
        where: {
          id: {
            in: reviewLink.baseline!.items.map((item) => item.requirementId)
          }
        },
        data: {
          status: decision === "approved" ? "approved" : decision === "rejected" ? "rejected" : "change_requested"
        }
      });

      await transaction.auditEvent.create({
        data: {
          projectId: reviewLink.baseline!.projectId,
          actorType: "stakeholder_link",
          action: `review_packet.${decision}`,
          artefactType: "requirement_baseline",
          artefactId: baselineId,
          summary: `${reviewerName} recorded ${decision.replace(/_/g, " ")} for ${reviewLink.baseline!.name}.`,
          metadata: {
            reviewLinkId: reviewLink.id,
            approvalEvidenceId: approvalEvidence.id,
            decision
          } as Prisma.InputJsonValue
        }
      });

      return approvalEvidence;
    });

    return {
      token,
      decision,
      evidence,
      decidedAt: evidence.decidedAt
    };
  }

  private async findActiveReviewLink(token: string) {
    const reviewLink = await this.prisma.reviewLink.findUnique({
      where: {
        tokenHash: tokenHash(token)
      },
      include: {
        stakeholder: true,
        approvals: {
          orderBy: {
            decidedAt: "desc"
          }
        },
        baseline: {
          include: {
            items: {
              include: {
                requirement: true,
                requirementVersion: true
              },
              orderBy: {
                requirement: {
                  reference: "asc"
                }
              }
            }
          }
        }
      }
    });

    if (!reviewLink) {
      throw new NotFoundException("Review link was not found.");
    }

    return reviewLink;
  }

  private async getBaselineForProject(projectId: string, baselineId: string) {
    const baseline = await this.prisma.requirementBaseline.findFirst({
      where: {
        id: baselineId,
        projectId
      },
      include: {
        items: {
          include: {
            requirement: true,
            requirementVersion: true
          },
          orderBy: {
            requirement: {
              reference: "asc"
            }
          }
        },
        reviewLinks: {
          include: {
            stakeholder: true,
            approvals: {
              orderBy: {
                decidedAt: "desc"
              }
            }
          },
          orderBy: {
            createdAt: "desc"
          }
        },
        approvals: {
          orderBy: {
            decidedAt: "desc"
          }
        }
      }
    });

    if (!baseline) {
      throw new NotFoundException(`Review packet ${baselineId} was not found.`);
    }

    return baseline;
  }
}
