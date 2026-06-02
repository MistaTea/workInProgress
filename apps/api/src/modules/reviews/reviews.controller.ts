import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ReviewsService } from "./reviews.service";

@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

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
    return this.reviews.recordApproval(token, body);
  }
}
