import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { PrismaClient } from "@ba-workbench/database";
import { chunkDocumentText } from "../src/processors/document-chunker";
import { ingestDocument, type EmbeddingProvider } from "../src/processors/document-ingestion.processor";

const prisma = new PrismaClient();

const fakeEmbeddingProvider: EmbeddingProvider = {
  model: "test-embedding-model",
  dimensions: 1_536,
  async embed(inputs) {
    return inputs.map((_, inputIndex) =>
      Array.from({ length: this.dimensions }, (__, dimensionIndex) => (dimensionIndex === inputIndex ? 1 : 0))
    );
  }
};

before(async () => {
  await prisma.$connect();
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "Organisation" CASCADE');
});

after(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "Organisation" CASCADE');
  await prisma.$disconnect();
});

test("chunks text with offsets that reproduce the exact cited source", () => {
  const sourceText = `${"First discovery paragraph. ".repeat(20)}\n\n${"Second discovery paragraph. ".repeat(20)}`;
  const chunks = chunkDocumentText(sourceText, {
    maxCharacters: 300,
    overlapCharacters: 40
  });

  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.equal(sourceText.slice(chunk.metadata.startOffset, chunk.metadata.endOffset), chunk.chunkText);
    assert.equal(chunk.metadata.characterCount, chunk.chunkText.length);
  }
});

test("extracts, embeds, audits, and preserves chunk identities when reprocessed", async () => {
  const organisation = await prisma.organisation.create({
    data: {
      name: "Worker Integration Test Workspace"
    }
  });
  const owner = await prisma.user.create({
    data: {
      organisationId: organisation.id,
      email: "worker-integration-test@ba-workbench.local",
      displayName: "Worker Integration Test BA"
    }
  });
  const project = await prisma.project.create({
    data: {
      organisationId: organisation.id,
      ownerId: owner.id,
      name: "Document intelligence test"
    }
  });
  const sourceText = `${"Payment exception discovery notes. ".repeat(45)}\n\n${"Operations needs traceable reasons. ".repeat(45)}`;
  const document = await prisma.document.create({
    data: {
      projectId: project.id,
      name: "Payments discovery notes",
      documentType: "text/plain",
      storageUri: "native://documents/test/versions/1",
      sourceText,
      extractionStatus: "queued",
      embeddingStatus: "pending"
    }
  });

  const firstResult = await ingestDocument(
    {
      documentId: document.id,
      projectId: project.id
    },
    {
      prisma,
      embeddingProvider: fakeEmbeddingProvider
    }
  );

  assert.equal(firstResult.extractionStatus, "completed");
  assert.equal(firstResult.embeddingStatus, "completed");
  assert.ok(firstResult.chunkCount > 1);

  const firstChunks = await prisma.documentChunk.findMany({
    where: { documentId: document.id },
    orderBy: { chunkIndex: "asc" }
  });
  const embeddingCount = await prisma.documentEmbedding.count({
    where: {
      chunk: {
        documentId: document.id
      }
    }
  });
  const auditActions = await prisma.auditEvent.findMany({
    where: {
      projectId: project.id,
      artefactId: document.id
    },
    select: {
      action: true
    },
    orderBy: {
      occurredAt: "asc"
    }
  });

  assert.equal(embeddingCount, firstChunks.length);
  assert.deepEqual(
    auditActions.map((event) => event.action),
    ["document.extracted", "document.embedded"]
  );

  for (const chunk of firstChunks) {
    const metadata = chunk.metadata as { startOffset: number; endOffset: number; characterCount: number };
    assert.equal(sourceText.slice(metadata.startOffset, metadata.endOffset), chunk.chunkText);
    assert.equal(metadata.characterCount, chunk.chunkText.length);
  }

  await ingestDocument(
    {
      documentId: document.id,
      projectId: project.id
    },
    {
      prisma,
      embeddingProvider: fakeEmbeddingProvider
    }
  );

  const secondChunks = await prisma.documentChunk.findMany({
    where: { documentId: document.id },
    orderBy: { chunkIndex: "asc" }
  });
  assert.deepEqual(
    secondChunks.map((chunk) => chunk.id),
    firstChunks.map((chunk) => chunk.id)
  );
});
