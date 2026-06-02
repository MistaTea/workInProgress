import { Injectable } from "@nestjs/common";

@Injectable()
export class ReviewsService {
  createReviewLink(baselineId: string, stakeholderEmail?: string) {
    return {
      baselineId,
      reviewUrl: `/review/${crypto.randomUUID()}`,
      stakeholderEmail,
      status: "active",
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString()
    };
  }

  getReview(token: string) {
    return {
      token,
      artefactType: "requirement_baseline",
      artefactVersion: "v0.1",
      status: "active",
      requiresEmailVerification: true
    };
  }

  recordApproval(token: string, input: { reviewerName: string; comments?: string }) {
    return {
      token,
      decision: "approved",
      reviewerName: input.reviewerName,
      comments: input.comments,
      decidedAt: new Date().toISOString()
    };
  }
}
