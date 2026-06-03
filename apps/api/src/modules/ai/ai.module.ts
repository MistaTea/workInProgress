import { Module } from "@nestjs/common";
import { AiController } from "./ai.controller";
import { AiJobQueueService } from "./ai-job-queue.service";
import { AiOrchestrationService } from "./ai-orchestration.service";

@Module({
  controllers: [AiController],
  providers: [AiOrchestrationService, AiJobQueueService],
  exports: [AiOrchestrationService]
})
export class AiModule {}
