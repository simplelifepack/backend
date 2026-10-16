# Verified manual production recovery and Data API hardening

Executed on 2026-10-16 against the existing `readiness` Supabase project,
`izsujcwyuirkzkafhfnp`. The Free plan has no configured platform backups; this
manual recovery point was created without purchasing an add-on.

## Recovery archive

Secured local directory:
`/Users/ranjith/.codex/backups/readiness/2026-10-16` (0700).

Complete archive: `complete-production-backup.rpb` (0600), 16,179,045 bytes.
SHA-256: `57ffec1b640de97a27189c455f4451580c192c000246e72685fedbe7ee2f0ae0`.

The recipient private key is retained separately in
`/Users/ranjith/.codex/backup-keys` with 0700 directory/0600 file permissions.
Do not put it beside the archive, commit it, paste it into chat or upload it.
Retain both locations. All original application/database/storage/document/
metadata/OAuth/RSA/lookup secrets remain in Vercel; none was retrieved, printed,
rotated or exported. This recipient key is a new backup-only key and does not
replace any application key.

The archive contains a PostgreSQL custom-format database dump, role/global
configuration without role passwords, table fingerprints/counts, Storage bucket
and object metadata, and every object's bytes. All entries and their completion
manifest are authenticated and encrypted to the local recipient public key.
Object paths, data and recovery SQL remain encrypted on local disk. Only encrypted
frames were emitted through authenticated build transport; no public backup
HTTP endpoint was deployed. Every export build deliberately ended in ERROR
(exit 42) after a valid authenticated completion manifest; arbitrary build ERROR
is not accepted as evidence. The old application deployment pointer remained
unchanged, and active firewall coverage was rechecked afterwards.

The original database/manifest archive and 12 encrypted object parts are also
retained. The complete archive includes all the same database/object entry bytes;
its independent decrypt/hash check verified exact equality. The original
manifest-only archive alone was not counted as a complete Storage backup.

## Verified scope and isolated restoration

| Check | Verified result |
|---|---:|
| Source non-system tables restored and fingerprinted | 76 |
| Source rows | 2,658 |
| Storage buckets / public buckets | 1 / 0 |
| Storage objects / object bytes | 6 / 8,137,429 |
| Objects restored and SHA-256 checked | 6 |
| Foreign keys validated | 76 |
| Sequences / sequence-value entries restored | 2 / 2 |
| Large objects | 0 |
| Unvalidated constraints after isolated checks | 0 |
| Host/production databases overwritten | 0 |
| Existing application keys exported | 0 |

Restored both the assembled parts and the complete single archive into separate
fresh containers using the official, digest-pinned matching Supabase PostgreSQL
image:
`public.ecr.aws/supabase/postgres@sha256:b3bfedb107413abb3b8cb0d0874b0414a1dceb3d55bc0c778de6ad22d1f7dc86`.
Each container had **no network, no published ports, no host data mounts**, a
read-only root and tmpfs database/object storage. No Supabase entrypoint,
scheduled jobs or preload hooks ran. Containers were removed after verification.
The normal local database and production were never restore targets.

PostgreSQL 17 membership grants preserve their original `GRANTED BY` role. The
first attempts with a random bootstrap role stopped at that check (SQLSTATE
42501). The verified restore bootstraps with the source platform superuser and
skips only its single already-created `CREATE ROLE` statement. All original
ALTER ROLE settings and grants still execute; the archive is unchanged. This is
recorded in the successful reports, not treated as a skipped restore error.
One pre-existing NOT VALID source constraint was validated successfully in the
isolated copy only. Production constraint state was not changed by that test.

Evidence in the secured directory:

- `backup-report.json`: authenticated original database/manifest export.
- `backup-completeness-report.json`: all 12 parts assembled and six whole-object hashes matched.
- `restore-report.json`: complete parts-based restoration.
- `complete-archive-report.json`: single-archive hash and source-entry equality.
- `complete-production-backup-restore-report.json`: successful single-archive restoration.
- `maintenance-evidence.json`: actual Vercel block/gate probe results; Data API inspection is separately recorded below.

Counts/hashes prove restoration and ciphertext preservation. The local restore
**does not claim to decrypt application ciphertext**, because existing keys stay
in Vercel. A separate Vercel-side historical-ciphertext check is required before
backfill. Keep all original keys/IDs and the encrypted archive; Vercel
configuration existence alone is not proof of historical key recovery.

## Data API exposure addressed before encryption migration

Reused the user's existing signed-in Chrome instance and Supabase tab. The
project's Data API Settings page explicitly reported **Data API is disabled**.
It was already disabled when inspected; this work did not claim to have toggled
it or launch a separate Chrome instance.

After the verified recovery point, applied the connector-recorded migration
`restrict_direct_application_data_api_access` using the reviewed statements in
[data-api-hardening.sql](data-api-hardening.sql):

- Revoked public-schema table/sequence/function privileges from PUBLIC, `anon`
  and `authenticated`, including public security-definer execution.
- Enabled RLS on every public table without adding Supabase Auth policies to the
  application's independent backend JWT scheme.
- Removed permissive postgres-created object defaults. PostgreSQL's global
  PUBLIC function EXECUTE default also had to be revoked; per-schema REVOKE
  alone cannot cancel that inherited default. Future postgres-created functions
  require explicit grants. No managed role credentials or auth/storage schemas
  were changed.

Production verification:

| Check | Result |
|---|---:|
| Public application/Prisma tables | 37 |
| Public tables without RLS | 0 |
| Public tables/views accessible to anon/authenticated | 0 |
| Public security-definer functions callable by those roles | 0 |
| Permissive postgres default grants for those roles/PUBLIC | 0 |
| Backend-owner table access preserved | true |
| Source-table fingerprints rechecked / mismatches | 76 / 0 |
| Application-table fingerprints rechecked / mismatches | 37 / 0 |
| Storage objects after hardening | 6 |
| Privacy encryption migrations applied at this checkpoint | 0 of 9 |

A disposable local rehearsal additionally proved anonymous reads/writes and
function calls fail, authenticated direct calls fail, future defaults are closed,
backend-owner access remains, and rows are retained. Production advisor output
has **zero errors and zero warnings**; its 37 informational “RLS Enabled No
Policy” notices are intentional deny-all direct access for this backend-only
application. Do not add permissive policies just to remove that informational
notice. [Supabase advisory explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

The access-hardening migration is separate from the nine Prisma privacy
migrations and does not mark those as applied. Its pre-change ACL/RLS/function
state is preserved in the recovery archive. Keep the Data API disabled and retain
these restrictions after rollout.

## Current rollout boundary

The existing Vercel block-all backend firewall was verified against 34 retained
READY backend URLs/aliases. The frontend remains paused, and both project install
gates block automatic application builds. Original production pointers remain
unchanged. Build-only exports bypass the application install gate explicitly but
never become ready deployments. No plaintext writers were resumed.

This recovery/security checkpoint does not claim the encryption migrations,
backfills, constraint validation or production application release are complete.
Those still require the reviewed rollout and authenticated verification.
