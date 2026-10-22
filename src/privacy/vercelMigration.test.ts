import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { encryptedModels } from "./modelCodec";
import { assertVercelMigrationContext, migrationCommands, migrationPhase, migrationProjectId, migrationReport, vercelBuildCommands, migrationChildEnvironment } from "./vercelMigration";

const environment = { VERCEL: "1", VERCEL_ENV: "production", VERCEL_PROJECT_ID: migrationProjectId, APP_ENV: "production", PRIVACY_MIGRATION_ENABLED: "1" };
test("only explicit phases and the existing Vercel production project are accepted", () => {
  for (const value of [undefined, "", "all", "reset", "db-push", "--apply; printenv"]) assert.throws(() => migrationPhase(value));
  for (const phase of ["preflight", "dry-run", "verify"] as const) {
    assert.doesNotThrow(() => assertVercelMigrationContext(phase, environment));
    for (const key of Object.keys(environment)) {
      assert.throws(() => assertVercelMigrationContext(phase, { ...environment, [key]: "wrong" }));
    }
  }
});
test("mutations require backup and maintenance references independently", () => {
  for (const phase of ["schema", "apply", "constraints"] as const) {
    assert.throws(() => assertVercelMigrationContext(phase, environment));
    assert.throws(() => assertVercelMigrationContext(phase, { ...environment, PRIVACY_MIGRATION_BACKUP_REFERENCE: "restore-point-reference" }));
    assert.throws(() => assertVercelMigrationContext(phase, { ...environment, PRIVACY_MIGRATION_MAINTENANCE_REFERENCE: "maintenance-reference" }));
    assert.doesNotThrow(() => assertVercelMigrationContext(phase, { ...environment, PRIVACY_MIGRATION_BACKUP_REFERENCE: "restore-point-reference", PRIVACY_MIGRATION_MAINTENANCE_REFERENCE: "maintenance-reference" }));
  }
});
test("phase planning preserves schema/record/archive ordering and verifies again before constraints", () => {
  assert.deepEqual(migrationCommands("preflight"), []);
  assert.deepEqual(migrationCommands("schema")[0].args, ["node_modules/prisma/build/index.js", "migrate", "deploy"]);
  for (const phase of ["dry-run", "apply", "verify", "constraints"] as const) {
    const commands = migrationCommands(phase); assert.deepEqual(commands.map(command => command.kind), ["records", "archives"]);
    for (const command of commands) {
      assert.equal(command.args.includes("--apply"), phase === "apply");
      assert.equal(command.args.includes("--verify"), phase === "verify" || phase === "constraints");
      assert(!command.args.some(arg => /reset|db.?push|printenv/.test(arg)));
    }
  }
});
test("reports emit only fixed model names and counts; unexpected content never gets echoed", () => {
  const secret = "SYNTHETIC-PRIVATE-KEY-OR-CONTENT";
  const models = Object.fromEntries([...encryptedModels, "StorageCleanup"].map(name => [name, { scanned: 2, pending: 1, updated: 0, leakedValue: secret }]));
  const report = migrationReport("records", JSON.stringify({ mode: secret, models, credentials: secret }));
  assert(!JSON.stringify(report).includes(secret));
  assert.throws(() => migrationReport("records", JSON.stringify({ models: { User: { scanned: 2, pending: 1, updated: 0 } } })));
  assert.throws(() => migrationReport("records", JSON.stringify({ models: { ...models, [secret]: {} } })));
  models.User.scanned = Number.NaN; assert.throws(() => migrationReport("records", JSON.stringify({ models })));
  const counts = { jobsScanned: 1, jobsPending: 0, jobsUpdated: 0, exportsScanned: 1, exportsPending: 0, exportsUpdated: 0, cleanupPending: 0 };
  assert.deepEqual(migrationReport("archives", JSON.stringify({ ...counts, credentials: secret })), counts);
  for (const bad of [-1, 0.5, secret, null]) assert.throws(() => migrationReport("archives", JSON.stringify({ ...counts, cleanupPending: bad })));
});
test("runner fails outside Vercel before touching any credentials or database", () => {
  const secret = "SYNTHETIC-PRIVATE-CONNECTION-CONTENT";
  const child = spawnSync(process.execPath, ["--import", "tsx", "src/scripts/runVercelPrivateMigration.ts", "--phase=apply"], { env: { ...process.env, VERCEL: "0", DATABASE_URL: secret, PRIVATE_DATA_KEYRING_JSON: secret }, encoding: "utf8" });
  assert.equal(child.status, 1); assert.equal(child.stdout, ""); assert(!child.stderr.includes(secret));
  const error = JSON.parse(child.stderr); assert.equal(error.stage, "context"); assert.equal(error.code, "VERCEL_PRIVATE_MIGRATION_FAILED");
});

test("ordinary builds retain their old plan; migration builds never run implicit schema migration", () => {
  assert.deepEqual(vercelBuildCommands({}), [["scripts/prisma-command.mjs", "migrate-deploy"], ["scripts/prisma-command.mjs", "generate"]]);
  assert.throws(() => vercelBuildCommands({ PRIVACY_MIGRATION_ENABLED: "1" }));
  assert.throws(() => vercelBuildCommands({ PRIVACY_MIGRATION_PHASE: "reset" }));
  assert.deepEqual(vercelBuildCommands({ PRIVACY_MIGRATION_ENABLED: "1", PRIVACY_MIGRATION_PHASE: "preflight" }), [["--import", "tsx", "src/scripts/runVercelPrivateMigration.ts", "--phase=preflight"]]);
});

test("offline backfills use the direct connection without mutating runtime configuration", () => {
  const env = { DATABASE_URL: "synthetic-runtime-pool", DIRECT_URL: "synthetic-maintenance-session", DOCUMENT_ENCRYPTION_KEY: "synthetic-retained-key" };
  const child = migrationChildEnvironment(env);
  assert.equal(child.DATABASE_URL, env.DIRECT_URL);
  assert.equal(env.DATABASE_URL, "synthetic-runtime-pool");
  assert.equal(child.DOCUMENT_ENCRYPTION_KEY, env.DOCUMENT_ENCRYPTION_KEY);
  assert.equal(child.DOTENV_CONFIG_PATH, "/dev/null");
  assert.throws(() => migrationChildEnvironment({ DATABASE_URL: "synthetic-runtime-pool" }));
});
