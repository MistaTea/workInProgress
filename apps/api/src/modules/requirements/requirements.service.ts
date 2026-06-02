import { Injectable, NotFoundException } from "@nestjs/common";
import type { RequirementStatus, RequirementSummary, RequirementType } from "@ba-workbench/shared";

export interface CreateRequirementDto {
  title: string;
  statement: string;
  type: RequirementType;
  priority?: RequirementSummary["priority"];
}

export type UpdateRequirementDto = Partial<CreateRequirementDto> & {
  status?: RequirementStatus;
};

@Injectable()
export class RequirementsService {
  private readonly requirements: RequirementSummary[] = [
    {
      id: "req-001",
      reference: "REQ-001",
      title: "Capture payment exception reason",
      statement: "The system must capture a standardised exception reason when a payment fails validation.",
      type: "functional",
      status: "draft",
      priority: "must",
      qualityScore: 84,
      sourceReferences: []
    }
  ];

  listByProject(_projectId: string) {
    return this.requirements;
  }

  create(_projectId: string, input: CreateRequirementDto) {
    const requirement: RequirementSummary = {
      id: `req-${crypto.randomUUID()}`,
      reference: `REQ-${String(this.requirements.length + 1).padStart(3, "0")}`,
      title: input.title,
      statement: input.statement,
      type: input.type,
      status: "draft",
      priority: input.priority ?? "should",
      sourceReferences: []
    };

    this.requirements.push(requirement);
    return requirement;
  }

  get(requirementId: string) {
    const requirement = this.requirements.find((item) => item.id === requirementId);
    if (!requirement) {
      throw new NotFoundException(`Requirement ${requirementId} was not found.`);
    }
    return requirement;
  }

  update(requirementId: string, input: UpdateRequirementDto) {
    const requirement = this.get(requirementId);
    Object.assign(requirement, input);
    return requirement;
  }
}
