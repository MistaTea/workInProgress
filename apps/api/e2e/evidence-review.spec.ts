import { randomUUID } from "node:crypto";
import { PrismaClient } from "@ba-workbench/database";
import {
  test as base,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

const API = "http://127.0.0.1:4000/api";
const original = {
  title: "Display synthetic exception reason",
  statement: "The system must show the synthetic exception reason.",
  rationale: "Reduce synthetic investigation time.",
};
const savedExcerpt = "Synthetic saved excerpt.";
const fullText = `${savedExcerpt} The full source requires a reason and an audit trail.`;
interface EvidenceDetail {
  status: string;
  currentVersion: number;
  replayed?: boolean;
  history: Array<{
    outcome: string;
    requirementVersion: number;
    comment: string | null;
  }>;
}
interface Fixture {
  projectId: string;
  projectName: string;
  requirementId: string;
  chunkId: string;
  prisma: PrismaClient;
}
async function json<T>(
  request: APIRequestContext,
  path: string,
  method = "GET",
  data?: unknown,
): Promise<T> {
  const response = await request.fetch(`${API}${path}`, {
    method,
    ...(data === undefined ? {} : { data }),
  });
  expect(
    response.ok(),
    `${method} ${path}: ${response.status()} ${await response.text()}`,
  ).toBeTruthy();
  return response.json() as Promise<T>;
}

// Source attachment is seeded through Prisma because there is deliberately no
// public source-amendment route. All application reads/decisions use the real API.
const test = base.extend<{ evidence: Fixture }>({
  evidence: async ({ request }, use) => {
    const prisma = new PrismaClient();
    let projectId: string | undefined;
    try {
      const projectName = `Browser evidence ${randomUUID()}`;
      const project = await json<{ id: string }>(request, "/projects", "POST", {
        name: projectName,
      });
      projectId = project.id;
      const requirement = await json<{ id: string }>(
        request,
        `/projects/${projectId}/requirements`,
        "POST",
        {
          ...original,
          type: "functional",
          priority: "must",
        },
      );
      const document = await prisma.document.create({
        data: {
          projectId,
          name: `Synthetic browser source ${randomUUID()}`,
          documentType: "text/plain",
          storageUri: "test://browser-evidence",
          extractionStatus: "completed",
        },
      });
      const chunk = await prisma.documentChunk.create({
        data: { documentId: document.id, chunkIndex: 0, chunkText: fullText },
      });
      await prisma.requirementVersion.update({
        where: {
          requirementId_version: { requirementId: requirement.id, version: 1 },
        },
        data: {
          sourceRefs: [
            {
              artefactType: "document_chunk",
              artefactId: chunk.id,
              label: document.name,
              excerpt: savedExcerpt,
            },
          ],
        },
      });
      await use({
        projectId,
        projectName,
        requirementId: requirement.id,
        chunkId: chunk.id,
        prisma,
      });
    } finally {
      // Restrict relations preserve production evidence; delete only this fixture's
      // evidence and snapshots explicitly. Never truncate shared tables.
      if (projectId)
        await prisma.$transaction(async (tx) => {
          await tx.requirementEvidenceReview.deleteMany({
            where: { requirement: { projectId } },
          });
          await tx.approvalEvidence.deleteMany({
            where: { baseline: { projectId } },
          });
          await tx.requirementBaseline.deleteMany({ where: { projectId } });
          await tx.auditEvent.deleteMany({ where: { projectId } });
          await tx.project.deleteMany({ where: { id: projectId } });
        });
      await prisma.$disconnect();
    }
  },
});

async function openEvidence(page: Page, fixture: Fixture) {
  await page.goto("/evidence");
  await expect(
    page.getByRole("combobox", { name: "Project", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("combobox", { name: "Project", exact: true })
    .selectOption(fixture.projectId);
  const queue = page.getByRole("complementary", { name: "Requirements queue" });
  await expect(queue.getByRole("button", { name: /REQ-001/ })).toContainText(
    original.title,
  );
  await queue.getByRole("button", { name: /REQ-001/ }).click();
  await expect(
    page.getByRole("heading", { name: original.title, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Supports requirement", exact: true }),
  ).toBeEnabled();
}
const detailPath = (fixture: Fixture) =>
  `/requirements/${fixture.requirementId}/evidence-review`;
async function saveSupport(page: Page, fixture: Fixture) {
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith(detailPath(fixture)) && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Supports requirement", exact: true })
    .click();
  expect((await response).status()).toBe(201);
  await expect(
    page.getByRole("status").filter({ hasText: "Evidence review saved" }),
  ).toBeVisible();
  return (await response).json() as Promise<EvidenceDetail>;
}

test("real queue and source comparison record support and follow-up history without approval", async ({
  page,
  request,
  evidence,
}) => {
  await openEvidence(page, evidence);
  const sources = page.getByRole("region", {
    name: "Linked source comparisons",
  });
  await expect(sources.getByText(savedExcerpt, { exact: true })).toBeVisible();
  await expect(sources.getByText(fullText, { exact: true })).toBeVisible();
  await saveSupport(page, evidence);
  const repeated = await saveSupport(page, evidence);
  expect(repeated.replayed).toBe(true);
  expect(repeated.history).toHaveLength(1);
  expect(
    (await json<EvidenceDetail>(request, detailPath(evidence))).history,
  ).toHaveLength(1);
  const history = page.getByRole("region", { name: "Evidence review history" });
  await expect(history).toContainText("Supports requirement · Requirement v1");
  await expect(
    page.getByRole("complementary", { name: "Requirements queue" }),
  ).toContainText("Reviewed for this version");

  await page
    .getByRole("button", { name: "Needs follow-up", exact: true })
    .click();
  await expect(page.getByRole("region", { name: "Requirement evidence", exact: true }).getByRole("alert")).toContainText("Add a comment");
  const comment = "Confirm the synthetic audit-trail detail with operations.";
  await page.getByRole("textbox", { name: /Review comment/ }).fill(comment);
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith(detailPath(evidence)) && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Needs follow-up", exact: true })
    .click();
  expect((await response).status()).toBe(201);
  await expect(history).toContainText(comment);
  const detail = await json<EvidenceDetail>(request, detailPath(evidence));
  expect(detail.history).toHaveLength(2);
  expect(detail.history.map((r) => r.outcome)).toEqual([
    "needs_follow_up",
    "supports",
  ]);
  const requirement = await json<{ status: string }>(
    request,
    `/requirements/${evidence.requirementId}`,
  );
  expect(requirement.status).toBe("draft");
});

test("content and full-source edits require revalidation while preserving earlier evidence", async ({
  page,
  request,
  evidence,
}) => {
  await openEvidence(page, evidence);
  await saveSupport(page, evidence);
  await json(request, `/requirements/${evidence.requirementId}`, "PATCH", {
    rationale: "Changed synthetic rationale.",
  });
  await page
    .getByRole("button", { name: "Refresh evidence", exact: true })
    .click();
  const area = page.getByRole("region", {
    name: "Requirement evidence",
    exact: true,
  });
  await expect(
    area.getByText("Needs revalidation", { exact: true }),
  ).toBeVisible();
  await expect(area).toContainText("Requirement version 2");
  await expect(
    page.getByRole("region", { name: "Evidence review history" }),
  ).toContainText("Supports requirement · Requirement v1");
  await saveSupport(page, evidence);
  expect(
    (await json<EvidenceDetail>(request, detailPath(evidence))).history.map(
      (r) => r.requirementVersion,
    ),
  ).toEqual([2, 1]);

  const changedFullText = `${savedExcerpt} The full source now requires two audit entries.`;
  await evidence.prisma.documentChunk.update({
    where: { id: evidence.chunkId },
    data: { chunkText: changedFullText },
  });
  await page
    .getByRole("button", { name: "Refresh evidence", exact: true })
    .click();
  await expect(
    area.getByText("Needs revalidation", { exact: true }),
  ).toBeVisible();
  await expect(area.getByText(changedFullText, { exact: true })).toBeVisible();
  await expect(area.getByText(savedExcerpt, { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Refresh requirement queue", exact: true })
    .click();
  await expect(
    page.getByRole("complementary", { name: "Requirements queue" }),
  ).toContainText("Needs revalidation");
});

test("a genuine stale-version 409 blocks resubmission until explicit refresh and human action", async ({
  page,
  request,
  evidence,
}) => {
  await openEvidence(page, evidence);
  let submissions = 0;
  page.on("request", (r) => {
    if (r.url().endsWith(detailPath(evidence)) && r.method() === "POST")
      submissions += 1;
  });
  await json(request, `/requirements/${evidence.requirementId}`, "PATCH", {
    statement: "The changed system must show two synthetic reasons.",
  });
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith(detailPath(evidence)) && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Supports requirement", exact: true })
    .click();
  expect((await response).status()).toBe(409);
  await expect(page.getByRole("region", { name: "Requirement evidence", exact: true }).getByRole("alert")).toContainText(
    "has not been automatically resubmitted",
  );
  await expect(
    page.getByRole("button", { name: "Supports requirement", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Needs follow-up", exact: true }),
  ).toBeDisabled();
  expect(
    (await json<EvidenceDetail>(request, detailPath(evidence))).history,
  ).toHaveLength(0);
  await page
    .getByRole("button", { name: "Refresh evidence", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Requirement evidence", exact: true }),
  ).toContainText("Requirement version 2");
  await expect(
    page.getByRole("button", { name: "Supports requirement", exact: true }),
  ).toBeEnabled();
  expect(submissions).toBe(1);
  expect(
    (await json<EvidenceDetail>(request, detailPath(evidence))).history,
  ).toHaveLength(0);
  await saveSupport(page, evidence);
  expect(submissions).toBe(2);
  const detail = await json<EvidenceDetail>(request, detailPath(evidence));
  expect(detail.history).toHaveLength(1);
  expect(detail.history[0]?.requirementVersion).toBe(2);
});

test("public reviewer sees the frozen original snapshot after the current requirement is edited", async ({
  page,
  request,
  evidence,
}) => {
  const packet = await json<{ token: string }>(
    request,
    `/projects/${evidence.projectId}/review-packets`,
    "POST",
    {
      name: "Synthetic browser frozen snapshot",
      requirementIds: [evidence.requirementId],
      stakeholderName: "Synthetic Reviewer",
    },
  );
  expect(packet.token).toBeTruthy();
  const replacement = {
    title: "Changed synthetic title",
    statement: "Changed synthetic statement.",
    rationale: "Changed synthetic rationale.",
  };
  const updated = await json<{ currentVersion: number }>(
    request,
    `/requirements/${evidence.requirementId}`,
    "PATCH",
    replacement,
  );
  expect(updated.currentVersion).toBe(2);
  await page.goto(`/stakeholder-review/${packet.token}`);
  await expect(
    page.getByText(
      "1 versioned requirements. Your decision applies only to this snapshot.",
      { exact: true },
    ),
  ).toBeVisible();
  const card = page.getByRole("article").filter({ hasText: original.title });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText(original.statement);
  await expect(card).toContainText(original.rationale);
  await expect(card).toContainText("v1 - functional - MUST");
  for (const value of Object.values(replacement))
    await expect(page.getByText(value, { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Submit decision", exact: true }),
  ).toBeEnabled();
  const snapshot = await json<{
    baseline: {
      items: Array<{ requirementVersion: { version: number; title: string } }>;
    };
  }>(request, `/review/${packet.token}`);
  expect(snapshot.baseline.items[0]?.requirementVersion.version).toBe(1);
  expect(snapshot.baseline.items[0]?.requirementVersion.title).toBe(
    original.title,
  );
});
