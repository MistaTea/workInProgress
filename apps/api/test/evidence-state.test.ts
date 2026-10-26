import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEvidenceSources, deriveEvidenceState, evidenceFingerprint, parseEvidenceReferences, type EvidenceChunk, type EvidenceSource } from '../src/modules/requirements/evidence-state';
const chunk: EvidenceChunk = { id: 'chunk-1', chunkText: 'Saved excerpt. Full text beyond the excerpt.', document: { id: 'doc-1', name: 'Policy', version: 1, projectId: 'project-1' } };
const refs = [{ artefactType: 'document_chunk', artefactId: chunk.id, label: 'Policy', excerpt: 'Saved excerpt.' }];
const sources = () => buildEvidenceSources(parseEvidenceReferences(refs), [chunk]);
const review = (items: EvidenceSource[] = sources()) => ({ requirementVersion: 1, sourceFingerprints: { fingerprint: evidenceFingerprint(items) }, outcome: 'supports' });

test('unchanged full text is reviewed for the exact requirement version', () => {
  assert.deepEqual(deriveEvidenceState(1, sources(), review()), { status: 'reviewed_for_version', reasons: [] });
});
test('text changes beyond the saved excerpt require revalidation', () => {
  const changed = buildEvidenceSources(refs, [{ ...chunk, chunkText: 'Saved excerpt. Changed full text.' }]);
  assert.equal(changed[0].savedExcerpt, sources()[0].savedExcerpt);
  assert.equal(deriveEvidenceState(1, changed, review()).status, 'needs_revalidation');
});
test('requirement version and document version changes require revalidation', () => {
  assert.equal(deriveEvidenceState(2, sources(), review()).status, 'needs_revalidation');
  const changed = buildEvidenceSources(refs, [{ ...chunk, document: { ...chunk.document, version: 2 } }]);
  assert.equal(deriveEvidenceState(1, changed, review()).status, 'needs_revalidation');
});
test('document identity is bound into the full-text fingerprint', () => {
  const changed = buildEvidenceSources(refs, [{ ...chunk, document: { ...chunk.document, id: 'other-doc' } }]);
  assert.notEqual(changed[0].fingerprint, sources()[0].fingerprint);
});
test('empty refs and legacy reviews cannot count as reviewed evidence', () => {
  for (const input of [null, undefined, []]) assert.equal(deriveEvidenceState(1, buildEvidenceSources(parseEvidenceReferences(input), []), review()).status, 'no_linked_evidence');
  assert.equal(deriveEvidenceState(1, sources(), null).status, 'not_reviewed');
  assert.equal(deriveEvidenceState(1, sources(), { ...review(), sourceFingerprints: [] }).status, 'needs_revalidation');
});
test('missing, unsupported and malformed references never disappear into reviewed status', () => {
  for (const input of [refs, [{ artefactType: 'external', artefactId: 'abc' }], [null], [42], [{}], 'bad', {}, [{ ...refs[0], artefactId: '' }], [{ ...refs[0], excerpt: 42 }]]) {
    const result = buildEvidenceSources(parseEvidenceReferences(input), []);
    assert.ok(result.length > 0);
    assert.equal(deriveEvidenceState(1, result, review(result)).status, 'unavailable_source');
  }
  const mixed = buildEvidenceSources(parseEvidenceReferences([...refs, null]), [chunk]);
  assert.equal(deriveEvidenceState(1, mixed, review(mixed)).status, 'unavailable_source');
});
test('cross-project chunks filtered by caller resolve as missing', () => {
  const otherProject = { ...chunk, document: { ...chunk.document, projectId: 'project-2' } };
  const result = buildEvidenceSources(refs, [otherProject].filter((item) => item.document.projectId === 'project-1'));
  assert.equal(result[0].availability, 'missing');
  assert.equal(deriveEvidenceState(1, result, review(result)).status, 'unavailable_source');
});
test('missing and unsupported identity is included and resolution changes snapshot', () => {
  const missing = buildEvidenceSources(refs, []);
  const different = buildEvidenceSources([{ ...refs[0], artefactId: 'chunk-2' }], []);
  assert.notEqual(evidenceFingerprint(missing), evidenceFingerprint(different));
  assert.notEqual(evidenceFingerprint(missing), evidenceFingerprint(sources()));
  assert.equal(deriveEvidenceState(1, sources(), review(missing)).status, 'needs_revalidation');
});
test('latest follow-up invalidates an earlier supporting review', () => {
  assert.equal(deriveEvidenceState(1, sources(), { ...review(), outcome: 'needs_follow_up' }).status, 'needs_revalidation');
  assert.equal(deriveEvidenceState(1, sources(), { ...review(), outcome: 'unknown' }).status, 'needs_revalidation');
});
test('fingerprints are deterministic across order; presentation metadata is irrelevant', () => {
  const items = [...sources(), ...buildEvidenceSources([{ artefactType: 'external', artefactId: 'x', label: 'X' }], [])];
  assert.equal(evidenceFingerprint(items), evidenceFingerprint([...items].reverse()));
  assert.equal(evidenceFingerprint(sources()), evidenceFingerprint(sources().map((item) => ({ ...item, label: 'New label', savedExcerpt: 'Old excerpt' }))));
});
test('workflow status is not evidence review and cannot affect review currency', () => {
  for (const status of ['draft', 'approved', 'rejected']) {
    const latest = { ...review(), status };
    assert.equal(deriveEvidenceState(1, sources(), latest).status, 'reviewed_for_version');
    assert.equal(deriveEvidenceState(1, sources(), null).status, 'not_reviewed');
  }
});
