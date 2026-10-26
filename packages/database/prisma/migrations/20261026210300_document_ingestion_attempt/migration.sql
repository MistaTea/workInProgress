-- Bind queue callbacks and deliveries to their ingestion attempt.
ALTER TABLE "Document" ADD COLUMN "ingestionAttemptId" TEXT;
