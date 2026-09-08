# Readiness account usage implementation

Implemented across the existing backend, PostgreSQL schema, web frontend, and mobile package-request boundary. Validation completed September 8, 2026. Existing unrelated working-tree changes were preserved.

| Account | Retained document storage | Public/package AI |
| --- | --- | --- |
| `free` | 52,428,800 bytes (50 binary MB) | 3 actions per UTC calendar month |
| `paid` | No application quota | No action quota |

All authenticated modules remain accessible. There is no payment gateway, checkout, subscription framework, or client-accessible tier setter.

## 1. Forward migrations

- `20260907090000_account_usage_limits`: adds PostgreSQL `AccountTier`, `User.accountTier`, and `user_ai_usage`.
- `20260907093000_storage_cleanup_queue`: adds `storage_cleanup` so obsolete objects remain accounted until physical deletion succeeds.

Both were tested in rolled-back transactions with unchanged user/document counts, then applied successfully to the existing local database. All 41 preceding migrations were already applied. Historical migration files were not rewritten. No production database was changed.

## 2. Account tier

`User.accountTier` is the enum `free | paid`, defaulting to `free`. The live schema had no surviving paid-status field or billing tables; the previous migration had already removed them. Existing and new users therefore deterministically default to free. Authentication/current-user responses expose the tier, and quota services independently read the authenticated user's database row. Tier promotion is an administrative database operation; no API request body can set it.

## 3. Canonical storage calculation

`accountUsage.service.ts` defines `FREE_STORAGE_LIMIT_BYTES = 50 * 1024 * 1024` and `storedBytes()`.

Usage is the sum of retained file bytes, grouped by physical storage key across `Document`, `DocumentFile`, and pending `storage_cleanup` rows. The parent document aliases the first page, so that alias is counted once. Every additional stored scan page is counted. `encryptedSize` is authoritative for current files and includes the AES-GCM tag; legacy rows fall back to recorded `size`. The audited local database contained three documents and no retained documents missing `encryptedSize`. No downloads are needed to display usage.

Drive currently downloads temporarily for local extraction, then retains a link and metadata with an empty storage key/path. It contributes zero retained file bytes. Gmail attachments and supported message imports become quota-bearing documents only when saved from review through the shared document save route. Temporary encrypted review uploads are staging, excluded from permanent storage; their database validity is 30 minutes. Existing temporary-file cleanup behavior remains separate.

There are no separately persisted thumbnail/preview copies in the audited upload path. Browser previews and isolated processing files do not add permanent storage. Soft-deleted records with retained file references remain counted until physical removal, rather than silently treating retained data as free space.

## 4. Concurrent storage enforcement and failure handling

Finalization runs under a PostgreSQL transaction that locks the user's row with `SELECT ... FOR UPDATE`, calculates retained usage, and checks incoming server-recorded encrypted bytes before any permanent storage upload. Document creation/replacement, page records, and temporary-upload consumption commit together. Replacement ownership and its current state are checked under the same lock. Other accounts can proceed independently.

Two uploads cannot pass a stale allowance check. Duplicate temporary references are rejected; duplicate content review follows existing behavior. Rejected quota requests neither consume temporary uploads nor create permanent objects/documents. A multi-page storage failure rolls back database changes, cleans newly written objects, and preserves staging files for retry. If cleanup fails, known retained objects enter the cleanup queue and continue counting toward usage.

Deletion queues every page and removes the document transactionally, then removes physical objects. Failed physical deletions remain counted. Cleanup retries on usage refresh and the next save; Drive replacement uses the same accounting lock and queue. The API can return a successful logical deletion while usage remains occupied during a storage-provider outage, until physical cleanup succeeds. Storage writes and PostgreSQL are separate systems; abrupt process termination during an external write was not fault-injection tested.

## 5. Storage error contract

HTTP 429, with stable fields at the top level:

```json
{
  "success": false,
  "code": "STORAGE_LIMIT_EXCEEDED",
  "message": "This upload would exceed your 50 MB cloud storage limit.",
  "usageBytes": 43000000,
  "limitBytes": 52428800,
  "incomingBytes": 12000000
}
```

Numbers come from backend accounting, never the submitted `size`, tier, or unlimited flags. Existing per-file security/resource limits still apply to both tiers; unlimited account storage does not disable file validation.

## 6. Frontend storage UI

`/settings` presents account tier, a storage progress bar, and a link to recovery settings. The Documents overview also uses the storage progress bar. Hover or keyboard focus shows used/total MB and upgrade guidance; paid storage shows an unlimited tooltip. Monthly AI usage appears only as a 3.5-second informational toast, without persistent text. Both “Create a custom pack” buttons disable when the free allowance is exhausted, with “Upgrade to use” on hover/focus. Paid accounts remain enabled. The existing navigation exposes “Settings & usage.” The shared HTTP error mapper recognizes quota codes and shows clear delete-or-upgrade guidance without parsing backend message text or exposing raw provider diagnostics.

Bootstrap includes `accountTier`, `storage`, and `aiUsage`; authenticated `GET /api/bootstrap/usage` refreshes the same authoritative contract. Redux refreshes usage after normal document saves/deletions and package operations, and when Settings/Packages opens. Display state does not grant access or enforce quotas. Mobile uses code-based quota messages and filters provider-bound labels too.

## 7. AI usage schema

`user_ai_usage` has `userId`, `period`, `actionCount`, and `updatedAt`, with primary key `(userId, period)`, a user foreign key with cascade deletion, and checks for valid `YYYY-MM` periods and nonnegative counts. Paid users bypass consumption; their usage response reports null counts/limits and `unlimited: true`.

## 8. Exact action definition

One action is one user-requested public package generation operation that reaches its first real OpenAI request. This includes generating requirements for a package that catalogue search cannot find. Internal retries share that action. Concurrent duplicate requests within the same server process and account share an in-flight generation. Distinct provider operations across workers still acquire the database quota atomically.

These do **not** count: catalogue searches/matches, opening pages, typing, invalid payloads, unavailable provider configuration, rejected quota requests, explicit development mocks, and cancellation before provider invocation. A reservation cancelled before `fetch` is invoked is refunded. Once the provider request starts, its action remains counted even if the upstream response fails or the client disconnects; the server cannot reliably determine whether the upstream request incurred cost.

The operator-only catalogue source-backfill script uses the same allowlisted public payload but is not an end-user operation and does not debit an account. It has no public route. Document OCR/analysis does not consume this package quota.

## 9. Calendar policy

UTC calendar months, calculated by the backend. The period is determined after acquiring the account lock. A fresh row is used at the next month; no rolling 30-day window, client timestamp, or reset cron is used. Tests cover September 30 to October 1 UTC.

## 10. AI quota enforcement

`consumeAIAction()` locks the account row and atomically creates/checks/increments the current monthly row. Only free accounts are capped. A fourth action is rejected before provider invocation with HTTP 429:

```json
{
  "success": false,
  "code": "AI_MONTHLY_LIMIT_EXCEEDED",
  "message": "You've used your 3 AI actions for this month.",
  "used": 3,
  "limit": 3,
  "period": "2026-09"
}
```

## 11. Public AI proxy architecture

Web/mobile → authenticated `POST /api/packages/search-or-generate` → strict public-input builder → server-selected provider → OpenAI Responses API. The web supports streaming; existing JSON clients, including mobile, remain compatible. There is no generic client-supplied prompt/model/tool/credential endpoint.

## 12. Streaming

The previous package implementation returned completed JSON. The web now requests SSE and renders the arriving package title while verification proceeds. Provider text deltas pass through without buffering the whole response before the first update. The backend also accumulates bounded output for final schema/source validation before saving or delivering the completed package.

Application SSE events are `delta`, `result`, and `error`. The parser handles split UTF-8/network chunks. Failed, incomplete, oversized, or malformed streams are rejected; readers are cancelled/released. A shared upstream controller aborts when all subscribers disconnect. Per-request server timeout remains capped at 25 seconds; the web stops waiting at 40 seconds. Streamed requests are not automatically retried after partial output. Slow downstream buffers are bounded. Quota failures occur before SSE headers, retaining normal HTTP error codes.

## 13. Web-search configuration

`src/ai/providers/openai.ts` configures model, reasoning, web-search tool, `search_context_size: low`, instructions, output schema, output-token bound, deadline, and retry policy. Existing environment choices remain supported. The client cannot override any of these. Integration follows the official [Responses streaming guide](https://developers.openai.com/api/docs/guides/streaming-responses) and [web-search guide](https://developers.openai.com/api/docs/guides/tools-web-search).

## 14. Provider secret storage

The existing backend `OPENAI_API_KEY` was reused with user authorization. It is read only from server configuration and attached as the provider Authorization header. It is not returned through bootstrap, errors, or streams. Package payload/query logging and raw upstream-error-body logging were removed. `store: false` is set on package requests; the existing document analyzer also sets it.

The source/config/build scan passed for web and mobile, including the generated web bundle, with no provider secret or direct provider endpoint found. The scanner reports file paths only. No new key was provisioned and no secret file was rewritten.

## 15. Exact public payload

```json
{
  "packageType": "Home Loan",
  "availableDocumentLabels": ["aadhaar", "bank_statement", "pan", "salary_slip"]
}
```

These are the only provider input fields. Top-level unknown fields and document objects are rejected. Document labels use exact dictionary lookup rather than free-form normalization fallback. Web and mobile construct filtered label arrays; mobile no longer chooses document display names or titles. Unknown labels, personal titles, and prototype-property names are dropped. The public query is bounded and rejects common identifier/content patterns. A user-entered query remains free text; these checks are not a general-purpose sensitive-text classifier, and the application never automatically fills it from vault text.

## 16–17. Existing document-content AI and compatibility

| Call | Classification | Content sent | Quota |
| --- | --- | --- | --- |
| Package search/generation via `analyzeIntent` / `OpenAIProvider` | A: public/package AI | Package query and dictionary labels only | Free monthly quota |
| Operator source-backfill script | A: public catalogue maintenance | Package title and empty labels | No end-user debit |
| `OpenAIDocumentAnalyzer.analyzeDocument` | B: document-content AI | Uploaded image bytes as image inputs, for classification/name/number/expiry extraction | Separate; no package quota |
| Gmail/Drive `ingestDocument` | Local content processing | Local extraction/classification; no provider call in this pipeline | No package quota |

Category B deliberately remains separate. The upload UI discloses that analysis sends document content to OpenAI; the backend invokes it when upload analysis consent is selected. PDF analysis currently falls back to manual review because image-page rendering is not implemented in that analyzer; this pre-existing behavior was retained. The package proxy does not receive OCR images, document text, decrypted fields, or document/database objects. The application as a whole must **not** be described as never sending document contents to OpenAI.

## 18. Validation

Passed:

- Both forward migrations: rollback validation, unchanged existing user/document counts, then successful local application.
- `npm run test:usage:integration`: real PostgreSQL storage boundaries, exact limit, paid accounts, deletion, replacements, multi-page accounting, rollback, concurrency, UTC rollover, cancellation; authenticated HTTP upload rollback/retry, forged paid bypass, cleanup-outage accounting/retry; HTTP package quota, cache exemption, SSE and actual disconnect-to-upstream cancellation. All temporary test users are removed.
- `npm run test:package-proxy`: 8 tests covering allowlisted payloads, document/config rejection, backend key/model/web-search attachment, streamed output, one charge across retries, provider errors, malformed/truncated streams, split UTF-8, and cancellation/refund.
- Web `npm run test:usage`: 7 tests for free/paid UI, safe quota errors, incremental streaming, client label filtering, and source/config/build secret audit.
- Additional selected frontend regression run: 18 tests passed across usage, AppShell module access, Gmail document state, package catalogue state, and session refresh.
- Existing backend product-access, session, document-analysis response, hybrid-encryption, document security-validation, and document-storage security tests passed. The storage-security fixture was corrected from its obsolete legacy-envelope assertion to persisted hybrid metadata, round-trip decryption, and tamper rejection.
- Backend production build; web production build and TypeScript check; mobile TypeScript check.
- ESLint for the new backend and frontend implementation/test files; repository diff whitespace checks.
- Browser rendering of real free/paid usage components in an isolated fixture. Protected Settings requires a signed-in browser session; authenticated behavior was tested over HTTP instead. The temporary visual fixture was removed.

Provider traffic was stubbed in tests, so no billable OpenAI request was made. Live OpenAI responses, production S3 behavior, native release/runtime behavior, and production deployment were not verified by these local checks. Full-repository lint was not claimed.

## 19. Obsolete billing and copy encountered

The previously applied `20260906090000_remove_subscriptions_and_rebrand` migration had removed billing tables and entitlement enforcement. Historical plan/subscription migrations remain historical; they were not restored or rewritten. No Health, Wealth, Documents, Packages, Trust Center, or Legacy premium gates were added.

At the user's follow-up, the landing CTA now reads “Start your living archive.” Family-focused marketing references were removed from the landing/footer/feature copy. The inaccurate on-device-only storage claim was corrected to encrypted cloud storage and separate consented document analysis. The updated landing copy was verified in the browser and the production build passed afterward.
