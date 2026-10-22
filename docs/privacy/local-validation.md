# Local completion and validation — 2026-10-15

## Cause of readable data

The running backend was the older `/Users/ranjith/code/backend` checkout without the encrypted Prisma facade. Its normal local database had none of the nine privacy schema migrations or backfills, and its existing environment had legacy encryption keys but no private-data v2 keyring/lookup key. Testing an isolated database had not migrated this database.

The backend socket and pgAdmin configuration/query history both selected `localhost:5434/lifepack`. Final verification found three pgAdmin sessions connected to that database. No credentials, key material or private record values were printed. Production was not accessed.

## Changes applied to the normal local database

- Preserved existing document, RSA, OAuth and OpenAI keys. Added only the missing private-data keyring, active key ID and independent lookup key to the existing ignored local environment, using restrictive file permissions. No key was replaced or stored in database records.
- Stopped the older local backend before migration. Created an authenticated encrypted database backup and verified its roundtrip before changing schema/data. The ignored `.secrets/local-privacy-backup-v2.bin` contains ciphertext and binding metadata only; retain its external keyring.
- Applied the previously pending application query-index migration and all nine privacy migrations. Ran counts-only dry runs, resumable backfills, ciphertext verification and SQL constraint validation. Final results: every protected model pending=0, jobsPending=0, exportsPending=0, cleanupPending=0; no unvalidated privacy constraints.
- Preserved every table's record count. Verified 4 accounts, 11 documents/13 pages, 35 health records across seven models, 7 wealth records, 1 trust member, 232 integration candidates/1 connection/1 external identity, 68 packages/358 requirements, 2 signup verifications, 2 push subscriptions and 1 export job. Existing references and relationships remain; historical content-bearing private requirement IDs are replaced by opaque IDs with assignment references cascaded, as documented in the rollout guide.
- Cleared protected original columns to keyed indexes or fixed null/empty/zero masks only after successful bound encryption. Archived legacy catalogue search metadata in ciphertext and quarantined historical AI catalogue records without reliable ownership. Migrated the existing ZIP to encrypted storage and removed its old plaintext object.
- Started the current worktree backend on port 4000 against that same database, existing storage and preserved keys. The old checkout must not be restarted until it incorporates these changes; use the launcher below.

Old WAL, snapshots and historical backup/object versions are not securely erased by a backfill. The new backup is encrypted; any earlier copies require normal controlled retention handling. No production migration or deployment was performed.

## Re-run local checks

The launcher and synthetic verifier reject targets other than the normal development database on localhost:5434/lifepack with local storage. They read the explicitly supplied environment in memory, preserve relative storage roots and load the existing development RSA pair. They never rotate/write keys.

```sh
npm run dev:local-private -- --env-file /Users/ranjith/code/backend/.env
# In a second terminal; uses synthetic users only and cleans their fixtures:
npm run privacy:verify-local -- --env-file /Users/ranjith/code/backend/.env
# Optional real provider check, using the existing configured key and synthetic PDF:
npm run privacy:verify-local -- --env-file /Users/ranjith/code/backend/.env --live-ai
```

The verifier checks actual health/member/measurement/medication/wealth services and encrypted document/temp storage, create/update nonces, raw database values, SQL plaintext-write rejection, authorized HTTP decryption, cross-user denial, allowlisted operator projection, AI-disabled manual entry, original-file health AI input, failed/disabled retries retaining stored measurements, and disabled future Gmail/Drive routes. It compares all table counts before/after and removes only its generated fixture IDs/objects. A failed process interrupted before finally cleanup may leave synthetic fixtures; do not delete unrelated records to repair this.

For migrations on another intended environment, follow the maintenance sequence in [README.md](README.md), retaining its exact keys and storage configuration. The local launcher deliberately does not accept production targets.

## Results

- Build / TypeScript: passed (`npm run build`, `tsc --noEmit`). OpenAPI: valid, 129 operations.
- Privacy/diagnostic unit tests: 15 passed.
- AI/manual/PDF tests: 9 passed, covering all original pages, disabled/failing AI, structured health output, merged/reordered/rotated/removed PDF pages and structural validation.
- Related regression run: 20 passed, covering hybrid encryption, PDF/image safety, document response shape, readiness matching/refresh and refresh cookies.
- Seven PostgreSQL privacy integration suites: passed (jobs/exports; health; wealth/temp/identity/push/OTP; documents/pages/storage; authentication; trust/sharing; catalogue). These run only on disposable `127.0.0.1:55439/privacy_test`, separately from normal local verification. The container was removed afterwards. Gmail/Drive import flow tests are deferred with their disabled routes.
- Normal local synthetic service/raw-storage/HTTP check: passed with all table counts unchanged after cleanup.
- Live OpenAI extraction: passed using a synthetic PDF and the existing approved key. No stored user documents were sent by this validation.
- Focused lint for the new extraction/local tooling: passed. `git diff --check`: passed.

Readable operational fields and their reasons are enumerated in [field-inventory.md](field-inventory.md): opaque ownership/provenance links; record lifecycle timestamps; processing, lease/retry/access state; sizes/MIME/cipher descriptors; quotas/plans; sharing permission flags; public operator-authored catalogue definitions. Clinical dates/types/states, financial values and identity content remain protected. Restricted authentication hashes are one-way verifiers and excluded from operator DTOs.

Backend-held keys still permit backend controllers to decrypt data; this is server-managed encryption, not zero-knowledge.
