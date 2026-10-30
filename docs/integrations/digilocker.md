# DigiLocker integration contract

Current source contract, 30 October 2026. Source implementation and deployment are separate: the latest contract changes below are local until explicitly released. Historical runtime evidence is recorded in the mobile QA report.

## Environment and registration

The direct requester integration supports production only. `DIGILOCKER_ENVIRONMENT=production`, client ID, client secret and the exact registered HTTPS `DIGILOCKER_REDIRECT_URI` are required; hosted operation also requires the scheduler secret. Sandbox fails closed. No sandbox/test credentials are bundled or provisioned.

The provider callback stays on the backend domain. The backend redirects to the app as a second hop; the native scheme must not replace the registered provider callback. The existing registration has been exercised by real iOS OAuth. Provider portal settings were not independently inspected.

## Mobile return and security

Start mobile authorization with `POST /api/integrations/digilocker/sessions` and body `{"redirectUrl":"readiness://digilocker","returnFormat":"session-v1"}`. Web sends `{}`. No `client`, mobile session type or arbitrary `returnTo` is needed.

Only the exact `readiness://digilocker` and configured frontend `/documents` URL are accepted. Extra paths, queries, fragments, credentials, alternate casing and origins are rejected. The target is stored in an owner-bound session, revalidated, and selected only after consuming one-time OAuth state. Callback input cannot override it.

- Success: `readiness://digilocker?session=<UUID>`.
- Failure: `readiness://digilocker?error=<code>`, with `consent_denied`, `authorization_failed`, `session_expired` or `cancelled`.
- Invalid, expired or replayed OAuth state goes to the fixed web `/documents#digilocker_error=invalid_state` error. There is no trusted mobile destination in that case; callback-supplied targets are never trusted.
- Web keeps `/documents#digilocker=<UUID>&result=<status>`.

Mobile accepts the new return format and the earlier `?digilocker=<UUID>&result=<status>` format. Error-only returns reopen the account's locally stored pending session and read its authenticated API status. Query values are navigation hints, never proof of authorization. Success UUIDs must match the account-scoped pending connection. Tokens and provider descriptions never enter return links.

Compatibility: `returnFormat:"session-v1"` explicitly opts a session into session/error returns. Omission retains the earlier digilocker/result format, including already pending sessions. The choice is stored in the encrypted session payload and cannot be overridden by callback input. Backend deployment does not require simultaneous app release.

## Authentication and response shapes

All six endpoints below require the normal bearer token and owner context. Responses are uncached (`Cache-Control: no-store`). Unknown IDs and IDs owned by someone else both return 404.

Base path: `/api/integrations/digilocker`.

| Method/path | Request | Success response |
| --- | --- | --- |
| `GET /status` | None | 200 `{configured, environment, provider:"direct", consentVersion:"digilocker-copy-v1", message:string|null}` |
| `POST /sessions` | `{}` or `{redirectUrl:"readiness://digilocker"}` | 201 session plus `authorizationUrl` |
| `GET /sessions/{id}/status` | None | 200 session |
| `GET /sessions/{id}/documents` | None | 200 `{session, documents: LockerDocument[]}` |
| `POST /sessions/{id}/cancel` | No body required | 200 session |
| `POST /sessions/{id}/import` | `{references:string[], consent:true, consentVersion:"digilocker-copy-v1"}` | 202 session; poll status |

Session: `{id:string, status:string, expiresAt:ISO8601|null, progress:Progress[]}`.

Session status values: `PENDING`, `AUTHENTICATED`, `IMPORTING`, `CONSENT_DENIED`, `FAILED`, `CANCELLED`, `EXPIRED`. A completed batch returns the connection to `AUTHENTICATED`. There is no session-level `COMPLETED`; inspect progress for each selected reference. Terminal failure requires reconnecting; successful copies remain saved.

Progress: `{reference:string, phase:string, documentId?:string, duplicate?:boolean, code?:string, message?:string}`. Phase values, with exact case: `Importing`, `Encrypting`, `Processing with AI`, `Completed`, `Failed`. Failure messages are safe descriptions. `code` is optional; clients must not require it. `Completed` with `duplicate:true` means an existing copy, not a new import or new AI analysis.

LockerDocument: `{reference, name, type, issuer:string|null, issueDate:string|null, modifiedAt:string|null, mimeType, available:boolean, reason:string|null}`. Other unannotated fields are strings. `modifiedAt` is provider last-modified, not an issue date. Only available PDF documents may be selected. XML-only and restricted Aadhaar records are unavailable; no file is fabricated from metadata.

Machine-readable operation schemas are in `src/docs/digilocker.openapi.ts`.

## Errors, limits and retries

| HTTP | Meaning / codes |
| --- | --- |
| 400 | Schema validation, invalid selection/consent/return URL. Service validation uses `DIGILOCKER_INVALID_REQUEST`; Zod validation may have no code. |
| 401 / 403 | Normal authentication/account-access failure. |
| 404 | Missing or foreign session: `DIGILOCKER_SESSION_NOT_FOUND`. |
| 409 | Incompatible session state: `DIGILOCKER_SESSION_CONFLICT`. |
| 429 | API rate limit; includes `Retry-After` seconds. |
| 502 | Provider failure, e.g. `DIGILOCKER_PROVIDER_ERROR`. |
| 503 | Unconfigured (`DIGILOCKER_NOT_CONFIGURED`), unavailable rate-limit store, or admission busy. Includes `Retry-After: 2`. |

Error responses may include `{code?, message, errorId?}`; normal rate-limit responses use `{message}`. Do not parse messages or expect a code on every error. Raw provider/database diagnostics are not exposed.

Known per-file diagnostics are defined in `src/services/digilocker/importFailure.ts`: storage, file-size/type/signature/password/security/corruption/malware failures; `DIGILOCKER_ACCESS_EXPIRED`, `DIGILOCKER_ACCESS_DENIED`, `DIGILOCKER_FILE_UNAVAILABLE`, `DIGILOCKER_INTEGRITY_FAILED`, `DIGILOCKER_PROVIDER_ERROR`, `DIGILOCKER_RATE_LIMITED`, `DOCUMENT_SAVE_FAILED`, and fallback `IMPORT_FAILED`. Provider 429s become per-file failures with durable retries, not necessarily an HTTP 429 from the import-start request.

The existing PostgreSQL-backed API limiter emits `Retry-After` for 429 responses. Central error handling supplies a 2-second fallback for thrown 429/503 errors while preserving an existing header. Infrastructure outside this application can impose its own behavior.

Defaults (environment variables can override rate limits):

- 1–50 distinct references per batch, each at most 1,024 characters.
- File limit: 10 MiB, validated downloadable PDF with provider HMAC, bounded reads and no redirects.
- Session-start and import-start share the upload limiter: 30 requests per 60 minutes per client IP. General API limiter: 300 requests per 15 minutes per client IP. Polling counts toward the general limiter.
- Pending OAuth lifetime: 10 minutes. Authenticated access: at most 30 minutes from exchange, bounded by provider token and consent expiry. No refresh token is retained.
- Import-start is asynchronous (202). At most three durable workers are active; 90-second renewable leases fence cancelled/stale workers. A worker invocation processes at most one document, with a 240-second attempt deadline. Queue drain budget is 270 seconds; scheduled recovery resumes abandoned work.
- Retryable failures have up to five attempts for the current work item, exponential delays capped at 60 seconds, and remain bounded by session expiry. A whole batch has no fixed completion-time guarantee. Honor `Retry-After`; back off polling on errors.

## Consent, AI and saved documents

The same consent version and disclosure are used by web and mobile:

> Readines will securely copy your selected DigiLocker documents into your account. These copies will be encrypted. Your existing AI processing preference applies.

Import requires explicit `consent:true` and `digilocker-copy-v1`, and records encrypted copy-consent audit before downloading. The Import action supplies consent; no second toggle is required. Original-file AI analysis follows the account's current AI processing setting, with no import-specific override. Document analysis does not consume AI package-search allowance. Existing encrypted copies are deduplicated before analysis. Storage quotas still apply.

Normal `GET /api/documents` records expose `sourceProvider`; DigiLocker copies use `DIGILOCKER`. Mobile rows, details and filters retain that source.

## Disconnect, abandoned sessions and reset

`POST /sessions/{id}/cancel` fences active work, attempts provider revocation, and removes local credentials on success. On provider revocation failure, encrypted credentials are retained only for durable revocation retries until their expiry; cancellation is not proof of successful provider revocation. Imported copies and encrypted consent audits remain. There is no separate account-wide connection or revoke endpoint.

Expired credentials are cleared by maintenance/scheduled recovery and opportunistic route cleanup. Idle browser tabs cannot extend session access. Cleanup runs when the scheduler/host executes; do not promise instantaneous deletion during an infrastructure outage.

Reset by cancelling the owned session and creating a new one. Mobile Start over performs this sequence. There is no production session-reset backdoor or test-account bypass. QA uses an approved real account with user-completed provider login; credentials must not be shared in source or logs.
