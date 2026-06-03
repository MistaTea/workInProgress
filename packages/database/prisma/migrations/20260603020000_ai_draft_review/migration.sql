-- CreateEnum
CREATE TYPE "AiDraftReviewDecision" AS ENUM ('accepted', 'rejected');

-- CreateTable
CREATE TABLE "AiDraftReviewItem" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "aiDraftOutputId" TEXT NOT NULL,
    "itemType" TEXT NOT NULL,
    "itemIndex" INTEGER NOT NULL,
    "decision" "AiDraftReviewDecision" NOT NULL,
    "reviewedById" TEXT NOT NULL,
    "comments" TEXT,
    "reviewedPayload" JSONB,
    "createdRequirementId" TEXT,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiDraftReviewItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiDraftReviewItem_createdRequirementId_key" ON "AiDraftReviewItem"("createdRequirementId");

-- CreateIndex
CREATE UNIQUE INDEX "AiDraftReviewItem_aiDraftOutputId_itemType_itemIndex_key"
ON "AiDraftReviewItem"("aiDraftOutputId", "itemType", "itemIndex");

-- CreateIndex
CREATE INDEX "AiDraftReviewItem_projectId_decision_idx" ON "AiDraftReviewItem"("projectId", "decision");

-- AddForeignKey
ALTER TABLE "AiDraftReviewItem"
ADD CONSTRAINT "AiDraftReviewItem_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDraftReviewItem"
ADD CONSTRAINT "AiDraftReviewItem_aiDraftOutputId_fkey"
FOREIGN KEY ("aiDraftOutputId") REFERENCES "AiDraftOutput"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDraftReviewItem"
ADD CONSTRAINT "AiDraftReviewItem_reviewedById_fkey"
FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDraftReviewItem"
ADD CONSTRAINT "AiDraftReviewItem_createdRequirementId_fkey"
FOREIGN KEY ("createdRequirementId") REFERENCES "Requirement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
