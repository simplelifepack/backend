import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import 'dotenv/config';
import { signAccessToken } from '../src/utils/jwt.ts';
import { calculatePackReadiness } from '../../frontend-web/src/readiness/calculatePackageReadiness.ts';
import { fingerprint } from './seed-reviewed-package-sources.mjs';

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
try {
  const dbPacks = await prisma.readinessPack.findMany({ where: { createdBy: { in: ['seed', 'ai'] } }, orderBy: { slug: 'asc' } });
  const documentOwner = await prisma.document.findFirst({ where: { deletedAt: null }, select: { ownerProfileId: true } });
  const ownerUser = documentOwner ? await prisma.user.findUnique({ where: { id: documentOwner.ownerProfileId } }) : null;
  const user = ownerUser ?? await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  assert(user, 'Need an existing user for authenticated read-only API verification');
  const token = signAccessToken({ sub: user.id, email: user.email, authVersion: user.authVersion });
  let requests = 0;
  const get = async route => {
    const response = await fetch(new URL(route, option('--api') ?? 'http://localhost:4000'), { headers: { Authorization: `Bearer ${token}` } });
    requests++;
    assert.equal(response.status, 200, `GET ${route} failed (${response.status})`);
    if (route.startsWith('/api/packages')) assert.equal(response.headers.get('cache-control'), 'no-store');
    return response.json();
  };
  const catalogue = await get('/api/packages?limit=200&page=1&sort=category');
  assert.equal(catalogue.items.length, dbPacks.length);
  const documents = await get('/documents');
  const content = pack => ({
    id: pack.id, slug: pack.slug, title: pack.title, subtitle: pack.subtitle, category: pack.category,
    aliases: pack.aliases, description: pack.description, keywords: pack.keywords,
    searchMetadata: pack.searchMetadata ? Object.fromEntries(Object.entries(pack.searchMetadata).filter(([key]) => key !== 'sourceReview')) : pack.searchMetadata,
    requirements: pack.requirements, createdBy: pack.createdBy, version: pack.version,
  });
  const baselineContent = [];
  const readiness = [];
  const sourceRows = [];
  const searches = [];
  for (const pack of dbPacks) {
    const detail = await get(`/api/packages/${encodeURIComponent(pack.slug)}`);
    baselineContent.push(content(detail));
    const ready = calculatePackReadiness(detail.requirements, documents);
    readiness.push({ slug: pack.slug, percentage: ready.percentage, required: ready.totalRequired, ready: ready.satisfiedRequired, matchingFingerprint: fingerprint(ready) });
    const search = await get(`/api/packages?limit=200&sort=relevance&search=${encodeURIComponent(pack.title)}`);
    searches.push({ query: pack.title, slugs: search.items.map(item => item.slug), total: search.pagination.total });
    assert(search.items.some(item => item.slug === pack.slug), `Exact-title search lost ${pack.slug}`);
    assert.equal(fingerprint(detail.verificationSources), fingerprint(pack.verificationSources), 'Detail API sources differ from database');
    const summary = catalogue.items.find(item => item.slug === pack.slug);
    assert.equal(fingerprint(summary.verificationSources), fingerprint(pack.verificationSources), 'List API sources differ from database');
    const urls = detail.verificationSources.map(source => source.url).filter(Boolean);
    assert.equal(new Set(urls).size, urls.length, 'Duplicate source URL in package');
    sourceRows.push({ package: pack.title, slug: pack.slug, count: urls.length, sources: detail.verificationSources, verificationStatus: pack.verificationStatus, gap: pack.searchMetadata?.sourceReview?.gap ?? null });
  }
  const categories = [];
  for (const category of new Set(dbPacks.map(pack => pack.category))) {
    const response = await get(`/api/packages?limit=200&category=${encodeURIComponent(category)}`);
    assert(response.items.every(pack => pack.category === category));
    categories.push({ category, slugs: response.items.map(pack => pack.slug) });
  }
  const myPacks = await get('/api/packages?limit=200&category=My%20packs');
  assert(myPacks.items.every(pack => pack.createdBy === user.id));
  const applicable = dbPacks.filter(pack => pack.searchMetadata?.destination || pack.searchMetadata?.jurisdiction);
  const applicability = [];
  for (const pack of applicable) {
    const location = pack.searchMetadata.destination || pack.searchMetadata.jurisdiction;
    const response = await get(`/api/packages?limit=200&location=${encodeURIComponent(location)}`);
    applicability.push({ location, slugs: response.items.map(pack => pack.slug) });
  }
  const result = {
    packageCount: dbPacks.length, authenticatedDocumentCount: documents.length, requests,
    contentFingerprint: fingerprint(baselineContent), searchFingerprint: fingerprint(searches),
    categoryFingerprint: fingerprint(categories), readinessFingerprint: fingerprint(readiness),
    myPacksFingerprint: fingerprint(myPacks), applicabilityFingerprint: fingerprint(applicability),
    categories, readiness, sourceRows,
  };
  const compare = option('--compare');
  if (compare) {
    const before = JSON.parse(await fs.readFile(compare, 'utf8'));
    for (const key of ['packageCount', 'authenticatedDocumentCount', 'contentFingerprint', 'searchFingerprint', 'categoryFingerprint', 'readinessFingerprint', 'myPacksFingerprint', 'applicabilityFingerprint']) assert.equal(result[key], before[key], `${key} changed after source seed`);
    result.beforeAfterChecks = 'unchanged catalogue content, searches, categories, readiness/matches, My packs and applicability';
  }
  const report = option('--report');
  if (report) await fs.writeFile(report, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ packageCount: result.packageCount, requests, categories: categories.length, authenticatedDocumentCount: documents.length, apiSourcesMatchDatabase: true, beforeAfterChecks: result.beforeAfterChecks ?? 'baseline captured' }, null, 2));
} catch (error) {
  console.error(error.message); process.exitCode = 1;
} finally { await prisma.$disconnect(); }
