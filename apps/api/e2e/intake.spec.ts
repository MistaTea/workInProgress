import { randomUUID } from "node:crypto";
import { PrismaClient } from "@ba-workbench/database";
import { Queue, Worker } from "bullmq";
import { test as base, expect, type Page } from "@playwright/test";
import {
  ingestDocument,
  type DocumentIngestionJob,
} from "../../worker/src/processors/document-ingestion.processor";

// Must match the browser API's isolated REDIS_URL in playwright.config.ts.
// No general worker/AI queue is started. Embeddings are explicitly disabled.
const connection = { host: "127.0.0.1", port: 6379, db: 15 };
const API = "http://127.0.0.1:4000/api";
interface Harness {
  prisma: PrismaClient;
  names: Set<string>;
  projectIds: Set<string>;
  startWorker: () => Promise<void>;
}
const test = base.extend<{ intake: Harness }>({
  intake: async ({}, use) => {
    const prisma = new PrismaClient();
    const names = new Set<string>();
    const projectIds = new Set<string>();
    let worker: Worker<DocumentIngestionJob> | undefined;
    const errors: Error[] = [];
    try {
      await use({
        prisma,
        names,
        projectIds,
        startWorker: async () => {
          worker = new Worker<DocumentIngestionJob>(
            "document-ingestion",
            async (job) => {
              if (!projectIds.has(job.data.projectId))
                throw new Error(
                  "Unexpected project in isolated browser ingestion queue.",
                );
              return ingestDocument(job.data, {
                prisma,
                embeddingProvider: null,
              });
            },
            { connection, concurrency: 1 },
          );
          worker.on("error", (error) => errors.push(error));
          await worker.waitUntilReady();
        },
      });
    } finally {
      await worker?.close();
      // Include a project whose POST completed but the browser response failed.
      const ownProjects = names.size
        ? await prisma.project.findMany({
            where: { name: { in: [...names] } },
            select: { id: true },
          })
        : [];
      const ids = ownProjects.map((p) => p.id);
      const queue = new Queue<DocumentIngestionJob>("document-ingestion", {
        connection,
      });
      try {
        const jobs = await queue.getJobs([
          "wait",
          "completed",
          "failed",
          "delayed",
        ]);
        for (const job of jobs)
          if (ids.includes(job.data.projectId)) await job.remove();
      } finally {
        await queue.close();
      }
      if (ids.length)
        await prisma.$transaction(async (tx) => {
          await tx.requirementEvidenceReview.deleteMany({
            where: { requirement: { projectId: { in: ids } } },
          });
          await tx.requirementBaseline.deleteMany({
            where: { projectId: { in: ids } },
          });
          await tx.auditEvent.deleteMany({ where: { projectId: { in: ids } } });
          await tx.project.deleteMany({ where: { id: { in: ids } } });
        });
      await prisma.$disconnect();
      expect(
        errors,
        "Real keyless worker should not emit connection errors",
      ).toEqual([]);
    }
  },
});
function projectName(intake: Harness) {
  const name = `Browser intake ${randomUUID()}`;
  intake.names.add(name);
  return name;
}
async function createProject(page: Page, intake: Harness) {
  const name = projectName(intake);
  const form = page.getByRole("form", { name: "Create project", exact: true });
  await form
    .getByRole("textbox", { name: "Project name", exact: true })
    .fill(name);
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/projects") && r.request().method() === "POST",
  );
  await form
    .getByRole("button", { name: "Create project", exact: true })
    .click({ clickCount: 2 });
  const saved = await response;
  expect(saved.status()).toBe(201);
  const data = (await saved.json()) as { id: string };
  intake.projectIds.add(data.id);
  await expect(page).toHaveURL(new RegExp(`projectId=${data.id}`));
  await expect(
    page.getByRole("combobox", { name: "Project", exact: true }),
  ).toHaveValue(data.id);
  return { id: data.id, name };
}

test("browser creates a real project and pasted source, then observes keyless parsing and chunks", async ({
  page,
  request,
  intake,
}) => {
  let projectPosts = 0;
  let documentPosts = 0;
  page.on("request", (r) => {
    if (r.method() !== "POST") return;
    if (r.url().endsWith("/api/projects")) projectPosts += 1;
    if (/\/api\/projects\/[^/]+\/documents$/.test(r.url())) documentPosts += 1;
  });
  await page.goto("/");
  const project = await createProject(page, intake);
  expect(projectPosts).toBe(1);
  const metrics = page.getByRole("region", { name: "Current project counts" });
  await expect(metrics).toContainText("Requirements");
  await expect(metrics.locator("strong")).toHaveText(["0", "0", "0", "0"]);
  const form = page.getByRole("form", {
    name: "Paste source document",
    exact: true,
  });
  const name = `Synthetic transcript ${randomUUID()}`;
  const content =
    "Operations needs a visible exception reason.\n\nA reviewer must be able to find the original source passage.";
  await form
    .getByRole("textbox", { name: "Document name", exact: true })
    .fill(name);
  await form
    .getByRole("combobox", { name: "Document type", exact: true })
    .selectOption("transcript");
  await form.getByRole("textbox", { name: /Source text/ }).fill(content);
  const saved = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/projects/${project.id}/documents`) &&
      r.request().method() === "POST",
  );
  await form
    .getByRole("button", { name: "Save source document", exact: true })
    .click({ clickCount: 2 });
  const response = await saved;
  expect(response.status()).toBe(201);
  const document = (await response.json()) as { id: string };
  expect(documentPosts).toBe(1);
  const inspector = page.getByRole("region", {
    name: "Document detail",
    exact: true,
  });
  await expect(inspector.getByText("queued", { exact: true })).toBeVisible();
  await expect(inspector.getByRole("status")).toContainText(
    "Processing is pending",
  );
  await intake.startWorker();
  await expect(inspector.getByText("completed", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(inspector.getByText("skipped", { exact: true })).toBeVisible();
  await expect(
    inspector.getByRole("heading", { name: "Chunk 1", exact: true }),
  ).toBeVisible();
  await expect(inspector).toContainText(
    "Operations needs a visible exception reason.",
  );
  await expect(inspector).toContainText(
    "A reviewer must be able to find the original source passage.",
  );
  const detail = await request.get(`${API}/documents/${document.id}`);
  expect(detail.ok()).toBeTruthy();
  const data = (await detail.json()) as {
    extractionStatus: string;
    embeddingStatus: string;
    chunks: unknown[];
  };
  expect(data.extractionStatus).toBe("completed");
  expect(data.embeddingStatus).toBe("skipped");
  expect(data.chunks.length).toBeGreaterThan(0);
  const requirements = await request.get(
    `${API}/projects/${project.id}/requirements`,
  );
  expect(await requirements.json()).toEqual([]);
  expect(
    await intake.prisma.document.count({ where: { projectId: project.id } }),
  ).toBe(1);
  expect(
    await intake.prisma.project.count({ where: { name: project.name } }),
  ).toBe(1);
});

test("project context survives deep links, switching and browser Back; invalid IDs never select another project", async ({
  page,
  intake,
}) => {
  await page.goto("/");
  const first = await createProject(page, intake);
  const second = await createProject(page, intake);
  const selector = page.getByRole("combobox", { name: "Project", exact: true });
  await selector.selectOption(first.id);
  await expect(page).toHaveURL(new RegExp(`projectId=${first.id}`));
  await selector.selectOption(second.id);
  await expect(page).toHaveURL(new RegExp(`projectId=${second.id}`));
  await page.goBack();
  await expect(selector).toHaveValue(first.id);
  await expect(
    page.getByRole("region", { name: "Selected project workspace" }),
  ).toContainText(first.name);
  await page
    .getByRole("link", { name: "Open project reviews", exact: true })
    .click();
  await expect(page).toHaveURL(`http://127.0.0.1:3000/reviews?projectId=${first.id}`);
  await expect(
    page.getByRole("combobox", { name: "Project", exact: true }),
  ).toHaveValue(first.id);
  await page.getByRole("link", { name: "Evidence", exact: true }).click();
  await expect(page).toHaveURL(`http://127.0.0.1:3000/evidence?projectId=${first.id}`);
  await expect(
    page.getByRole("combobox", { name: "Project", exact: true }),
  ).toHaveValue(first.id);
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(selector).toHaveValue(first.id);
  await page.goto(`/?projectId=${second.id}`);
  await expect(selector).toHaveValue(second.id);
  await expect(
    page.getByRole("region", { name: "Selected project workspace" }),
  ).toContainText(second.name);
  for (const path of ["/", "/reviews", "/evidence"]) {
    await page.goto(`${path}?projectId=missing-${randomUUID()}`);
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: /requested project.*unavailable/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Project", exact: true }),
    ).not.toHaveValue(first.id);
    await expect(
      page.getByRole("combobox", { name: "Project", exact: true }),
    ).not.toHaveValue(second.id);
  }
});

test("switching projects discards a delayed real previous-project document response", async ({
  page,
  request,
  intake,
}) => {
  await page.goto("/");
  const first = await createProject(page, intake);
  const second = await createProject(page, intake);
  const firstName = `First project source ${randomUUID()}`;
  const secondName = `Second project source ${randomUUID()}`;
  for (const [id, name] of [
    [first.id, firstName],
    [second.id, secondName],
  ]) {
    const response = await request.post(`${API}/projects/${id}/documents`, {
      data: {
        name,
        documentType: "text/plain",
        content: "Synthetic source for project-boundary browser verification.",
      },
    });
    expect(response.status()).toBe(201);
  }
  // Only delay transport: the response body comes unmodified from the real API.
  let release!: () => void;
  let received!: () => void;
  let finished!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const captured = new Promise<void>((resolve) => {
    received = resolve;
  });
  const delivered = new Promise<void>((resolve) => {
    finished = resolve;
  });
  await page.route(
    `**/api/projects/${first.id}/documents`,
    async (route) => {
      try {
        const response = await route.fetch();
        received();
        await gate;
        // Abort on project switch is expected; either cancellation or an ignored
        // old response is correct, but its content must never replace project two.
        await route.fulfill({ response }).catch(() => {});
      } finally {
        finished();
      }
    },
    { times: 1 },
  );
  const selector = page.getByRole("combobox", { name: "Project", exact: true });
  try {
    await selector.selectOption(first.id);
    await captured;
    await selector.selectOption(second.id);
    release();
    await delivered;
    const documents = page.getByRole("region", {
      name: "Project documents",
      exact: true,
    });
    await expect(
      documents.getByRole("button", { name: new RegExp(secondName) }),
    ).toBeVisible();
    await expect(
      documents.getByRole("button", { name: new RegExp(firstName) }),
    ).toHaveCount(0);
    await expect(selector).toHaveValue(second.id);
  } finally {
    release();
  }
});
