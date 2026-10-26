import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Prisma } from "@ba-workbench/database";
import { z } from "zod";
import { PrismaService } from "../database/prisma.service";
import { WorkspaceContextService } from "../database/workspace-context.service";
import { buildEvidenceSources, deriveEvidenceState, evidenceFingerprint, parseEvidenceReferences } from "./evidence-state";

const acknowledgementSchema = z.object({
  requestId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  expectedFingerprints: z.string().regex(/^[a-f0-9]{64}$/),
  outcome: z.enum(["supports", "needs_follow_up"]),
  comment: z.string().trim().max(4000).default("")
}).strict().refine(value => value.outcome !== "needs_follow_up" || value.comment.length > 0, {
  message: "Explain what needs follow-up.", path: ["comment"]
});

type Database = PrismaService | Prisma.TransactionClient;
const reviewerSelection = { displayName: true };

@Injectable()
export class EvidenceReviewService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WorkspaceContextService) private readonly workspaceContext: WorkspaceContextService
  ) {}

  private async accessibleRequirement(requirementId: string) {
    const owner = await this.workspaceContext.getOwner();
    const requirement = await this.prisma.requirement.findFirst({
      where: { id: requirementId, project: { organisationId: owner.organisationId } }
    });
    if (!requirement) throw new NotFoundException("Requirement was not found.");
    return { owner, requirement };
  }

  private async snapshot(database: Database, requirementId: string) {
    const requirement = await database.requirement.findUniqueOrThrow({ where: { id: requirementId } });
    const version = await database.requirementVersion.findUnique({
      where: { requirementId_version: { requirementId, version: requirement.currentVersion } }
    });
    if (!version) throw new ConflictException("Requirement version is unavailable. Refresh before reviewing evidence.");
    const refs = parseEvidenceReferences(version.sourceRefs);
    const chunkIds = [...new Set(refs.filter(ref => ref.artefactType === "document_chunk").map(ref => ref.artefactId))];
    const chunks = await database.documentChunk.findMany({
      where: { id: { in: chunkIds }, document: { projectId: requirement.projectId } },
      include: { document: { select: { id: true, name: true, version: true, projectId: true } } }
    });
    const sources = buildEvidenceSources(refs, chunks);
    const history = await database.requirementEvidenceReview.findMany({
      where: { requirementId }, include: { reviewer: { select: reviewerSelection } },
      orderBy: { sequence: "desc" }
    });
    const latest = history[0] ?? null;
    const state = deriveEvidenceState(requirement.currentVersion, sources, latest);
    return { requirement, version, refs, chunks, sources, history, latest, state, fingerprint: evidenceFingerprint(sources) };
  }

  private presentReview(review: { id: string; requirementVersion: number; outcome: string; comment: string | null; reviewedAt: Date; reviewer: { displayName: string } }) {
    return { id: review.id, requirementVersion: review.requirementVersion, outcome: review.outcome,
      comment: review.comment, reviewedAt: review.reviewedAt, reviewer: review.reviewer };
  }

  private async detailUnchecked(requirementId: string) {
    const snapshot = await this.snapshot(this.prisma, requirementId);
    const { requirement, state, sources, history, latest, fingerprint } = snapshot;
    return {
      id: requirement.id, reference: requirement.reference, title: requirement.title,
      statement: requirement.statement, rationale: requirement.rationale,
      currentVersion: requirement.currentVersion, ...state, sources,
      expectedFingerprints: fingerprint,
      latestReview: latest ? this.presentReview(latest) : null,
      history: history.map(review => this.presentReview(review))
    };
  }

  async detail(requirementId: string) {
    await this.accessibleRequirement(requirementId);
    return this.detailUnchecked(requirementId);
  }

  async list(projectId: string) {
    await this.workspaceContext.assertProjectAccess(projectId);
    const requirements = await this.prisma.requirement.findMany({ where: { projectId }, orderBy: { reference: "asc" } });
    // Detailed source text remains in the dedicated review view, not the queue.
    return Promise.all(requirements.map(async requirement => {
      const detail = await this.detailUnchecked(requirement.id);
      return { id: detail.id, reference: detail.reference, title: detail.title, currentVersion: detail.currentVersion,
        status: detail.status, reasons: detail.reasons, latestReview: detail.latestReview };
    }));
  }

  async acknowledge(requirementId: string, input: unknown) {
    const parsed = acknowledgementSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map(issue => issue.message).join(" "));
    const data = parsed.data;
    const { owner, requirement } = await this.accessibleRequirement(requirementId);
    const requestFingerprint = createHash("sha256").update(JSON.stringify({ ...data, reviewedById: owner.id })).digest("hex");
    const result = await this.prisma.$transaction(async transaction => {
      // Serialize acknowledgements and content edits before checking exact version.
      await transaction.$queryRaw`SELECT id FROM "Requirement" WHERE id = ${requirementId} FOR UPDATE`;
      const existing = await transaction.requirementEvidenceReview.findUnique({
        where: { requirementId_requestId: { requirementId, requestId: data.requestId } }
      });
      if (existing) {
        if (existing.requestFingerprint !== requestFingerprint) throw new ConflictException("This submission ID was already used for a different review.");
        return { id: existing.id, replayed: true };
      }

      const initial = await this.snapshot(transaction, requirementId);
      const documentIds = [...new Set(initial.chunks.map(chunk => chunk.documentId))].sort();
      // Ingestion locks each document before changing chunks. Read current data only
      // after acquiring those same locks; retained chunk IDs are not historical proof.
      for (const documentId of documentIds) {
        await transaction.$queryRaw`SELECT id FROM "Document" WHERE id = ${documentId} FOR SHARE`;
      }
      for (const chunk of [...initial.chunks].sort((a, b) => a.id.localeCompare(b.id))) {
        await transaction.$queryRaw`SELECT id FROM "DocumentChunk" WHERE id = ${chunk.id} FOR SHARE`;
      }
      const current = await this.snapshot(transaction, requirementId);
      if (current.chunks.some(chunk => !documentIds.includes(chunk.documentId))) {
        throw new ConflictException("Source evidence changed. Refresh and review it again.");
      }
      if (current.requirement.currentVersion !== data.expectedVersion || current.fingerprint !== data.expectedFingerprints) {
        throw new ConflictException("The requirement or source evidence changed. Refresh and review it again; nothing was recorded.");
      }
      if (data.outcome === "supports" && (current.sources.length === 0 || current.sources.some(source => source.availability !== "available"))) {
        throw new BadRequestException("Available same-project source evidence is required before recording support.");
      }
      const sourceFingerprints = {
        fingerprint: current.fingerprint,
        sources: current.sources.map(source => ({
          artefactType: source.artefactType, artefactId: source.artefactId,
          documentId: current.chunks.find(chunk => chunk.id === source.artefactId)?.documentId ?? null,
          documentVersion: source.documentVersion, fingerprint: source.fingerprint, availability: source.availability
        }))
      };
      const review = await transaction.requirementEvidenceReview.create({
        data: { requirementId, requirementVersionId: current.version.id, requirementVersion: current.requirement.currentVersion,
          reviewedById: owner.id, reviewedAt: new Date(), outcome: data.outcome, comment: data.comment || null,
          sourceFingerprints: sourceFingerprints as Prisma.InputJsonValue, requestId: data.requestId, requestFingerprint }
      });
      await transaction.auditEvent.create({ data: {
        projectId: requirement.projectId, actorId: owner.id, actorType: "user", action: "requirement.evidence_reviewed",
        artefactType: "requirement", artefactId: requirementId,
        summary: `Recorded evidence ${data.outcome === "supports" ? "support acknowledgement" : "follow-up"} for ${requirement.reference} v${current.requirement.currentVersion}.`,
        metadata: { evidenceReviewId: review.id, requirementVersion: current.requirement.currentVersion, outcome: data.outcome }
      } });
      return { id: review.id, replayed: false };
    });
    return { ...await this.detailUnchecked(requirementId), savedReviewId: result.id, replayed: result.replayed };
  }
}
