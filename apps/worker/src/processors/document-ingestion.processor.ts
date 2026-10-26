import { randomUUID } from "node:crypto";
import { PrismaClient, type Prisma } from "@ba-workbench/database";
import type { Job } from "bullmq";
import OpenAI from "openai";
import { chunkDocumentText } from "./document-chunker";

export interface DocumentIngestionJob {
  documentId: string;
  projectId: string;
  ingestionAttemptId?: string;
}

export interface EmbeddingProvider {
  model: string;
  dimensions: number;
  embed(inputs: string[]): Promise<number[][]>;
}

export interface DocumentIngestionDependencies {
  prisma?: PrismaClient;
  embeddingProvider?: EmbeddingProvider | null;
  embeddingProviderFactory?: () => EmbeddingProvider | null;
}

const EMBEDDING_BATCH_SIZE = 64;
const PERSISTED_EMBEDDING_DIMENSIONS = 1_536;
let defaultPrisma: PrismaClient | undefined;

function getDefaultPrisma() {
  defaultPrisma ??= new PrismaClient();
  return defaultPrisma;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown ingestion error.";
}

function vectorLiteral(embedding: number[]) {
  return `[${embedding.join(",")}]`;
}

class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;

  constructor(
    private readonly client: OpenAI,
    model: string,
    dimensions: number
  ) {
    this.model = model;
    this.dimensions = dimensions;
  }

  async embed(inputs: string[]) {
    const embeddings: number[][] = [];

    for (let offset = 0; offset < inputs.length; offset += EMBEDDING_BATCH_SIZE) {
      const batch = inputs.slice(offset, offset + EMBEDDING_BATCH_SIZE);
      const response = await this.client.embeddings.create({
        model: this.model,
        input: batch,
        dimensions: this.dimensions,
        encoding_format: "float"
      });

      embeddings.push(...[...response.data].sort((left, right) => left.index - right.index).map((item) => item.embedding));
    }

    return embeddings;
  }
}

export function createEmbeddingProviderFromEnvironment(): EmbeddingProvider | null {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  const dimensions = Number(process.env.OPENAI_EMBEDDING_DIMENSIONS ?? PERSISTED_EMBEDDING_DIMENSIONS);
  if (dimensions !== PERSISTED_EMBEDDING_DIMENSIONS) {
    throw new Error(
      `OPENAI_EMBEDDING_DIMENSIONS must be ${PERSISTED_EMBEDDING_DIMENSIONS} until the pgvector column is migrated.`
    );
  }

  return new OpenAiEmbeddingProvider(
    new OpenAI({ apiKey }),
    process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
    dimensions
  );
}

async function recordFailure(
  prisma: PrismaClient,
  documentId: string,
  projectId: string,
  phase: "extraction" | "embedding",
  error: unknown,
  ingestionAttemptId: string | null
) {
  const message = errorMessage(error);
  await prisma.$transaction([
    prisma.document.update({
      where: { id: documentId, ingestionAttemptId },
      data:
        phase === "extraction"
          ? {
              extractionStatus: "failed",
              extractionError: message
            }
          : {
              embeddingStatus: "failed",
              embeddingError: message
            }
    }),
    prisma.auditEvent.create({
      data: {
        projectId,
        actorType: "system",
        action: `document.${phase}_failed`,
        artefactType: "document",
        artefactId: documentId,
        summary: `Document ${phase} failed.`,
        metadata: {
          error: message
        }
      }
    })
  ]);
}

async function persistChunks(
  prisma: PrismaClient,
  documentId: string,
  projectId: string,
  documentName: string,
  sourceText: string,
  ingestionAttemptId: string | null
) {
  const drafts = chunkDocumentText(sourceText);
  if (drafts.length === 0) {
    throw new Error("Document extraction produced no text chunks.");
  }

  return prisma.$transaction(async (transaction) => {
    // Evidence acknowledgements use the same document-before-chunk lock order.
    await transaction.$queryRaw`SELECT id FROM "Document" WHERE id = ${documentId} FOR UPDATE`;
    await transaction.documentEmbedding.deleteMany({
      where: {
        chunk: {
          documentId
        }
      }
    });

    const chunks = [];
    for (const draft of drafts) {
      chunks.push(
        await transaction.documentChunk.upsert({
          where: {
            documentId_chunkIndex: {
              documentId,
              chunkIndex: draft.chunkIndex
            }
          },
          update: {
            chunkText: draft.chunkText,
            pageRef: null,
            metadata: draft.metadata as Prisma.InputJsonValue
          },
          create: {
            id: randomUUID(),
            documentId,
            chunkIndex: draft.chunkIndex,
            chunkText: draft.chunkText,
            metadata: draft.metadata as Prisma.InputJsonValue
          }
        })
      );
    }

    await transaction.documentChunk.deleteMany({
      where: {
        documentId,
        chunkIndex: {
          gte: drafts.length
        }
      }
    });

    await transaction.document.update({
      where: { id: documentId, ingestionAttemptId },
      data: {
        extractionStatus: "completed",
        embeddingStatus: "pending",
        extractionError: null,
        embeddingError: null,
        extractedAt: new Date()
      }
    });

    await transaction.auditEvent.create({
      data: {
        projectId,
        actorType: "system",
        action: "document.extracted",
        artefactType: "document",
        artefactId: documentId,
        summary: `Extracted ${chunks.length} source chunks from ${documentName}.`,
        metadata: {
          chunkCount: chunks.length
        }
      }
    });

    return chunks;
  });
}

async function persistEmbeddings(
  prisma: PrismaClient,
  documentId: string,
  projectId: string,
  chunks: Array<{ id: string; chunkText: string }>,
  provider: EmbeddingProvider,
  ingestionAttemptId: string | null
) {
  await prisma.document.update({
    where: { id: documentId, ingestionAttemptId },
    data: {
      embeddingStatus: "processing",
      embeddingError: null
    }
  });

  const embeddings = await provider.embed(chunks.map((chunk) => chunk.chunkText));
  if (embeddings.length !== chunks.length) {
    throw new Error(`Embedding provider returned ${embeddings.length} vectors for ${chunks.length} chunks.`);
  }

  for (const embedding of embeddings) {
    if (embedding.length !== provider.dimensions) {
      throw new Error(`Embedding provider returned ${embedding.length} dimensions; expected ${provider.dimensions}.`);
    }
  }

  await prisma.$transaction(async (transaction) => {
    for (const [index, chunk] of chunks.entries()) {
      const embedding = embeddings[index];
      if (!embedding) {
        throw new Error(`Missing embedding for chunk ${chunk.id}.`);
      }

      await transaction.$executeRaw`
        INSERT INTO "DocumentEmbedding" ("id", "documentChunkId", "model", "dimensions", "embedding", "createdAt")
        VALUES (${randomUUID()}, ${chunk.id}, ${provider.model}, ${provider.dimensions}, ${vectorLiteral(embedding)}::vector, CURRENT_TIMESTAMP)
      `;
    }

    await transaction.document.update({
      where: { id: documentId, ingestionAttemptId },
      data: {
        embeddingStatus: "completed",
        embeddingError: null,
        embeddedAt: new Date()
      }
    });

    await transaction.auditEvent.create({
      data: {
        projectId,
        actorType: "system",
        action: "document.embedded",
        artefactType: "document",
        artefactId: documentId,
        summary: `Created embeddings for ${chunks.length} document chunks.`,
        metadata: {
          chunkCount: chunks.length,
          model: provider.model,
          dimensions: provider.dimensions
        }
      }
    });
  });
}

export async function ingestDocument(job: DocumentIngestionJob, dependencies: DocumentIngestionDependencies = {}) {
  const prisma = dependencies.prisma ?? getDefaultPrisma();
  const document = await prisma.document.findUnique({
    where: { id: job.documentId },
    select: {
      id: true,
      projectId: true,
      name: true,
      sourceText: true
    }
  });

  if (!document || document.projectId !== job.projectId) {
    throw new Error(`Document ${job.documentId} was not found in project ${job.projectId}.`);
  }

  const ingestionAttemptId = job.ingestionAttemptId ?? null;
  const claim = await prisma.document.updateMany({
    where: { id: document.id, ingestionAttemptId, extractionStatus: { in: ["pending", "queued", "queue_failed"] } },
    data: {
      extractionStatus: "processing",
      extractionError: null
    }
  });

  if (claim.count !== 1) {
    return { documentId: document.id, projectId: document.projectId, chunkCount: 0, extractionStatus: "superseded_or_already_claimed", embeddingStatus: "skipped", skipped: true };
  }

  let chunks: Array<{ id: string; chunkText: string }>;
  try {
    if (!document.sourceText?.trim()) {
      throw new Error("Document has no native source text to extract.");
    }

    chunks = await persistChunks(prisma, document.id, document.projectId, document.name, document.sourceText, ingestionAttemptId);
  } catch (error) {
    await recordFailure(prisma, document.id, document.projectId, "extraction", error, ingestionAttemptId);
    throw error;
  }

  try {
    const embeddingProvider =
      dependencies.embeddingProvider === undefined ? (dependencies.embeddingProviderFactory ?? createEmbeddingProviderFromEnvironment)() : dependencies.embeddingProvider;

    if (!embeddingProvider) {
      await prisma.document.update({
        where: { id: document.id, ingestionAttemptId },
        data: {
          embeddingStatus: "skipped",
          embeddingError: null
        }
      });

      return {
        documentId: document.id,
        projectId: document.projectId,
        chunkCount: chunks.length,
        extractionStatus: "completed",
        embeddingStatus: "skipped"
      };
    }

    await persistEmbeddings(prisma, document.id, document.projectId, chunks, embeddingProvider, ingestionAttemptId);
  } catch (error) {
    await recordFailure(prisma, document.id, document.projectId, "embedding", error, ingestionAttemptId);
    throw error;
  }

  return {
    documentId: document.id,
    projectId: document.projectId,
    chunkCount: chunks.length,
    extractionStatus: "completed",
    embeddingStatus: "completed"
  };
}

export async function handleDocumentIngestionJob(job: Job<DocumentIngestionJob>) {
  return ingestDocument(job.data);
}
