import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@ba-workbench/database";
import type { RequirementStatus, RequirementSummary, RequirementType } from "@ba-workbench/shared";
import { PrismaService } from "../database/prisma.service";
import { WorkspaceContextService } from "../database/workspace-context.service";

export interface CreateRequirementDto {
  title: string;
  statement: string;
  type: RequirementType;
  priority?: RequirementSummary["priority"];
  rationale?: string | null;
}

export type UpdateRequirementDto = Partial<CreateRequirementDto> & {
  status?: RequirementStatus;
};

export interface RequirementCreationContext {
  sourceRefs?: Prisma.InputJsonValue;
  auditAction?: string;
  auditSummary?: (reference: string) => string;
  auditMetadata?: Prisma.InputJsonValue;
}

@Injectable()
export class RequirementsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WorkspaceContextService) private readonly workspaceContext: WorkspaceContextService
  ) {}

  async listByProject(projectId: string) {
    await this.workspaceContext.assertProjectAccess(projectId);

    return this.prisma.requirement.findMany({
      where: { projectId },
      orderBy: { reference: "asc" }
    });
  }

  async create(projectId: string, input: CreateRequirementDto) {
    const { owner } = await this.workspaceContext.assertProjectAccess(projectId);

    return this.prisma.$transaction((transaction) =>
      this.createDraftInTransaction(transaction, projectId, owner.id, input)
    );
  }

  async createDraftInTransaction(
    transaction: Prisma.TransactionClient,
    projectId: string,
    ownerId: string,
    input: CreateRequirementDto,
    context: RequirementCreationContext = {}
  ) {
    const requirementCount = await transaction.requirement.count({ where: { projectId } });
    const reference = `REQ-${String(requirementCount + 1).padStart(3, "0")}`;
    const priority = input.priority ?? "should";

    const requirement = await transaction.requirement.create({
      data: {
        projectId,
        reference,
        title: input.title,
        statement: input.statement,
        type: input.type,
        priority,
        ...(input.rationale !== undefined ? { rationale: input.rationale } : {}),
        status: "draft",
        ownerId,
        versions: {
          create: {
            version: 1,
            title: input.title,
            statement: input.statement,
            type: input.type,
            priority,
            ...(input.rationale !== undefined ? { rationale: input.rationale } : {}),
            ...(context.sourceRefs !== undefined ? { sourceRefs: context.sourceRefs } : {}),
            createdById: ownerId
          }
        }
      }
    });

    await transaction.auditEvent.create({
      data: {
        projectId,
        actorId: ownerId,
        actorType: "user",
        action: context.auditAction ?? "requirement.created",
        artefactType: "requirement",
        artefactId: requirement.id,
        summary: context.auditSummary?.(requirement.reference) ?? `Created requirement ${requirement.reference}.`,
        ...(context.auditMetadata !== undefined ? { metadata: context.auditMetadata } : {})
      }
    });

    return requirement;
  }

  async get(requirementId: string) {
    const owner = await this.workspaceContext.getOwner();
    const requirement = await this.prisma.requirement.findFirst({
      where: {
        id: requirementId,
        project: {
          organisationId: owner.organisationId
        }
      },
      include: {
        versions: {
          orderBy: {
            version: "desc"
          }
        }
      }
    });

    if (!requirement) {
      throw new NotFoundException(`Requirement ${requirementId} was not found.`);
    }

    return requirement;
  }

  async update(requirementId: string, input: UpdateRequirementDto) {
    const existing = await this.get(requirementId);
    const owner = await this.workspaceContext.getOwner();
    const nextTitle = input.title ?? existing.title;
    const nextStatement = input.statement ?? existing.statement;
    const nextType = input.type ?? existing.type;
    const nextPriority = input.priority ?? existing.priority;
    const nextRationale = input.rationale !== undefined ? input.rationale : existing.rationale;
    const nextSourceRefs = existing.versions[0]?.sourceRefs;
    const contentChanged = nextTitle !== existing.title || nextStatement !== existing.statement ||
      nextType !== existing.type || nextPriority !== existing.priority || nextRationale !== existing.rationale;
    // Approval evidence applies to a version, not all future edits.
    const nextVersion = existing.currentVersion + (contentChanged ? 1 : 0);
    const nextStatus = contentChanged ? "draft" : input.status;

    return this.prisma.$transaction(async (transaction) => {
      const update = await transaction.requirement.updateMany({
        where: { id: requirementId, currentVersion: existing.currentVersion },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.statement !== undefined ? { statement: input.statement } : {}),
          ...(input.type !== undefined ? { type: input.type } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.rationale !== undefined ? { rationale: input.rationale } : {}),
          ...(nextStatus !== undefined ? { status: nextStatus } : {}),
          currentVersion: nextVersion
        }
      });

      if (update.count !== 1) {
        throw new ConflictException("This requirement changed. Refresh it before saving your edits.");
      }
      const requirement = await transaction.requirement.findUniqueOrThrow({ where: { id: requirementId } });

      if (contentChanged) await transaction.requirementVersion.create({
        data: {
          requirementId,
          version: nextVersion,
          title: nextTitle,
          statement: nextStatement,
          type: nextType,
          priority: nextPriority,
          rationale: nextRationale,
          ...(nextSourceRefs !== null && nextSourceRefs !== undefined
            ? { sourceRefs: nextSourceRefs as Prisma.InputJsonValue }
            : {}),
          createdById: owner.id
        }
      });

      await transaction.auditEvent.create({
        data: {
          projectId: existing.projectId,
          actorId: owner.id,
          actorType: "user",
          action: "requirement.updated",
          artefactType: "requirement",
          artefactId: requirement.id,
          summary: `Updated requirement ${requirement.reference} to version ${nextVersion}.`,
          metadata: {
            version: nextVersion,
            changedFields: Object.keys(input)
          }
        }
      });

      return requirement;
    });
  }
}
