# Production maintenance preparation — 2026-10-16

**Latest executed checkpoint:** the manual database/all-Storage backup and two isolated restore checks passed; Data API is confirmed disabled and public-schema access hardening is applied and verified. See [manual-production-backup.md](manual-production-backup.md). Earlier sections below describe historical preparation and must not be used as current absence-of-backup evidence. The original nine encryption migrations and the additive health extraction outcome migration are now applied. Resumable backfills are running; validation and application deployment remain pending. Old writers and automatic builds remain blocked.

## Remote configuration-only preflight: completed

- Existing backend project: `prj_8AdWu5G9SWVFbBwv4hGxzSUo9r82` (`lifepack1/backend`).
- Preflight deployment: `dpl_DexfVjFTCqjdcx88zSuQLYpmJp2T`, https://backend-8uhncij6y-lifepack1.vercel.app . Its public handler returns 503 and has no application routes.
- Inspector/build logs: https://vercel.com/lifepack1/backend/DexfVjFTCqjdcx88zSuQLYpmJp2T . Configuration result: `configurationValid=true`.
- Vercel validated the newly configured private-data keyring/active ID/independent lookup key and retained legacy document/metadata/lookup/dedup/OAuth/RSA configuration in its own process. No secret value was fetched from Vercel, printed, committed, copied into local env files or replaced. This validates configuration, not historical ciphertext recovery.
- Supabase references derived inside Vercel: database `izsujcwyuirkzkafhfnp`; direct database `izsujcwyuirkzkafhfnp`; storage `izsujcwyuirkzkafhfnp`. Storage driver is `s3`, provider is **Supabase Storage**. No storage bucket name or connection URL was emitted.
- `remoteConnectivityVerified=false`, `existingCiphertextVerified=false`, `backupVerified=false`, `maintenanceVerified=false`. The build made no database/storage calls and did not query or modify records.
- Used a secret-free 16-file isolated artifact, fixed `--phase=preflight`, generate-only postinstall helper, no migration directories, no backfill scripts, and no production application handler. Only deployment-scoped non-secret enable/phase flags were supplied. No Git commit/push or project configuration change was used.

### Routing incident and correction

Despite using `--prod --skip-domain`, Vercel automatically assigned the legacy `backend-lifepack1.vercel.app` alias to the preflight. That alias briefly returned the preflight's 503. The project production deployment pointer and `backend-three-sage-78.vercel.app` were unchanged. The legacy alias was immediately restored to `backend-m5osa23ks-lifepack1.vercel.app` / `dpl_4qQZNydcF2ZMKPrYXHqT3EiDJiYc`. Final alias API checks confirmed **both** existing API aliases point to that previous production deployment and return HTTP 200. No application data was changed.

Do not rely on `--skip-domain` or the project production pointer alone for future builds. Check every live alias directly before and after any deployment. Deployment detail `alias` metadata can retain historical assignments even after reassignment; use the alias API/current HTTP routing as the source of truth. All further migration builds must occur with verified maintenance already blocking every old URL. Do not issue another unprotected production build as part of preparation.

## Current access and verified inventory

Vercel CLI authentication refreshed successfully. Both existing projects remain Git-linked to their corresponding `simplelifepack` repositories and production branch `main`. Backend production remains `dpl_4qQZNydcF2ZMKPrYXHqT3EiDJiYc`; frontend remains `dpl_3FFreSp5PHc2BKLUAvb2j8rxGWU1`. No application deployment was promoted.

All retained deployments were enumerated through API pagination:

| Project | Retained deployments | READY | Active builds | Vercel cron definitions | Deployment protection configured |
|---|---:|---:|---:|---:|---|
| Backend | 39 | 32, including this non-writing preflight | 0 | 0 | No |
| Frontend | 25 | 20 | 0 | 0 | No |

Non-secret URL/ID manifests and prior settings are saved under `/tmp/readiness-vercel-preflight-state/` for the coordinator; these are operational metadata only. Re-enumerate immediately before maintenance because deployments/configuration can change. The live aliases include `backend-lifepack1.vercel.app`, `backend-three-sage-78.vercel.app`, `readines.com`, `www.readines.com` and `frontend-web-nine-amber.vercel.app`, plus retained generated deployment URLs. Do not assume protecting only the main domain blocks historical deployments.

### Supabase connection completed: read-only inspection

The user connected the Supabase integration after the initial preflight. It is now authenticated and usable; installation/connection is no longer a blocker. The project metadata independently confirms:

| Item | Verified result |
|---|---|
| Project | `readiness`, `izsujcwyuirkzkafhfnp`, `ACTIVE_HEALTHY` |
| Organization | `lifepack`, subscription plan `free` |
| Region / PostgreSQL | `ap-south-1` / 17.6 |
| Database size at inspection | 18,443,411 bytes |
| Completed privacy migrations | 0 of 9 |
| `private_*` ciphertext columns | 0 |
| Storage | 1 bucket, 0 public buckets, 6 object metadata rows |
| Recorded storage bytes | 8,137,429; all 6 objects have size metadata |
| Supabase scheduling extensions | No `pg_cron`, `pgmq` or TimescaleDB installed; `cron.job` absent |
| Edge Functions | 0 |
| Public HTTP webhook triggers | 0 identified for the standard HTTP trigger functions |
| Managed Supabase Auth users | 0 |
| Anonymous table grants without RLS | 14 public tables permit SELECT and DML; 13 match protected application models |
| Anonymous-callable public security-definer functions | 1 |

These are configuration/catalog/aggregate observations only. No real user values, object names, SQL text from active sessions, credentials, keys, function definitions or cron/webhook secrets were read. Storage metadata counts are **not** an object-byte backup or checksum verification. The 14 table grants do **not** by themselves prove live REST exposure: the Data API enabled/exposed-schema configuration still needs inspection.

**Maintenance implication:** closing Vercel traffic alone is insufficient if the Supabase Data API is enabled. Inspect and disable its REST/GraphQL access path before the backup/migration window. Keep it disabled afterwards unless a separate grant/RLS/function review establishes safe exposure; this application uses its backend API instead of a Supabase client. Do not apply blanket `auth.uid()` policies to the application's independent JWT scheme, and do not run unreviewed GRANT/REVOKE/RLS DDL ahead of the required backup gates.

### Backup/restore capabilities and remaining dashboard access

The installed connector supports project/organization metadata, SQL, function and migration operations, but **has no backup listing, backup creation or backup restore-point inspection tool**. Do not use pause/restore-project calls as a backup test. Supabase's current documentation provides automatic daily backups for paid plans and recommends manual logical exports for Free projects; paid PITR is not established for this Free organization. No upgrade or paid add-on was requested or purchased.

Supabase Storage's S3 interface does **not support object versioning**. Database backups cover storage metadata, not object bytes. This project therefore needs a separately verified, encrypted object snapshot and a verified database recovery point; neither exists as verified evidence from this work. Manual logical database backup plus object copy/restore is a supported planning route, without assuming an upgrade is required. Keep private backups encrypted and retain recovery keys inside the authorized Vercel environment as requested.

The targeted backup dashboard still redirects to Supabase sign-in even after the connector was authorized. The next missing access action is to sign in to https://supabase.com/dashboard/project/izsujcwyuirkzkafhfnp/database/backups in the opened in-app browser. This is distinct from connector authorization: it allows inspection of actual restore points and dashboard-only controls. No token/password should be pasted into chat. A dashboard check must not click Restore on production or upgrade a plan without a separate explicit request.

## Exact maintenance sequence to execute after access and backup planning

These steps are prepared, **not activated**. No backup or maintenance references have been invented.

1. **Capture and freeze deployment inputs.** Refresh the complete backend/frontend deployment/alias manifests, current deployment SHAs, Git link and protection settings. In each Vercel project's **Settings → Git**, disconnect the repository temporarily after recording its exact origin/production branch; this prevents old/new pushes from launching builds before the maintenance migration. Coordinate a freeze of CLI/manual deployments, Deploy Hooks and CI workflows as well. Do not remove the GitHub app or delete repositories. Inspect/cancel any queued/running application deployments before proceeding. Reconnect only after verified rollout. The current `vercel-build` otherwise performs Prisma migrate deploy automatically.
2. **Inventory schedulers before changing them.** Vercel currently has zero cron definitions in either project. Supabase inspection found no scheduling extensions, Edge Functions or standard public HTTP webhook triggers. Confirm dashboard integrations, CI jobs and external schedulers as well; their absence has not been established by the SQL checks. Avoid printing cron commands/webhook URLs because they may contain tokens. List only opaque IDs, active flags and aggregate counts. Identify callers of package generation/polling, exports, storage cleanup, notification sends and account deletion processing. Stop scheduled invocations and disable retries while preserving job/queue rows and documenting previous settings. Do not delete or force-complete jobs.
3. **Close all request paths to old writers.** In Supabase, inspect **Integrations → Data API → Overview** and turn **Enable Data API** off if currently enabled; record its prior configuration. Inspect independent Storage/API clients and suspend external upload/deletion jobs without rotating the existing S3 credentials. Account for any outstanding signed uploads. First place the frontend into maintenance. For the backend, use Vercel project pause and all-deployment protection covering production, previews, branch aliases and retained generated URLs. Deployment protection lives under the project's Security/Deployment Protection controls; pause is under Settings → General → Pause Project. Remove or suspend existing protection exceptions/shareable links/automation bypasses for old deployments during the window, recording them without disclosing secrets. Coordinate with team members so authenticated access cannot invoke old code. Keep application projects paused/protected while migration work runs at build time. Do not confuse a blocked UI with a blocked backend.
4. **Verify the block, not merely the setting.** Probe every retained backend URL and every live alias without cookies or bypass credentials. No old application handler may remain publicly callable. Expect platform pause/protection responses, not a live application's 401; anonymous 401 from `requireAuth` alone does not prove an authenticated writer is blocked. Verify privileged/automation callers are also stopped. Keep the isolated preflight's inert 503 handler separate from live-app checks. If a retained URL bypasses the block, stop the rollout and resolve coverage before migrating.
5. **Drain existing work.** The current code can write on GETs, including package job polling, export polling/download state, health default-member reads, and usage/storage cleanup. Exports can continue through an immediate background callback after the requesting response. Stop independent/local workers connected to production as well. Inspect the actual deployed function duration limit; it was not reported by the metadata read, so no duration was invented. Wait for that bound and confirm aggregate active database transactions, unexpired package worker leases, and live export/background processing are zero. Package lease length in source is 120 seconds; lease expiry alone is insufficient proof of drain. Inspect counts only, never query text, payloads or identifiers containing private content.
6. **Create and prove a consistent recovery point.** With writers drained and object mutation stopped, verify a recoverable database backup/PITR point and an independent storage-object snapshot from the same maintenance window. Inspect actual available features in the authorized Supabase project; do not assume a paid plan or PITR is enabled. Database backup metadata alone does not cover file bytes. Retain all object versions and full manifests securely; log only counts/byte totals. Encrypt backups containing legacy plaintext, including legacy exports. Use an approved isolated restore destination to verify schema, counts, foreign keys, object checksums and readable existing ciphertext with Vercel-held keys. Never test a restore over production. Confirm destination isolation prevents restored cron/webhook/worker invocations. Record real evidence only after the restore checks pass.
7. **Record gates and execute no earlier.** Only after steps 1–6 are verified may a coordinator set `PRIVACY_MIGRATION_BACKUP_REFERENCE` and `PRIVACY_MIGRATION_MAINTENANCE_REFERENCE` to the genuine evidence references and run schema/backfill phases through [the Vercel runner](vercel-migration-runner.md). Retain the old keys and an encryption-capable rollback artifact. Do not promote a migration-only build. Recheck all actual aliases after every remote build because of the observed alias behavior.
8. **Keep maintenance until application validation passes.** Require zero pending records/exports/cleanup, authenticated ciphertext verification and all 29 constraints before the normal application deployment. Verify controlled synthetic auth/ownership/sharing/admin, document/AI/manual/PDF, health/wealth/trust, packages/search/reminders, exports and storage accounting. Gmail/Drive remain disabled. Remove only generated synthetic fixtures. After successful checks, route the verified application, restore intended job/protection/Git settings, then resume traffic. Any failure keeps maintenance active; never fall back to old plaintext writers.

### Backup capability distinction

The production organization is confirmed Free. Supabase documents paid daily backups/PITR, manual logical exports for Free projects, and separate restore workflows. Database backups do **not** include Storage object bytes and Supabase S3 versioning is unsupported. An independent object snapshot and tested database restore are required. Dashboard-only backup inventory/restore permissions remain unverified; connector access itself is working.

Sources:
- https://supabase.com/docs/guides/platform/backups
- https://supabase.com/docs/guides/platform/clone-project
- https://supabase.com/docs/guides/storage/s3/compatibility
- https://supabase.com/docs/guides/api/securing-your-api
- https://vercel.com/docs/projects/managing-projects
- https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication
- https://vercel.com/docs/git/vercel-for-github

## Validation and remaining gate

Nine synthetic local tests (six runner controls, three target-redaction tests), TypeScript, focused lint and `git diff --check` passed. The remote configuration-only build is READY with configuration valid. Only read-only project/catalog/aggregate SQL was executed in Supabase. No schema/backfill/constraint command, production DDL/DML, object-content listing/copy/deletion, backup creation, restore, job pause, repository disconnect or maintenance activation has been performed. Backup/maintenance references remain unset by this work.

Supabase connector access is now available. The remaining access step is dashboard sign-in for backup/restore inventory and Data API controls. Backup/restore evidence and the remaining external-writer inventory must be completed before any migration can start.

## Continuation check — 2026-10-16

- Resumed through the authenticated Supabase connector and the user's already signed-in **Chrome** session. In-app browser sign-in is no longer the requested path. Chrome initially showed the intended production project. Navigation to the backup page and one reload both produced a blank dark page; the Database navigation fallback also rendered blank. Dashboard backup/Data API controls could not yet be inspected. No backup/restore or Data API setting was changed.
- Fresh aggregate production query: 0 `private_*` columns, 0 completed privacy migrations, 1 storage bucket, 0 public buckets, 6 storage objects. These are counts only and do not establish recoverability.
- Refreshed Vercel inventory confirms all three new private-data settings exist. The backend's deployed SHA remains `6c60c8fc85cc3095f709a75070f95786e1c33138` and it is not paused. The frontend SHA remains `c0cea3c34fbb6a58cb168e7b6beef870480073a9` and its project is now reported **paused**. This continuation did not set or change either pause state. Both Git links remain on `main`; both cron definition lists remain empty. Preserve the observed settings until the coordinator verifies maintenance coverage.
- Rechecks: backend build passed; 6 Vercel-runner + 15 privacy + 9 AI/manual/PDF tests passed. Frontend build and TypeScript passed. Full frontend suite reported 145 passes and one 5-second health test timeout during parallel load; the affected health file passed both tests when rerun alone. Do not describe this full-suite run as entirely passing.
- Full lint remains failing: backend 7 file-length errors; frontend 9 errors and 1 warning. No lint rules were weakened or unrelated large-file restructuring performed.
- No production DDL/DML, backfill, constraint validation, storage-object copy/delete, deployment, alias change, key change, Git push, restore or maintenance activation was performed in this continuation. Recoverable backup/restore evidence and verified all-writer maintenance coverage remain prerequisites to migration.
