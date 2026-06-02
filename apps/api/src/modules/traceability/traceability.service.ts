import { Injectable } from "@nestjs/common";
import type { TraceabilityLinkType } from "@ba-workbench/shared";

export interface CreateTraceabilityLinkDto {
  projectId: string;
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  linkType: TraceabilityLinkType;
}

@Injectable()
export class TraceabilityService {
  getMatrix(projectId: string) {
    return {
      projectId,
      coverage: {
        requirementsWithStories: 68,
        requirementsWithTestScenarios: 54,
        orphanRequirements: 6
      },
      links: []
    };
  }

  createLink(input: CreateTraceabilityLinkDto) {
    return {
      id: `trace-${crypto.randomUUID()}`,
      ...input,
      status: "approved",
      createdAt: new Date().toISOString()
    };
  }
}
