import { Prisma, type PrismaClient } from "@prisma/client";

export const DOCUMENT_EMBEDDING_DIMENSIONS = 1_536;

export interface DocumentChunkSearchResult {
  id: string;
  documentId: string;
  documentName: string;
  documentType: string;
  chunkIndex: number;
  chunkText: string;
  pageRef: string | null;
  metadata: Prisma.JsonValue;
  similarity: number;
}

export interface SearchDocumentChunksByVectorInput {
  projectId: string;
  embedding: number[];
  model: string;
  limit?: number;
  documentIds?: string[];
}

function vectorLiteral(embedding: number[]) {
  if (embedding.length !== DOCUMENT_EMBEDDING_DIMENSIONS || embedding.some((value) => !Number.isFinite(value))) {
    throw new Error(`Document search embeddings must contain ${DOCUMENT_EMBEDDING_DIMENSIONS} finite numbers.`);
  }

  return `[${embedding.join(",")}]`;
}

export async function searchDocumentChunksByVector(
  prisma: PrismaClient,
  input: SearchDocumentChunksByVectorInput
): Promise<DocumentChunkSearchResult[]> {
  const limit = Math.min(50, Math.max(1, input.limit ?? 10));
  const documentIds = [...new Set(input.documentIds ?? [])];
  const documentFilter =
    documentIds.length > 0
      ? Prisma.sql`AND document."id" IN (${Prisma.join(documentIds)})`
      : Prisma.sql``;
  const queryVector = vectorLiteral(input.embedding);

  return prisma.$queryRaw<DocumentChunkSearchResult[]>(Prisma.sql`
    SELECT
      chunk."id",
      chunk."documentId",
      document."name" AS "documentName",
      document."documentType",
      chunk."chunkIndex",
      chunk."chunkText",
      chunk."pageRef",
      chunk."metadata",
      1 - (embedding."embedding" <=> ${queryVector}::vector) AS "similarity"
    FROM "DocumentEmbedding" AS embedding
    INNER JOIN "DocumentChunk" AS chunk ON chunk."id" = embedding."documentChunkId"
    INNER JOIN "Document" AS document ON document."id" = chunk."documentId"
    WHERE document."projectId" = ${input.projectId}
      AND embedding."model" = ${input.model}
      ${documentFilter}
    ORDER BY embedding."embedding" <=> ${queryVector}::vector
    LIMIT ${limit}
  `);
}
