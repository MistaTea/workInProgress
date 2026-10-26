-- No historical acknowledgements are backfilled: legacy evidence remains not reviewed.
CREATE TABLE "RequirementEvidenceReview" (
  "sequence" SERIAL NOT NULL,
  "id" TEXT NOT NULL,
  "requirementId" TEXT NOT NULL,
  "requirementVersionId" TEXT NOT NULL,
  "requirementVersion" INTEGER NOT NULL,
  "reviewedById" TEXT NOT NULL,
  "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "outcome" TEXT NOT NULL,
  "comment" TEXT,
  "sourceFingerprints" JSONB NOT NULL,
  "requestId" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  CONSTRAINT "RequirementEvidenceReview_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RequirementEvidenceReview_outcome_check" CHECK ("outcome" IN ('supports', 'needs_follow_up'))
);
CREATE UNIQUE INDEX "RequirementEvidenceReview_requirementId_requestId_key" ON "RequirementEvidenceReview"("requirementId", "requestId");
CREATE INDEX "RequirementEvidenceReview_requirementId_reviewedAt_idx" ON "RequirementEvidenceReview"("requirementId", "reviewedAt");
ALTER TABLE "RequirementEvidenceReview" ADD CONSTRAINT "RequirementEvidenceReview_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RequirementEvidenceReview" ADD CONSTRAINT "RequirementEvidenceReview_requirementVersionId_fkey" FOREIGN KEY ("requirementVersionId") REFERENCES "RequirementVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RequirementEvidenceReview" ADD CONSTRAINT "RequirementEvidenceReview_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "RequirementEvidenceReview_sequence_key" ON "RequirementEvidenceReview"("sequence");
