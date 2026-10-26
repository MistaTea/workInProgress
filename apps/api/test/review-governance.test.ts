import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { ReviewsService } from "../src/modules/reviews/reviews.service";
import type { PrismaService } from "../src/modules/database/prisma.service";
import type { WorkspaceContextService } from "../src/modules/database/workspace-context.service";

function fixture(options: { currentVersion?: number; status?: string; expiresAt?: Date; linkCount?: number; claimFails?: boolean } = {}) {
  const snapshot = { id: "rv1", version: 1, title: "Original title", statement: "Original statement", type: "functional", priority: "must", rationale: "Original rationale" };
  const link = {
    id: "link", status: options.status ?? "active", expiresAt: options.expiresAt ?? new Date(Date.now() + 60_000),
    baselineId: "packet", stakeholderId: null, stakeholder: null, approvals: [], emailRequired: false,
    artefactType: "requirement_baseline", baseline: {
      id: "packet", projectId: "project", name: "Review", version: 1, status: "sent_for_review",
      items: [{ requirementId: "req", requirement: { id: "req", reference: "REQ-001", title: "New secret title", statement: "New secret statement" }, requirementVersion: snapshot }]
    }
  };
  const calls: Array<{ operation: string; args: any }> = [];
  let evidenceCount = 0;
  const transaction = {
    $queryRaw: async () => [],
    reviewLink: {
      count: async () => options.linkCount ?? 1,
      updateMany: async (args: any) => {
        calls.push({ operation: "claim", args });
        return { count: options.claimFails ? 0 : 1 };
      }
    },
    requirementBaseline: { updateMany: async (args: any) => { calls.push({ operation: "packet", args }); return { count: 1 }; } },
    approvalEvidence: { create: async ({ data }: any) => { evidenceCount++; return { ...data, id: "evidence", decidedAt: new Date() }; } },
    requirement: { updateMany: async (args: any) => { calls.push({ operation: "requirement", args }); return { count: (options.currentVersion ?? 1) === args.where.currentVersion ? 1 : 0 }; } },
    auditEvent: { create: async (args: any) => { calls.push({ operation: "audit", args }); return {}; } }
  };
  const prisma = {
    reviewLink: { findUnique: async () => link, updateMany: async () => ({ count: 1 }) },
    $transaction: async (run: any) => run(transaction)
  } as unknown as PrismaService;
  return { service: new ReviewsService(prisma, {} as WorkspaceContextService), calls, snapshot, evidenceCount: () => evidenceCount };
}

test("public review exposes immutable snapshot, not later requirement content", async () => {
  const { service, snapshot } = fixture();
  const review = await service.getReview("token");
  assert.deepEqual(review.baseline?.items[0]?.requirement, { id: "req", reference: "REQ-001" });
  assert.deepEqual(review.baseline?.items[0]?.requirementVersion, snapshot);
  assert.equal(JSON.stringify(review).includes("New secret"), false);
});

for (const status of ["revoked", "expired"]) {
  test(`${status} links cannot disclose packet content`, async () => {
    await assert.rejects(fixture({ status }).service.getReview("token"), /no longer available/);
  });
}

test("an elapsed active link cannot disclose or decide", async () => {
  const f = fixture({ expiresAt: new Date(Date.now() - 1) });
  await assert.rejects(f.service.getReview("token"), /no longer available/);
  await assert.rejects(f.service.recordApproval("token", { decision: "approved", reviewerName: "Reviewer" }), /expired/);
  assert.equal(f.evidenceCount(), 0);
});

test("completed link remains an immutable receipt and cannot decide again", async () => {
  const f = fixture({ status: "completed", expiresAt: new Date(0) });
  assert.equal((await f.service.getReview("token")).status, "completed");
  await assert.rejects(f.service.recordApproval("token", { decision: "approved", reviewerName: "Reviewer" }), /completed/);
  assert.equal(f.evidenceCount(), 0);
});

for (const decision of ["approved", "rejected", "changes_requested"] as const) {
  test(`${decision} evidence cannot change a newer requirement version`, async () => {
    const f = fixture({ currentVersion: 2 });
    const result = await f.service.recordApproval("token", { decision, reviewerName: "Reviewer" });
    assert.deepEqual(result.updatedRequirementIds, []);
    assert.deepEqual(result.supersededRequirementIds, ["req"]);
    assert.equal(result.evidence.artefactVersion, "v1");
    assert.deepEqual(f.calls.find(c => c.operation === "requirement")?.args.where, { id: "req", currentVersion: 1 });
  });
}

test("atomic link claim guards expiry and single use before recording evidence", async () => {
  const f = fixture({ claimFails: true });
  await assert.rejects(f.service.recordApproval("token", { decision: "approved", reviewerName: "Reviewer" }), /expired or already/);
  const claim = f.calls.find(c => c.operation === "claim")!.args;
  assert.equal(claim.where.status, "active");
  assert.ok(claim.where.expiresAt.gt instanceof Date);
  assert.equal(f.evidenceCount(), 0);
});

test("multiple live links require explicit policy rather than first-response-wins", async () => {
  const f = fixture({ linkCount: 2 });
  await assert.rejects(f.service.recordApproval("token", { decision: "approved", reviewerName: "Reviewer" }), /multiple review links/);
  assert.equal(f.evidenceCount(), 0);
  assert.equal(f.calls.length, 0);
});

test("unchanged version receives status and audit of the applied decision", async () => {
  const f = fixture();
  const result = await f.service.recordApproval("token", { decision: "approved", reviewerName: "Reviewer" });
  assert.deepEqual(result.updatedRequirementIds, ["req"]);
  assert.deepEqual(result.supersededRequirementIds, []);
  assert.equal(f.calls.find(c => c.operation === "requirement")?.args.data.status, "approved");
  assert.deepEqual(f.calls.find(c => c.operation === "audit")?.args.data.metadata.updatedRequirementIds, ["req"]);
});

import { RequirementsService } from "../src/modules/requirements/requirements.service";

function requirementFixture(conflict = false) {
  const existing = { id: "req", projectId: "project", reference: "REQ-001", title: "Title", statement: "Statement", type: "functional", priority: "must", rationale: "Original rationale", status: "approved", currentVersion: 1, versions: [{ sourceRefs: [{ artefactId: "source" }] }] };
  const writes: any[] = [];
  const versions: any[] = [];
  const transaction = {
    requirement: {
      updateMany: async (args: any) => { writes.push(args); return { count: conflict ? 0 : 1 }; },
      findUniqueOrThrow: async () => ({ ...existing, ...writes[0].data })
    },
    requirementVersion: { create: async (args: any) => { versions.push(args); } },
    auditEvent: { create: async () => ({}) }
  };
  const prisma = { requirement: { findFirst: async () => existing }, $transaction: async (run: any) => run(transaction) } as unknown as PrismaService;
  const context = { getOwner: async () => ({ id: "owner", organisationId: "org" }) } as unknown as WorkspaceContextService;
  return { service: new RequirementsService(prisma, context), writes, versions };
}

test("editing approved content resets status and retains source evidence in new version", async () => {
  const f = requirementFixture();
  const result = await f.service.update("req", { statement: "New statement", status: "approved" });
  assert.equal(result.status, "draft");
  assert.equal(result.currentVersion, 2);
  assert.deepEqual(f.writes[0].where, { id: "req", currentVersion: 1 });
  assert.deepEqual(f.versions[0].data.sourceRefs, [{ artefactId: "source" }]);
});

test("stale concurrent edit fails before adding a version", async () => {
  const f = requirementFixture(true);
  await assert.rejects(f.service.update("req", { statement: "New statement" }), /changed/);
  assert.equal(f.versions.length, 0);
});

test("no-op edit does not copy stale status or invent a new content version", async () => {
  const f = requirementFixture();
  await f.service.update("req", { title: "Title" });
  assert.equal(f.writes[0].data.currentVersion, 1);
  assert.equal("status" in f.writes[0].data, false);
  assert.equal(f.versions.length, 0);
});


test("clearing rationale is a content change requiring a new unapproved version", async () => {
  const f = requirementFixture();
  const result = await f.service.update("req", { rationale: null });
  assert.equal(result.status, "draft");
  assert.equal(result.currentVersion, 2);
  assert.equal(f.versions[0].data.rationale, null);
});
