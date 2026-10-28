# DigiLocker integration and verification — 2026-10-28

This report supersedes the earlier preview notes. PR #3 and PR #4 from both
repositories are included in main. The backend upload conflict preserved the
security fixes, admission controls and authenticated private-data context.
Readines authentication is enabled on the main domains. Main uses the registered
backend directly; the temporary preview callback-forwarding rules were removed.
Razorpay was explicitly excluded from this follow-up by the user.

## Implemented and released

- Import admission returns HTTP 202 with durable encrypted consent/progress,
  PostgreSQL leases, retry times and bounded attempts. A short claim transaction
  caps active leases at three across serverless instances. State transitions and
  final document writes check owner, cancellation, expiry and lease ownership.
- Expired leases recover after process death. Provider downloads and AI receive
  AbortSignals. Heartbeats stop cancelled/stale work; final commits remain fenced.
  Partial success survives retries. Timeout and corrupt-payload paths terminate
  or retry safely instead of stranding a session.
- Provider references are checked before download. Reference/content deduplication
  is repeated transactionally. Provider bytes are size-bounded, HMAC verified,
  validated, encrypted, and wiped on success/failure. Import slots also bound PDF,
  encryption and AI operations. Progress is separate from credential payloads.
- Failed revocations retain encrypted credentials for maintenance retries until
  expiry; terminal sessions cannot import. Successful revocation clears stored
  credentials. Encryption key rotation preserves old-key reads; removed keys fail
  closed. Lookup-key replacement is a separate migration, not normal rotation.
- Supabase runs `digilocker-recovery-every-minute` independently of browsers.
  It wakes the protected worker only for eligible work/expiry/revocation. The
  bearer token stays in Vault; Vercel receives only its SHA-256 verifier. Headers
  are not stored in an asynchronous HTTP queue. The existing daily Vercel cleanup
  remains a secondary path. Local server startup already ticks the worker every
  two seconds. See `DIGILOCKER_RECOVERY_OPERATIONS.md` for verification and rollback.
- Frontend polling aborts on cleanup, backs off and pauses while hidden. Initial
  connection checks now time out after twenty seconds and offer Refresh Status
  even before a session exists. Per-account storage keys prevent stale recovery
  state or a late old-account cancellation erasing another account's connection.
- UI supports cancellation/reconnect, individual results, retry/expiry messages,
  fifty-row rendering increments and fifty-document batch selection. Imported
  source labels and filters now identify DigiLocker rather than Manual Upload.
  At the user’s request, header/modal/bulk action buttons use natural widths
  and wrap only when the row runs out of space. Existing tokens are preserved.
- IndexedDB clears/writes serialize through commit with account-generation checks;
  Redux request IDs are capped at 2,048 and expire after ten minutes. HTTP 503
  responses expose Retry-After; the frontend provides retry cooldown/backoff.

## Real provider verification

The user completed DigiLocker sign-in and provider consent in Chrome on
readines.com. The registered callback returned successfully and the document list
contained the selected documents. The earlier PAN copy completed as already in
Documents without creating a duplicate.

With explicit action-time approval, a fresh Driving License PDF then imported
successfully. The archive grew from three to four records. This exercised actual
provider download, mandatory HMAC verification, PDF validation, encryption,
permanent persistence and the existing AI processing path. Database checks found
an AES-256-GCM encrypted page with ciphertext hash, encrypted parent hash, and a
private storage reference. The import was not marked duplicate. Closing the
connection produced CANCELLED, cleared credentials and released its lease.
No PIN, OTP, provider token or document content was included in this report.

## Regression and fault verification

- All 30 unique combined backend test files passed using the pre-integration main as the
  comparison baseline, with each suite routed to its required disposable DB.
- Eleven worker integration cases passed, including a real SIGKILL of a worker
  child during provider I/O, lease recovery, stale commit fencing, concurrent
  admission, cancellation, partial retry, invocation timeout, corrupt progress,
  revocation retry and expiry. Provider boundaries in these fault tests are
  synthetic; the PostgreSQL and import pipeline are real.
- All 56 frontend test files / 234 tests passed. Coverage includes account cache
  ordering, request bounds, abort/retry contracts, hidden-tab polling, timeout
  recovery, separate account session keys, fifty-row paging, fifty-item selection,
  focus trapping, Escape and focus restoration.
- Lint and TypeScript checks pass without disabling rules. Builds pass with the
  existing bundle-size advisory. Privacy key rotation tests pass.
- Merged Prisma schema/migration checks passed on disposable PostgreSQL. The
  additive durable-import migration is applied to the connected Supabase project.
- Final isolated backup/restore matched all 44 table counts and its sentinel.
  This synthetic round trip is not a current production/object-storage disaster
  recovery rehearsal. Historical full recovery evidence remains in
  `docs/privacy/manual-production-backup.md`.

## Authenticated hosted verification

A verification-only Vercel build created unique synthetic accounts and cleaned
up its fixtures. All 17 named checks passed: owner access/no-store, cross-account
status/list/cancel/import denial, consent/batch boundaries, pending/cancelled
import rejection, forged tokens, unauthenticated worker denial, invalid/replayed
OAuth state, cancellation, and autonomous expiry of an abandoned lease.

The expiry fixture was observed directly in PostgreSQL: the test did not poll its
API status or manually invoke the worker. The minute scheduler expired it and
released its lease without browser activity. The verification build deliberately
exited 42 after its successful structured report, so it could not publish a
serving deployment. Error status alone is not evidence of success.

Bounded authenticated load against the deployed API:

| Concurrency | Requests | p95 | p99 |
|---|---:|---:|---:|
| 1 | 8 | 293.3 ms | 293.3 ms |
| 4 | 32 | 1,585.7 ms | 1,766.2 ms |
| 8 | 64 | 405.0 ms | 1,489.9 ms |

All 104 responses were HTTP 200. Maximum sampled database connections: 18.
Samples are small, cold-start/pooling effects vary, and connection sampling can
miss a short peak. This is targeted authenticated security/load verification,
not an independent penetration test or a saturation/soak capacity claim.
Evidence: `audit-evidence/digilocker-hosted-2026-10-28.json`.

## PDF memory and database contention

The final synthetic local profile used three 9 MiB PDFs with AI disabled. Peak
process RSS was approximately 302.8 MiB; after settled GC, array buffers returned
to the pre-import value of approximately 3.85 MiB. Settled external memory was
approximately 7.72 MiB. RSS remained about 299.3 MiB because the process retained
allocated pages; RSS is not equivalent to live plaintext buffers.

Queue admission p95/p99: 9.29/9.58 ms. Small-PDF worker p95/p99: 40.16/64.64 ms.
At 32 one-connection clients, the rate-limit contention profile observed 33
connections, 640 operations, p95/p99 9.31/21.88 ms, and zero failures.

Earlier source-baseline and current profile runs are preserved separately. Their
RSS and latency vary across runs. Baseline synchronous completion and durable
queue admission measure different boundaries, so they must not be presented as
a like-for-like end-to-end production latency improvement. Local profiles also
include synthetic PDF generation and do not measure hosted AI peak RSS.

## Verification boundaries

Real Chrome mobile emulation at 412 × 924 showed light/dark Documents and DigiLocker
modal fitting the viewport. Keyboard and large-provider-list behavior have the
automated coverage above. Physical-device/browser-matrix validation, independent
penetration testing, long-running saturation/soak tests, hosted large-PDF/AI peak
RSS and comparable historical production before/after metrics are not established
by these checks. Keep those distinctions when making a production-readiness claim.
