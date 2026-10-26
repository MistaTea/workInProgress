import "reflect-metadata";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/modules/app.module";
import { PrismaService } from "../src/modules/database/prisma.service";
import { DocumentIngestionQueueService } from "../src/modules/documents/document-ingestion-queue.service";
import { ingestDocument } from "../../worker/src/processors/document-ingestion.processor";

let app: INestApplication;
let prisma: PrismaService;
let queue: DocumentIngestionQueueService;
let baseUrl: string;
interface DocumentResult { id: string; projectId: string; extractionStatus: string; embeddingStatus: string; extractionError: string | null; chunks: Array<{id: string; chunkText: string}> }
async function request<T>(path: string, method = "GET", data?: unknown) {
  const response = await fetch(`${baseUrl}/api${path}`, { method, headers: { "content-type": "application/json" }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  return { status: response.status, body: await response.json() as T };
}
const inlineIngestion: DocumentIngestionQueueService["enqueue"] = async job => { await ingestDocument(job, { prisma, embeddingProvider: null }); };
before(async () => {
  process.env.DEFAULT_OWNER_EMAIL = "intake-integration@ba-workbench.local";
  app = await NestFactory.create(AppModule, { logger: ["error"] });
  app.setGlobalPrefix("api");
  await app.listen(0, "127.0.0.1");
  prisma = app.get(PrismaService);
  queue = app.get(DocumentIngestionQueueService);
  // Run the genuine parser/chunker inline to reproduce a faster-than-enqueue worker.
  // No embeddings/provider calls; Redis-backed delivery is exercised by browser CI.
  queue.enqueue = inlineIngestion;
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "Organisation" CASCADE');
  baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
});
after(async () => { if (prisma) await prisma.$executeRawUnsafe('TRUNCATE TABLE "Organisation" CASCADE'); await app?.close(); });
async function project() {
  const result = await request<{id: string; name: string}>("/projects", "POST", {name: "  Synthetic intake project  ", objectives: ["Review source evidence"]});
  assert.equal(result.status, 201); assert.equal(result.body.name, "Synthetic intake project"); return result.body;
}
async function document(projectId: string) {
  return request<DocumentResult>(`/projects/${projectId}/documents`, "POST", {name: "Synthetic transcript", documentType: "transcript", content: "Operations: Show an exception reason.\r\nBA: Keep an audit trail."});
}

test("real keyless intake chunks text and never downgrades a fast worker to queued", async () => {
  const p = await project();
  const created = await document(p.id);
  assert.equal(created.status, 201);
  assert.equal(created.body.extractionStatus, "completed");
  assert.equal(created.body.embeddingStatus, "skipped");
  assert.ok(created.body.chunks.length > 0);
  assert.match(created.body.chunks.map(c => c.chunkText).join("\n"), /Keep an audit trail/);
  assert.equal(await prisma.requirement.count({where: {projectId: p.id}}), 0);
  assert.equal(await prisma.aiJob.count({where: {projectId: p.id}}), 0);
  assert.equal(await prisma.aiDraftOutput.count({where: {projectId: p.id}}), 0);
  const list = await request<Array<{id: string; extractionStatus: string; _count: {chunks: number}}>>(`/projects/${p.id}/documents`);
  assert.equal(list.body[0]?.id, created.body.id);
  assert.equal(list.body[0]?.extractionStatus, "completed");
  assert.equal(list.body[0]?._count.chunks, created.body.chunks.length);
});

test("project and document malformed inputs return400 without creating records", async () => {
  for (const body of [{}, {name: " "}, {name: 123}, {name: "x", objectives: [null]}, {name: "x", problemStatement: []}, {name: "x".repeat(201)}]) {
    assert.equal((await request("/projects", "POST", body)).status, 400);
  }
  const p = await project();
  for (const body of [{}, {name: {}, documentType: "text/plain", content: "text"}, {name: "x", documentType: "pdf", content: "text"}, {name: "x", documentType: "text/plain", content: 42}, {name: "x", documentType: "text/plain", content: " "}, {name: "x", documentType: "text/plain", content: "text", metadata: []}]) {
    assert.equal((await request(`/projects/${p.id}/documents`, "POST", body)).status, 400);
  }
  assert.equal(await prisma.document.count({where: {projectId: p.id}}), 0);
});

test("ambiguous queue error after completed ingestion does not erase worker results", async () => {
  const p = await project();
  queue.enqueue = async job => { await inlineIngestion(job); throw new Error("Synthetic lost enqueue receipt"); };
  try {
    const created = await document(p.id);
    assert.equal(created.status, 201);
    assert.equal(created.body.extractionStatus, "completed");
    assert.equal(created.body.embeddingStatus, "skipped");
    assert.equal(created.body.extractionError, null);
  } finally { queue.enqueue = inlineIngestion; }
});

test("queued ingestion rejects simultaneous retry and genuine queue failure can be retried", { timeout: 15_000 }, async () => {
  const p = await project();
  queue.enqueue = async () => { throw new Error("Synthetic queue unavailable"); };
  const created = await document(p.id);
  assert.equal(created.body.extractionStatus, "queue_failed");
  assert.match(created.body.extractionError ?? "", /Synthetic queue unavailable/);
  let release!: () => void;
  let ready!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  const entered = new Promise<void>(resolve => {ready = resolve;});
  queue.enqueue = async job => {ready(); await gate; await inlineIngestion(job);};
  const retry = request<DocumentResult>(`/documents/${created.body.id}/ingest`, "POST");
  try {
    await Promise.race([entered, retry.then(() => {throw new Error("Retry did not reach queue");})]);
    assert.equal((await request(`/documents/${created.body.id}/ingest`, "POST")).status, 409);
    assert.equal((await request<DocumentResult>(`/documents/${created.body.id}`)).body.extractionStatus, "queued");
  } finally {release(); queue.enqueue = inlineIngestion;}
  const finished = await retry;
  assert.equal(finished.status, 201);
  assert.equal(finished.body.extractionStatus, "completed");
  assert.equal(finished.body.embeddingStatus, "skipped");
});

test("real parser failure remains visible rather than becoming queue_failed", async () => {
  const p = await project();
  const created = await document(p.id);
  await prisma.document.update({where: {id: created.body.id}, data: {sourceText: null}});
  const retry = await request<DocumentResult>(`/documents/${created.body.id}/ingest`, "POST");
  assert.equal(retry.status, 201);
  assert.equal(retry.body.extractionStatus, "failed");
  assert.match(retry.body.extractionError ?? "", /no native source text/);
});

test("accepted-but-unconfirmed old delivery is superseded and duplicate current delivery extracts once", async () => {
  const p = await project();
  const jobs: Array<Parameters<DocumentIngestionQueueService["enqueue"]>[0]> = [];
  queue.enqueue = async job => { jobs.push(job); throw new Error("Synthetic accepted but receipt lost"); };
  try {
    const created = await document(p.id);
    assert.equal(created.body.extractionStatus, "queue_failed");
    queue.enqueue = async job => { jobs.push(job); };
    const retry = await request<DocumentResult>(`/documents/${created.body.id}/ingest`, "POST");
    assert.equal(retry.body.extractionStatus, "queued");
    assert.equal(jobs.length, 2);
    assert.notEqual(jobs[0]?.ingestionAttemptId, jobs[1]?.ingestionAttemptId);
    assert.ok(jobs[0] && jobs[1]);
    const old = await ingestDocument(jobs[0], {prisma, embeddingProvider: null});
    assert.equal(old.chunkCount, 0);
    assert.equal(await prisma.documentChunk.count({where: {documentId: created.body.id}}), 0);
    const current = await Promise.all([ingestDocument(jobs[1], {prisma, embeddingProvider: null}), ingestDocument(jobs[1], {prisma, embeddingProvider: null})]);
    assert.equal(current.filter(result => result.chunkCount > 0).length, 1);
    assert.equal(await prisma.auditEvent.count({where: {artefactId: created.body.id, action: "document.extracted"}}), 1);
    assert.equal((await request<DocumentResult>(`/documents/${created.body.id}`)).body.extractionStatus, "completed");
  } finally { queue.enqueue = inlineIngestion; }
});

test("embedding provider setup failure is terminal and can be retried without any provider call", async () => {
  const p = await project();
  queue.enqueue = async job => { await ingestDocument(job, {prisma, embeddingProviderFactory: () => {throw new Error("Synthetic provider configuration invalid");}}); };
  try {
    const created = await document(p.id);
    assert.equal(created.body.extractionStatus, "completed");
    assert.equal(created.body.embeddingStatus, "failed");
    queue.enqueue = inlineIngestion;
    const retry = await request<DocumentResult>(`/documents/${created.body.id}/ingest`, "POST");
    assert.equal(retry.status, 201);
    assert.equal(retry.body.extractionStatus, "completed");
    assert.equal(retry.body.embeddingStatus, "skipped");
  } finally { queue.enqueue = inlineIngestion; }
});

test("active-attempt redelivery is conservative; crashed processing requires operator reconciliation", async () => {
  const p = await project();
  let job: Parameters<DocumentIngestionQueueService["enqueue"]>[0] | undefined;
  queue.enqueue = async input => { job = input; };
  try {
    const created = await document(p.id);
    assert.ok(job);
    await prisma.document.update({where: {id: created.body.id}, data: {extractionStatus: "processing"}});
    // A duplicate delivery cannot distinguish a live owner from a crashed owner.
    // No invented timeout/lease takeover: keep the active state and make no writes.
    const replay = await ingestDocument(job, {prisma, embeddingProvider: null});
    assert.equal(replay.chunkCount, 0);
    assert.equal(replay.extractionStatus, "superseded_or_already_claimed");
    assert.equal((await request<DocumentResult>(`/documents/${created.body.id}`)).body.extractionStatus, "processing");
    assert.equal((await request(`/documents/${created.body.id}/ingest`, "POST")).status, 409);
    assert.equal(await prisma.documentChunk.count({where: {documentId: created.body.id}}), 0);
  } finally {queue.enqueue = inlineIngestion;}
});
