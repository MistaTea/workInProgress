import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import { AiOrchestrationService, type CreateAiJobDto } from "./ai-orchestration.service";

@Controller("projects/:projectId/ai")
export class AiController {
  constructor(@Inject(AiOrchestrationService) private readonly ai: AiOrchestrationService) {}

  @Get("jobs")
  listJobs(@Param("projectId") projectId: string) {
    return this.ai.listJobs(projectId);
  }

  @Post("jobs")
  createJob(@Param("projectId") projectId: string, @Body() body: CreateAiJobDto) {
    return this.ai.createDraftJob(projectId, body);
  }

  @Get("jobs/:aiJobId")
  getJob(@Param("projectId") projectId: string, @Param("aiJobId") aiJobId: string) {
    return this.ai.getJob(projectId, aiJobId);
  }
}
