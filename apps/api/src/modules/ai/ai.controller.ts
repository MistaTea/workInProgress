import { Body, Controller, Inject, Param, Post } from "@nestjs/common";
import { AiOrchestrationService, CreateAiJobDto } from "./ai-orchestration.service";

@Controller("projects/:projectId/ai")
export class AiController {
  constructor(@Inject(AiOrchestrationService) private readonly ai: AiOrchestrationService) {}

  @Post("jobs")
  createJob(@Param("projectId") projectId: string, @Body() body: CreateAiJobDto) {
    return this.ai.createDraftJob(projectId, body);
  }
}
