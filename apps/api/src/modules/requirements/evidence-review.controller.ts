import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import { EvidenceReviewService } from "./evidence-review.service";

@Controller()
export class EvidenceReviewController {
  constructor(@Inject(EvidenceReviewService) private readonly evidence: EvidenceReviewService) {}

  @Get("projects/:projectId/evidence-review")
  list(@Param("projectId") projectId: string) { return this.evidence.list(projectId); }

  @Get("requirements/:requirementId/evidence-review")
  detail(@Param("requirementId") requirementId: string) { return this.evidence.detail(requirementId); }

  @Post("requirements/:requirementId/evidence-review")
  acknowledge(@Param("requirementId") requirementId: string, @Body() body: unknown) {
    return this.evidence.acknowledge(requirementId, body);
  }
}
