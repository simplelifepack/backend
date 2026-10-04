import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

const defaultDataset = new URL('./data/reviewed-package-sources.json', import.meta.url);
const systemOwners = new Set(['seed', 'ai']);
const validatedStatuses = new Set(['content_validated', 'content_validated_in_original_review']);
const excludedCurrentness = new Set([
  'legacy_legal_references_do_not_import_as_current',
  'policy_confirmation_required_old_examples',
]);
const scopes = new Set(['national', 'state', 'provider_specific', 'institution_specific', 'destination_specific']);

export function canonical(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

export function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export function acceptedSources(row) {
  return row.sources.filter(source => validatedStatuses.has(source.validationStatus) && !excludedCurrentness.has(source.currentnessStatus));
}

function date(value) {
  assert(/^\d{4}-\d{2}-\d{2}$/.test(value), 'Expected ISO checked date');
  const result = new Date(`${value}T00:00:00.000Z`);
  assert.equal(result.toISOString().slice(0, 10), value, 'Invalid checked date');
  return result;
}

export function sourceUpdate(pack, row, dataset) {
  assert(systemOwners.has(pack.createdBy), 'Cannot update user-owned packages');
  assert.equal(pack.slug, row.slug, 'Package slug mismatch');
  assert.equal(pack.id, row.id, 'Package reference ID mismatch');
  const seen = new Set();
  const sources = acceptedSources(row).map(source => {
    assert(source.title && source.organization && source.relevance, 'Incomplete reviewed source');
    const url = new URL(source.url);
    assert.equal(url.protocol, 'https:');
    assert(!seen.has(url.href), 'Duplicate source URL');
    seen.add(url.href);
    assert(scopes.has(source.sourceScope), 'Unsupported source scope');
    assert(source.applicability && Object.keys(source.applicability).length, 'Source applicability missing');
    date(source.checkedAt);
    return {
      ...source,
      type: source.sourceType.startsWith('government_') ? 'government' : 'official',
      retrievedAt: source.checkedAt,
    };
  });
  const metadata = pack.searchMetadata;
  assert(metadata === null || (typeof metadata === 'object' && !Array.isArray(metadata)), 'Unsupported package metadata');
  // The existing search parser ignores this audit namespace; searchable/applicability keys stay unchanged.
  const sourceReview = {
    revision: dataset.revision, checkedAt: dataset.checkedAt,
    status: row.status, gap: row.gap ?? null, notes: row.reviewNotes ?? [],
    samePublisherPair: row.samePublisherPair ?? false,
    acceptedSourceCount: sources.length,
    excludedSources: row.sources.filter(source => !acceptedSources(row).includes(source)),
    pendingCandidates: row.pendingCandidates ?? [],
    contextReferences: row.contextReferences ?? [],
    checklistCertification: 'Source review only; does not certify all package requirements.',
  };
  const primary = sources[0];
  return {
    verificationSources: sources,
    sourceName: primary?.organization ?? null,
    sourceTitle: primary?.title ?? null,
    sourceUrl: primary?.url ?? null,
    lastCheckedAt: primary ? date(primary.checkedAt) : null,
    lastVerifiedAt: null,
    verificationStatus: 'needs_review',
    searchMetadata: { ...(metadata ?? {}), sourceReview },
  };
}

export function packageContent(pack) {
  if (!systemOwners.has(pack.createdBy)) return pack;
  const { verificationSources, sourceName, sourceTitle, sourceUrl, lastCheckedAt, lastVerifiedAt, verificationStatus, updatedAt, ...content } = pack;
  if (content.searchMetadata && typeof content.searchMetadata === 'object') {
    const { sourceReview, ...metadata } = content.searchMetadata;
    content.searchMetadata = metadata;
  }
  return content;
}

async function inventory(tx) {
  return {
    packs: await tx.readinessPack.findMany({ include: { requirements: { orderBy: { id: 'asc' } } }, orderBy: { id: 'asc' } }),
    documents: await tx.document.findMany({ select: { id: true, updatedAt: true, ownerProfileId: true, deletedAt: true }, orderBy: { id: 'asc' } }),
    assignments: await tx.requirementAssignment.findMany({ orderBy: { id: 'asc' } }),
    documentFiles: await tx.documentFile.findMany({ select: { id: true, updatedAt: true, documentId: true }, orderBy: { id: 'asc' } }),
  };
}

function preserved(data) {
  return { ...data, packs: data.packs.map(packageContent) };
}

export async function seedReviewedSources(prisma, dataset, apply = false) {
  assert(Array.isArray(dataset.rows) && dataset.rows.length, 'Review dataset has no rows');
  const slugs = new Set(dataset.rows.map(row => row.slug));
  assert.equal(slugs.size, dataset.rows.length, 'Duplicate reviewed slug');
  return prisma.$transaction(async tx => {
    const before = await inventory(tx);
    const bySlug = new Map(before.packs.map(pack => [pack.slug, pack]));
    const plan = dataset.rows.map(row => {
      const pack = bySlug.get(row.slug);
      assert(pack, `Reviewed package missing: ${row.slug}`);
      const update = sourceUpdate(pack, row, dataset);
      const current = Object.fromEntries(Object.keys(update).map(key => [key, pack[key]]));
      return { pack, update, changed: fingerprint(current) !== fingerprint(update) };
    });
    let updated = 0;
    for (const item of plan) {
      if (!item.changed || !apply) continue;
      const result = await tx.readinessPack.updateMany({
        where: { id: item.pack.id, slug: item.pack.slug, createdBy: item.pack.createdBy, updatedAt: item.pack.updatedAt },
        data: item.update,
      });
      assert.equal(result.count, 1, 'Package changed concurrently; aborting source seed');
      updated++;
    }
    const after = apply ? await inventory(tx) : before;
    assert.equal(fingerprint(preserved(before)), fingerprint(preserved(after)), 'Non-source data changed; rolling back');
    if (apply) for (const item of plan) {
      const saved = after.packs.find(pack => pack.id === item.pack.id);
      assert.equal(fingerprint(Object.fromEntries(Object.keys(item.update).map(key => [key, saved[key]]))), fingerprint(item.update));
    }
    return {
      mode: apply ? 'applied' : 'dry_run', updated, wouldUpdate: plan.filter(item => item.changed).length,
      reviewedPackages: plan.length, packageCount: after.packs.length,
      customPackCount: after.packs.filter(pack => !systemOwners.has(pack.createdBy)).length,
      requirementCount: after.packs.reduce((n, pack) => n + pack.requirements.length, 0),
      documentCount: after.documents.length, assignmentCount: after.assignments.length,
      preservedDataFingerprint: fingerprint(preserved(after)),
      sourceCount: plan.reduce((n, item) => n + item.update.verificationSources.length, 0),
      packages: plan.map(item => ({ slug: item.pack.slug, package: item.pack.title, sources: item.update.verificationSources, review: item.update.searchMetadata.sourceReview })),
    };
  }, { isolationLevel: 'Serializable', maxWait: 10000, timeout: 120000 });
}

async function main() {
  const args = process.argv.slice(2);
  assert(args.every((arg, index) => ['--apply', '--report', '--dataset'].includes(arg) || ['--report', '--dataset'].includes(args[index - 1])), 'Unknown argument');
  const option = flag => { const index = args.indexOf(flag); if (index < 0) return undefined; assert(args[index + 1] && !args[index + 1].startsWith('--'), `Missing ${flag} value`); return args[index + 1]; };
  const dataset = JSON.parse(await fs.readFile(option('--dataset') ?? defaultDataset, 'utf8'));
  const prisma = new PrismaClient();
  try {
    const result = await seedReviewedSources(prisma, dataset, args.includes('--apply'));
    const report = option('--report');
    if (report) await fs.writeFile(report, JSON.stringify(result, null, 2));
    const { packages, ...summary } = result;
    console.log(JSON.stringify(summary, null, 2));
  } finally { await prisma.$disconnect(); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
