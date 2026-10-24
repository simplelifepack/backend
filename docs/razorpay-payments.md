# Readines Razorpay integration

## Delivery state

Implemented locally. No commit, deployment, live charge, application-database migration, or Razorpay account mutation was performed. Real Razorpay Test-mode checkout/webhook delivery remains pending test credentials, Plan IDs and a reachable webhook endpoint. The existing backend environment was checked for variable presence only; none of the five Razorpay variables below were configured.

## Reference analysis and architecture

Inspected `/Users/ranjith/kpr/be/src/services/razorpay.service.ts`, payment controller/routes and Order model. The reference creates one-time orders using client-provided amounts and verifies an order/payment HMAC before optionally marking a MongoDB order paid. It lacks the recurring subscription lifecycle, server-owned catalogue, subscription ownership checks, captured-invoice entitlement proof, durable idempotency and reconciliation needed here. Its useful HMAC/timing-safe verification pattern was independently implemented; its controller/model were not copied.

Readines already uses PostgreSQL/Prisma, database-backed bearer authentication, a free/paid `User.accountTier`, and account-locked storage/AI quotas. Monthly and annual automatic renewal require Razorpay Subscriptions rather than one-time Orders. Checkout creates/reuses a recurring subscription, never a client-priced order. Prices are centralized in `src/services/billing/catalogue.ts`: monthly 24,900 paise; annual 199,900 paise; INR, interval 1; annual equivalent rounded to ₹167/month and savings ₹989. Provider Plan amount, currency and interval must match before creation. Razorpay requires a finite `total_count`; initial mandates cover 120 monthly or 10 annual billing cycles (ten years), then complete and need a new mandate.

Official references reviewed: [subscription integration](https://razorpay.com/docs/payments/subscriptions/integration-guide/), [webhook signatures/idempotency](https://razorpay.com/docs/webhooks/validate-test/), [subscription events](https://razorpay.com/docs/webhooks/subscriptions/).

## APIs

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/api/billing/plans` | Public prices, intervals and configuration availability; no secret or provider Plan ID |
| POST | `/api/billing/checkout` | Auth required; body `{ "plan": "annual" }` or monthly; rejects amount/extra fields; creates/reuses own subscription |
| POST | `/api/billing/verify` | Auth required; Razorpay payment/subscription/signature fields; verifies `payment_id|stored_subscription_id` and reconciles provider records |
| GET | `/api/billing/subscription` | Auth required; reconciles and returns own tier/subscription |
| POST | `/api/billing/cancel` | Auth required; cycle-end cancellation with paid time remaining, immediate cancellation otherwise |
| POST | `/api/billing/webhook` | Raw JSON, `X-Razorpay-Signature`, `X-Razorpay-Event-Id`; no bearer token; signature is mandatory |

All six operations are included in OpenAPI. Billing responses are not cached. Webhook parsing is mounted before the application's JSON parser. Existing shared request/auth/refresh-cookie handling is reused by the frontend.

## Database and security

Additive migration: `prisma/migrations/20261024160000_razorpay_billing/migration.sql`.

- `User.billingManaged` defaults false, preserving existing manually provisioned paid users.
- `BillingSubscription`: user ownership, plan/price snapshot, provider IDs, state, billing period, next charge, verified paid-through and cancellation flag.
- `BillingPayment`: unique provider payment ID, associated subscription/invoice, canonical amount/currency, status/refund and verified billing period.
- `BillingWebhookEvent`: unique event ID, SHA256 payload hash, event type and processed timestamp. Raw payload is never retained.
- A partial unique index allows only one unresolved/renewing subscription per user. Existing User row locks serialize checkout and entitlement changes. Webhook event insertion and updates are atomic, with event-level advisory locks.
- Provider plan checks, ownership, HMAC verification, captured status, invoice/payment/order/subscription linkage, full expected amount/currency, non-refund and paid billing dates are required for paid access. Mandate authorization, browser success or `subscription.active` alone are insufficient.
- Backend quotas independently enforce expiry whenever used. Cancelled/failed renewal does not erase already verified paid time. Refunded billing periods cease to qualify. No module locks were added; free allowances are unchanged.
- Duplicate events/payments cannot extend access again. Current provider state is fetched to avoid stale webhook ordering. Scheduled reconciliation and status lookups recover missed events.
- An API timeout after subscription creation is ambiguous: the persisted attempt survives, and retry searches provider subscriptions by its opaque attempt ID. It never blindly creates a second mandate. A definitive provider rejection releases the attempt. If an ambiguous attempt cannot be found, checkout intentionally requires provider/support reconciliation; do not manually clear it without checking Razorpay.
- Billing tables retain only canonical public prices, provider linkage and entitlement bookkeeping, not card/bank/payer data or payment secrets. Generic operational projections expose only minimal identity/bookkeeping fields. Existing private-user authorization is used for User writes, including signed webhooks.
- Account deletion cancels renewal under the same user lock/transaction as scheduling deletion; final deletion retries cancellation. Billing rows cascade on account deletion and webhook hashes retain no payer payload.

## Frontend

The existing Full-plan card fetches backend prices and retains its toggle/components/visual styling. The obsolete ₹1,499 early-member offer was removed to follow the explicit ₹1,999 annual requirement; automatic-renewal disclosure was added using existing Text. No new CSS/classes/inline styles/font/theme tokens were introduced.

The selected period is kept in sessionStorage through sign-in, signup and PIN setup. The global checkout controller waits for authenticated initialization, then opens Razorpay Standard Checkout using only the backend public key and subscription ID. Dismissal/failure supports explicit retry using the existing subscription. Success is reported only after backend verification; pending confirmation is surfaced without requesting another payment. Usage is refreshed from the backend. Settings reuses existing Section/Content/Stack/Text/Button/Choice components for billing status, checkout, refresh and renewal cancellation. CSP permits required Razorpay scripts/frames/connections.

## Configuration and setup

Backend only:

```dotenv
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...
RAZORPAY_MONTHLY_PLAN_ID=plan_...
RAZORPAY_ANNUAL_PLAN_ID=plan_...
```

1. Configure the two API credentials in the backend environment; never add the secret to a Vite variable or frontend bundle.
2. Run `npm run billing:setup-test-plans` from this backend. The command refuses live keys, reuses matching existing Plans and prints only Plan IDs. Save the returned IDs in the backend environment. Plan setup does not charge anyone. It was not run against Razorpay here because credentials are absent.
3. Apply normal Prisma migration deployment to the intended environment after reviewing the additive migration. Only the isolated test database was migrated in this task. Do not run a reset.
4. In Razorpay Dashboard Test mode, enable Subscriptions, verify the two Plans are ₹249 monthly and ₹1,999 yearly, quantity 1 and no additional offers/add-ons.
5. Add webhook URL `https://<backend>/api/billing/webhook` and a strong independent secret matching `RAZORPAY_WEBHOOK_SECRET`. Subscribe to subscription.authenticated, activated, charged, updated, pending, halted, cancelled, completed, paused and resumed; payment.failed, payment.captured and payment.refunded; refund.processed. Expired state is also reconciled by status/job lookups.
6. Use a reachable staging HTTPS endpoint or a supported local tunnel. Razorpay cannot deliver directly to localhost and currently blocks several common tunnel domains; check its current webhook documentation. No endpoint was published automatically.
7. Run `npm run billing:reconcile` from a trusted scheduled worker (for example hourly). It retries current subscription state without initiating charges and exits nonzero on failures. Webhooks remain the primary renewal signal; quota expiry does not depend on this worker.
8. Complete real Razorpay Test-mode annual/monthly payments, failure/dismissal/retry, cancellation, renewal failure/recovery and signed webhook retries. Do not use live cards/keys for validation.

## Validation evidence

Artifacts and logs: `/Users/ranjith/.codex/visualizations/2026/10/24/01a16d42-a440-7293-8cec-139f325848a6/readines-billing/`.

- All repository migrations plus the billing migration applied successfully on a newly created isolated PostgreSQL database; no application data was touched.
- Billing integration suite: 10/10 passed with real Prisma transactions/HTTP authentication and a synthetic Razorpay boundary. Includes both prices, concurrent checkout, signatures/ownership, activation, duplicate verification/webhooks, stale events, refunds, renewal, expiry without webhook, legacy paid users, provider outages and ambiguous-create recovery; forged HTTP amounts are rejected and raw JSON signature bytes are preserved.
- Backend unit/privacy/security suites: 27/27 passed. Existing standalone Google/session integration scripts require their own configured database/auth fixtures and were not established as passing in this environment.
- Frontend checkout controller tests: 7/7 passed. Landing/Google tests: 10/10 passed. Broad suite initially reported 155 passed/7 failed under high concurrency; rerunning the affected files serially passed Landing, AppShell and Health (13 passed), leaving three pre-existing UploadDocumentModal assertions failing.
- Playwright: eight annual/monthly × 390/1440 × light/dark cases passed for pricing, sign-in handoff, simulated checkout, backend-response confirmation, Settings cancellation and overflow; zero page errors. Screenshots are synthetic UI evidence, not real Razorpay payments.
- Frontend build passed with the existing large-chunk advisory. Backend build passed. OpenAPI validation passed (135 operations). Final compiler/lint outputs are included alongside this report.
- Full lint retains existing max-lines violations in large application files (seven backend errors; seven frontend errors and one existing hooks warning); newly added frontend billing files pass focused lint. No unrelated refactor was made to silence these baselines.

Real Razorpay Test-mode checkout, provider cancellation/renewal and network-delivered webhook validation remain pending configuration. Therefore this is implemented and locally validated, not yet provider-certified end to end.


## Local runtime follow-up (24 October 2026)

The running API on port 4000 was using `/Users/ranjith/code/backend`, while the integration initially existed in the c224 worktree. Both checkouts had the same Git base. Applied only the billing integration to the active checkout, preserved its unrelated untracked files, regenerated its Prisma client, and applied the additive billing migration to its configured local database (port 5434). The statements above saying the application database was not migrated describe the initial delivery; the local database has now been migrated. No production migration or deployment occurred.

Verified `GET http://localhost:4000/api/billing/plans` returns HTTP 200 and allows the frontend origin. The active environment contains test API credentials, but Razorpay's Plans API returned HTTP 401 with `Unauthorized` using that exact pair. The test Plan setup command therefore failed safely and no subscription/charge was created. Webhook secret and Plan IDs remain missing. Replace the matching test API pair before retrying setup; do not fabricate Plan IDs or bypass backend availability checks.

Authentication regression: protected-route redirects previously persisted `authMode: signin` in browser history. Protected redirects now return to the landing page without opening authentication; explicit login/signup requests consume their navigation state once. Playwright verified default landing, protected redirect and reload stay closed; explicit Sign in, /login and Start free open authentication. Actual pricing was fetched from the local backend, not a billing fixture. Frontend TypeScript and 12 focused landing/checkout tests passed.


## Supplied hosted test button

Configured `RAZORPAY_TEST_PAYMENT_BUTTON_ID=pl_TroJQy6559FmHg` at the user's request. Razorpay's public button preferences endpoint confirmed `is_test_mode: true`. Public catalogue now returns this ID and allows the explicit CTA to proceed despite the unavailable subscription API credentials. After authenticated initialization, the existing checkout controller renders the exact payment-button.js embed in an existing design-system modal. It does not call the recurring subscription API or grant paid access from this hosted test flow. The Razorpay-configured button amount is disclosed separately from the selected plan; this one shared test button is not two independently configured recurring Plans.

Playwright verified the actual vendor widget renders 'Pay Now / Secured by Razorpay', displays Test Mode, opens only after explicit CTA/authentication, fits a 390px viewport, and closes without leaving a dialog. No payment was submitted. TypeScript, focused lint, build and 13 focused tests passed. Hosted test payments do not activate or renew the Full plan; verified account-linked recurring billing still needs valid API credentials and Plan/webhook configuration.

## Combined early-access release preparation — 24 October 2026

The user authorized applying migrations, saving payment test configuration to Vercel, and pushing all source changes. The billing source was combined with domain-based early access in the ed2c worktree. The billing and waitlist migrations were applied to the verified production Supabase project, together with a new migration enabling RLS and revoking browser-role grants on their tables. Existing ownership constraints and query indexes were preserved. The available Razorpay test API pair and hosted test-button ID were saved to the existing backend Vercel project's Production and Preview environments; no secrets were committed. The exact API pair still returns HTTP 401 on a read-only Plans request. Recurring Plan IDs and the webhook secret remain absent, so recurring billing is not available. The hosted test-payment button remains independent and does not activate recurring entitlements. See `docs/early-access/verification-2026-10-24.md` for combined verification and migration details.
