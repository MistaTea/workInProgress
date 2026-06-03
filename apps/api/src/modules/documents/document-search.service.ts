import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import {
  DOCUMENT_EMBEDDING_DIMENSIONS,
  searchDocumentChunksByVector,
  type DocumentChunkSearchResult,
  type Prisma
} from "@ba-workbench/database";
import OpenAI from "openai";
import { z } from "zod";
import { PrismaService } from "../database/prisma.service";
import { WorkspaceContextService } from "../database/workspace-context.service";

const searchDocumentsSchema = z.object({
  query: z.string().trim().min(1).max(4_000),
  limit: z.number().int().min(1).max(50).optional(),
  documentIds: z.array(z.string().min(1)).max(50).optional()
});

export type SearchDocumentsDto = z.infer<typeof searchDocumentsSchema>;

interface QueryEmbedding {
  embedding: number[];
  model: string;
}

@Injectable()
export class OpenAiQueryEmbeddingService {
  async embed(query: string): Promise<QueryEmbedding> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      throw new ServiceUnavailableException("Semantic search requires OPENAI_API_KEY.");
    }

    const dimensions = Number(process.env.OPENAI_EMBEDDING_DIMENSIONS ?? DOCUMENT_EMBEDDING_DIMENSIONS);
    if (dimensions !== DOCUMENT_EMBEDDING_DIMENSIONS) {
      throw new ServiceUnavailableException(
        `OPENAI_EMBEDDING_DIMENSIONS must be ${DOCUMENT_EMBEDDING_DIMENSIONS} until the pgvector column is migrated.`
      );
    }

    const model = process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";
    const response = await new OpenAI({ apiKey }).embeddings.create({
      model,
      input: query,
      dimensions,
      encoding_format: "float"
    });
    const embedding = response.data[0]?.embedding;

    if (!embedding || embedding.length !== dimensions) {
      throw new ServiceUnavailableException("The embedding provider returned an invalid query embedding.");
    }

    return { embedding, model };
  }
}

@Injectable()
export class DocumentSearchService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WorkspaceContextService) private readonly workspaceContext: WorkspaceContextService,
    @Inject(OpenAiQueryEmbeddingService) private readonly queryEmbedding: OpenAiQueryEmbeddingService
  ) {}

  async search(projectId: string, input: SearchDocumentsDto) {
    const parsedInput = searchDocumentsSchema.safeParse(input);
    if (!parsedInput.success) {
      throw new BadRequestException(parsedInput.error.issues.map((issue) => issue.message).join(" "));
    }

    await this.workspaceContext.assertProjectAccess(projectId);
    const documentIds = [...new Set(parsedInput.data.documentIds ?? [])];
    await this.assertDocumentScope(projectId, documentIds);
    const { embedding, model } = await this.queryEmbedding.embed(parsedInput.data.query);
    return this.retrieve(projectId, {
      embedding,
      model,
      ...(parsedInput.data.limit !== undefined ? { limit: parsedInput.data.limit } : {}),
      documentIds
    });
  }

  async searchByEmbedding(
    projectId: string,
    input: {
      embedding: number[];
      model: string;
      limit?: number;
      documentIds?: string[];
    }
  ) {
    await this.workspaceContext.assertProjectAccess(projectId);
    const documentIds = [...new Set(input.documentIds ?? [])];
    await this.assertDocumentScope(projectId, documentIds);

    return this.retrieve(projectId, {
      embedding: input.embedding,
      model: input.model,
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
      documentIds
    });
  }

  private async assertDocumentScope(projectId: string, documentIds: string[]) {
    if (documentIds.length > 0) {
      const accessibleDocumentCount = await this.prisma.document.count({
        where: {
          projectId,
          id: {
            in: documentIds
          }
        }
      });

      if (accessibleDocumentCount !== documentIds.length) {
        throw new BadRequestException("One or more selected documents do not belong to this project.");
      }
    }
  }

  private async retrieve(
    projectId: string,
    input: {
      embedding: number[];
      model: string;
      limit?: number;
      documentIds: string[];
    }
  ) {
    const results = await searchDocumentChunksByVector(this.prisma, {
      projectId,
      embedding: input.embedding,
      model: input.model,
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
      documentIds: input.documentIds
    });

    return results.map((result) => this.toSearchResult(result));
  }

  private toSearchResult(result: DocumentChunkSearchResult) {
    return {
      ...result,
      sourceReference: {
        artefactType: "document_chunk",
        artefactId: result.id,
        label: result.documentName,
        excerpt: result.chunkText.slice(0, 240),
        location: result.pageRef ?? this.chunkLocation(result.metadata)
      }
    };
  }

  private chunkLocation(metadata: Prisma.JsonValue) {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      return undefined;
    }

    const values = metadata as Prisma.JsonObject;
    const startOffset = values.startOffset;
    const endOffset = values.endOffset;
    return typeof startOffset === "number" && typeof endOffset === "number"
      ? `Characters ${startOffset + 1}-${endOffset}`
      : undefined;
  }
}
