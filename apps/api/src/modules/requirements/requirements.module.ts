import { EvidenceReviewController } from "./evidence-review.controller";
import { EvidenceReviewService } from "./evidence-review.service";
import { Module } from "@nestjs/common";
import { RequirementsController } from "./requirements.controller";
import { RequirementsService } from "./requirements.service";

@Module({
  controllers: [RequirementsController, EvidenceReviewController],
  providers: [RequirementsService, EvidenceReviewService],
  exports: [RequirementsService]
})
export class RequirementsModule {}
