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
    const response = await fetch(`http://localhost:4000/api/packages/${slug}/refresh`, { method: "POST", headers: { Authorization: `Bearer ${signAccessToken({ sub: id })}` }, signal: AbortSignal.timeout(210_000) });
    const result = await response.json();
    assert.equal(response.status, 200, result.message);
    assert.equal(typeof result.verified, "boolean");
    assert(result.package.verificationSources.length);
    if (!result.verified) {
      assert.equal(result.changed, false);
      assert.equal(result.package.requirements.length, source.requirements.length);
      assert.equal(result.package.lastCheckedAt, source.lastCheckedAt?.toISOString());
    }
    console.log(JSON.stringify({ status: response.status, verified: result.verified, changed: result.changed, message: result.message, sources: result.package.verificationSources.length }));
  } finally {
    await withPrivateUser(id, () => prisma.readinessPack.deleteMany({ where: { id: packId, createdBy: id } }));
    await withPrivateMigration("remove synthetic refresh check", () => prisma.user.deleteMany({ where: { id } }));
    await prisma.$disconnect();
  }
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
