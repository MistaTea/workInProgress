import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type {
  RequirementExtraction,
  RequirementExtractionStructuredOutput
} from "@ba-workbench/ai-schemas";
import { PrismaClient } from "@ba-workbench/database";
import {
  processAiJob,
  type RequirementExtractionProvider,
  type RequirementExtractionSource
} from "../src/processors/ai-job.processor";

const prisma = new PrismaClient();

function extractionFor(source: RequirementExtractionSource): RequirementExtractionStructuredOutput {
  return {
    summary: "The source identifies a need for consistent payment exception reasons.",
    candidates: [
      {
        title: "Capture payment exception reason",
        statement: "The system must capture a standardised reason when a payment exception occurs.",
        type: "functional",
        priority: "must",
        rationale: "Operations needs consistent exception analysis.",
        assumptions: [],
        openQuestions: [],
        sourceReferences: [
          {
            artefactType: "document_chunk",
            artefactId: source.chunkId
          }
        ]
      }
    ],
    risks: [],
    decisions: [],
    actions: []
  };
}

const fakeProvider: RequirementExtractionProvider = {
  model: "test-requirement-extraction-model",
  async extract(input) {
    const source = input.sources[0];
    if (!source) {
      throw new Error("Test source is required.");
    }

    return {
      output: extractionFor(source),
      tokenUsage: {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150
      }
    };
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

test("persists a source-grounded AI requirement extraction as a human-review draft", async () => {
  const organisation = await prisma.organisation.create({
    data: {
      name: "AI Job Test Workspace"
    }
  });
  const owner = await prisma.user.create({
    data: {
      organisationId: organisation.id,
      email: "ai-job-test@ba-workbench.local",
      displayName: "AI Job Test BA"
    }
  });
  const project = await prisma.project.create({
    data: {
      organisationId: organisation.id,
      ownerId: owner.id,
      name: "Payments modernisation"
    }
  });
  const document = await prisma.document.create({
    data: {
      projectId: project.id,
      name: "Payments discovery notes",
      documentType: "text/plain",
      storageUri: "native://documents/ai-job/versions/1",
      extractionStatus: "completed",
      embeddingStatus: "skipped"
    }
  });
  const chunk = await prisma.documentChunk.create({
    data: {
      documentId: document.id,
      chunkIndex: 0,
      chunkText: "Operations needs a standardised payment exception reason for consistent analysis.",
      metadata: {
        startOffset: 0,
        endOffset: 81,
        characterCount: 81
      }
    }
  });
  const aiJob = await prisma.aiJob.create({
    data: {
      projectId: project.id,
      jobType: "extract_requirements",
      status: "queued",
      input: {
        sourceArtefactIds: [document.id],
        instructions: "Focus on operational requirements."
      }
    }
  });

  const result = await processAiJob(
    {
      aiJobId: aiJob.id,
      projectId: project.id
    },
    {
      prisma,
      requirementExtractionProvider: fakeProvider
    }
  );

  assert.equal(result.status, "completed");
  assert.equal(result.reviewStatus, "generated");

  const completedJob = await prisma.aiJob.findUniqueOrThrow({
    where: { id: aiJob.id },
    include: {
      outputs: true
    }
  });
  const draft = completedJob.outputs[0];
  assert.equal(completedJob.status, "completed");
  assert.equal(completedJob.outputs.length, 1);
  assert.equal(draft?.reviewStatus, "generated");
  assert.equal(draft?.outputType, "requirement_extraction");
  assert.equal(draft?.model, fakeProvider.model);

  const payload = draft?.payload as RequirementExtraction;
  const sourceReference = payload.candidates[0]?.sourceReferences[0];
  assert.equal(sourceReference?.artefactId, chunk.id);
  assert.equal(sourceReference?.label, document.name);
  assert.equal(sourceReference?.excerpt, chunk.chunkText);
  assert.equal(sourceReference?.location, "Characters 1-81");

  assert.equal(await prisma.requirement.count({ where: { projectId: project.id } }), 0);
  assert.equal(
    await prisma.auditEvent.count({
      where: {
        projectId: project.id,
        action: "ai_draft.generated",
        artefactId: draft?.id
      }
    }),
    1
  );
});

test("rejects an AI draft that cites a chunk outside the selected evidence", async () => {
  const project = await prisma.project.findFirstOrThrow({
    where: {
      name: "Payments modernisation"
    }
  });
  const document = await prisma.document.findFirstOrThrow({
    where: {
      projectId: project.id
    }
  });
  const aiJob = await prisma.aiJob.create({
    data: {
      projectId: project.id,
      jobType: "extract_requirements",
      status: "queued",
      input: {
        sourceArtefactIds: [document.id]
      }
    }
  });
  const invalidProvider: RequirementExtractionProvider = {
    model: "invalid-test-model",
    async extract(input) {
      const source = input.sources[0];
      if (!source) {
        throw new Error("Test source is required.");
      }

      const output = extractionFor(source);
      output.candidates[0]!.sourceReferences[0]!.artefactId = "not-a-selected-chunk";
      return { output };
    }
  };

  await assert.rejects(
    processAiJob(
      {
        aiJobId: aiJob.id,
        projectId: project.id
      },
      {
        prisma,
        requirementExtractionProvider: invalidProvider
      }
    ),
    /was not supplied to the AI job/
  );

  const failedJob = await prisma.aiJob.findUniqueOrThrow({
    where: { id: aiJob.id }
  });
  assert.equal(failedJob.status, "failed");
  assert.match(failedJob.error ?? "", /was not supplied to the AI job/);
  assert.equal(await prisma.aiDraftOutput.count({ where: { aiJobId: aiJob.id } }), 0);
});
