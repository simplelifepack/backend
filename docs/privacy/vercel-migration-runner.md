# Run privacy migrations inside Vercel without retrieving secrets

The new private-data settings have been added by the operator. Their contents have not been retrieved or validated from this workstation. Existing database/storage/document/metadata/OAuth/RSA/lookup secrets remain in Vercel. This adapter reads them only from the production build process environment. It never exports them to an env file, returns them through HTTP, prints them, rotates them or sends them to a separate service.

## Explicit, staged maintenance builds

**Observed on 2026-10-16:** `--skip-domain` left the project production pointer unchanged but reassigned its legacy `backend-lifepack1.vercel.app` alias. That routing change was immediately reversed and both API aliases were verified healthy on the old deployment. Do not rely on this flag alone: check each live alias through the alias API and keep all writers blocked during subsequent migration builds. See [the executed preflight and maintenance preparation](production-maintenance-preparation.md).

`vercel-build` now has an opt-in maintenance branch. With no migration settings it keeps the existing `migrate-deploy` then `generate` behavior. When a migration phase is selected, it runs **only that phase**, avoiding the ordinary implicit schema migration before preflight. Existing Prisma postinstall generation is unchanged. No migration route is added to the application.

Use the **existing backend project**, `prj_8AdWu5G9SWVFbBwv4hGxzSUo9r82`, with a remote production build and automatic promotion disabled. The runner rejects local execution, preview environments, other project IDs, local databases and non-S3 storage. Vercel must expose its system environment variables to the build, including `VERCEL_PROJECT_ID`. A staged production deployment (`vercel deploy --prod --skip-domain`) receives production configuration without assigning the production domains. Do not use `env pull`, `--prebuilt`, `vercel build` on the workstation, or a preview deployment with copied production secrets.

Do not promote any migration-only deployment. Protect its unique URL and all historical production aliases, not only the primary domain. Staged deployment does **not** stop the old production writers. Coordinate the actual maintenance and drain separately.

For each remote build, supply these non-secret build controls through Vercel's deployment-scoped build environment (REST deployment `build.env` or `--build-env`). Keep secret values in the existing project environment, never command arguments:

```text
PRIVACY_MIGRATION_ENABLED=1
PRIVACY_MIGRATION_PHASE=preflight
```

Select a single phase per build, in this order:

| Phase | Work performed |
|---|---|
| `preflight` | Validates new keyring/active ID/key separation, retained legacy key configuration and RSA pair, database URL shape and S3 configuration. No database/storage calls. Explicitly reports that ciphertext, backup and maintenance have not been verified. |
| `schema` | Runs repository Prisma `migrate deploy` using Vercel's existing connection settings. Review all pending repository migrations first; this applies every pending migration, not only the nine privacy directories. Never reset or db push. |
| `dry-run` | Runs both existing record and jobs/export scripts without writes; authenticates existing encrypted fields and counts remaining work. Requires the schema first. |
| `apply` | Runs both existing resumable backfills, including encrypted archive replacement and queued legacy archive cleanup. |
| `verify` | Re-runs both scripts with `--verify`; exits unsuccessfully on pending work, corruption, missing objects or key errors. |
| `constraints` | Re-runs both verification scripts in this same invocation, then validates the fixed 30-constraint manifest only if both succeed. |

After an initial configuration-only preflight, establish verified recoverable database **and storage** backups/restore points and actual maintenance with all old writers drained, external jobs stopped and automatic deployments controlled. Before `schema`, `apply` or `constraints`, also supply:

```text
PRIVACY_MIGRATION_BACKUP_REFERENCE=<non-secret reference to verified database/storage restore evidence>
PRIVACY_MIGRATION_MAINTENANCE_REFERENCE=<non-secret reference to the active maintenance procedure>
```

These references are **operator attestations**, not backup creation, restore verification, or proof that traffic is blocked. The script checks that references are present, not that an external backup or maintenance system has acted. Do not invent references or treat them as a substitute for the actual procedures. No production backup or maintenance has been performed by this local adaptation.

Raw subprocess stdout/stderr is captured and never forwarded. Reports are reconstructed from a fixed allowlist of model names and nonnegative integer counts. Failure output identifies only a fixed stage/code. No record IDs, content, database URLs, storage paths, key IDs, key values or exception text are emitted. Each subprocess is limited to ten minutes; completed backfill records remain checkpoints. Retry interrupted backfill phases with the same keys. A failed schema migration requires inspection/reconciliation of Prisma migration state; do not blindly mark it resolved or drop guards. A timeout around archive upload can leave a ciphertext orphan requiring storage reconciliation, as in the existing runbook.

The runner does not create backups, inspect unreferenced/provider-versioned objects, manage deployment aliases, pause traffic, or resume jobs. Existing source scripts remain unchanged and retain their existing documented reconciliation requirements. This is a build-time migration adapter, not an export mechanism for Vercel secrets.

## Return to application deployment

After zero pending/cleanup results and successful constraint validation, remove the deployment-scoped migration controls. Build the normal encryption-capable backend and frontend under the coordinated rollout, verify controlled synthetic flows while maintenance remains active, then promote the verified application and resume traffic/jobs. Never promote a migration build as the application release or roll back to plaintext writers. Retain the entire old keyring and lookup keys.

The normal build still runs its historical automatic migration step; do not push or trigger unconfigured builds before the maintenance sequence. This adaptation has not changed any Vercel project settings, deployed code, read production secrets, migrated production data or verified production behavior.

## Local validation

```sh
npm run test:privacy-vercel
npx tsc --noEmit
npx eslint src/privacy/vercelMigration.ts src/privacy/vercelMigration.test.ts src/scripts/runVercelPrivateMigration.ts src/scripts/runVercelBuild.ts
```

Tests use synthetic settings only. They cover wrong-project/environment rejection, independent backup/maintenance gates, phase ordering, re-verification before constraints, counts-only output, suppression of unexpected content, local execution denial and ordinary build compatibility. Production execution is deliberately not part of these tests.

References: https://vercel.com/docs/cli/deploy and https://vercel.com/docs/environment-variables/system-environment-variables .

Offline backfill child processes now use the existing `DIRECT_URL` as their in-memory `DATABASE_URL`, preserving session continuity while leaving the project’s runtime pooled setting unchanged. Environment/key values are never emitted or written. Provenance parent reads are batched; write transactions still recheck current ownership.

The additive `20261016120000_private_health_extraction_outcomes` migration protects status codes that reveal prescription/medical extraction outcomes. It follows the original nine migrations; do not modify their applied checksums. The constraint manifest now validates 30 constraints. Offline record/archive phases have a 20-minute child timeout, preserve completed records and can be resumed with the same retained keys.

The guarded `verifyProductionPrivateWrites.ts` tool creates only synthetic fixtures, checks real services, raw records, SQL rejection, original-file AI, manual/retry, permissions, storage and exports, and removes its fixtures in `finally`. With `PRIVACY_SMOKE_API_URL` it also tests the verified deployed backend through a maintenance-only probe header. It never prints credentials, private values or provider responses. Successful offline tool builds exit 42 deliberately to prevent them becoming public application deployments.
