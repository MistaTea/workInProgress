import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { WorkspaceContextService } from "../database/workspace-context.service";

export interface CreateProjectDto {
  name: string;
  problemStatement?: string;
  objectives?: string[];
}

@Injectable()
export class ProjectsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WorkspaceContextService) private readonly workspaceContext: WorkspaceContextService
  ) {}

  async list() {
    const owner = await this.workspaceContext.getOwner();

    return this.prisma.project.findMany({
      where: {
        organisationId: owner.organisationId
      },
      orderBy: {
        updatedAt: "desc"
      }
    });
  }

  async create(input: CreateProjectDto) {
    const owner = await this.workspaceContext.getOwner();

    return this.prisma.$transaction(async (transaction) => {
      const project = await transaction.project.create({
        data: {
          organisationId: owner.organisationId,
          ownerId: owner.id,
          name: input.name,
          ...(input.problemStatement !== undefined ? { problemStatement: input.problemStatement } : {}),
          objectives: input.objectives ?? [],
          status: "draft",
          members: {
            create: {
              userId: owner.id,
              role: "owner"
            }
          }
        }
      });

      await transaction.auditEvent.create({
        data: {
          projectId: project.id,
          actorId: owner.id,
          actorType: "user",
          action: "project.created",
          artefactType: "project",
          artefactId: project.id,
          summary: `Created project ${project.name}.`
        }
      });

      return project;
    });
  }

  async getDashboard(projectId: string) {
    await this.workspaceContext.assertProjectAccess(projectId);

    const [requirementGroups, pendingApprovals, aiDraftsAwaitingReview, openRisks, jiraSyncConflicts] = await Promise.all([
      this.prisma.requirement.groupBy({
        by: ["status"],
        where: { projectId },
        _count: { _all: true }
      }),
      this.prisma.reviewLink.count({
        where: {
          baseline: { projectId },
          status: "active"
        }
      }),
      this.prisma.aiDraftOutput.count({
        where: {
          projectId,
          reviewStatus: {
            in: ["generated", "under_ba_review"]
          }
        }
      }),
      this.prisma.risk.count({
        where: {
          projectId,
          status: "open"
        }
      }),
      this.prisma.syncConflict.count({
        where: {
          status: "open",
          mapping: {
            provider: "jira",
            connection: {
              projectId
            }
          }
        }
      })
    ]);

    const requirementCounts = Object.fromEntries(
      requirementGroups.map((group) => [group.status, group._count._all])
    );

    const tracedRequirementCount = await this.prisma.traceabilityLink.count({
      where: {
        projectId,
        sourceType: "requirement",
        targetType: {
          in: ["user_story", "test_scenario"]
        }
      }
    });
    const totalRequirementCount = requirementGroups.reduce((total, group) => total + group._count._all, 0);

    return {
      projectId,
      requirementCounts,
      pendingApprovals,
      aiDraftsAwaitingReview,
      traceabilityCoveragePercent:
        totalRequirementCount === 0 ? 0 : Math.min(100, Math.round((tracedRequirementCount / totalRequirementCount) * 100)),
      openRisks,
      jiraSyncConflicts
    };
  }
}
