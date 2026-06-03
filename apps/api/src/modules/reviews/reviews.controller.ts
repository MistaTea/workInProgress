import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import { type CreateReviewPacketDto, type RecordReviewDecisionDto, ReviewsService } from "./reviews.service";

@Controller()
export class ReviewsController {
  constructor(@Inject(ReviewsService) private readonly reviews: ReviewsService) {}

  @Get("projects/:projectId/review-packets")
  listReviewPackets(@Param("projectId") projectId: string) {
    return this.reviews.listReviewPackets(projectId);
  }

  @Post("projects/:projectId/review-packets")
  createReviewPacket(@Param("projectId") projectId: string, @Body() body: CreateReviewPacketDto) {
    return this.reviews.createReviewPacket(projectId, body);
  }

  @Post("baselines/:baselineId/send-review")
  sendReview(@Param("baselineId") baselineId: string, @Body() body: { stakeholderEmail?: string }) {
    return this.reviews.createReviewLink(baselineId, body.stakeholderEmail);
  }

  @Get("review/:token")
  getReview(@Param("token") token: string) {
    return this.reviews.getReview(token);
  }

  @Post("review/:token/approve")
  approve(@Param("token") token: string, @Body() body: { reviewerName: string; comments?: string }) {
    return this.reviews.recordApproval(token, { ...body, decision: "approved" });
  }

  @Post("review/:token/decision")
  decision(@Param("token") token: string, @Body() body: RecordReviewDecisionDto) {
    return this.reviews.recordApproval(token, body);
  }
}
