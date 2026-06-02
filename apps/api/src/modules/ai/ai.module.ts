import { Module } from "@nestjs/common";
import { AiController } from "./ai.controller";
import { AiOrchestrationService } from "./ai-orchestration.service";

@Module({
  controllers: [AiController],
  providers: [AiOrchestrationService],
  exports: [AiOrchestrationService]
})
export class AiModule {}
