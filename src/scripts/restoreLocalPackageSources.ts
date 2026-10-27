import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Prisma } from "@prisma/client";
import { configureNormalLocalBackend } from "./localBackendEnvironment";
import { withPrivateMigration } from "../privacy/access";

const position = process.argv.indexOf("--env-file");
configureNormalLocalBackend(position >= 0 ? process.argv[position + 1] : undefined);
const accepted = new Set(["content_validated", "content_validated_in_original_review"]);
const excluded = new Set(["legacy_legal_references_do_not_import_as_current", "policy_confirmation_required_old_examples"]);
async function run() {
  const { prisma } = await import("../lib/prisma");
  try {
    const data = JSON.parse(await fs.readFile(path.resolve(__dirname, "../../scripts/data/reviewed-package-sources.json"), "utf8")) as { rows: Array<{ id: string; slug: string; sources: Array<Record<string, unknown>> }> };
    const packs = await prisma.readinessPack.findMany({ where: { createdBy: "seed", deletedAt: null }, select: { id: true, slug: true, updatedAt: true, sourceUrl: true, sourceName: true, sourceTitle: true, lastCheckedAt: true, lastVerifiedAt: true, verificationStatus: true, verificationSources: true } });
    const plan = data.rows.flatMap(row => {
      const pack = packs.find(item => item.id === row.id && item.slug === row.slug);
      if (!pack || pack.sourceUrl || (Array.isArray(pack.verificationSources) && pack.verificationSources.length)) return [];
      const sources = row.sources.filter(source => accepted.has(String(source.validationStatus)) && !excluded.has(String(source.currentnessStatus))).map(source => {
        assert.equal(new URL(String(source.url)).protocol, "https:");
        assert(source.title && source.organization && source.checkedAt);
        return { ...source, organization: String(source.organization), title: String(source.title), url: String(source.url), checkedAt: String(source.checkedAt), type: String(source.sourceType).startsWith("government_") ? "government" : "official", retrievedAt: String(source.checkedAt) };
      });
      return sources.length ? [{ pack, sources }] : [];
    });
    let updated = 0;
    if (process.argv.includes("--apply")) {
      const folder = await fs.mkdtemp(path.join(os.tmpdir(), "readiness-source-restore-"));
      await fs.writeFile(path.join(folder, "before.json"), JSON.stringify(plan.map(item => item.pack)), { mode: 0o600 });
      console.log(JSON.stringify({ backup: path.join(folder, "before.json") }));
    }
    if (process.argv.includes("--apply")) await withPrivateMigration("restore reviewed public seed sources on the guarded local database", () => prisma.$transaction(async tx => {
      for (const { pack, sources } of plan) {
        const primary = sources[0];
        const saved = await tx.readinessPack.updateMany({ where: { id: pack.id, createdBy: "seed", updatedAt: pack.updatedAt }, data: {
          sourceName: String(primary.organization), sourceTitle: String(primary.title), sourceUrl: String(primary.url),
          verificationSources: sources as Prisma.InputJsonValue, lastCheckedAt: new Date(String(primary.checkedAt)),
          verificationStatus: "needs_review", lastVerifiedAt: null,
        } });
        assert.equal(saved.count, 1, "Package changed during source restoration."); updated++;
      }
    }, { timeout: 30_000 }));
    console.log(JSON.stringify({ seedPackages: packs.length, packagesToRestore: plan.length, reviewedSources: plan.reduce((sum, item) => sum + item.sources.length, 0), updated, apply: process.argv.includes("--apply") }));
  } finally { await prisma.$disconnect(); }
}
run().catch(() => { console.error("Local source restoration failed; no unreviewed metadata was restored."); process.exitCode = 1; });
