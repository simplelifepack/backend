# READINESS_SECURITY_PERFORMANCE_AUDIT

25 October 2026. **Local remediation verified; production release approval and external verification remain outstanding.**

## A. Executive summary

Confirmed issues were fixed directly in both working directories. No deployment or branch merge was performed. The user subsequently authorized creating pull requests, including commits and pushes on audit branches. Backend source synchronization includes six upstream commits applied as uncommitted source alongside the original two local DigiLocker commits; that upstream billing/waitlist work must be reviewed separately from audit fixes. Frontend local commits were preserved. No production data, ciphertext, secrets or infrastructure was changed.

The user confirmed that **there is no staging environment**. Vercel custom staging lookup returned 404 for both projects; there was nothing to delete. Built-in Preview is not an isolated staging database and was not used for mutation testing.

**Charging policy, as clarified by the user:** only AI package search consumes the monthly AI allowance. Documents, Health, Wealth and document imports do not consume it. Existing-package refresh is also exempt. Consent checks, storage limits, rate limits and resource admission still apply. A regression with an already exhausted package-search counter verifies document/Health processing succeeds without increasing it; DigiLocker processing is likewise exercised. Only `analyzeIntent` calls the quota consumer in application code.

### Pull-request scope

The audit PRs target current `main` and exclude the pre-existing DigiLocker feature commits and the upstream source synchronization already present on main. Original working directories and feature branches remain preserved. The audit-only tree adds no database migrations. The preview-specific DigiLocker admission/charging fixes are retained in `docs/security/digilocker-preview-followup.patch`; apply and retest them when updating that feature branch, rather than merging an older implementation into main. The main-branch DigiLocker integration remains disabled. Full-working-tree evidence below includes the feature fixtures; Exact PR-tree verification: backend 46 files pass, frontend 51 files / 241 tests pass, both builds pass, OpenAPI validates 167 operations, and four critical integrations pass. Detailed PR-tree regression results are recorded separately in `docs/security/audit-evidence/pr-verification.json`.

### Completion list

- [x] Preserve work, fetch both remotes, inspect architecture and synchronize missing backend source without commits.
- [x] Inventory mounted routes; OpenAPI covers 168 operations.
- [x] Reproduce and fix bounded upload, streaming download/export, temporary-file and concurrency problems.
- [x] Fix PIN races, JWT/session validation, distributed throttling, push SSRF and account cache isolation.
- [x] Preserve existing encryption algorithms, key derivation, AAD and enc:v2 ciphertext compatibility; no new plaintext export persistence.
- [x] Bound imports/AI, paginate eligible private queries and improve preview/billing cancellation.
- [x] Review dependency migrations; final advisory counts zero in both repositories.
- [x] Run isolated security, privacy, payment, regression, load, memory and authenticated browser checks.
- [x] Inspect production database ACL/RLS, storage privacy, HTTP boundaries and deployment/configuration metadata read-only.
- [x] Record actual failures and untested boundaries; preserve the evidence below.
- [ ] Full ESLint pass: inherited file-size violations and one admin effect warning remain; no blanket suppressions added.
- [ ] Complete independent penetration testing and production-equivalent long-duration/capacity verification.
- [ ] Complete real Google/DigiLocker OAuth, AI 10/25/50 load and Razorpay delivery verification with authorized provider credentials/test accounts.
- [ ] Verify current key rotation/recovery and an actual backup restore in a disposable target; configuration/source review is not restore evidence.
- [ ] Approve and perform production release/configuration remediation, then repeat authenticated production checks. Original no-deploy/no-production-change restrictions remain in force.

### Production release blockers

1. Audit fixes are local, not deployed. Read-only production revisions: backend `be7e104011bc76d310379339c56e1a56a5c2dbc6`, frontend `66f99b7368877d3deb45ddd46dbd6529e97c9d29`.
2. Production environment metadata lacks `RAZORPAY_MONTHLY_PLAN_ID`, `RAZORPAY_ANNUAL_PLAN_ID` and `RAZORPAY_WEBHOOK_SECRET`. A public catalogue availability flag/test button does not establish recurring billing readiness.
3. `PACKAGES_ADMIN_INITIAL_PASSWORD` is an encrypted/readable deployment variable. Reclassify as sensitive or remove obsolete bootstrap configuration after verifying provisioning and approval. Its value was not decrypted.
4. Live provider, full browser interaction/render profiling, restore and independent pentest evidence remains incomplete. This report is not certification.

## B. Detailed confirmed findings

Line references identify the current working tree. “Pass” means the stated bounded test passed, not that all deployments or exploit classes are certified safe.

### F01 — High — Backend

Affected: [src/middleware/upload.ts:144](src/middleware/upload.ts#L144).

- **Root cause / impact:** Encrypted uploads accumulated each file independently; a multi-file request exceeded the intended aggregate memory budget.
- **Reproduction:** Send a 12 MiB encrypted multipart batch, including a chunked body without Content-Length. Original middleware accepted it (200).
- **Fix:** Count aggregate ciphertext while reading; cap files/fields/parts, remove listeners and buffers on failure, drain rejected requests, admit four uploads per process.
- **Verification:** 413 after remediation; exact-limit, 51st-file, chunked, cancellation and repeated multipart tests pass.

### F02 — High — Backend

Affected: [src/services/archiveZip.ts:120](src/services/archiveZip.ts#L120).

- **Root cause / impact:** Bulk downloads buffered all source files plus the full ZIP; simultaneous downloads multiplied RSS.
- **Reproduction:** Generate three 100 × 1 MiB archives with original buffered ZIP creation.
- **Fix:** Stream sequential entries, retain central-directory metadata, apply backpressure and cancellation; four document download slots.
- **Verification:** SHA-256 identical for every before/after ZIP; cancellation test and encrypted HTTP round trip pass.

### F03 — High — Backend

Affected: [src/services/accountExport.service.ts:45](src/services/accountExport.service.ts#L45).

- **Root cause / impact:** Concurrent export reservation/preparation could duplicate expensive work, while archive generation, encryption and download each materialized large buffers.
- **Reproduction:** Issue simultaneous requests for one account and prepare/download a 100 MiB synthetic archive.
- **Fix:** Lock reservation, atomically claim jobs, serialize preparation, stream existing enc:v2 encryption to ciphertext-only disk and provider storage; two download slots. Authenticate the entire ciphertext before exposing a download stream.
- **Verification:** Concurrent callers share a job; owner isolation, ciphertext round trip, real S3 SDK stream tests and corruption rejection pass; peak RSS reduction below.

### F04 — High — Backend

Affected: [src/services/auth.service.ts:280](src/services/auth.service.ts#L280).

- **Root cause / impact:** Read-modify-write PIN counters lost concurrent failed attempts; twelve failures could leave a count of one.
- **Reproduction:** Submit twelve wrong PIN attempts concurrently; separately try the correct PIN after lockout.
- **Fix:** Perform bcrypt outside a short row-lock transaction, recheck verifier/lock state, atomically commit each failure before returning an error.
- **Verification:** Counter reaches five, correct PIN is denied while locked, expiry recovery passes in real PostgreSQL.

### F05 — High — Backend

Affected: [src/services/trustCenter.service.ts:385](src/services/trustCenter.service.ts#L385).

- **Root cause / impact:** Trust invitation PIN attempts and acceptance were vulnerable to the same concurrency race.
- **Reproduction:** Concurrent invalid PIN submissions and replay of accepted invitation.
- **Fix:** Lock/recheck invitation state, verifier and expiry; commit bounded attempts and one-time acceptance atomically.
- **Verification:** Concurrent lockout and acceptance replay regressions pass.

### F06 — High — Backend

Affected: [src/utils/jwt.ts:29](src/utils/jwt.ts#L29).

- **Root cause / impact:** Access JWT validation did not require issuer/audience/expiry with an explicit algorithm policy.
- **Reproduction:** Use wrong algorithm, wrong issuer/audience, absent/expired expiry and a tampered signature.
- **Fix:** Require HS256, expiry, readines-backend issuer and readines-clients audience; validate session/version claims.
- **Verification:** JWT negative cases pass. Old access tokens need refresh; no ciphertext or refresh-cookie format change.

### F07 — High — Backend

Affected: [src/services/auth.service.ts:1037](src/services/auth.service.ts#L1037).

- **Root cause / impact:** An access token was not bound to the refresh-session row, so per-session logout/rotation could leave access valid.
- **Reproduction:** Issue a real login token, rotate its refresh token or log out, then reuse its access token.
- **Fix:** Include sid in issued access tokens and check the corresponding unrevoked, unexpired session on authenticated reads.
- **Verification:** Both old access tokens are immediately rejected after rotation/logout in the session integration test.

### F08 — High — Backend

Affected: [src/middleware/postgresRateLimitStore.ts:7](src/middleware/postgresRateLimitStore.ts#L7).

- **Root cause / impact:** Process-local counters could be bypassed across serverless instances.
- **Reproduction:** Increment one logical key concurrently through two independent Prisma clients.
- **Fix:** Use atomic PostgreSQL counters in the existing WaitlistRateLimit table, HMAC scoped keys, bounded pruning and fail-closed errors; wire security limiters to shared store.
- **Verification:** Forty concurrent increments produce 1–40; scope, expiry, reset and hash isolation pass. No new remediation schema required.

### F09 — High — Backend

Affected: [src/services/pushNotifications.service.ts:4](src/services/pushNotifications.service.ts#L4).

- **Root cause / impact:** Stored Web Push endpoints could direct backend requests to private network targets; unrestricted fan-out also retained unbounded work.
- **Reproduction:** Try private IPv4/IPv6, localhost, userinfo, HTTP and nonstandard ports; inspect resolved outbound destination.
- **Fix:** Require HTTPS public endpoints, resolve and pin public DNS at connection time, set timeout, page subscriptions and send with concurrency five.
- **Verification:** Endpoint rejection and DNS/address validation regressions pass; no live notification was sent.

### F10 — Medium — Backend

Affected: [src/services/documentFileStorage.ts:139](src/services/documentFileStorage.ts#L139).

- **Root cause / impact:** Cleanup could remove an unexpired consumed temporary upload while a concurrent permanent copy still needed its encrypted file.
- **Reproduction:** Mark a synthetic upload consumed, run cleanup before expiry and read the file.
- **Fix:** Keep all unexpired temporary objects until TTL, including consumed rows.
- **Verification:** Dynamic local cleanup check passes; expired objects remain eligible for cleanup.

### F11 — Medium — Backend

Affected: [src/services/authRevocationCache.ts:1](src/services/authRevocationCache.ts#L1).

- **Root cause / impact:** A fast-rejection revocation cache could grow without a size bound.
- **Reproduction:** Insert many distinct revocations and inspect eviction/expiry behavior.
- **Fix:** Cap at 10,000 entries, sweep expired values and evict oldest; database remains authoritative.
- **Verification:** Authentication/session tests pass; eviction never grants access without the database check.

### F12 — Medium — Backend

Affected: [src/privacy/encryptedClient.ts:187](src/privacy/encryptedClient.ts#L187).

- **Root cause / impact:** The private-data facade fetched entire authorized result sets even when pagination used only operational fields.
- **Reproduction:** Observe SQL for an operational sort/take/skip query and compare with private-field filters/sorts.
- **Fix:** Push eligible operational pagination into SQL; retain post-decryption filtering/sorting where required for correctness.
- **Verification:** Real SQL LIMIT/OFFSET and exact result ordering verified; private filtering/sorting still preserves matching rows.

### F13 — Medium — Backend

Affected: [src/services/boundedRead.ts:3](src/services/boundedRead.ts#L3).

- **Root cause / impact:** Imports could buffer large provider responses and collect all Drive pages before processing.
- **Reproduction:** Stream more bytes than the cap without a reliable Content-Length; iterate multiple Drive pages.
- **Fix:** Bound stream reads, destroy on all exits, scan pages incrementally with three workers, cap Gmail candidates/base64 and provider timeouts; admit three imports.
- **Verification:** Overflow, source closure, exact-size, Drive/Gmail fixtures and admission cleanup pass. Live imports not tested; Gmail/Drive mounts remain disabled.

### F14 — Medium — Backend

Affected: [src/middleware/resourceLimits.ts:29](src/middleware/resourceLimits.ts#L29).

- **Root cause / impact:** AI tasks could retain concurrent original-file buffers and continue after HTTP response disconnection.
- **Reproduction:** Hold asynchronous work, exceed admission, then reject/cancel it.
- **Fix:** Bound document AI to four and package AI to five active tasks; hold slots until work really ends; forward document abort signal and wipe original buffers.
- **Verification:** Work-limit success/failure cleanup tests pass. These limits do not consume the user AI allowance.

### F15 — High — Frontend

Affected: [src/lib/auth.ts:25](https://github.com/simplelifepack/frontend-web/blob/codex/security-memory-performance-audit/src/lib/auth.ts#L25).

- **Root cause / impact:** Logout did not fully isolate caches and late HTTP/Redux results could restore private state from the previous session.
- **Reproduction:** Start refresh/data requests, log out, then resolve the old requests.
- **Fix:** Increment auth generation; reject stale HTTP/blob/stream responses; ignore prior-epoch Redux completions; invalidate request/search caches.
- **Verification:** HTTP, Redux session isolation and authenticated browser logout tests pass.

### F16 — High — Frontend

Affected: [src/packages/packageCatalogueCache.ts:8](https://github.com/simplelifepack/frontend-web/blob/codex/security-memory-performance-audit/src/packages/packageCatalogueCache.ts#L8).

- **Root cause / impact:** Persistent catalogue entries lacked account-scoped keys and a late write could repopulate cache after logout.
- **Reproduction:** Switch accounts with a populated IndexedDB cache and resolve a pending write after clearing.
- **Fix:** Key by JWT subject, upgrade IndexedDB and clear legacy unscoped pages, filter reads by current account, guard writes by auth generation.
- **Verification:** Account isolation, same-user refresh stability and stale write regressions pass.

### F17 — Medium — Frontend

Affected: [src/pages/documents/file-preview.tsx:3](https://github.com/simplelifepack/frontend-web/blob/codex/security-memory-performance-audit/src/pages/documents/file-preview.tsx#L3).

- **Root cause / impact:** Object URLs created during render could leak across StrictMode renders; obsolete preview downloads continued after unmount.
- **Reproduction:** Mount/unmount previews under StrictMode and resolve an obsolete preview request.
- **Fix:** Allocate URLs in effects and revoke in cleanup; abort obsolete preview/page downloads; apply the same lifecycle to upload previews.
- **Verification:** Object URL accounting and abort-on-unmount tests pass; styling and animations preserved.

### F18 — Low — Frontend

Affected: [src/pages/documents/document-actions.ts:3](https://github.com/simplelifepack/frontend-web/blob/codex/security-memory-performance-audit/src/pages/documents/document-actions.ts#L3).

- **Root cause / impact:** Malformed encoded download names could throw during download setup and leave resources allocated.
- **Reproduction:** Use a malformed percent-encoded filename and force a download error.
- **Fix:** Parse safely before allocating URLs and remove links/revoke URLs in finally.
- **Verification:** Document action and preview regression suite passes.

### F19 — Medium — Frontend

Affected: [public/readiness-sw.js:1](https://github.com/simplelifepack/frontend-web/blob/codex/security-memory-performance-audit/public/readiness-sw.js#L1).

- **Root cause / impact:** A backslash-containing apparent internal notification path could normalize into an external navigation.
- **Reproduction:** Test //host and /\host paths through actual URL parsing.
- **Fix:** Parse against a fixed/current origin and require identical origin in service worker and backend push payload handling.
- **Verification:** Service-worker VM and backend safe URL regression cases pass.

### F20 — Medium — Frontend

Affected: [src/pages/settings/BillingSection.tsx:32](https://github.com/simplelifepack/frontend-web/blob/codex/security-memory-performance-audit/src/pages/settings/BillingSection.tsx#L32).

- **Root cause / impact:** Superseded billing refreshes could finish late and overwrite newer subscription/pricing state.
- **Reproduction:** Trigger two billing updates, resolve newest first and oldest last; unmount during a pending read.
- **Fix:** Abort prior and unmounted reads and ignore aborted completion.
- **Verification:** Two dedicated billing race/unmount tests pass.

### F21 — Low — Frontend

Affected: [src/App.tsx:5](https://github.com/simplelifepack/frontend-web/blob/codex/security-memory-performance-audit/src/App.tsx#L5).

- **Root cause / impact:** Settings loaded eagerly in the initial route graph.
- **Reproduction:** Compare initial emitted JS and route module loading before/after.
- **Fix:** Lazy-load Settings using the existing route loading pattern, retaining design system and all workflows.
- **Verification:** Build and route regression pass; initial entry bundle change below, with shared API chunk still large.

### F22 — High — Both

Affected: [package.json:58](package.json#L58).

- **Root cause / impact:** Dependency audit reported 21 backend and 14 frontend advisories, including one backend critical.
- **Reproduction:** Run npm audit before remediation and inspect dependency/import reachability.
- **Fix:** Apply reviewed compatible patches; migrate Zod 4 record schemas and Nodemailer types; advisory-recommended Vercel Functions version, narrow Prisma deepmerge override; remove unused sanitizer dependency.
- **Verification:** Final npm audit: zero known advisories in each repository; Prisma generation, build, package bundling and regression tests pass. Zero advisories is not proof of exploit absence.

### Policy correction, not a vulnerability

The preliminary document-processing quota change was removed after the user clarified the product rule. Do not treat free document processing as a quota bypass. AI consent remains mandatory. Tests now establish the exemption, rather than enforcing a charge. Package search charging, atomic account limits and cancellation-before-provider refunds remain tested.

## C. Security test matrix

| Category | Result | Evidence and limits |
|---|---|---|
| API authentication inventory / admin boundaries | Pass | 147 protected operation probes in the full working tree reject anonymous calls; mounted inventory and OpenAPI alignment checked. Does not imply every role/path permutation was exercised. |
| Modified resource IDs / tenant isolation | Pass | Two-user document read/preview/download HTTP negatives; private domain suites cover cross-owner reads/writes and privileged boundaries. |
| JWT signature, algorithm, issuer, audience, expiry | Pass | Negative token suite; real issued session token rotation/logout integration. |
| Refresh rotation, replay, revoke, fresh authentication | Pass | Auth/session suites and sensitive account operation tests. |
| Account and invitation PIN brute force | Pass | Real PostgreSQL concurrent attempts, lock, expiry and replay. |
| Password reset and OTP expiry / attempt bounds | Pass | Auth email/session fixtures; real delivery is not exercised. |
| Google OAuth / DigiLocker state, replay, consent and ownership | Pass | Synthetic provider callback/state tests; provider scopes and encrypted credentials inspected. Live OAuth: Not Tested. |
| Gmail / Drive import bounds and token handling | Pass | Fixture tests and bounded readers; routes remain disabled. Live provider/revocation: Not Tested. |
| SQL injection / mass assignment / unsafe deserialization | Pass | Parameterized Prisma/raw-query source review, Zod boundary tests and static scan. Not an exhaustive dynamic injection campaign. |
| NoSQL injection | Not Applicable | No NoSQL query backend in the audited request flow. |
| XSS / prototype pollution / ReDoS | Pass | Input/schema, safe email template and dependency/static checks. Full browser payload fuzzing: Not Tested. |
| CSRF / CORS / security headers | Pass | Cookie/bearer boundary source/tests and local/production read-only headers; no wildcard credential origin introduced. |
| SSRF / path traversal / navigation normalization | Pass | Private IP and URL validation tests, public DNS pinning, safe storage paths and notification URL tests. Live DNS redirection pentest: Not Tested. |
| File signature, MIME, size, corrupted ciphertext | Pass | Document security/hybrid tests and real local encrypted upload/download. |
| GCM failure never exposes partial export plaintext | Pass | Complete authentication pass before stream is returned; corruption, wrong binding and existing-format tests. |
| Temporary plaintext / encrypted object ownership | Pass | Scoped transient analysis directories and cleanup tests; streamed export disk content is ciphertext only. |
| Shared rate limits / bounded work / request payloads | Pass | Two-client PostgreSQL atomic tests, multipart and admission tests. Admission excess deliberately returns 503. |
| Payment amount/plan/signature/state/idempotency | Pass | Ten synthetic Razorpay integration cases with real transactions, including raw HTTP webhook body. Real delivery: Not Tested. |
| Production Supabase RLS / grants / storage | Pass | Counts-only read-only SQL: zero tables without RLS, directly accessible browser tables, callable security definers, public buckets or browser storage policies. |
| Encryption-key recovery / backup restore | Not Tested | Architecture/history is not current restore evidence; no production key manipulation performed. |
| Dependency and source secret scan | Pass | Zero npm advisories both repos; Semgrep evidence records scope/parser limitations. Secret values never copied into report. |
| Independent penetration-test certification | Not Tested | Requires independent authorized engagement. |

Production counts additionally found zero missing private profile ciphertexts, zero missing private document filenames and zero unvalidated private constraints. Supabase's INFO “RLS enabled, no policy” findings are consistent with intentional deny-all browser access; the backend applies its own private-data authorization. These checks do not replace an application-level isolation test or backup restore.

## D. Memory and performance results

### Method and limitations

All mutation/load tests use new disposable PostgreSQL databases in `readines-audit-20261025`, loopback port 55439, synthetic users, generated test keys and local storage. Production records were neither reset nor deleted. Tests with fresh schemas reset only these explicitly disposable test schemas. Provider traffic is blocked in load tests. Admission and security thresholds were changed only in the test process as documented by the script.

Backend load client and server share one process, so CPU and memory include both. Login uses bcrypt cost 4 and files are tiny synthetic PNGs; these are not production capacity numbers. Request concurrency is a synchronized burst. Cold-connection resets observed on macOS are retained in `local-http-cold-connections.json`; the main run warms harmless health connections before mutating requests and records warmup resets. No cold failures were erased from evidence.

### Before / after resource measurements

| Measurement | Before | After | Compatibility / interpretation |
|---|---:|---:|---|
| 12 MiB aggregate multipart | HTTP 200 | HTTP 413 | Now rejects over-budget batches while reading. |
| ZIP peak RSS, 3 × 100 MiB archives | 592.78 MiB | 268.52 MiB | All ZIP SHA-256 values identical. |
| Encrypted export creation + verified download peak RSS | 870.19 MiB | 173.14 MiB | Same archive hash; enc:v2 unchanged, ciphertext-only spool. |
| Export elapsed time | 2454 ms | 2281 ms | Single synthetic run; full authentication adds two-pass download IO. |
| Original frontend entry JS / final | 646.51 kB (201.15 gzip) | See final build log (~510.5 kB, ~158.5 gzip) | Dependency patches and Settings splitting both contribute; API shared chunk remains >500 kB. |

Post-GC upload heap, five cycles (MiB): before 14.58, 13.01, 12.99, 13.05, 13.10; after 14.37, 12.83, 12.81, 12.88, 12.92. RSS can remain high because allocators retain pages; these short runs do not establish leak absence for every workload.

### Local burst load measurements

| Scenario | Requests | HTTP counts | RPS | p50 / p95 / p99 ms | Peak RSS / heap MiB | CPU ms | DB connections | Timeouts |
|---|---:|---|---:|---|---|---:|---:|---:|
| packages | 100 | 200: 100 | 516.6 | 188.6 / 190.5 / 190.7 | 335.69 / 134.81 | 462.7 | 19 | 0 |
| login | 100 | 200: 100 | 308.7 | 270.4 / 312.7 / 317.3 | 352.53 / 144.20 | 802.3 | 19 | 0 |
| mixed | 100 | 200: 100 | 588.3 | 125.9 / 165.5 / 167.0 | 359.20 / 155.40 | 535.5 | 19 | 0 |
| packages | 250 | 200: 250 | 983.1 | 246.2 / 249.5 / 251.6 | 383.11 / 165.16 | 767.3 | 19 | 0 |
| login | 250 | 200: 250 | 383.1 | 642.7 / 645.1 / 645.2 | 423.17 / 184.64 | 1738.2 | 19 | 0 |
| mixed | 250 | 200: 250 | 667.3 | 288.2 / 369.0 / 369.9 | 428.14 / 155.72 | 1332.0 | 19 | 0 |
| packages | 500 | 200: 500 | 988.8 | 405.3 / 488.7 / 494.6 | 423.77 / 189.06 | 1728.7 | 19 | 0 |
| login | 500 | 200: 500 | 419.4 | 1161.8 / 1177.0 / 1177.2 | 465.91 / 226.25 | 3413.8 | 19 | 0 |
| mixed | 500 | 200: 500 | 778.8 | 504.1 / 617.0 / 631.1 | 473.95 / 280.15 | 2522.1 | 19 | 0 |
| search | 100 | 200: 100 | 343.9 | 257.8 / 286.7 / 289.1 | 467.80 / 294.31 | 1259.5 | 19 | 0 |
| search | 250 | 200: 250 | 356.4 | 488.9 / 697.2 / 698.4 | 477.16 / 317.99 | 2873.4 | 19 | 0 |
| upload | 25 | 200: 4, 503: 21 | 272.8 | 49.8 / 90.3 / 90.4 | 472.55 / 323.04 | 122.9 | 19 | 0 |
| encrypted-download | 25 | 200: 4, 503: 21 | 450.1 | 33.6 / 55.2 / 55.2 | 465.31 / 295.56 | 75.4 | 19 | 0 |
| upload | 50 | 200: 4, 503: 46 | 549.4 | 72.5 / 89.4 / 90.6 | 461.31 / 321.54 | 144.3 | 19 | 0 |
| encrypted-download | 50 | 200: 4, 503: 46 | 576.1 | 65.3 / 86.5 / 86.7 | 461.44 / 328.05 | 124.7 | 19 | 0 |
| upload | 100 | 200: 4, 503: 96 | 633.7 | 140.3 / 140.4 / 157.5 | 449.92 / 340.36 | 237.4 | 19 | 0 |
| encrypted-download | 100 | 200: 4, 503: 96 | 882.9 | 88.4 / 89.8 / 113.1 | 447.92 / 340.87 | 174.2 | 19 | 0 |
| upload-download-cycle | 20 | 200: 8, 503: 12 | 271.7 | 46.0 / 73.3 / 73.3 | 443.17 / 314.39 | 110.9 | 19 | 0 |
| upload-download-cycle | 20 | 200: 8, 503: 12 | 232.6 | 53.8 / 85.6 / 85.6 | 484.05 / 97.64 | 120.3 | 19 | 0 |
| upload-download-cycle | 20 | 200: 8, 503: 12 | 238.6 | 48.0 / 83.5 / 83.5 | 470.66 / 92.96 | 120.3 | 19 | 0 |
| upload-download-cycle | 20 | 200: 8, 503: 12 | 234.1 | 54.1 / 85.4 / 85.4 | 464.52 / 92.22 | 125.8 | 19 | 0 |
| upload-download-cycle | 20 | 200: 8, 503: 12 | 241.5 | 50.1 / 82.0 / 82.0 | 448.58 / 92.05 | 125.6 | 19 | 0 |

The main run records 59 GC events totaling 311.2 ms. Post-GC heap across repeated cycles: 81.50, 77.51, 76.54, 76.33, 76.41 MiB.

All main-run login/packages/mixed/search bursts returned 200 with no request errors or timeouts. File bursts return 503 with Retry-After when four process slots are occupied: this is controlled overload, **not** evidence that 100 simultaneous file transfers are supported. No 429/500 occurs in this capacity run because security rate thresholds were raised for the synthetic run. Production throughput depends on instance count, DB pooling and provider/storage latency.

AI generation 10/25/50: **Not Tested** against real providers. No mock timing is presented as real AI performance. Package/Health/Wealth/admin queries have functional coverage, but large-data query plans and production N+1/long-query profiling remain unverified. Operational pagination improves one demonstrated bottleneck; private-field sorts/filters and account-export metadata may still materialize authorized rows, deliberately preserving completeness.

### Browser measurements

Authenticated local API browser run: 40 navigations across Home, Packages, Documents, Health, Wealth, Family, Legacy and Settings; no page errors or failing API responses; logout succeeded. Empty synthetic account, development build, forced GC after each eight-route cycle. Heap samples and network results are in `browser-authenticated.json`. This is short-session evidence, not a production retention guarantee.

The original `browser-landing.json` measurements showed a session-error screen because production API traffic was blocked. They are **invalid as landing LCP/CLS evidence** and must not be used to claim a landing performance gain. Corrected production-build measurements are recorded in `browser-landing-valid.json`: actual landing renders through a temporary loopback TLS proxy to the disposable API, with external providers blocked. One cold sample before/after: LCP 420 / 184 ms, CLS 0.000987 / 0.000987, no page errors. These are lab observations, not a stable causal/field performance claim. The original-code comparison uses current patched dependencies; original dependency build entry size is reported separately. The observed single sign-in click interaction was 80 / 48 ms before/after, using nonzero interaction IDs. This is a one-interaction lab sample, not production field INP. Authenticated INP and React render counts remain Not Tested. Existing Poppins, themes, responsive layout, design components and animations were preserved.

## E. Regression results

- Backend non-integration suite: 47 files; final status is recorded in `backend-test-files.json`. One interim run had an auth welcome-email timing failure under local contention; the fixture now waits for actual delivery before asserting. No production behavior was changed to satisfy it.
- Frontend: 52 files / 253 tests pass with one worker and normal assertion logic; timeout allowance 20 s for the constrained local machine. Interim parallel runs had three timeouts, retained in execution history. Dedicated billing race/unmount suite: 1 additional file / 2 tests pass.
- Privacy: seven fresh-schema suites plus the full encryption/export migration integration pass. Includes authorization, serialization, private operational fields and all major data domains.
- Payment: ten Razorpay cases pass with synthetic provider and real PostgreSQL; no real charges or webhook configuration changes.
- PIN concurrency, session revocation, shared throttling, SQL pagination, export streaming and document-processing allowance policy integrations pass separately.
- Four legacy quota/manual HTTP integration suites pass; tests initialize explicit fixture capabilities. HTTP owner scopes remain enforced. Privileged fixture setup is not presented as HTTP isolation evidence.
- Backend build/Prisma generation and frontend TypeScript/Vite build pass. OpenAPI validates 168 operations without empty enums or missing component examples.
- ESLint remains **Fail**: backend seven inherited max-lines errors; frontend seven inherited max-lines errors plus one inherited admin effect dependency warning. These are recorded, not hidden with suppressions or large unrelated rewrites.
- Semgrep security/secrets scan: backend zero findings across 278 files; frontend zero findings across 406 files with three partial parser warnings. JSON reports preserve errors and scanned file lists. Static absence of findings is not certification.
- ZAP passive API scan completed: 0 failures, 119 passing checks, 2 warnings. Reviewed warnings are expected 5xx from deliberately disabled test providers/configuration and a generic “Internal server error” phrase, with no stack or sensitive provider payload disclosed. JSON/HTML and triage are retained. This was an unauthenticated local scan; authenticated coverage comes from separate tests.

Existing lint blockers: backend `ai/providers/openai.ts`, `routes/packs.routes.ts`, `scripts/importDefaultPackagesFromEvents.ts`, `services/adminPackages.service.ts`, `services/drive/scanner.ts`, `services/email/emailService.ts`, `services/health.service.ts`; frontend `components/Landing.tsx`, `pages/admin/packages/index.tsx`, `pages/health/HealthDialog.tsx`, `pages/health/HealthPage.test.tsx`, `pages/health/records/RecordDetailModal.tsx`, `pages/trust/index.tsx`, `pages/wealth/capture-proof-dialog.tsx`. Admin package editor also has the existing effect warning. Split these in a dedicated behavior-preserving cleanup if a lint-clean release gate is required.

## F. Remaining actions and recommendations

1. **Production release approval:** review the complete uncommitted diff, separate upstream source changes, deploy backend/frontend together, and verify login refresh, PIN, files and payment state. New issuer/audience checks reject legacy access tokens; clients should refresh through the existing cookie flow. Do not claim local tests establish deployed behavior.
2. **Recurring billing:** provision/verify correct INR monthly/annual Plans and a webhook signing secret, then configure delivery and run real provider test lifecycle checks. Do not infer entitlements from a hosted test button. Do not invent credentials or Plan IDs.
3. **Secrets:** review admin bootstrap variable classification/removal and current key version/recovery process without exposing values. Perform a controlled restore to an isolated target and verify encrypted object recovery before signing off backups.
4. **Load/platform:** verify connection limits across actual serverless instance counts. Process-local admissions bound memory per instance; shared DB counters enforce rate limits across instances. Measure large-file throughput, long sessions, private-query plans and realistic bcrypt/provider latency before a capacity claim.
5. **Provider regressions:** use dedicated authorized accounts for Google/DigiLocker imports, token revocation and real AI 10/25/50 load. Keep Gmail/Drive disabled until intentionally released; this audit does not silently enable them.
6. **Browser/independent review:** collect valid landing/authenticated production LCP/CLS, interaction INP, render counts and a longer retained-object profile with realistic records; complete independent penetration testing.
7. **Remaining static cleanup:** address inherited max-lines/effect lint failures through focused follow-up without changing UI/design or weakening rules.

### Evidence and reproducibility

Machine-readable evidence is under [docs/security/audit-evidence](docs/security/audit-evidence/). Benchmark sources: `src/scripts/securityPerformanceAudit.ts`, `src/scripts/auditResourceBenchmark.ts`, `src/scripts/auditExportMemory.ts`. They deliberately restrict disposable target selection; use synthetic keys and explicit test environments. Never run destructive fixture/schema setup against production or Preview. Synthetic credentials and key files remain outside the repository; no secret-bearing env files are included in evidence.

Primary review references: [OWASP API Security Top 10 2023](https://api-security.owasp.org/editions/2023/en/0x11-t10/), [OWASP ASVS](https://asvs.owasp.org/), [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security), [Zod 4 migration guide](https://zod.dev/v4/changelog).
