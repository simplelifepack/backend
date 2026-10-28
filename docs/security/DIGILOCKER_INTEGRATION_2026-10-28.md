# Combined PR #3/#4 integration — 2026-10-28

Both repositories integrate the fetched PR #3 and PR #4 heads with current main on `codex/digilocker-durable-integration`. No GitHub PR has been merged. Backend upload conflict retains admission limits, authenticated AsyncLocalStorage, bounded parsing and stream draining. Callback validation and CSP are retained. The later requested removal deletes frontend hostname/early-access gates and backend early-access blocking; account authentication and authorization remain enforced.

## Implemented

- Import requests persist explicit consent and return HTTP 202. The durable batch lives on its owner-bound session; each worker invocation handles one document. PostgreSQL atomically claims leases under a short advisory transaction, caps active leases at three and recovers expired leases. Attempts, retry timestamps and encrypted progress survive process loss.
- Provider downloads and AI calls receive AbortSignals. Five-second heartbeats fence cancelled/expired/stale workers. The document transaction locks/checks the session lease before writing. Cancellation cannot be overwritten by a late worker completion. Time comparisons and raw timestamp parameters explicitly use UTC.
- Provider references are checked before downloading; owner-scoped hash/reference deduplication remains inside the account-locked final transaction. One process holds at most three import work slots and at most four document AI slots. A fourth import worker gets 503; error middleware includes Retry-After.
- Stream chunks are wiped on successful and failed bounded reads. Import buffers are wiped in all exits, including validation/storage failures. Validation precedes encryption; ciphertext references are released after encrypted temporary storage, and the source plaintext buffer is wiped once its isolated analysis file exists.
- Progress is encrypted separately from credential/consent payloads. Failed provider revocations retain encrypted terminal credentials for bounded maintenance retries until expiry. Cancelled and failed sessions cannot use retained credentials for imports.
- Frontend polling aborts on cleanup, backs off on errors, respects Retry-After and pauses scheduling while hidden. Users can refresh status, cancel a running import or reconnect after interruption. Individual results and expiry messages retain partial-success information. Document lists render fifty rows at a time.
- IndexedDB operations serialize clear/write ordering and resolve only after transaction commit. Cache writes check auth generation and account scope. Redux keeps at most 2,048 pending IDs for ten minutes and rejects unknown/expired completions; logout/account replacement invalidates pending work.
- Inherited file-length lint failures were resolved by separating service modules, hooks and view components. Existing design-system components and styling are retained. SMTP pool typing is corrected. Admin bootstrap consumes its invocation secret, requires a generated 16-character minimum password (72 UTF-8 bytes maximum), and requires `--rotate-password` to change an existing admin password.
- Preview builds skip inherited database migrations unless `PREVIEW_DATABASE_MIGRATIONS_APPROVED=1` is explicitly configured.

## Verification

- All 27 backend test files changed in PR #3/#4, plus billing/worker coverage, passed against combined code and isolated PostgreSQL with synthetic provider boundaries. Added bootstrap, preview-migration, cancellation, global admission and revocation-retry checks pass.
- Frontend: 56 files / 226 tests passed after removing obsolete hostname-gate tests, including new cache commit-order, bounded request registry, signal forwarding and Retry-After tests. Both repository lint checks and TypeScript checks pass; production builds pass. Existing bundle-size warnings remain.
- All migrations applied to a fresh disposable PostgreSQL database. Prisma reports an empty schema diff against the merged schema.
- Real PostgreSQL tests exercise concurrent enqueue, provider-reference retries, expired leases, stale commit fencing, partial progress, retry timing, active cancellation, cross-account denial, three-worker admission, revocation retries and expiry.
- Disposable backup/restore: all 44 table counts and a sentinel record matched. This validates the synthetic database round trip, not current production backup recoverability or object-storage recovery.
- Local resource profile (synthetic provider, AI disabled): queue admission p95 22.3 ms / p99 55.0 ms; small-PDF worker p95 189.9 ms / p99 221.1 ms. Three 9 MiB PDFs reached process peak RSS 236.5 MiB. RSS after GC remained about 215 MiB; Node/native allocators can retain pages. See the evidence JSON for heap/external buffers. This is neither a production baseline nor a serverless equivalence claim.
- Local shared-key rate-limit profile at 32 one-connection pools: 33 total connections including the observer, p95 11.0 ms / p99 32.5 ms, 640 operations, zero failures. Connection totals still scale with function instances; pool size one does not globally cap database connections.

## Hosted verification and outstanding gates

The user authorized the connected `readiness` Supabase project (`izsujcwyuirkzkafhfnp`) as the current test environment and requested Vercel test-branch deployment. Existing records must be preserved. The additive migration adds queue metadata only.

A real Chrome localhost OAuth attempt returned `redirect_uri_mismatch` for `http://localhost:4000/api/integrations/digilocker/callback`, before authentication or document consent. The saved provider callback is `https://backend-three-sage-78.vercel.app/`. A preview callback cannot complete through a different deployment/database without a supported routing arrangement. Do not claim scopes, HMAC, real imports or real token revocation are verified until that flow succeeds.

Vercel metadata showed no recurring Razorpay plan IDs or webhook secret configured. Synthetic billing lifecycle tests pass; real test checkout/payment/refund/webhook verification remains pending. The bootstrap password remains a readable production-scoped Vercel configuration variable; remove it after intentional offline provisioning/rotation and keep future invocation secrets out of persistent deployment configuration. This task has not changed existing account passwords or encryption keys.

A test preview requires CRON_SECRET. Import admission starts a best-effort Vercel waitUntil drain (three workers, 270-second invocation budget); the protected GET /api/integrations/digilocker/worker endpoint provides durable scheduler recovery. Timeout retries preserve the durable job. The current Hobby plan permits daily cron only; the committed cron is daily cleanup. Status checks also restart eligible interrupted jobs. Vercel cron executes for production deployments; preview crash-recovery verification must invoke the protected worker explicitly if its best-effort invocation is interrupted. Configure a minute-level external/paid production scheduler before relying on autonomous crash recovery while the browser is closed. Key rotation still requires preserving old versioned decryption keys, separately backing up lookup keys and following the private-data recovery runbook; lookup-key rotation is not an in-place key replacement.

Still required: successful real provider consent/scopes/callback/HMAC/imports and revocation, Razorpay credentials and real test lifecycle, authenticated hosted penetration tests, hosted load/memory/GC and before/after p95/p99/failure-rate comparisons, and real-device mobile/light/dark/focus QA. Automated synthetic checks do not satisfy these live gates. PRs should remain unmerged until the applicable gates have evidence.

## Hosted test configuration

The additive migration is confirmed applied to the connected Supabase project.
The existing verified-host firewall intentionally denies new generated/branch
hostnames. Test traffic will use the designated DigiLocker preview hosts already
on its allowlist: `backend-git-codex-digilocker-preview-lifepack1.vercel.app` and
`frontend-web-git-codex-digilocker-preview-lifepack1.vercel.app`. The new backend
branch's frontend/CORS configuration and frontend branch API URL use these test
hosts. The main frontend aliases now serve the approved auth-enabled test build. The registered provider callback has the approved forwarding rules described below.

Hosted verification confirms the new migration is applied and the Git-connected
builds succeed. Git-connected builds include the verified designated-host configuration. Ten real
PostgreSQL worker tests now pass, including invocation-timeout retries and
invalid-progress handling. The approved temporary callback routing is now published and synthetic invalid-state callbacks were verified.

The user subsequently requested authentication on `readines.com` for live
DigiLocker testing. The early-access API restriction and its environment flag have been deleted; normal authentication middleware still protects account APIs.
Frontend domain redirects that forced application paths back to `/` are removed.
The test backend returns OAuth users to `https://readines.com`. Two explicitly
approved temporary project rules relay only GET root callbacks on the registered
backend host with state+code or state+error to the designated test callback.
Synthetic invalid-state probes return 303 to the expected frontend error
fragment; ordinary root traffic remains 404. No firewall rule was changed.


## Main-domain verification update

The user explicitly approved frontend build `b68b397` on both `readines.com` and `www.readines.com`. Both aliases now point to `dpl_8AQiyD4oe85qhjAW5LQ45RebwQxq`; rollback build `826a48b` remains available as `dpl_4oeKcTbviejPQxZCbijWM5DwJprS`. Git main and PR merge state are unchanged. The frontend uses the designated test backend, preserving the original registered callback host for ordinary traffic.

Chrome restored the existing account on the main domain and loaded Documents. Real status/session requests returned 200. Connect DigiLocker reached the provider's actual sign-in form with the registered callback accepted, replacing the previous redirect mismatch. Provider sign-in, consent, returned scopes, HMAC and actual document import remain pending human sign-in. No PIN or OTP was requested in chat.

Hosted testing found an express-rate-limit false double-count warning for stacked shared stores. Each store now exposes its actual scope as its validation prefix; counters and limits remain unchanged. A real Express/PostgreSQL stacked-limiter regression and all 27 combined backend test files pass.

Synthetic source-baseline measurements are saved beside current resource evidence. On the same local workflow with three 9 MiB PDFs and AI disabled, peak RSS fell from 337.42 MiB to 236.53 MiB and post-GC RSS from 335.95 MiB to 215.2 MiB. Baseline synchronous completion p95/p99 was 322.20/322.56 ms; durable admission p95/p99 was 22.29/54.99 ms. These timings measure different completion boundaries and are not a production end-to-end latency comparison.


Live provider verification: the user completed DigiLocker authentication and selected PAN. The registered callback returned successfully, authenticated session and provider document-list requests returned 200, and the user explicitly approved copying that PAN record. The durable import reached `Completed — already in Documents`, confirming real OAuth/listing/import admission and deduplication without creating another copy. Because the record was deduplicated, this test does not establish a fresh provider PDF download/HMAC/encryption or AI operation. Those paths remain covered by synthetic integration tests pending a distinct real document.

The user subsequently requested pushing all combined work, including the previous DigiLocker PRs, to main. This authorizes releasing the integrated source; outstanding external verification remains explicitly recorded above.
