import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HttpException } from '@nestjs/common';
import { DocumentIngestionQueueService } from '../src/modules/documents/document-ingestion-queue.service';
import { DocumentsService } from '../src/modules/documents/documents.service';
import { ProjectsService } from '../src/modules/projects/projects.service';
import { AiOrchestrationService } from '../src/modules/ai/ai-orchestration.service';
const workspace: any = { getOwner: async () => ({ id: 'owner', organisationId: 'org' }), assertProjectAccess: async () => ({ owner: { id: 'owner', organisationId: 'org' } }) };
const isHttp = (status: number) => (error: unknown) => error instanceof HttpException && error.getStatus() === status;
// Faithfully apply compare-and-set predicates so unconditional writes fail tests.
function matches(row: Record<string, any>, where: Record<string, any>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'NOT') return !matches(row, value);
    if (value && typeof value === 'object' && 'notIn' in value) return !value.notIn.includes(row[key]);
    return row[key] === value;
  });
}
function fixture(kind: 'document' | 'aiJob', onEnqueue: (row: any) => void | Promise<void> = () => {}) {
  let row: any = { id: 'doc', projectId: 'project', name: 'Notes', extractionStatus: 'failed', embeddingStatus: 'failed', chunks: [] };
  let queued = 0, created = 0;
  const model = {
    create: async ({ data }: any) => { created++; row = { id: 'job', error: null, ...data, chunks: [], outputs: [] }; return row; },
    findFirst: async () => ({ ...row }),
    updateMany: async ({ where, data }: any) => { if (!matches(row, where)) return { count: 0 }; Object.assign(row, data); return { count: 1 }; },
    update: async ({ data }: any) => { Object.assign(row, data); return row; }
  };
  const database: any = {
    document: { findMany: async () => [{ id: 'doc', name: 'Notes', extractionStatus: 'completed', _count: { chunks: 1 } }] },
    [kind]: model, auditEvent: { create: async () => ({}) }, $transaction: async (run: any) => run(database)
  };
  const queue: any = { enqueue: async () => { queued++; await onEnqueue(row); } };
  return {
    docs: new DocumentsService(database, workspace, queue), ai: new AiOrchestrationService(database, workspace, queue, {} as any),
    row: () => row, queued: () => queued, created: () => created
  };
}
const validDocument = { name: ' Notes ', documentType: 'text/plain', content: 'Original source\r\nSecond line' };
const validJob = { jobType: 'extract_requirements', sourceArtefactIds: ['doc'] };
for (const kind of ['document', 'aiJob'] as const) {
  for (const status of ['processing', 'completed', 'failed']) {
    for (const ambiguousError of [false, true]) {
      test(`${kind} enqueue preserves inline worker ${status}, ambiguous error=${ambiguousError}`, async () => {
        const f = fixture(kind, row => {
          const field = kind === 'document' ? 'extractionStatus' : 'status';
          assert.equal(row[field], 'queued');
          row[field] = status;
          if (ambiguousError) throw new Error('Redis response lost after acceptance');
        });
        if (kind === 'document') assert.equal((await f.docs.create('project', validDocument)).extractionStatus, status);
        else assert.equal((await f.ai.createDraftJob('project', validJob)).status, status);
        assert.equal(f.queued(), 1);
      });
    }
  }
  test(`${kind} queue failure transitions only still-queued work`, async () => {
    const f = fixture(kind, () => { throw new Error('Redis unavailable'); });
    if (kind === 'document') {
      assert.equal((await f.docs.create('project', validDocument)).extractionStatus, 'queue_failed');
      assert.equal(f.row().extractionError, 'Redis unavailable');
      await f.docs.reingest(f.row().id);
      assert.equal(f.queued(), 2);
    } else {
      const result = await f.ai.createDraftJob('project', validJob);
      assert.equal(result.status, 'queue_failed');
      assert.equal(result.error, 'Redis unavailable');
    }
  });
}
test('simultaneous document retries atomically claim one queue submission', async () => {
  const f = fixture('document');
  const results = await Promise.allSettled([f.docs.reingest('doc'), f.docs.reingest('doc')]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find(result => result.status === 'rejected');
  assert.ok(rejected && rejected.status === 'rejected' && isHttp(409)(rejected.reason));
  assert.equal(f.queued(), 1);
});
for (const [extractionStatus, embeddingStatus] of [['queued', 'pending'], ['processing', 'pending'], ['completed', 'pending'], ['completed', 'processing'], ['completed', 'queued']]) {
  test(`retry rejects active document ${extractionStatus}/${embeddingStatus}`, async () => {
    const f = fixture('document'); Object.assign(f.row(), { extractionStatus, embeddingStatus });
    await assert.rejects(f.docs.reingest('doc'), isHttp(409)); assert.equal(f.queued(), 0);
  });
}
for (const [extractionStatus, embeddingStatus] of [['pending', 'pending'], ['completed', 'skipped'], ['completed', 'completed'], ['completed', 'failed'], ['failed', 'failed']]) {
  test(`retry accepts inactive document ${extractionStatus}/${embeddingStatus}`, async () => {
    const f = fixture('document'); Object.assign(f.row(), { extractionStatus, embeddingStatus });
    await f.docs.reingest('doc'); assert.equal(f.queued(), 1); assert.equal(f.row().extractionStatus, 'queued');
  });
}
test('document validation rejects malformed bodies before persistence', async () => {
  const f = fixture('document');
  for (const body of [null, undefined, [], 42, {}, { ...validDocument, name: 42 }, { ...validDocument, name: ' ' },
    { ...validDocument, name: 'n'.repeat(201) }, { ...validDocument, content: null }, { ...validDocument, content: {} },
    { ...validDocument, content: ' ' }, { ...validDocument, content: 'x'.repeat(2_000_001) },
    { ...validDocument, documentType: 'application/pdf' }, { ...validDocument, metadata: [] }, { ...validDocument, metadata: null }]) {
    await assert.rejects(f.docs.create('project', body), isHttp(400));
  }
  assert.equal(f.created(), 0); assert.equal(f.queued(), 0);
});
test('native types preserve metadata and normalize source newlines', async () => {
  const metadata = { source: 'workshop', tags: ['synthetic'], nested: { approved: false }, count: 0, optional: null };
  for (const documentType of ['text/plain', 'text/markdown', 'transcript']) {
    const f = fixture('document'); await f.docs.create('project', { ...validDocument, documentType, metadata });
    assert.equal(f.row().name, 'Notes'); assert.equal(f.row().sourceText, 'Original source\nSecond line'); assert.deepEqual(f.row().metadata, metadata);
  }
});
test('content exactly at the existing 2M-character limit remains accepted', async () => {
  const f = fixture('document'); await f.docs.create('project', { ...validDocument, content: 'x'.repeat(2_000_000) }); assert.equal(f.created(), 1);
});
test('project validation rejects malformed values and preserves valid optional inputs', async () => {
  let created = 0;
  const database: any = { project: { create: async ({ data }: any) => { created++; return { id: 'project', ...data }; } }, auditEvent: { create: async () => ({}) }, $transaction: async (run: any) => run(database) };
  const service = new ProjectsService(database, workspace);
  for (const body of [null, undefined, [], 42, {}, { name: 42 }, { name: ' ' }, { name: 'x'.repeat(201) },
    { name: 'Valid', problemStatement: null }, { name: 'Valid', problemStatement: 42 }, { name: 'Valid', problemStatement: 'x'.repeat(4001) },
    { name: 'Valid', objectives: null }, { name: 'Valid', objectives: 'x' }, { name: 'Valid', objectives: [42] },
    { name: 'Valid', objectives: [' '] }, { name: 'Valid', objectives: ['x'.repeat(501)] }, { name: 'Valid', objectives: Array(21).fill('Objective') }]) await assert.rejects(service.create(body), isHttp(400));
  assert.equal(created, 0);
  const result = await service.create({ name: ' Project ', problemStatement: '', objectives: [' Objective '] });
  assert.equal(result.name, 'Project'); assert.equal(result.problemStatement, ''); assert.deepEqual(result.objectives, ['Objective']);
});

test('late enqueue failure from an older completed attempt cannot overwrite a newer queued retry', async () => {
  let signalFirstCompleted!: () => void;
  let failFirstEnqueue!: (error: Error) => void;
  const firstCompleted = new Promise<void>(resolve => { signalFirstCompleted = resolve; });
  const firstEnqueue = new Promise<void>((_, reject) => { failFirstEnqueue = reject; });
  let enqueueCount = 0;
  const f = fixture('document', async row => {
    enqueueCount++;
    if (enqueueCount === 1) {
      row.extractionStatus = 'completed';
      row.embeddingStatus = 'skipped';
      signalFirstCompleted();
      await firstEnqueue;
    }
  });
  const create = f.docs.create('project', validDocument);
  await firstCompleted;
  const firstAttempt = f.row().ingestionAttemptId;
  await f.docs.reingest(f.row().id);
  const secondAttempt = f.row().ingestionAttemptId;
  failFirstEnqueue(new Error('Old Redis acknowledgement arrived late'));
  await create;
  assert.equal(f.queued(), 2);
  assert.equal(f.row().extractionStatus, 'queued');
  assert.equal(f.row().extractionError, null);
  assert.notEqual(firstAttempt, secondAttempt);
  assert.equal(f.row().ingestionAttemptId, secondAttempt);
});


test('document queue uses stable attempt-specific IDs and supports legacy payloads', async () => {
  const calls: any[] = [];
  // Bypass constructor to stub BullMQ without opening a Redis connection.
  const queue = Object.create(DocumentIngestionQueueService.prototype) as DocumentIngestionQueueService;
  Object.assign(queue, { queue: { add: async (...args: any[]) => { calls.push(args); } } });
  const payload = { documentId: 'doc', projectId: 'project', ingestionAttemptId: 'attempt-a' };
  await queue.enqueue(payload);
  await queue.enqueue(payload);
  await queue.enqueue({ ...payload, ingestionAttemptId: 'attempt-b' });
  await queue.enqueue({ documentId: 'doc', projectId: 'project' });
  assert.equal(calls[0][2].jobId, calls[1][2].jobId);
  assert.notEqual(calls[0][2].jobId, calls[2][2].jobId);
  assert.equal(calls[3][2].jobId, undefined);
  assert.deepEqual(calls[0][1], payload);
});
