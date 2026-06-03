-- AlterTable
ALTER TABLE "Document"
ADD COLUMN "sourceText" TEXT,
ADD COLUMN "embeddingStatus" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN "extractionError" TEXT,
ADD COLUMN "embeddingError" TEXT,
ADD COLUMN "extractedAt" TIMESTAMP(3),
ADD COLUMN "embeddedAt" TIMESTAMP(3);

-- Constrain embeddings to the configured OpenAI embedding dimension.
ALTER TABLE "DocumentEmbedding"
ALTER COLUMN "embedding" TYPE vector(1536)
USING "embedding"::vector(1536);

-- Support cosine similarity retrieval over document chunks.
CREATE INDEX "DocumentEmbedding_embedding_hnsw_idx"
ON "DocumentEmbedding"
USING hnsw ("embedding" vector_cosine_ops);
