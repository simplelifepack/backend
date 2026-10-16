# Private manual production backup tooling

These explicit maintenance tools produce a recoverable database plus all-bucket
Storage snapshot without downloading existing Vercel secrets. They do not run as
application routes and never migrate production. Current evidence is documented
in `docs/privacy/manual-production-backup.md`; do not treat scripts as evidence.

The local setup generates a separate RSA recipient key (0600) outside the backup
directory (0700). Vercel receives only its public key. The remote build uses the
existing injected production database/S3 credentials in process memory, exports
`pg_dump` custom format plus globals without role passwords, fingerprints every
non-system table before/after export, and inventories/reads every bucket/object.
Each archive entry is encrypted with a fresh AES-GCM nonce and bound to backup,
sequence and entry name. A final authenticated manifest binds all hashes/counts.
Only recipient-encrypted frames reach build transport; PostgreSQL/S3 errors and
private names never print. Collection fetches those frames through authenticated
Vercel APIs and verifies the completion manifest before writing private files.
Existing application keys are never exported. Keep them retained in Vercel and
retain the backup recipient private key separately; neither substitutes for the
other when restoring encrypted application content.

The build deliberately exits 42 after successful export so it cannot become a
ready application deployment or acquire live aliases. ERROR is expected only
when a valid encrypted completion manifest is present. Never treat arbitrary
build failure as a successful backup. All URLs and production pointers still
need checks before/after builds. The prepared job directory must contain only
backup tooling, recipient public key, actual maintenance evidence and a pinned
PostgreSQL client extracted from an official image. Never upload recipient
private keys, local archives, `.env` files or source `.secrets`.

Object bytes can be exported as <=1 MiB parts to stay within authenticated build
transport limits. Parts are accepted only for the same backup and reassembled
against the original whole-object hash, rejecting gaps, overlaps or substitution.
A manifest-only archive is NOT a complete Storage backup until every object byte
has been collected and hashed. Pending jobs can be collected again idempotently.

`restore.mjs` requires a digest-pinned official Supabase PostgreSQL image. It
starts PostgreSQL with a new bootstrap identity, no ports, no network, no host
mounts, read-only root, tmpfs data, no Supabase entrypoint or preload hooks. For PostgreSQL 17 it retains the source platform-superuser grantor identity,
skipping only that bootstrap role’s already-created CREATE ROLE. It
restores roles/schema/data, checks all table counts and fingerprints, every
object hash, sequences and foreign keys. It validates source NOT VALID
constraints in the isolated copy only. The container is removed afterwards.
Real data is never restored over production or the normal local database.
Reports contain counts/status only and distinguish ciphertext preservation from
application decryption (the latter requires keys retained in Vercel).

Commands require explicit paths; do not invent maintenance references:

```sh
node --test scripts/private-backup/*.test.mjs
# Setup and maintenance require reviewed target and block coverage first.
node scripts/private-backup/collect.mjs <export-deployment-id> <secured-backup-directory> <separate-recipient-private-key>
node scripts/private-backup/parts.mjs status <secured-backup-directory> <separate-recipient-private-key>
node scripts/private-backup/parts.mjs collect <secured-backup-directory> <separate-recipient-private-key>
node scripts/private-backup/restore.mjs <secured-backup-directory> <separate-recipient-private-key> public.ecr.aws/supabase/postgres@sha256:<verified-digest>
```

`maintenance.mjs` captures and changes project gates/firewall/pause settings;
`allow-export-build.mjs` permits backend builds only after verifying block-all
coverage. These scripts are specific to the existing project IDs/previous
production deployment IDs and fail closed on drift. They do not cover Supabase
Data API or independent external workers: verify those separately. `resume`
restores prior settings, including prior paused projects; do not resume old
plaintext writers after the encryption migration. Production application rollout
uses the separate reviewed migration/deployment sequence.

`consolidate.mjs` creates a single recipient-encrypted complete archive from the
verified source archive and all parts, preserving every source entry byte. Supply
`complete-production-backup.rpb` as the optional fourth restore argument to test
that single archive. Original archives and evidence are retained.
