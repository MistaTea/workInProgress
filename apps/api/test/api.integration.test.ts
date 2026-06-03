import "reflect-metadata";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { RequirementExtraction } from "@ba-workbench/ai-schemas";
import { AppModule } from "../src/modules/app.module";
import { PrismaService } from "../src/modules/database/prisma.service";

interface ProjectResponse {
  id: string;
  name: string;
  problemStatement: string | null;
  objectives: string[];
  status: string;
}

interface RequirementResponse {
  id: string;
  projectId: string;
  reference: string;
  title: string;
  statement: string;
  status: string;
  currentVersion: number;
  versions?: Array<{
    version: number;
    statement: string;
    sourceRefs?: Array<{
      artefactType: string;
      artefactId: string;
      label: string;
    }>;
  }>;
}

interface DashboardResponse {
  requirementCounts: Record<string, number>;
}

interface DocumentResponse {
  id: string;
  projectId: string;
  name: string;
  documentType: string;
  storageUri: string;
  extractionStatus: string;
  embeddingStatus: string;
  chunks: Array<{
    id: string;
    sourceReference: {
      artefactType: string;
      artefactId: string;
      label: string;
    };
  }>;
}

interface AiJobResponse {
  id: string;
  projectId: string;
  jobType: string;
  status: string;
  reviewModel: string;
  outputs: unknown[];
}

interface AiDraftResponse {
  id: string;
  reviewStatus: string;
  reviewedAt: string | null;
  reviewSummary: {
    totalCandidates: number;
    reviewedCandidates: number;
    acceptedCandidates: number;
    rejectedCandidates: number;
    pendingCandidates: number;
  };
  requirementCandidates: Array<{
    candidateIndex: number;
    review: {
      decision: string;
      comments: string | null;
      createdRequirement: RequirementResponse | null;
    } | null;
  }>;
}

interface AiDraftListItem {
  id: string;
  reviewStatus: string;
  summary: string;
  reviewSummary: AiDraftResponse["reviewSummary"];
}

interface ReviewPacketResponse {
  id: string;
  name: string;
  version: number;
  status: string;
  reviewUrl?: string;
  token?: string;
  items: Array<{
    requirement: RequirementResponse;
    requirementVersion: {
      version: number;
      statement: string;
    };
  }>;
  reviewLinks: Array<{
    status: string;
    stakeholder: {
      name: string;
      email: string | null;
    } | null;
    approvals: Array<{
      decision: string;
      reviewerName: string;
    }>;
  }>;
  approvals: Array<{
    decision: string;
    reviewerName: string;
  }>;
}

interface StakeholderReviewResponse {
  token: string;
  status: string;
  baseline: ReviewPacketResponse;
}

interface ReviewDecisionResponse {
  token: string;
  decision: string;
  evidence: {
    decision: string;
    reviewerName: string;
    reviewerEmail: string | null;
  };
}

let app: INestApplication;
let prisma: PrismaService;
let baseUrl: string;

async function resetDatabase() {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "Organisation" CASCADE');
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<{ response: Response; body: T }> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers
    }
  });

  return {
    response,
    body: (await response.json()) as T
  };
}

before(async () => {
  process.env.DEFAULT_ORGANISATION_NAME = "Integration Test Workspace";
  process.env.DEFAULT_OWNER_NAME = "Integration Test BA";
  process.env.DEFAULT_OWNER_EMAIL = "integration-test@ba-workbench.local";

  app = await NestFactory.create(AppModule, { logger: ["error"] });
  app.setGlobalPrefix("api");
  await app.listen(0, "127.0.0.1");

  prisma = app.get(PrismaService);
  await resetDatabase();

  const address = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await resetDatabase();
  await app.close();
});

test("persists a project and versioned requirement through the HTTP API", async () => {
  const projectResult = await requestJson<ProjectResponse>("/api/projects", {
    method: "POST",
    body: JSON.stringify({
      name: "Payments modernisation",
      problemStatement: "Payment exceptions require too much manual analysis.",
      objectives: ["Reduce rework", "Improve traceability"]
    })
  });

  assert.equal(
    projectResult.response.status,
    201,
    `Expected project creation to succeed: ${JSON.stringify(projectResult.body)}`
  );
  assert.equal(projectResult.body.name, "Payments modernisation");
  assert.deepEqual(projectResult.body.objectives, ["Reduce rework", "Improve traceability"]);

  const projectList = await requestJson<ProjectResponse[]>("/api/projects");
  assert.equal(projectList.response.status, 200);
  assert.equal(projectList.body.length, 1);
  assert.equal(projectList.body[0]?.id, projectResult.body.id);

  const documentResult = await requestJson<DocumentResponse>(`/api/projects/${projectResult.body.id}/documents`, {
    method: "POST",
    body: JSON.stringify({
      name: "Payments discovery notes",
      documentType: "text/markdown",
      content: "# Payments discovery\n\nOperations needs clearer exception reasons."
    })
  });

  assert.equal(documentResult.response.status, 201);
  assert.equal(documentResult.body.extractionStatus, "queued");
  assert.equal(documentResult.body.embeddingStatus, "pending");
  assert.match(documentResult.body.storageUri, /^native:\/\/documents\//);
  assert.equal("sourceText" in documentResult.body, false);
  assert.deepEqual(documentResult.body.chunks, []);

  const documentDetail = await requestJson<DocumentResponse>(`/api/documents/${documentResult.body.id}`);
  assert.equal(documentDetail.response.status, 200);
  assert.equal(documentDetail.body.name, "Payments discovery notes");

  await prisma.document.update({
    where: {
      id: documentResult.body.id
    },
    data: {
      extractionStatus: "completed",
      embeddingStatus: "skipped"
    }
  });
  const documentChunk = await prisma.documentChunk.create({
    data: {
      documentId: documentResult.body.id,
      chunkIndex: 0,
      chunkText: "Operations needs clearer payment exception reasons.",
      metadata: {
        startOffset: 0,
        endOffset: 51,
        characterCount: 51
      }
    }
  });

  const aiJobResult = await requestJson<AiJobResponse>(`/api/projects/${projectResult.body.id}/ai/jobs`, {
    method: "POST",
    body: JSON.stringify({
      jobType: "extract_requirements",
      sourceArtefactIds: [documentResult.body.id],
      instructions: "Focus on operational requirements."
    })
  });

  assert.equal(aiJobResult.response.status, 201);
  assert.equal(aiJobResult.body.jobType, "extract_requirements");
  assert.equal(aiJobResult.body.status, "queued");
  assert.equal(aiJobResult.body.reviewModel, "ai_draft_requires_human_review");
  assert.deepEqual(aiJobResult.body.outputs, []);

  const aiJobDetail = await requestJson<AiJobResponse>(
    `/api/projects/${projectResult.body.id}/ai/jobs/${aiJobResult.body.id}`
  );
  assert.equal(aiJobDetail.response.status, 200);
  assert.equal(aiJobDetail.body.id, aiJobResult.body.id);
  assert.equal(aiJobDetail.body.reviewModel, "ai_draft_requires_human_review");

  const sourceReference = {
    artefactType: "document_chunk",
    artefactId: documentChunk.id,
    label: documentResult.body.name,
    excerpt: documentChunk.chunkText,
    location: "Characters 1-51"
  };
  const aiDraft = await prisma.aiDraftOutput.create({
    data: {
      projectId: projectResult.body.id,
      aiJobId: aiJobResult.body.id,
      outputType: "requirement_extraction",
      reviewStatus: "generated",
      promptVersion: "integration-test",
      model: "integration-test-model",
      sourceRefs: [sourceReference],
      payload: {
        summary: "Operations needs clearer payment exception handling.",
        candidates: [
          {
            title: "Capture payment exception reason",
            statement: "The system must capture a standardised payment exception reason.",
            type: "functional",
            priority: "must",
            rationale: "Operations needs consistent reporting.",
            assumptions: [],
            openQuestions: [],
            sourceReferences: [sourceReference]
          },
          {
            title: "Review payment exception reports",
            statement: "Operations should review payment exception reporting each month.",
            type: "reporting",
            priority: "could",
            assumptions: [],
            openQuestions: [],
            sourceReferences: [sourceReference]
          }
        ],
        risks: [],
        decisions: [],
        actions: []
      }
    }
  });

  const initialDraft = await requestJson<AiDraftResponse>(
    `/api/projects/${projectResult.body.id}/ai/drafts/${aiDraft.id}`
  );
  assert.equal(initialDraft.response.status, 200);
  assert.equal(initialDraft.body.reviewStatus, "generated");
  assert.equal(initialDraft.body.reviewSummary.pendingCandidates, 2);

  const initialDraftQueue = await requestJson<AiDraftListItem[]>(
    `/api/projects/${projectResult.body.id}/ai/drafts`
  );
  assert.equal(initialDraftQueue.response.status, 200);
  assert.equal(initialDraftQueue.body.length, 1);
  assert.equal(initialDraftQueue.body[0]?.id, aiDraft.id);
  assert.equal(initialDraftQueue.body[0]?.summary, "Operations needs clearer payment exception handling.");
  assert.equal(initialDraftQueue.body[0]?.reviewSummary.pendingCandidates, 2);

  const acceptedDraft = await requestJson<AiDraftResponse>(
    `/api/projects/${projectResult.body.id}/ai/drafts/${aiDraft.id}/requirement-candidates/0/review`,
    {
      method: "POST",
      body: JSON.stringify({
        decision: "accepted",
        comments: "Confirmed with operations.",
        requirement: {
          statement: "The system must capture a standardised payment exception reason when validation fails."
        }
      })
    }
  );
  assert.equal(acceptedDraft.response.status, 201);
  assert.equal(acceptedDraft.body.reviewStatus, "under_ba_review");
  assert.equal(acceptedDraft.body.reviewSummary.acceptedCandidates, 1);
  assert.equal(acceptedDraft.body.reviewSummary.pendingCandidates, 1);

  const acceptedRequirement = acceptedDraft.body.requirementCandidates[0]?.review?.createdRequirement;
  assert.ok(acceptedRequirement);
  assert.equal(acceptedRequirement.reference, "REQ-001");
  assert.equal(acceptedRequirement.status, "draft");
  assert.match(acceptedRequirement.statement, /when validation fails/);

  const acceptedRequirementDetail = await requestJson<RequirementResponse>(
    `/api/requirements/${acceptedRequirement.id}`
  );
  assert.equal(acceptedRequirementDetail.response.status, 200);
  assert.equal(acceptedRequirementDetail.body.versions?.[0]?.sourceRefs?.[0]?.artefactId, documentChunk.id);

  const updatedAcceptedRequirement = await requestJson<RequirementResponse>(
    `/api/requirements/${acceptedRequirement.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        rationale: "Confirmed as a system requirement during BA review."
      })
    }
  );
  assert.equal(updatedAcceptedRequirement.response.status, 200);
  assert.equal(updatedAcceptedRequirement.body.currentVersion, 2);

  const updatedAcceptedRequirementDetail = await requestJson<RequirementResponse>(
    `/api/requirements/${acceptedRequirement.id}`
  );
  assert.equal(updatedAcceptedRequirementDetail.body.versions?.[0]?.sourceRefs?.[0]?.artefactId, documentChunk.id);

  const invalidRejection = await requestJson<unknown>(
    `/api/projects/${projectResult.body.id}/ai/drafts/${aiDraft.id}/requirement-candidates/1/review`,
    {
      method: "POST",
      body: JSON.stringify({
        decision: "rejected"
      })
    }
  );
  assert.equal(invalidRejection.response.status, 400);

  const reviewedDraft = await requestJson<AiDraftResponse>(
    `/api/projects/${projectResult.body.id}/ai/drafts/${aiDraft.id}/requirement-candidates/1/review`,
    {
      method: "POST",
      body: JSON.stringify({
        decision: "rejected",
        comments: "This is an operating procedure, not a system requirement."
      })
    }
  );
  assert.equal(reviewedDraft.response.status, 201);
  assert.equal(reviewedDraft.body.reviewStatus, "accepted_by_ba");
  assert.equal(reviewedDraft.body.reviewSummary.reviewedCandidates, 2);
  assert.equal(reviewedDraft.body.reviewSummary.rejectedCandidates, 1);
  assert.equal(reviewedDraft.body.reviewSummary.pendingCandidates, 0);
  assert.ok(reviewedDraft.body.reviewedAt);
  assert.match(reviewedDraft.body.requirementCandidates[1]?.review?.comments ?? "", /operating procedure/);

  const reviewedDraftQueue = await requestJson<AiDraftListItem[]>(
    `/api/projects/${projectResult.body.id}/ai/drafts`
  );
  assert.equal(reviewedDraftQueue.response.status, 200);
  assert.equal(reviewedDraftQueue.body[0]?.reviewStatus, "accepted_by_ba");
  assert.equal(reviewedDraftQueue.body[0]?.reviewSummary.acceptedCandidates, 1);
  assert.equal(reviewedDraftQueue.body[0]?.reviewSummary.rejectedCandidates, 1);
  assert.equal(reviewedDraftQueue.body[0]?.reviewSummary.pendingCandidates, 0);

  const persistedAiDraft = await prisma.aiDraftOutput.findUniqueOrThrow({
    where: {
      id: aiDraft.id
    }
  });
  const originalAiPayload = persistedAiDraft.payload as unknown as RequirementExtraction;
  assert.equal(
    originalAiPayload.candidates[0]?.statement,
    "The system must capture a standardised payment exception reason."
  );
  assert.equal(await prisma.aiDraftReviewItem.count({ where: { aiDraftOutputId: aiDraft.id } }), 2);

  const duplicateReview = await requestJson<unknown>(
    `/api/projects/${projectResult.body.id}/ai/drafts/${aiDraft.id}/requirement-candidates/0/review`,
    {
      method: "POST",
      body: JSON.stringify({
        decision: "accepted"
      })
    }
  );
  assert.equal(duplicateReview.response.status, 409);
  assert.equal(
    await prisma.traceabilityLink.count({
      where: {
        projectId: projectResult.body.id,
        sourceId: acceptedRequirement.id,
        targetType: "ai_draft_requirement_candidate",
        linkType: "derived_from"
      }
    }),
    1
  );

  const requirementResult = await requestJson<RequirementResponse>(
    `/api/projects/${projectResult.body.id}/requirements`,
    {
      method: "POST",
      body: JSON.stringify({
        title: "Capture payment exception reason",
        statement: "The system must capture a standardised exception reason.",
        type: "functional",
        priority: "must",
        rationale: "Operations needs consistent reporting."
      })
    }
  );

  assert.equal(requirementResult.response.status, 201);
  assert.equal(requirementResult.body.reference, "REQ-002");
  assert.equal(requirementResult.body.currentVersion, 1);

  const updateResult = await requestJson<RequirementResponse>(`/api/requirements/${requirementResult.body.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      statement: "The system must capture a standardised exception reason when payment validation fails.",
      status: "in_review"
    })
  });

  assert.equal(updateResult.response.status, 200);
  assert.equal(updateResult.body.currentVersion, 2);
  assert.equal(updateResult.body.status, "in_review");

  const requirementDetail = await requestJson<RequirementResponse>(`/api/requirements/${requirementResult.body.id}`);
  assert.equal(requirementDetail.response.status, 200);
  assert.equal(requirementDetail.body.versions?.length, 2);
  assert.equal(requirementDetail.body.versions?.[0]?.version, 2);
  assert.equal(requirementDetail.body.versions?.[1]?.version, 1);

  const reviewPacket = await requestJson<ReviewPacketResponse>(`/api/projects/${projectResult.body.id}/review-packets`, {
    method: "POST",
    body: JSON.stringify({
      name: "Payments exception review packet",
      requirementIds: [acceptedRequirement.id, requirementResult.body.id],
      stakeholderName: "Operations Manager",
      stakeholderEmail: "ops.manager@example.com"
    })
  });
  assert.equal(reviewPacket.response.status, 201);
  assert.equal(reviewPacket.body.status, "sent_for_review");
  assert.equal(reviewPacket.body.version, 1);
  assert.equal(reviewPacket.body.items.length, 2);
  assert.ok(reviewPacket.body.token);
  assert.match(reviewPacket.body.reviewUrl ?? "", /stakeholder-review/);

  const stakeholderReview = await requestJson<StakeholderReviewResponse>(`/api/review/${reviewPacket.body.token}`);
  assert.equal(stakeholderReview.response.status, 200);
  assert.equal(stakeholderReview.body.baseline.name, "Payments exception review packet");
  assert.equal(stakeholderReview.body.baseline.items.length, 2);

  const reviewDecision = await requestJson<ReviewDecisionResponse>(`/api/review/${reviewPacket.body.token}/decision`, {
    method: "POST",
    body: JSON.stringify({
      decision: "approved",
      reviewerName: "Operations Manager",
      reviewerEmail: "ops.manager@example.com",
      comments: "Approved for UAT planning."
    })
  });
  assert.equal(reviewDecision.response.status, 201);
  assert.equal(reviewDecision.body.decision, "approved");
  assert.equal(reviewDecision.body.evidence.reviewerName, "Operations Manager");

  const reviewPacketList = await requestJson<ReviewPacketResponse[]>(
    `/api/projects/${projectResult.body.id}/review-packets`
  );
  assert.equal(reviewPacketList.response.status, 200);
  assert.equal(reviewPacketList.body[0]?.status, "approved");
  assert.equal(reviewPacketList.body[0]?.approvals[0]?.decision, "approved");
  assert.equal(reviewPacketList.body[0]?.reviewLinks[0]?.status, "completed");

  const dashboard = await requestJson<DashboardResponse>(`/api/projects/${projectResult.body.id}/dashboard`);
  assert.equal(dashboard.response.status, 200);
  assert.equal(dashboard.body.requirementCounts.approved, 2);

  const auditEventCount = await prisma.auditEvent.count({
    where: {
      projectId: projectResult.body.id
    }
  });
  assert.equal(auditEventCount, 11);
});
