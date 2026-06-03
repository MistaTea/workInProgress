import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  DOCUMENT_EMBEDDING_DIMENSIONS,
  PrismaClient,
  searchDocumentChunksByVector
} from "../src";

const prisma = new PrismaClient();

function embedding(valueAtFirstDimension: number, valueAtSecondDimension: number) {
  return Array.from({ length: DOCUMENT_EMBEDDING_DIMENSIONS }, (_, index) => {
    if (index === 0) {
      return valueAtFirstDimension;
    }
    if (index === 1) {
      return valueAtSecondDimension;
    }
    return 0;
  });
}

function vectorLiteral(values: number[]) {
  return `[${values.join(",")}]`;
}

before(async () => {
  await prisma.$connect();
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "Organisation" CASCADE');
});

after(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "Organisation" CASCADE');
  await prisma.$disconnect();
});

test("ranks document chunks by cosine similarity within the selected project and model", async () => {
  const organisation = await prisma.organisation.create({
    data: {
      name: "Retrieval Test Workspace"
    }
  });
  const owner = await prisma.user.create({
    data: {
      organisationId: organisation.id,
      email: "retrieval-test@ba-workbench.local",
      displayName: "Retrieval Test BA"
    }
  });
  const project = await prisma.project.create({
    data: {
      organisationId: organisation.id,
      ownerId: owner.id,
      name: "Payments modernisation"
    }
  });
  const otherProject = await prisma.project.create({
    data: {
      organisationId: organisation.id,
      ownerId: owner.id,
      name: "Other project"
    }
  });
  const document = await prisma.document.create({
    data: {
      projectId: project.id,
      name: "Payments discovery notes",
      documentType: "text/plain",
      storageUri: "native://documents/retrieval/versions/1",
      extractionStatus: "completed",
      embeddingStatus: "completed"
    }
  });
  const otherDocument = await prisma.document.create({
    data: {
      projectId: otherProject.id,
      name: "Other project notes",
      documentType: "text/plain",
      storageUri: "native://documents/other/versions/1",
      extractionStatus: "completed",
      embeddingStatus: "completed"
    }
  });
  const matchingChunk = await prisma.documentChunk.create({
    data: {
      documentId: document.id,
      chunkIndex: 0,
      chunkText: "Operations needs standardised payment exception reasons."
    }
  });
  const secondaryChunk = await prisma.documentChunk.create({
    data: {
      documentId: document.id,
      chunkIndex: 1,
      chunkText: "The finance team needs monthly reporting."
    }
  });
  const otherProjectChunk = await prisma.documentChunk.create({
    data: {
      documentId: otherDocument.id,
      chunkIndex: 0,
      chunkText: "This chunk must never leak across projects."
    }
  });

  await prisma.$executeRaw`
    INSERT INTO "DocumentEmbedding" ("id", "documentChunkId", "model", "dimensions", "embedding", "createdAt")
    VALUES
      (${crypto.randomUUID()}, ${matchingChunk.id}, ${"test-embedding-model"}, ${DOCUMENT_EMBEDDING_DIMENSIONS}, ${vectorLiteral(embedding(1, 0))}::vector, CURRENT_TIMESTAMP),
      (${crypto.randomUUID()}, ${secondaryChunk.id}, ${"test-embedding-model"}, ${DOCUMENT_EMBEDDING_DIMENSIONS}, ${vectorLiteral(embedding(0, 1))}::vector, CURRENT_TIMESTAMP),
      (${crypto.randomUUID()}, ${otherProjectChunk.id}, ${"test-embedding-model"}, ${DOCUMENT_EMBEDDING_DIMENSIONS}, ${vectorLiteral(embedding(1, 0))}::vector, CURRENT_TIMESTAMP)
  `;

  const results = await searchDocumentChunksByVector(prisma, {
    projectId: project.id,
    embedding: embedding(1, 0),
    model: "test-embedding-model",
    limit: 10
  });

  assert.deepEqual(
    results.map((result) => result.id),
    [matchingChunk.id, secondaryChunk.id]
  );
  assert.equal(results[0]?.documentName, "Payments discovery notes");
  assert.equal(results.some((result) => result.id === otherProjectChunk.id), false);
});
