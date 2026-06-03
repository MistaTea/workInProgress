import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@ba-workbench/database";
import type { RequirementStatus, RequirementSummary, RequirementType } from "@ba-workbench/shared";
import { PrismaService } from "../database/prisma.service";
import { WorkspaceContextService } from "../database/workspace-context.service";

export interface CreateRequirementDto {
  title: string;
  statement: string;
  type: RequirementType;
  priority?: RequirementSummary["priority"];
  rationale?: string;
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
    const nextVersion = existing.currentVersion + 1;
    const nextTitle = input.title ?? existing.title;
    const nextStatement = input.statement ?? existing.statement;
    const nextType = input.type ?? existing.type;
    const nextPriority = input.priority ?? existing.priority;
    const nextRationale = input.rationale ?? existing.rationale;
    const nextSourceRefs = existing.versions[0]?.sourceRefs;

    return this.prisma.$transaction(async (transaction) => {
      const requirement = await transaction.requirement.update({
        where: { id: requirementId },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.statement !== undefined ? { statement: input.statement } : {}),
          ...(input.type !== undefined ? { type: input.type } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.rationale !== undefined ? { rationale: input.rationale } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          currentVersion: nextVersion
        }
      });

      await transaction.requirementVersion.create({
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
