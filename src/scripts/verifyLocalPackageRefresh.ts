import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { configureNormalLocalBackend } from "./localBackendEnvironment";
import { withPrivateMigration, withPrivateUser } from "../privacy/access";
configureNormalLocalBackend("/Users/ranjith/code/backend/.env");
async function run() {
  const { prisma } = await import("../lib/prisma");
  const { signAccessToken } = await import("../utils/jwt");
  const id = randomUUID(), packId = randomUUID(), slug = `comp-exam-check-${id}`;
  try {
    const source = await prisma.readinessPack.findFirstOrThrow({ where: { slug: "comp-exam", createdBy: "seed" }, include: { requirements: true } });
    await withPrivateMigration("synthetic local refresh HTTP verification", () => prisma.user.create({ data: { id, name: "Synthetic refresh check", email: `${id}@example.test`, aiProcessingEnabled: true } }));
    await withPrivateUser(id, () => prisma.readinessPack.create({ data: { id: packId, slug, title: source.title, subtitle: source.subtitle, category: source.category, description: source.description, createdBy: id, sourceName: source.sourceName, sourceTitle: source.sourceTitle, sourceUrl: source.sourceUrl, lastCheckedAt: source.lastCheckedAt, verificationSources: source.verificationSources ?? [], requirements: { create: source.requirements.map(({ id: _id, packId: _packId, ...requirement }) => ({ ...requirement, metadata: requirement.metadata ?? {} })) } } }));
    console.log("Researching a synthetic copy through the running local refresh endpoint.");
    if (process.argv.includes("--diagnose-service")) {
      const { refreshPackageForUser } = await import("../services/readiness/packageRefresh.service");
      try { const result = await withPrivateUser(id, () => refreshPackageForUser(id, slug)); console.log(JSON.stringify({ serviceStatus: "ok", changed: result.changed, message: result.message })); }
      catch (error) { console.error(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown", frames: error instanceof Error ? error.stack?.split("\n").slice(1, 5) : [] })); throw error; }
      return;
    }
    for (let attempt = 1; attempt <= 2; attempt++) {
      const response = await fetch(`http://localhost:4000/api/packages/${slug}/refresh`, { method: "POST", headers: { Authorization: `Bearer ${signAccessToken({ sub: id })}` }, signal: AbortSignal.timeout(210_000) });
      const result = await response.json();
      assert.equal(response.status, 200, result.message);
      assert.equal(result.refreshed, true);
      assert(result.package.verificationSources.length);
      assert.equal(result.package.lastVerifiedAt, null);
      assert(result.package.verificationSources.every((item: { validationStatus: string }) => item.validationStatus === "needs_review"));
      if (!result.changed) assert.equal(result.message, "Refreshed — no changes in this package.");
      console.log(JSON.stringify({ attempt, status: response.status, refreshed: result.refreshed, changed: result.changed, message: result.message, sources: result.package.verificationSources.length, requirements: result.package.requirements.filter((item: { metadata?: { refreshRetired?: boolean } }) => !item.metadata?.refreshRetired).length, adminVerified: false }));
    }
  } finally {
    await withPrivateUser(id, () => prisma.readinessPack.deleteMany({ where: { id: packId, createdBy: id } }));
    await withPrivateMigration("remove synthetic refresh check", () => prisma.user.deleteMany({ where: { id } }));
    await prisma.$disconnect();
  }
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
