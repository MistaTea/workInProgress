import { Injectable } from "@nestjs/common";

export interface CreateAiJobDto {
  jobType:
    | "extract_requirements"
    | "quality_review_requirement"
    | "generate_user_stories"
    | "generate_acceptance_criteria"
    | "generate_test_scenarios"
    | "summarise_transcript";
  sourceArtefactIds: string[];
  instructions?: string;
}

@Injectable()
export class AiOrchestrationService {
  createDraftJob(projectId: string, input: CreateAiJobDto) {
    return {
      id: `ai-job-${crypto.randomUUID()}`,
      projectId,
      jobType: input.jobType,
      status: "queued",
      sourceArtefactIds: input.sourceArtefactIds,
      reviewModel: "ai_draft_requires_human_review",
      createdAt: new Date().toISOString()
    };
  }
}
