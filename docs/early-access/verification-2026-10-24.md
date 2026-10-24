# Domain-based early access — local verification

Date: 2026-10-24. Initial local verification is below; see the authorized migration/push follow-up at the end for the current production migration and Vercel configuration state.

## Implementation

Frontend: `/Users/ranjith/code/frontend-web`.
Backend: `/Users/ranjith/.codex/worktrees/ed2c/backend`.

- `DomainAccessGuard` resolves the hostname before mounting the full application. Production and unknown hosts mount only the landing page; the session bootstrap and checkout controller do not mount. All application routes remain in place.
- `readines.com` and `www.readines.com` always use early access, even if accidentally included in the development configuration.
- `localhost`, loopback addresses, and `frontend-web-nine-amber.vercel.app` retain the full application. Additional preview/staging hostnames require exact entries in `VITE_FULL_ACCESS_HOSTNAMES`; there is no wildcard trust of Vercel URLs.
- Added `/dashboard` as an authenticated alias for the existing `/home` page.
- All five landing registration CTAs open the same email modal. The modal uses existing design-system primitives, focus management, and tokens. No CSS classes, inline styles, or stylesheet changes were added. Existing landing backgrounds, animations, layout, features, and pricing comparison remain. Early access paid pricing says “At launch” and avoids billing API requests; the full application retains server pricing and Razorpay behavior.
- Production-host Vercel redirects send non-public paths to `/` before the SPA rewrite, while retaining landing assets and the service worker. These use Vercel's documented conditional host matching: https://vercel.com/docs/project-configuration/vercel-json . Actual edge behavior must be smoke-tested after an approved deployment; conditional rules cannot be exercised by the local unit tests.
- Backend CORS allows exact production origins, the named Vercel origin, localhost port 5173, and explicitly configured additional origins. Arbitrary localhost ports and arbitrary Vercel hosts are no longer allowed implicitly.
- A server middleware rejects production-origin requests outside the public waitlist endpoints. This is a browser access policy, not authentication: Origin can be omitted or forged by non-browser clients. Existing endpoint authentication/authorization remains required and unchanged. Server/mobile/webhook calls without Origin retain their existing behavior.

## API and persistence

- `GET /api/waitlist/challenge`: ten-minute signed, IP-bound, single-use proof-of-work challenge (12 leading SHA-256 zero bits).
- `POST /api/waitlist/register`: normalized email, `challenge`, decimal `solution`, and an empty optional `website` honeypot.
- `POST /api/waitlist/unsubscribe`: signed token from the email link. Visiting the landing-page unsubscribe link opens a confirmation modal; only explicit submission changes consent.
- Prisma migration `20261024090000_early_access_waitlist` adds registration, consumed-proof, and rate-limit tables with supporting indexes. The registration email has a unique constraint and a database normalization check.
- Stores registration time, consent status, unsubscribe time, confirmation outcome, attempts, next attempt time, accepted message ID, and confirmation send time.
- Unique inserts suppress duplicates and concurrent sends. Re-registering an unsubscribed address does not restore consent or send another confirmation.
- Database-backed limits: 60 waitlist requests/IP/hour and 5 valid registration submissions/email/hour. IPv6 limit keys use the existing library’s subnet normalization. Rate-limit keys are HMAC digests; raw IP addresses are not stored.
- Confirmation uses the existing SMTP provider abstraction, including the existing Brevo SMTP configuration. `sent` means SMTP accepted the message, not confirmed inbox delivery.
- Atomic delivery claims prevent concurrent retry workers from sending twice. Only pending delivery or definite rejection/pre-send failure can be retried, with a one-hour cooldown and maximum three attempts. Timeouts/ambiguous delivery remain `unknown`; interrupted claims remain `sending`. Neither is automatically retried. Reconcile these with Brevo logs before any manual status adjustment.
- Retry/cleanup command: `node --import tsx src/scripts/retryWaitlistEmails.ts`. It processes up to 100 eligible registrations and removes expired proof/rate records. It is intentionally not scheduled or deployed automatically.

## Environment matrix tested locally

| Host / path | Result |
| --- | --- |
| `readines.com/` and `www.readines.com/` | Public landing only |
| Production `/login`, `/dashboard`, `/packages`, `/documents/a`, `/checkout`, `/forgot-password` | Redirect to `/`; private application never mounts |
| `localhost` and `127.0.0.1`: login/dashboard/packages/documents/checkout | Full application subtree and requested URL preserved by domain guard |
| `frontend-web-nine-amber.vercel.app`: same paths | Full application subtree and requested URL preserved by domain guard |
| Configured staging/preview hosts | Exact hostname accepted |
| Unknown host, unconfigured Vercel host, hostname suffix lookalike | Public experience; no application mount |
| Production browser origins → application/auth APIs | HTTP 403 |
| Localhost, named Vercel, configured preview → protected API | Existing authentication requirement retained (HTTP 401 without credentials) |
| Anonymous no-Origin call → protected API | Existing authentication requirement retained |

These hostname checks use local router/component tests, not requests to deployed websites. The existing authentication and application route components continue to decide access within the full application. No authenticated browser session on a deployed domain was tested.

## Checks and results

- Backend build / Prisma client generation: passed. Used a copied local Prisma engine cache because the sandbox could not write the normal shared cache or download engines.
- Backend TypeScript: passed.
- OpenAPI validation: passed, 132 documented operations including the three new public waitlist operations.
- New backend files and CORS middleware focused ESLint: passed.
- New migration executed successfully against disposable PostgreSQL 17 on `127.0.0.1:55439`, database `waitlist_test`.
- Waitlist HTTP/database integration: 8 tests passed. Covers concurrent registration, normalization, duplicate/no-repeat behavior, invalid/replayed/expired/IP-mismatched proof, honeypot, explicit/idempotent unsubscribe, safe retry cooldown/cap/concurrency, ambiguous email outcomes, atomic rate limits, and origin policy. Used the actual Prisma/database path and a test email-provider override; no real email was sent.
- Frontend production build: passed; existing large-bundle warning remains.
- Frontend TypeScript: passed.
- Frontend focused tests: 76 passed across hostname routing, landing/auth/recovery, waitlist UI and request/proof handling, checkout, app-shell access, Google sign-in, and auth storage.
- New frontend files focused ESLint: passed.
- Existing backend email-configuration and refresh-cookie tests: 2 passed.
- `git diff --check`: passed for both repositories.

An additional existing `authSession.test.ts` attempt could not run because this worktree has no `DATABASE_URL`. That test requires the full application database/credentials and was not pointed at production or the waitlist-only test schema. Full backend regression, real Brevo delivery, actual Razorpay payment, and deployed-host/edge smoke tests remain unverified.

## Required configuration before an approved release

1. Apply the new migration through the normal reviewed migration process. Only the disposable local database was migrated here.
2. Set a dedicated random `WAITLIST_SECRET` of at least 32 characters. Keep it stable: changing it invalidates outstanding unsubscribe links and challenges. Missing configuration returns HTTP 503 from the waitlist API.
3. Use the existing SMTP/Brevo credentials and sender; set `WAITLIST_PUBLIC_URL=https://readines.com`. Confirm a real registration email with an approved test recipient after configuration.
4. Configure additional exact frontend hostnames with `VITE_FULL_ACCESS_HOSTNAMES` and matching backend origins with `CORS_PREVIEW_ORIGINS`, `CORS_LOCALHOST_ORIGINS`, or existing `CORS_ORIGINS`.
5. Preserve the existing `VITE_API_URL` configuration and approved HTTPS API endpoint. Verify the existing `TRUST_PROXY` setting matches the hosting proxy topology so `req.ip` identifies clients correctly; do not trust arbitrary forwarding headers.
6. After an approved deployment, verify both production host redirects/assets, the named full-access Vercel hostname, real email receipt/unsubscribe, and authenticated application/payment behavior.

The frontend already contained substantial unrelated local changes before this task. Those were retained. Backend and frontend changes remain local and uncommitted.

## Authorized migration and push follow-up — 24 October 2026

The user subsequently authorized migrations, Vercel environment configuration, and pushing all current frontend/payment changes. The earlier “local only” statements describe the initial implementation phase.

- Combined the existing payment implementation from `/Users/ranjith/code/backend` with this worktree's waitlist implementation; preserved the frontend's earlier design-system/application changes.
- Waitlist email is now stored as authenticated ciphertext in `private_email`, using the existing privacy encryption keys, with an independently keyed equality token in the unique email column. Plaintext email and provider message IDs are excluded from generic operator projections. The privacy classification suite passes.
- Added a third migration, `20261024170000_private_waitlist_billing_tables`, enabling RLS and revoking public/anon/authenticated table grants for all six new tables. Backend connections retain their existing database permissions.
- Validated all 86 repository migrations against fresh disposable PostgreSQL. Waitlist HTTP/database suite: 8 passed; billing transaction/HTTP suite: 10 passed; billing/privacy/error unit suite: 18 passed. OpenAPI now covers 138 operations.
- Verified the existing production project mapping against `docs/privacy/production-maintenance-preparation.md`. All 83 prior production migration checksums matched. Applied the three new migrations atomically through the connected Supabase project `readiness` (`izsujcwyuirkzkafhfnp`), with exact corresponding Prisma migration names/checksums recorded for the normal Vercel migration runner. Verified all three completed, six tables have RLS, no direct browser-role grants exist, and both existing ownership constraints remain intact.
- Excluded the unrelated generated `20261016072517` migration that drops 19 indexes and two ownership constraints; it was never part of the production migration history. Generated PDF output was also excluded from source control.
- Saved `WAITLIST_SECRET`, `WAITLIST_PUBLIC_URL`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_TEST_PAYMENT_BUTTON_ID` to the existing backend Vercel project for Production and Preview. Secret values were passed via stdin and are not committed. No recurring Plan IDs or webhook secret were available to upload.
- A read-only Razorpay Plans request using the exact configured test pair returned HTTP 401. The hosted test button does not require that pair and remains the existing test-payment path; it does not grant recurring subscription entitlements.
- Fixed the full-access `/login` session race: when already authenticated, LandingRoute now lets the authenticated redirect take precedence over consuming old auth-modal navigation state. All 12 session tests pass.
- Full frontend regression initially reported 208 passed / 4 failed. The session failure was fixed and its complete suite passed. Three previously documented UploadDocumentModal assertions remain failing; they are unrelated to domain/waitlist/billing changes. Focused hostname, landing, waitlist, request/proof, checkout, and session checks pass.
- Full lint retains seven existing file-length errors in each repository and an existing frontend hooks warning. Focused new-file lint, type checks, builds, OpenAPI checks, and diff checks pass. The frontend pre-push hook runs this full lint baseline; its known failure is recorded for the authorized source push.

No manual Vercel deployment or real payment/confirmation email was initiated. Pushing the configured Git production branch may trigger the project's normal Vercel deployment integration.
