import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@ba-workbench/database";
import { PrismaService } from "../database/prisma.service";
import { WorkspaceContextService } from "../database/workspace-context.service";
import { DocumentIngestionQueueService } from "./document-ingestion-queue.service";

const MAX_NATIVE_SOURCE_CHARACTERS = 2_000_000;
const SUPPORTED_NATIVE_DOCUMENT_TYPES = new Set(["text/plain", "text/markdown", "transcript"]);

export interface CreateDocumentDto {
  name: string;
  documentType: string;
  content: string;
  metadata?: Record<string, unknown>;
}

function normalizeSourceText(content: string) {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown queueing error.";
}

@Injectable()
export class DocumentsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WorkspaceContextService) private readonly workspaceContext: WorkspaceContextService,
    @Inject(DocumentIngestionQueueService) private readonly ingestionQueue: DocumentIngestionQueueService
  ) {}

  async listByProject(projectId: string) {
    await this.workspaceContext.assertProjectAccess(projectId);

    return this.prisma.document.findMany({
      where: { projectId },
      select: {
        id: true,
        projectId: true,
        name: true,
        documentType: true,
        storageUri: true,
        extractionStatus: true,
        embeddingStatus: true,
        extractionError: true,
        embeddingError: true,
        extractedAt: true,
        embeddedAt: true,
        version: true,
        metadata: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            chunks: true
          }
        }
      },
      orderBy: {
        updatedAt: "desc"
      }
    });
  }

  async create(projectId: string, input: CreateDocumentDto) {
    const { owner } = await this.workspaceContext.assertProjectAccess(projectId);
    const name = input.name?.trim();
    const sourceText = normalizeSourceText(input.content ?? "");

    if (!name) {
      throw new BadRequestException("Document name is required.");
    }

    if (!SUPPORTED_NATIVE_DOCUMENT_TYPES.has(input.documentType)) {
      throw new BadRequestException(
        `Unsupported native document type ${input.documentType}. Supported types: ${[...SUPPORTED_NATIVE_DOCUMENT_TYPES].join(", ")}.`
      );
    }

    if (!sourceText.trim()) {
      throw new BadRequestException("Document content is required.");
    }

    if (sourceText.length > MAX_NATIVE_SOURCE_CHARACTERS) {
      throw new BadRequestException(
        `Native document content cannot exceed ${MAX_NATIVE_SOURCE_CHARACTERS.toLocaleString()} characters.`
      );
    }

    const documentId = crypto.randomUUID();
    const storageUri = `native://documents/${documentId}/versions/1`;

    await this.prisma.$transaction(async (transaction) => {
      await transaction.document.create({
        data: {
          id: documentId,
          projectId,
          name,
          documentType: input.documentType,
          storageUri,
          sourceText,
          extractionStatus: "pending",
          embeddingStatus: "pending",
          ...(input.metadata !== undefined ? { metadata: input.metadata as Prisma.InputJsonValue } : {})
        }
      });

      await transaction.auditEvent.create({
        data: {
          projectId,
          actorId: owner.id,
          actorType: "user",
          action: "document.created",
          artefactType: "document",
          artefactId: documentId,
          summary: `Added document ${name}.`,
          metadata: {
            documentType: input.documentType,
            storageUri
          }
        }
      });
    });

    await this.enqueue(documentId, projectId);
    return this.get(documentId);
  }

  async get(documentId: string) {
    const owner = await this.workspaceContext.getOwner();
    const document = await this.prisma.document.findFirst({
      where: {
        id: documentId,
        project: {
          organisationId: owner.organisationId
        }
      },
      select: {
        id: true,
        projectId: true,
        name: true,
        documentType: true,
        storageUri: true,
        extractionStatus: true,
        embeddingStatus: true,
        extractionError: true,
        embeddingError: true,
        extractedAt: true,
        embeddedAt: true,
        version: true,
        metadata: true,
        createdAt: true,
        updatedAt: true,
        chunks: {
          select: {
            id: true,
            chunkIndex: true,
            chunkText: true,
            pageRef: true,
            metadata: true,
            createdAt: true,
            embedding: {
              select: {
                model: true,
                dimensions: true,
                createdAt: true
              }
            }
          },
          orderBy: {
            chunkIndex: "asc"
          }
        }
      }
    });

    if (!document) {
      throw new NotFoundException(`Document ${documentId} was not found.`);
    }

    return {
      ...document,
      chunks: document.chunks.map((chunk) => ({
        ...chunk,
        sourceReference: {
          artefactType: "document_chunk",
          artefactId: chunk.id,
          label: document.name,
          excerpt: chunk.chunkText.slice(0, 240),
          location: chunk.pageRef ?? this.chunkLocation(chunk.metadata)
        }
      }))
    };
  }

  async reingest(documentId: string) {
    const document = await this.get(documentId);
    await this.enqueue(document.id, document.projectId);
    return this.get(documentId);
  }

  private async enqueue(documentId: string, projectId: string) {
    try {
      await this.ingestionQueue.enqueue({ documentId, projectId });
      await this.prisma.document.update({
        where: { id: documentId },
        data: {
          extractionStatus: "queued",
          embeddingStatus: "pending",
          extractionError: null,
          embeddingError: null
        }
      });
    } catch (error) {
      await this.prisma.document.update({
        where: { id: documentId },
        data: {
          extractionStatus: "queue_failed",
          extractionError: errorMessage(error)
        }
      });
    }
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
