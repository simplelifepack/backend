import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { configureNormalLocalBackend } from "./localBackendEnvironment";
import { withPrivateMigration } from "../privacy/access";
configureNormalLocalBackend("/Users/ranjith/code/backend/.env");

async function run() {
  const { prisma } = await import("../lib/prisma");
  const { signAccessToken } = await import("../utils/jwt");
  const id = randomUUID();
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "readines-five-refreshes-"));
  const packs = await prisma.readinessPack.findMany({ where: { createdBy: "seed", deletedAt: null, slug: { notIn: ["comp-exam", "dv-cof"] } }, include: { requirements: true } });
  const shuffle = <T>(values: T[]) => { for (let i = values.length - 1; i > 0; i--) { const j = randomInt(i + 1); [values[i], values[j]] = [values[j], values[i]]; } return values; };
  const position = process.argv.indexOf("--slugs");
  const requested = position >= 0 ? process.argv[position + 1]?.split(",").filter(Boolean) : undefined;
  const categories = shuffle([...new Set(packs.map(pack => pack.category))]).slice(0, 5);
  const selected = requested ? requested.map(slug => { const pack = packs.find(item => item.slug === slug); assert(pack, "Requested package is not in the local seed catalogue"); return pack; }) : categories.map(category => shuffle(packs.filter(pack => pack.category === category))[0]);
  assert.equal(selected.length, requested?.length ?? 5);
  await fs.writeFile(path.join(folder, "before.json"), JSON.stringify(selected, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ event: "selected", packages: selected.map(pack => ({ slug: pack.slug, title: pack.title, category: pack.category })), reportDirectory: folder }));
  const results: unknown[] = [];
  try {
    await withPrivateMigration("temporary local refresh checker", () => prisma.user.create({ data: { id, name: "Local package refresh checker", email: `${id}@example.test`, aiProcessingEnabled: true } }));
    const token = signAccessToken({ sub: id });
    for (const pack of selected) {
      const start = Date.now();
      try {
        const response = await fetch(`http://localhost:4000/api/packages/${pack.slug}/refresh`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(210000) });
        const result = await response.json();
        assert.equal(response.status, 200, result.message);
        assert.equal(result.refreshed, true);
        assert(result.package.verificationSources.length > 0);
        assert.equal(result.package.lastVerifiedAt, null);
        assert.equal(result.package.verificationStatus, "needs_review");
        assert(result.package.verificationSources.every((source: { validationStatus: string }) => source.validationStatus === "needs_review"));
        const saved = await prisma.readinessPack.findUniqueOrThrow({ where: { id: pack.id }, include: { requirements: true } });
        assert.equal(saved.updatedAt.toISOString(), result.package.updatedAt ?? saved.updatedAt.toISOString());
        assert(saved.lastCheckedAt && saved.lastCheckedAt.getTime() >= start);
        assert.equal(saved.requirements.filter(row => !(row.metadata as { refreshRetired?: boolean } | null)?.refreshRetired).length, result.package.requirements.filter((row: { metadata?: { refreshRetired?: boolean } }) => !row.metadata?.refreshRetired).length);
        if (!result.changed) assert.equal(result.message, "Refreshed — no changes in this package.");
        const summary = { title: pack.title, slug: pack.slug, category: pack.category, status: response.status, changed: result.changed, message: result.message, requirements: saved.requirements.filter(row => !(row.metadata as { refreshRetired?: boolean } | null)?.refreshRetired).length, sources: result.package.verificationSources.length, persisted: true, adminReview: true, seconds: Math.round((Date.now() - start) / 1000) };
        results.push(summary); console.log(JSON.stringify(summary));
      } catch (error) {
        const failure = { title: pack.title, slug: pack.slug, failed: true, message: error instanceof Error ? error.message : "Refresh failed", seconds: Math.round((Date.now() - start) / 1000) };
        results.push(failure); console.log(JSON.stringify(failure)); process.exitCode = 1;
      }
      await fs.writeFile(path.join(folder, "results.json"), JSON.stringify(results, null, 2), { mode: 0o600 });
    }
  } finally {
    await withPrivateMigration("remove temporary local refresh checker", () => prisma.user.deleteMany({ where: { id } }));
    await prisma.$disconnect();
  }
  console.log(JSON.stringify({ event: "complete", report: path.join(folder, "results.json") }));
}
run().catch(error => { console.error(error instanceof Error ? error.message : "Local checks failed"); process.exitCode = 1; });
