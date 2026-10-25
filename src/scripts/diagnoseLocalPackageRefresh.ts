import { randomUUID } from "node:crypto";
import { configureNormalLocalBackend } from "./localBackendEnvironment";
import { withPrivateMigration, withPrivateUser } from "../privacy/access";
const position = process.argv.indexOf("--env-file");
configureNormalLocalBackend(position >= 0 ? process.argv[position + 1] : undefined);
const userId = randomUUID();
async function run() {
  const { prisma } = await import("../lib/prisma");
  const { researchPackageRefresh, PackageRefreshError } = await import("../ai/researchPackageRefresh");
  try {
    const pack = await prisma.readinessPack.findFirstOrThrow({ where: { slug: "comp-exam", createdBy: "seed", deletedAt: null }, include: { requirements: true } });
    await withPrivateMigration("synthetic local refresh diagnosis", () => prisma.user.create({ data: { id: userId, name: "Synthetic refresh diagnostic", email: `${userId}@example.test`, aiProcessingEnabled: true } }));
    console.log(JSON.stringify({ event: "research_started", sources: Array.isArray(pack.verificationSources) ? pack.verificationSources.length : 0 }));
    try {
      const result = await withPrivateUser(userId, () => researchPackageRefresh(userId, pack, AbortSignal.timeout(180_000)));
      console.log(JSON.stringify({ event: "research_completed", requirements: result.checklist.requirements.length, sources: result.sources.length }));
    } catch (error) {
      console.log(JSON.stringify({ event: "research_failed", name: error instanceof Error ? error.name : "Error", ...(error instanceof PackageRefreshError ? { message: error.message, feedback: error.researchFeedback } : {}) }));
      process.exitCode = 1;
    }
  } finally {
    await withPrivateMigration("remove synthetic refresh diagnostic", () => prisma.user.deleteMany({ where: { id: userId } }));
    await prisma.$disconnect();
  }
}
run().catch(() => { console.error("Refresh diagnostic failed."); process.exitCode = 1; });
