import { createHash } from 'node:crypto';

export interface EvidenceReference {
  artefactType: string;
  artefactId: string;
  label: string;
  excerpt?: string;
}
export interface EvidenceChunk {
  id: string;
  chunkText: string;
  document: { id: string; name: string; version: number; projectId: string };
}
export interface EvidenceSource {
  artefactType: string;
  artefactId: string;
  label: string;
  savedExcerpt: string | null;
  currentText: string | null;
  documentName: string | null;
  documentVersion: number | null;
  availability: 'available' | 'missing' | 'unsupported';
  fingerprint: string | null;
}
export type EvidenceStatus = 'no_linked_evidence' | 'unavailable_source' | 'not_reviewed' | 'needs_revalidation' | 'reviewed_for_version';
export interface EvidenceState { status: EvidenceStatus; reasons: string[] }

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
// Persisted source refs are JSON. Sort malformed object keys for stable identities.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value ?? null;
}
export function parseEvidenceReferences(input: unknown): EvidenceReference[] {
  if (input === null || input === undefined) return [];
  return (Array.isArray(input) ? input : [input]).map((entry) => {
    if (!Array.isArray(input) || !isRecord(entry) || !nonempty(entry.artefactType) || !nonempty(entry.artefactId)
      || (entry.label !== undefined && typeof entry.label !== 'string')
      || (entry.excerpt !== undefined && entry.excerpt !== null && typeof entry.excerpt !== 'string')) {
      return { artefactType: 'unsupported', artefactId: `malformed:${hash(canonical(entry))}`, label: 'Malformed evidence reference' };
    }
    return {
      artefactType: entry.artefactType, artefactId: entry.artefactId,
      label: typeof entry.label === 'string' ? entry.label : entry.artefactId,
      ...(typeof entry.excerpt === 'string' ? { excerpt: entry.excerpt } : {}),
    };
  });
}
/** The caller MUST scope chunks to the requirement's project before calling. */
export function buildEvidenceSources(refs: EvidenceReference[], chunks: EvidenceChunk[]): EvidenceSource[] {
  const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  return refs.map((ref) => {
    const chunk = ref.artefactType === 'document_chunk' ? byId.get(ref.artefactId) : undefined;
    return {
      artefactType: ref.artefactType, artefactId: ref.artefactId, label: ref.label,
      savedExcerpt: ref.excerpt ?? null, currentText: chunk?.chunkText ?? null,
      documentName: chunk?.document.name ?? null, documentVersion: chunk?.document.version ?? null,
      availability: ref.artefactType !== 'document_chunk' ? 'unsupported' : chunk ? 'available' : 'missing',
      fingerprint: chunk ? hash(['document_chunk:v1', chunk.id, chunk.document.id, chunk.document.version, chunk.chunkText]) : null,
    };
  });
}
/** Order-independent multiset snapshot; duplicate references remain represented. */
export function evidenceFingerprint(sources: EvidenceSource[]): string {
  const entries = sources.map((source) => JSON.stringify([
    source.artefactType, source.artefactId, source.availability, source.fingerprint,
  ])).sort();
  return hash(['evidence-snapshot:v1', entries]);
}
/** Human review currency, not a claim that the requirement or evidence is true. */
export function deriveEvidenceState(
  currentVersion: number, sources: EvidenceSource[],
  latestReview: { requirementVersion: number; sourceFingerprints: unknown; outcome: string } | null,
): EvidenceState {
  if (sources.length === 0) return { status: 'no_linked_evidence', reasons: ['No evidence references are linked.'] };
  if (sources.some((source) => source.availability !== 'available')) {
    return { status: 'unavailable_source', reasons: ['One or more linked sources are missing or unsupported.'] };
  }
  if (!latestReview) return { status: 'not_reviewed', reasons: ['No evidence review has been recorded.'] };
  const reasons: string[] = [];
  if (latestReview.requirementVersion !== currentVersion) reasons.push('The requirement version has changed since the review.');
  const snapshot = latestReview.sourceFingerprints;
  if (!isRecord(snapshot) || snapshot.fingerprint !== evidenceFingerprint(sources)) reasons.push('Linked evidence has changed or the recorded snapshot is invalid.');
  if (latestReview.outcome !== 'supports') reasons.push('The latest evidence review requires follow-up.');
  return reasons.length > 0 ? { status: 'needs_revalidation', reasons } : { status: 'reviewed_for_version', reasons: [] };
}
