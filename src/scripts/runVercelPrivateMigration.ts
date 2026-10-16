import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { productionTargetSummary } from "../privacy/productionTargetSummary";
import { loadStorageConfig } from "../config/storage";
import { assertPrivateDataKeysConfigured } from "../privacy/fieldEncryption";
import { assertVercelMigrationContext, migrationCommands, migrationPhase, migrationReport, migrationChildEnvironment } from "../privacy/vercelMigration";
import { assertDocumentEncryptionConfigured } from "../utils/documentEncryption";
import { loadDocumentEncryptionKeys, getActiveDocumentEncryptionKey } from "../services/documentEncryptionKeyring";

// Explicit one-off Vercel build command. Not a deployment hook or HTTP route.
// All secrets stay in Vercel's injected environment and child process memory.
let stage = "context";
async function run() {
  const phase = migrationPhase(process.argv.find(arg => arg.startsWith("--phase="))?.slice(8));
  assertVercelMigrationContext(phase, process.env);
  stage = "private-key-configuration";
  assertPrivateDataKeysConfigured();
  stage = "legacy-key-configuration";
  assertDocumentEncryptionConfigured();
  loadDocumentEncryptionKeys(); getActiveDocumentEncryptionKey();
  if (!process.env.GOOGLE_TOKEN_ENCRYPTION_KEY?.trim()) throw new Error("LEGACY_KEY_CONFIGURATION_REQUIRED");
  stage = "database-target-configuration";
  for (const key of ["DATABASE_URL", "DIRECT_URL"] as const) {
    const target = new URL(process.env[key] || "");
    if (!["postgres:", "postgresql:"].includes(target.protocol) || !/\.(?:supabase\.co|pooler\.supabase\.com)$/.test(target.hostname)) throw new Error("PRODUCTION_SUPABASE_TARGET_REQUIRED");
  }
  stage = "storage-configuration";
  const storage = loadStorageConfig();
  if (storage.driver !== "s3" || !storage.endpoint || new URL(storage.endpoint).protocol !== "https:") throw new Error("PRODUCTION_STORAGE_REQUIRED");
  if (phase === "preflight") {
    console.log(JSON.stringify({ phase, configurationValid: true, existingCiphertextVerified: false, backupVerified: false, maintenanceVerified: false, target: productionTargetSummary(process.env) }));
    return;
  }
  for (const command of migrationCommands(phase)) {
    stage = command.kind;
    const child = spawnSync(process.execPath, command.args, {
      cwd: path.resolve(__dirname, "../.."),
      // Existing scripts use dotenv; never load a local env file as a fallback.
      env: migrationChildEnvironment(process.env),
      stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", maxBuffer: 4 * 1024 * 1024, timeout: 20 * 60 * 1000,
    });
    if (child.error || child.status !== 0 || child.signal) throw new Error("MIGRATION_PHASE_FAILED");
    if (command.kind !== "schema") console.log(JSON.stringify({ phase, stage: command.kind, ...migrationReport(command.kind, child.stdout) }));
  }
  if (phase === "constraints") {
    // Both verification processes must finish successfully in THIS invocation.
    // Never trust a prior build's success or an externally supplied count.
    stage = "constraints";
    const sql = readFileSync(path.resolve(__dirname, "../../docs/privacy/validate-constraints.sql"), "utf8");
    const statements = sql.replace(/^\s*--.*$/gm, "").split(";").filter(value => value.trim());
    if (statements.length !== 30 || statements.some(value => !/^\s*ALTER TABLE "[A-Za-z_]+" VALIDATE CONSTRAINT "[A-Za-z_0-9]+"\s*$/.test(value))) throw new Error("INVALID_CONSTRAINT_MANIFEST");
    const db = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } }, log: [] });
    try { for (const statement of statements) await db.$executeRawUnsafe(statement); }
    finally { await db.$disconnect(); }
    console.log(JSON.stringify({ phase, constraintsValidated: statements.length }));
  }
  console.log(JSON.stringify({ phase, completed: true }));
}
run().catch(() => {
  // Never output exceptions, stacks, provider responses, database errors,
  // environment values, target locators, key IDs, or captured subprocess output.
  console.error(JSON.stringify({ completed: false, stage, code: "VERCEL_PRIVATE_MIGRATION_FAILED", action: "Keep maintenance active. Investigate the failed stage; backfill phases preserve completed records and can resume." }));
  process.exitCode = 1;
});
