# Production rollout preflight — 2026-10-15

**Historical status below is from the first preflight. Follow-up on 2026-10-16:** the Vercel configuration-only preflight passed using secrets inside Vercel. Production data has not been migrated. Supabase connector authentication is complete; dashboard sign-in remains required for backup/restore inventory not exposed by the connector. See [current preparation and routing incident/correction](production-maintenance-preparation.md).

## Verified repositories and existing targets

| Repository | Working state | Existing Vercel project | Existing production URL | Currently deployed SHA |
|---|---|---|---|---|
| `simplelifepack/backend` | Detached worktree at `6c60c8f`, pending encryption/extraction implementation | `backend`, `prj_8AdWu5G9SWVFbBwv4hGxzSUo9r82` | https://backend-three-sage-78.vercel.app | `6c60c8fc85cc3095f709a75070f95786e1c33138` |
| `simplelifepack/frontend-web` | `main` at `c0cea3c`, pending UI/session/design-system/document changes | `frontend-web`, `prj_HJyvi4ZPj38809HHvRzIReFuDGev` | https://readines.com | `c0cea3c34fbb6a58cb168e7b6beef870480073a9` |

Both project configurations point to the corresponding GitHub repository and production branch `main`, in the same existing Vercel team. No new projects were created. Pending files inspected before this report: backend 145 (63 modified, 32 removed, 50 new); frontend 224 (125 modified, 6 removed, 93 new, including font/design-system assets). These counts include existing work from the preceding local tasks; the rollout has not committed or pushed it.

Production frontend configuration points to `https://backend-lifepack1.vercel.app`. Read-only checks returned HTTP 200 for `https://readines.com`, `https://backend-lifepack1.vercel.app/health` and the backend project's domain `/health`. These prove public availability only, not authenticated behavior, database migration status or data protection.

Gmail and Drive remain disabled in the pending implementation: backend mounts/OpenAPI operations and frontend connection dialogs are commented out. Existing integration data/readers remain. The pending implementation has not been deployed; its disabled-route behavior is not asserted for the old production release.

## Exact blockers

1. Production is missing `PRIVATE_DATA_KEYRING_JSON`, `PRIVATE_DATA_ACTIVE_KEY_ID`, and `PRIVATE_DATA_LOOKUP_KEY`. No new keys have been provisioned because required access below is unavailable. Existing keys were not overwritten or changed.
2. Vercel confirms existing `DATABASE_URL`, `DIRECT_URL`, S3 storage endpoint/bucket/credentials, document/metadata/lookup/dedup/OAuth keys, and RSA private key/active-key settings are configured as sensitive. Its read API does not return their values. Existence does not validate key correctness against stored ciphertext.
3. Existing local `.env.production.local` and `.env.deployed.local` files contain redacted placeholders for those settings, not usable credentials. They were inspected without printing values. The normal local database environment is not production and was not used as a substitute.
4. No Supabase management access is configured in the inspected environment or standard local credential files. The connected production Supabase project/database/storage target therefore cannot yet be independently identified or accessed securely.
5. A recoverable production database/storage backup or restore point cannot be created and verified with the available access. Existing ciphertext cannot be authenticated with the actual production keyring, and production migration/backfill counts cannot be queried safely.

Required to continue: an approved secret-store path or secured production migration runner holding the **existing** database/direct connection, storage credentials and complete legacy encryption/lookup/RSA/OAuth keys, plus access to create and verify database/storage restore points. Keep secret values out of chat, logs, command arguments and Git. Vercel authentication itself is available; deployment access alone is insufficient for this maintenance migration.

No secret-recovery endpoint, secret-printing deployment, key replacement or backup bypass was attempted.

## Checks completed locally during this preflight

| Check | Result |
|---|---|
| Frontend Vite production build | Passed |
| Frontend TypeScript `tsc --noEmit` | Passed |
| Full frontend Vitest suite | 34 files, 146 tests passed |
| Backend production build / TypeScript | Passed |
| Backend privacy/diagnostic unit tests | 15 passed |
| Backend original-file AI/manual/PDF tests | 9 passed |
| Backend OpenAPI validation | Passed, 129 operations |
| Full backend lint | Failed: 7 `max-lines` errors |
| Full frontend lint | Failed: 9 errors, 1 warning (`max-lines`, explicit `any`, hook dependency) |

The lint failures are remaining checks, not waived or reported as passing. Earlier local database/integration validation is recorded in `local-validation.md`; none of those results is represented as production validation. Frontend tests cover the document/manual controls and session behavior, and backend tests cover original-file AI/failure/manual behavior; no authenticated production end-to-end run occurred.

## Production steps deliberately not performed

- No secret provisioning/rotation, maintenance switch, worker interruption, project pause, Git configuration change, commit/push or deployment.
- No production schema migration, backfill, constraint validation or synthetic fixture creation.
- No production plaintext/ciphertext counts, storage inventory, backup/restore test, sharing/admin/access smoke checks or export verification.
- Existing production traffic was left running. No traffic/jobs were suspended, so there was nothing to resume. The current Vercel cron definitions are empty; external schedulers/workers still require inventory when access is available.

Git-linked automatic deployments must be controlled **before any push**. The backend `vercel-build` currently invokes Prisma migrations, so an ordinary push/deploy could apply constraints before maintenance and backfill. Review and separate build/migration execution during the coordinated rollout. Do not let automatic builds apply the nine migrations ahead of the maintenance window.

## Required continuation order

1. Resolve secure access, identify the exact production Supabase/storage target and authenticate all retained keys against existing ciphertext without printing content. Fix remaining required lint findings and complete rollout-specific compatibility checks.
2. Generate only the three missing private-data key settings securely, retain an externally recoverable keyring/lookup key, and configure production without modifying legacy settings. Validate active ID/key separation. Keep all old IDs/keys.
3. Create and test recoverable database **and storage** backups/restore points. Record aggregate counts and object totals without names or contents. Securely retain a pre-migration application artifact and an encryption-capable post-migration rollback artifact; the old plaintext application alone is not a valid rollback after backfill.
4. Prevent automatic deployments, establish maintenance across all domains/deployment aliases and scheduled/external workers, drain in-flight work, and confirm every old writer is stopped.
5. Apply the nine additive privacy migrations in order through Prisma migrate deploy; never reset or db push. Run records and jobs/exports dry-run/apply/verify using production keys/storage. Require zero pending records/exports/cleanup and validate all privacy/ownership constraints. Preserve all records and references; follow the documented UUID cascade/quarantine handling.
6. Commit/push the reviewed changes to the existing repositories under controlled deployment settings; deploy to the existing projects using preserved secrets and record exact new SHAs/URLs. Keep normal traffic blocked while controlled verification runs.
7. Run counts-only existing-record verification and narrowly scoped production synthetic service/HTTP checks for auth, ownership/sharing, operator redaction, documents/pages/preview/download, health, wealth, trust, packages/search, reminders, encrypted exports and byte accounting. Verify original-file AI/manual retry, with no OCR. Delete only synthetic fixtures and confirm counts reconcile.
8. Resume affected traffic/jobs only after all migration/deployment checks pass, restore intended automatic deployment settings, and report verified production results. Stop and retain maintenance if any ciphertext authentication, backup, migration or application check fails.

Implementation details and migration commands: [README.md](README.md). Field coverage/readable reasons: [field-inventory.md](field-inventory.md).
