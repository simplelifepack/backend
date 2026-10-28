// This is build-time tooling, never imported by the API or an HTTP handler.
export const migrationPhases = ["preflight", "schema", "dry-run", "apply", "verify", "constraints"] as const;
export type MigrationPhase = typeof migrationPhases[number];
export const migrationProjectId = "prj_8AdWu5G9SWVFbBwv4hGxzSUo9r82";

export function migrationPhase(value: string | undefined): MigrationPhase {
  if (!migrationPhases.includes(value as MigrationPhase)) throw new Error("INVALID_MIGRATION_PHASE");
  return value as MigrationPhase;
}

export function assertVercelMigrationContext(phase: MigrationPhase, env: NodeJS.ProcessEnv) {
  if (env.VERCEL !== "1" || env.VERCEL_ENV !== "production" || env.VERCEL_PROJECT_ID !== migrationProjectId || env.APP_ENV !== "production" || env.PRIVACY_MIGRATION_ENABLED !== "1") throw new Error("VERCEL_MIGRATION_CONTEXT_REQUIRED");
  if (["schema", "apply", "constraints"].includes(phase)) {
    if (!env.PRIVACY_MIGRATION_BACKUP_REFERENCE?.trim() || !env.PRIVACY_MIGRATION_MAINTENANCE_REFERENCE?.trim()) throw new Error("BACKUP_AND_MAINTENANCE_ATTESTATIONS_REQUIRED");
  }
}

export function migrationCommands(phase: MigrationPhase) {
  if (phase === "schema") return [{ kind: "schema" as const, args: ["node_modules/prisma/build/index.js", "migrate", "deploy"] }];
  if (phase === "preflight") return [];
  const mode = phase === "constraints" ? "verify" : phase;
  const args = mode === "dry-run" ? [] : [mode === "apply" ? "--apply" : "--verify"];
  return [
    { kind: "records" as const, args: ["--import", "tsx", "src/scripts/migratePrivateRecords.ts", ...args] },
    { kind: "archives" as const, args: ["--import", "tsx", "src/scripts/migratePrivateJobsAndExports.ts", ...args] },
  ];
}

// Preview builds must never inherit a production database migration target.
export function vercelBuildCommands(env: NodeJS.ProcessEnv) {
  if (env.VERCEL_ENV === "preview" && env.PREVIEW_DATABASE_MIGRATIONS_APPROVED !== "1") {
    return [["scripts/prisma-command.mjs", "generate"]];
  }
  if (env.PRIVACY_MIGRATION_PHASE || env.PRIVACY_MIGRATION_ENABLED === "1") {
    const phase = migrationPhase(env.PRIVACY_MIGRATION_PHASE);
    return [["--import", "tsx", "src/scripts/runVercelPrivateMigration.ts", `--phase=${phase}`]];
  }
  return [["scripts/prisma-command.mjs", "migrate-deploy"], ["scripts/prisma-command.mjs", "generate"]];
}

const models = new Set(["HealthMember", "HealthDocument", "HealthMeasurement", "TrackedHealthMetric", "HealthMedication", "HealthFollowUp", "HealthReminder", "WealthRecord", "ExternalConnection", "ExternalDocumentCandidate", "UserIdentityProfile", "TemporaryUpload", "DigiLockerConsentSession", "PushSubscription", "AccountChangeOtp", "Document", "DocumentFile", "User", "SignupVerification", "ExternalIdentity", "TrustMember", "ReadinessPack", "Requirement", "AccountExportJob", "StorageCleanup"]);
const archiveCounts = ["jobsScanned", "jobsPending", "jobsUpdated", "exportsScanned", "exportsPending", "exportsUpdated", "cleanupPending"] as const;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_MIGRATION_REPORT");
  return value as Record<string, unknown>;
}
function count(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("INVALID_MIGRATION_COUNT");
  return value;
}
// Never forward subprocess stdout/stderr. Reconstruct reports from fixed names
// and nonnegative counts, even when a failed tool includes data in its output.
export function migrationReport(kind: "records" | "archives", stdout: string) {
  const report = object(JSON.parse(stdout.trim()));
  if (kind === "archives") return Object.fromEntries(archiveCounts.map(key => [key, count(report[key])]));
  const rows = object(report.models);
  if (Object.keys(rows).length !== models.size || Object.keys(rows).some(key => !models.has(key))) throw new Error("INCOMPLETE_MIGRATION_REPORT");
  return { models: Object.fromEntries([...models].map(model => {
    const row = object(rows[model]);
    return [model, { scanned: count(row.scanned), pending: count(row.pending), updated: count(row.updated) }];
  })) };
}

// Offline maintenance requires session continuity. Leave the application's
// pooled DATABASE_URL unchanged in Vercel; override only child process memory.
export function migrationChildEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (!env.DIRECT_URL) throw new Error("DIRECT_MIGRATION_CONNECTION_REQUIRED");
  return { ...env, DATABASE_URL: env.DIRECT_URL, DOTENV_CONFIG_PATH: "/dev/null", DOTENV_CONFIG_QUIET: "true" };
}
