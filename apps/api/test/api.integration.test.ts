import "reflect-metadata";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
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
  assert.equal(requirementResult.body.reference, "REQ-001");
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

  const dashboard = await requestJson<DashboardResponse>(`/api/projects/${projectResult.body.id}/dashboard`);
  assert.equal(dashboard.response.status, 200);
  assert.equal(dashboard.body.requirementCounts.in_review, 1);

  const auditEventCount = await prisma.auditEvent.count({
    where: {
      projectId: projectResult.body.id
    }
  });
  assert.equal(auditEventCount, 4);
});
