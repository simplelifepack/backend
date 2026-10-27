import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { configureNormalLocalBackend } from "./localBackendEnvironment";
import { withPrivateMigration } from "../privacy/access";
configureNormalLocalBackend("/Users/ranjith/code/backend/.env");
async function run() {
  const { prisma } = await import("../lib/prisma");
  const { signAccessToken } = await import("../utils/jwt");
  const id = randomUUID();
  try {
    await withPrivateMigration("synthetic local source HTTP verification", () => prisma.user.create({ data: { id, name: "Synthetic source check", email: `${id}@example.test`, aiProcessingEnabled: false } }));
    const token = signAccessToken({ sub: id });
    for (const slug of ["comp-exam", "schengen-visa"]) {
      const response = await fetch(`http://localhost:4000/api/packages/${slug}`, { headers: { Authorization: `Bearer ${token}` } });
      assert.equal(response.status, 200);
      const pack = await response.json();
      assert(pack.sourceUrl); assert(pack.verificationSources?.length);
      console.log(JSON.stringify({ slug, status: response.status, sources: pack.verificationSources.length, sourceRestored: true }));
    }
  } finally {
    await withPrivateMigration("remove synthetic source check", () => prisma.user.deleteMany({ where: { id } }));
    await prisma.$disconnect();
  }
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
