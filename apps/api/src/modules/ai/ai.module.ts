import { Module } from "@nestjs/common";
import { RequirementsModule } from "../requirements/requirements.module";
import { AiController } from "./ai.controller";
import { AiJobQueueService } from "./ai-job-queue.service";
import { AiOrchestrationService } from "./ai-orchestration.service";

@Module({
  imports: [RequirementsModule],
  controllers: [AiController],
  providers: [AiOrchestrationService, AiJobQueueService],
  exports: [AiOrchestrationService]
})
export class AiModule {}
