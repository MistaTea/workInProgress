import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Prisma } from '@ba-workbench/database';
import { AppModule } from '../src/modules/app.module';
import { PrismaService } from '../src/modules/database/prisma.service';

interface Detail {
  id: string;
  currentVersion: number;
  status: string;
  expectedFingerprints: string;
  sources: Array<{ availability: string; currentText: string | null; savedExcerpt: string | null }>;
  history: Array<{ id: string; requirementVersion: number; outcome: string }>;
  savedReviewId?: string;
  replayed?: boolean;
}
let app: INestApplication | undefined;
let prisma: PrismaService;
let baseUrl: string;
async function request<T>(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(`${baseUrl}/api${path}`, {
    method, headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() as T };
}
before(async () => {
  process.env.DEFAULT_ORGANISATION_NAME = 'Evidence Integration Workspace';
  process.env.DEFAULT_OWNER_NAME = 'Evidence Integration BA';
  process.env.DEFAULT_OWNER_EMAIL = 'evidence-integration@ba-workbench.local';
  app = await NestFactory.create(AppModule, { logger: ['error'] });
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  prisma = app.get(PrismaService);
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "Organisation" CASCADE');
  baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
});
after(async () => {
  if (prisma) await prisma.$executeRawUnsafe('TRUNCATE TABLE "Organisation" CASCADE');
  await app?.close();
});
async function project() {
  const result = await request<{ id: string }>('/projects', 'POST', { name: 'Synthetic evidence project' });
  assert.equal(result.status, 201);
  return result.body;
}
async function fixture() {
  const p = await project();
  const result = await request<{ id: string }>(`/projects/${p.id}/requirements`, 'POST', {
    title: 'Show exception reason', statement: 'The system must show an exception reason.', type: 'functional', priority: 'must', rationale: 'Reduce investigation time.',
  });
  assert.equal(result.status, 201);
  const id = result.body.id;
  const document = await prisma.document.create({ data: {
    projectId: p.id, name: 'Synthetic operations notes', documentType: 'text/plain', storageUri: 'test://synthetic-evidence', extractionStatus: 'completed',
  } });
  const chunk = await prisma.documentChunk.create({ data: {
    documentId: document.id, chunkIndex: 0, chunkText: 'Saved excerpt. Operations must see the exception reason.',
  } });
  const refs = [{ artefactType: 'document_chunk', artefactId: chunk.id, label: document.name, excerpt: 'Saved excerpt.' }];
  await setRefs(id, refs);
  return { id, projectId: p.id, document, chunk, refs };
}
async function setRefs(id: string, refs: Prisma.InputJsonValue) {
  await prisma.requirementVersion.update({ where: { requirementId_version: { requirementId: id, version: 1 } }, data: { sourceRefs: refs } });
}
async function detail(id: string) {
  const result = await request<Detail>(`/requirements/${id}/evidence-review`);
  assert.equal(result.status, 200);
  return result.body;
}
function submission(snapshot: Detail, extra: Record<string, unknown> = {}) {
  return { requestId: randomUUID(), expectedVersion: snapshot.currentVersion, expectedFingerprints: snapshot.expectedFingerprints, outcome: 'supports', ...extra };
}
const submit = (id: string, payload: unknown) => request<Detail>(`/requirements/${id}/evidence-review`, 'POST', payload);

test('legacy linked evidence becomes reviewed, unchanged text stays current, and full-text change invalidates', async () => {
  const f = await fixture();
  const initial = await detail(f.id);
  assert.equal(initial.status, 'not_reviewed');
  const supported = await submit(f.id, submission(initial));
  assert.equal(supported.status, 201);
  assert.equal(supported.body.status, 'reviewed_for_version');
  await prisma.documentChunk.update({ where: { id: f.chunk.id }, data: { chunkText: f.chunk.chunkText } });
  assert.equal((await detail(f.id)).status, 'reviewed_for_version');
  await prisma.documentChunk.update({ where: { id: f.chunk.id }, data: { chunkText: 'Saved excerpt. The full-text policy now differs.' } });
  const changed = await detail(f.id);
  assert.equal(changed.sources[0]?.savedExcerpt, 'Saved excerpt.');
  assert.equal(changed.status, 'needs_revalidation');
  assert.notEqual(changed.expectedFingerprints, initial.expectedFingerprints);
  assert.equal(changed.history.length, 1);
  const queue = await request<Array<{ id: string; status: string }>>(`/projects/${f.projectId}/evidence-review`);
  assert.equal(queue.status, 200);
  assert.equal(queue.body.find(row => row.id === f.id)?.status, 'needs_revalidation');
});

test('status-only changes do not revalidate; rationale/version edits do and retain prior review', async () => {
  const f = await fixture();
  assert.equal((await submit(f.id, submission(await detail(f.id)))).status, 201);
  const statusEdit = await request<{ currentVersion: number }>(`/requirements/${f.id}`, 'PATCH', { status: 'in_review' });
  assert.equal(statusEdit.status, 200);
  assert.equal(statusEdit.body.currentVersion, 1);
  assert.equal((await detail(f.id)).status, 'reviewed_for_version');
  const edit = await request<{ currentVersion: number; status: string }>(`/requirements/${f.id}`, 'PATCH', { rationale: 'New rationale requiring human revalidation.' });
  assert.equal(edit.status, 200);
  assert.equal(edit.body.currentVersion, 2);
  const changed = await detail(f.id);
  assert.equal(changed.status, 'needs_revalidation');
  assert.equal(changed.history[0]?.requirementVersion, 1);
  const resupported = await submit(f.id, submission(changed));
  assert.equal(resupported.status, 201);
  assert.equal(resupported.body.status, 'reviewed_for_version');
  assert.equal(resupported.body.history.length, 2);
  assert.deepEqual(resupported.body.history.map(row => row.requirementVersion).sort(), [1, 2]);
});

test('empty, missing, unsupported, malformed and cross-project refs cannot record support', async () => {
  const f = await fixture();
  const foreign = await fixture();
  const cases: Array<{ refs: Prisma.InputJsonValue; status: string }> = [
    { refs: [], status: 'no_linked_evidence' },
    { refs: [{ ...f.refs[0], artefactId: 'missing-chunk' }], status: 'unavailable_source' },
    { refs: [{ artefactType: 'external', artefactId: 'x', label: 'Unsupported' }], status: 'unavailable_source' },
    { refs: [null], status: 'unavailable_source' },
    { refs: [{ ...f.refs[0], artefactId: foreign.chunk.id }], status: 'unavailable_source' },
  ];
  for (const item of cases) {
    await setRefs(f.id, item.refs);
    const snapshot = await detail(f.id);
    assert.equal(snapshot.status, item.status);
    assert.ok(snapshot.sources.every(source => source.currentText === null));
    assert.equal((await submit(f.id, submission(snapshot))).status, 400);
    assert.equal(await prisma.requirementEvidenceReview.count({ where: { requirementId: f.id } }), 0);
  }
});

test('stale expected requirement versions and source fingerprints reject without recording evidence', async () => {
  const f = await fixture();
  const initial = await detail(f.id);
  assert.equal((await submit(f.id, submission(initial, { expectedVersion: 2 }))).status, 409);
  assert.equal((await submit(f.id, submission(initial, { expectedFingerprints: '0'.repeat(64) }))).status, 409);
  await prisma.documentChunk.update({ where: { id: f.chunk.id }, data: { chunkText: `${f.chunk.chunkText} Changed.` } });
  assert.equal((await submit(f.id, submission(initial))).status, 409);
  const fresh = await detail(f.id);
  await request(`/requirements/${f.id}`, 'PATCH', { rationale: 'Edited after the review screen opened.' });
  assert.equal((await submit(f.id, submission(fresh))).status, 409);
  assert.equal(await prisma.requirementEvidenceReview.count({ where: { requirementId: f.id } }), 0);
  assert.equal(await prisma.auditEvent.count({ where: { artefactId: f.id, action: 'requirement.evidence_reviewed' } }), 0);
});

test('parallel identical request IDs create one record and conflicting payload replay is rejected', async () => {
  const f = await fixture();
  const payload = submission(await detail(f.id));
  const results = await Promise.all(Array.from({ length: 4 }, () => submit(f.id, payload)));
  assert.deepEqual(results.map(result => result.status), [201, 201, 201, 201]);
  assert.equal(new Set(results.map(result => result.body.savedReviewId)).size, 1);
  assert.equal(results.filter(result => result.body.replayed === false).length, 1);
  assert.equal(results.filter(result => result.body.replayed === true).length, 3);
  assert.equal(await prisma.requirementEvidenceReview.count({ where: { requirementId: f.id } }), 1);
  assert.equal(await prisma.auditEvent.count({ where: { artefactId: f.id, action: 'requirement.evidence_reviewed' } }), 1);
  assert.equal((await submit(f.id, { ...payload, comment: 'A different payload' })).status, 409);
  assert.equal((await detail(f.id)).history.length, 1);
});

test('follow-up requires a meaningful comment and does not mutate requirement or stakeholder approval evidence', async () => {
  const f = await fixture();
  const packet = await request<{ id: string; token: string }>(`/projects/${f.projectId}/review-packets`, 'POST', { requirementIds: [f.id] });
  assert.equal(packet.status, 201);
  assert.equal((await request(`/review/${packet.body.token}/decision`, 'POST', { decision: 'approved', reviewerName: 'Synthetic stakeholder' })).status, 201);
  const beforeRequirement = await prisma.requirement.findUniqueOrThrow({ where: { id: f.id } });
  assert.equal(beforeRequirement.status, 'approved');
  const approvalBefore = await prisma.approvalEvidence.findMany({ where: { baselineId: packet.body.id } });
  assert.equal(approvalBefore.length, 1);
  const initial = await detail(f.id);
  for (const comment of ['', '   ']) assert.equal((await submit(f.id, submission(initial, { outcome: 'needs_follow_up', comment }))).status, 400);
  assert.equal(await prisma.requirementEvidenceReview.count({ where: { requirementId: f.id } }), 0);
  const supports = await submit(f.id, submission(initial));
  assert.equal(supports.status, 201);
  const followup = await submit(f.id, submission(await detail(f.id), { outcome: 'needs_follow_up', comment: 'Confirm the exception wording with operations.' }));
  assert.equal(followup.status, 201);
  assert.equal(followup.body.status, 'needs_revalidation');
  assert.equal(followup.body.history.length, 2);
  assert.ok(followup.body.history.some(row => row.id === supports.body.savedReviewId && row.outcome === 'supports'));
  const afterRequirement = await prisma.requirement.findUniqueOrThrow({ where: { id: f.id } });
  assert.deepEqual(afterRequirement, beforeRequirement);
  assert.deepEqual(await prisma.approvalEvidence.findMany({ where: { baselineId: packet.body.id } }), approvalBefore);
  assert.equal(await prisma.requirementVersion.count({ where: { requirementId: f.id } }), 1);
});

test('latest inserted evidence review wins even when timestamps tie or run backwards', async () => {
  const f = await fixture();
  const supported = await submit(f.id, submission(await detail(f.id)));
  assert.equal(supported.status, 201);
  assert.ok(supported.body.savedReviewId);
  const followup = await submit(f.id, submission(await detail(f.id), { outcome: 'needs_follow_up', comment: 'Recheck the source interpretation.' }));
  assert.equal(followup.status, 201);
  assert.ok(followup.body.savedReviewId);
  const tiedAt = new Date('2026-01-02T00:00:00.000Z');
  await prisma.requirementEvidenceReview.updateMany({ where: { requirementId: f.id }, data: { reviewedAt: tiedAt } });
  const tied = await detail(f.id);
  assert.equal(tied.status, 'needs_revalidation');
  assert.deepEqual(tied.history.map(row => row.id), [followup.body.savedReviewId, supported.body.savedReviewId]);
  await prisma.requirementEvidenceReview.update({ where: { id: followup.body.savedReviewId }, data: { reviewedAt: new Date('2026-01-01T00:00:00.000Z') } });
  const backwards = await detail(f.id);
  assert.equal(backwards.status, 'needs_revalidation');
  assert.deepEqual(backwards.history.map(row => row.id), [followup.body.savedReviewId, supported.body.savedReviewId]);
});

test('a blocked source acknowledgement rechecks full text after ingestion commits', { timeout: 15_000 }, async () => {
  const f = await fixture();
  const oldSnapshot = await detail(f.id);
  let signalWriterReady!: () => void;
  let releaseWriter!: () => void;
  const writerReady = new Promise<void>(resolve => { signalWriterReady = resolve; });
  const writerRelease = new Promise<void>(resolve => { releaseWriter = resolve; });
  const changedText = 'Saved excerpt. Concurrent ingestion changed the remaining full text.';
  const writer = prisma.$transaction(async transaction => {
    // Match ingestion's document-before-chunk lock order.
    await transaction.$queryRaw`SELECT id FROM "Document" WHERE id = ${f.document.id} FOR UPDATE`;
    await transaction.documentChunk.update({ where: { id: f.chunk.id }, data: { chunkText: changedText } });
    signalWriterReady();
    await writerRelease;
  }, { timeout: 10_000 });
  let pending: ReturnType<typeof submit> | undefined;
  try {
    // If setup fails, reject immediately instead of waiting forever for its signal.
    await Promise.race([writerReady, writer]);
    pending = submit(f.id, submission(oldSnapshot));
    const deadline = Date.now() + 4_000;
    let blockedOnSourceLock = false;
    while (Date.now() < deadline) {
      const blocked = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*)::bigint AS count FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid()
          AND wait_event_type = 'Lock' AND query LIKE '%Document%' AND query LIKE '%FOR SHARE%'
      `;
      if (Number(blocked[0]?.count ?? 0) > 0) { blockedOnSourceLock = true; break; }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.ok(blockedOnSourceLock, 'Acknowledgement must actually block on the writer document lock before commit');
  } finally {
    releaseWriter();
    await writer;
    if (pending) await pending;
  }
  assert.ok(pending);
  const result = await pending;
  assert.equal(result.status, 409);
  assert.equal(await prisma.requirementEvidenceReview.count({ where: { requirementId: f.id } }), 0);
  const refreshed = await detail(f.id);
  assert.equal(refreshed.sources[0]?.currentText, changedText);
  assert.notEqual(refreshed.expectedFingerprints, oldSnapshot.expectedFingerprints);
});
