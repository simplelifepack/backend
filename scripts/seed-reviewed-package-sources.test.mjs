import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptedSources, fingerprint, packageContent, sourceUpdate } from './seed-reviewed-package-sources.mjs';

const source = {
  title: 'Test checklist', organization: 'Test authority', url: 'https://example.org/checklist',
  sourceType: 'government_checklist', relevance: 'Exact process guidance', checkedAt: '2026-10-04',
  validationStatus: 'content_validated', currentnessStatus: 'undated_live', verificationMethod: 'web_text',
  sourceScope: 'state', applicability: { country: 'IN', state: 'Test jurisdiction' },
};
const pack = { id: 'test-package', slug: 'test-package', createdBy: 'seed', searchMetadata: { searchPhrases: ['test phrase'], destination: 'test destination' } };
const row = { id: pack.id, slug: pack.slug, sources: [source], status: 'review', gap: 'Second source missing' };
const dataset = { revision: 2, checkedAt: '2026-10-04' };

test('only content-validated, non-rejected sources are imported', () => {
  assert.equal(acceptedSources({ sources: [source, { ...source, validationStatus: 'pending_http_503' }, { ...source, currentnessStatus: 'legacy_legal_references_do_not_import_as_current' }, { ...source, validationStatus: 'process_validated_checklist_not_completed' }] }).length, 1);
});
test('preserves review metadata and existing API source aliases without changing search keys', () => {
  const update = sourceUpdate(pack, row, dataset);
  assert.equal(update.verificationSources[0].retrievedAt, source.checkedAt);
  assert.equal(update.verificationSources[0].type, 'government');
  assert.equal(update.searchMetadata.sourceReview.gap, row.gap);
  assert.equal(update.verificationStatus, 'needs_review');
  assert.equal(update.lastVerifiedAt, null);
  assert.deepEqual(packageContent({ ...pack, ...update }), packageContent(pack));
});
test('zero-source gaps are retained without invented source placeholders', () => {
  const update = sourceUpdate(pack, { ...row, sources: [], pendingCandidates: [source] }, dataset);
  assert.deepEqual(update.verificationSources, []);
  assert.equal(update.sourceUrl, null);
  assert.equal(update.searchMetadata.sourceReview.pendingCandidates.length, 1);
});
test('rejects custom ownership, mismatched identity and duplicate source URLs', () => {
  assert.throws(() => sourceUpdate({ ...pack, createdBy: 'user-id' }, row, dataset));
  assert.throws(() => sourceUpdate(pack, { ...row, id: 'another-id' }, dataset));
  assert.throws(() => sourceUpdate(pack, { ...row, sources: [source, source] }, dataset));
});
test('source update is deterministic and package-content fingerprint excludes only source review', () => {
  assert.equal(fingerprint(sourceUpdate(pack, row, dataset)), fingerprint(sourceUpdate(pack, row, dataset)));
  assert.notEqual(fingerprint(packageContent(pack)), fingerprint(packageContent({ ...pack, searchMetadata: { destination: 'changed' } })));
});
