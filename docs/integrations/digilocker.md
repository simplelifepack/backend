# DigiLocker document import — local delivery report

Implemented for **direct DigiLocker / API Setu requester credentials**, confirmed by the user. No deployment, production database changes, real authorization, or real document download was performed.

## Flow and architecture

Documents now has a DigiLocker button immediately after Upload. The existing design-system Button, Checkbox, modal, Card, Text, Row, Stack and ScrollRegion handle typography, theme and responsive layout. No new CSS classes, colors, spacing values or fonts were introduced.

The dialog explains metadata access before redirecting to the official authorization page. The backend creates a random single-use OAuth state and S256 PKCE verifier, exchanges the code server-side, and lists issued-document metadata returned by the provider. Requested types are never synthesized into available documents. Denial, interrupted authorization, expired state, replay, cancellation, and failed exchange are handled without returning provider descriptions or credentials.

Users select documents, optionally select all available documents (up to 50 per batch), and see **Copy documents to ReadiNes?** with the requested copy-consent text. Only **Allow & Import** invokes import. The backend independently requires the current consent version and explicit true consent, verifies every reference against the owned authorized session, and saves an encrypted audit before downloading any file.

Imports reuse `encryptDocumentOnBackend`, `validateDecryptedDocument`, `createEncryptedTemporaryUpload`, `saveEncryptedPermanentFile`, `withIsolatedPlaintextFile` and `analyzeImportedDocument`. They create normal Document and DocumentFile records with `sourceProvider=DIGILOCKER`. Provider reference, issuer, import timestamp, consent reference and analysis outcome are encrypted in normal document metadata; existing private sourceMessageId stores the external reference. No parallel extraction/storage system or PDF fabricated from API fields was added.

The import uses normal 10 MiB file validation and malware-scan configuration, account storage limits under the account lock, duplicate checks for both source reference and user-scoped content hash, and the existing original-file AI analyzer. Disabled AI does not run. Enabled AI is charged through existing account usage immediately before analyzer invocation; exhausted allowance or unavailable AI preserves the encrypted document for manual review. No additional document-analysis provider is introduced.

Each document has Importing, Encrypting, Processing with AI (only when enabled), Completed or Failed progress. Partial successes remain saved. Retries skip completed references and deduplicate committed files, including across a replacement authorization session. Concurrent import requests on the same session are rejected; account locking serializes final duplicate and quota checks across sessions. Plaintext buffers are cleared and isolated plaintext paths are removed by the existing helper. Encrypted temporary files and rows are removed in failure and success paths; uncommitted permanent objects are removed on persistence failure.

## Backend configuration

Set these in the backend's local environment, never in Vite variables or source control:

```dotenv
DIGILOCKER_CLIENT_ID=<direct requester client ID>
DIGILOCKER_CLIENT_SECRET=<direct requester client secret>
DIGILOCKER_REDIRECT_URI=http://localhost:4000/api/integrations/digilocker/callback
DIGILOCKER_ENVIRONMENT=production
FRONTEND_URL=http://localhost:5173
```

Register the **exact** `DIGILOCKER_REDIRECT_URI` in the direct provider console. It must point to the backend callback, not the frontend. For a hosted test callback, use HTTPS and the same exact registered URL. The final frontend redirect is fixed by backend configuration; clients cannot supply redirect destinations. Callback status/session references use a URL fragment and the frontend removes that fragment after reading it.

The existing private-data keyring, document encryption keyring, storage settings and AI configuration remain required for the corresponding existing pipelines. No new AI API credentials were provisioned or exercised. `configured=true` means the required fields are present and valid in shape; it does not certify that the credentials are accepted or have the required requester permissions.

Only the verified production direct-provider contract is enabled. Setting `sandbox` or another environment fails closed; intermediary credentials and unverified sandbox endpoints are not accepted automatically.

## APIs

All paths below are under `/api/integrations/digilocker`:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/status` | Safe configuration status; authenticated |
| POST | `/sessions` | Create owned OAuth state/session and authorization URL; empty object body |
| GET | `/callback` | Public OAuth callback; single-use state is mandatory |
| GET | `/sessions/:id/status` | Owned session status and per-document progress |
| GET | `/sessions/:id/documents` | Provider-returned metadata for the owned authorized session |
| POST | `/sessions/:id/import` | Explicit consent plus selected references; partial-success result |
| POST | `/sessions/:id/cancel` | Revoke token where possible, remove credentials and close session |

Import body:

```json
{
  "references": ["a-reference-returned-by-the-provider"],
  "consent": true,
  "consentVersion": "digilocker-copy-v1"
}
```

Only `/callback` is public. Every other operation requires the existing bearer authentication and private owner context. Responses use `Cache-Control: no-store`; the callback also uses a no-referrer policy. Status responses contain no OAuth tokens. Import-start and authorization-start routes use the existing upload rate limiter. Swagger/OpenAPI includes the new callback and revised contracts.

## Database migration

`prisma/migrations/20261025100000_digilocker_import_payload/migration.sql` adds two nullable fields to the existing DigiLockerConsentSession model:

- `encryptedPayload`: provider metadata, immutable-by-application copy-consent history, and progress.
- `encryptedCredentials`: short-lived access token or pending PKCE verifier.

Both use the existing contextual AES-GCM privacy keyring, bound to owner, session and field. SQL constraints accept only contextual ciphertext or NULL. Generic operator projections omit both fields. No Document model change, user-data backfill, reseeding or new storage bucket is required.

The migration was subsequently applied to the verified normal local development database `localhost:5434/lifepack` on 2026-10-25. Both nullable columns, both ciphertext constraints and the Prisma migration checksum were verified. The credential cleanup SQL completed successfully. No other pending migration or remote database was changed. Fresh environments still require this migration before DigiLocker use. Startup cleanup now tolerates the specific missing-column error and other cleanup failures cannot terminate backend startup.

Credentials expire after at most 10 minutes while pending and at most 30 minutes after authentication, further limited by provider access-token and consent expiry. Refresh tokens and identity claims are discarded. Closing the connection removes local credentials and attempts provider revocation. The local server removes expired credential ciphertext every minute and on startup; route traffic also triggers cleanup at most once per minute. Consent audits remain encrypted. On serverless hosts without continuous execution, cleanup runs on the next route invocation; a deployment-time scheduled cleanup would be required for a strict wall-clock deletion guarantee while idle.

## Supported documents and provider limitations

- Imports only **issued documents for which the provider advertises a downloadable PDF** and grants access to the file endpoint.
- Each file must pass the existing 10 MiB, PDF-content and optional malware scanner checks.
- XML-only records are displayed as unavailable. No XML-to-PDF conversion is attempted.
- Aadhaar/UIDAI/ADHAR records are unavailable pending separate permission and handling verification. No e-Aadhaar endpoint is called.
- Other unavailable or revoked provider permissions fail the individual import rather than claiming success.
- The provider `date` field is **last modified**, not an issue date. The UI does not label it as an issue date.
- Self-uploaded locker folders/files, document pull APIs and long-lived offline access are outside this implementation.
- File downloads use only the fixed provider origin, reject redirects, enforce a bounded body read, and require a matching SHA-256 HMAC using the backend client secret and a PDF response MIME type.
- Batches are synchronous HTTP operations with durable per-file progress, not detached background jobs. A server restart or host request timeout may interrupt a batch; existing successful copies are deduplicated on a new connection. Confirm hosting execution limits before deploying large batches.

Provider contract reference: [API Setu Authorized Partner specification v2.2](https://cf-media.api-setu.in/resources/DigitalLocker-AuthorizedPartnerAPI-Specificationv2.2.pdf). The direct provider host is `https://digilocker.meripehchaan.gov.in/public`, using authorize `/oauth2/1/authorize`, token `/oauth2/2/token`, issued list `/oauth2/2/files/issued`, file `/oauth2/1/file/{uri}`, and revoke `/oauth2/1/revoke`. Real credential acceptance and permissions must still be verified against the user's requester application.

## Local verification

Provider responses in automated tests are explicitly synthetic fixtures; they are not evidence of real DigiLocker connectivity. Database delegates are in memory. File encryption, content validation, isolated plaintext handling, local encrypted storage, quota policy and retry code execute normally in the import test.

- `npm run test:digilocker`: 8 tests covering missing-migration cleanup regression, configuration, PKCE, actual-list normalization, restrictions, HMAC/MIME/body limits, invalid/expired/replayed state, denied authorization, backend-only exchange, encrypted credentials, ownership rejection, no fetch without consent, cancellation, safe exchange failure, partial success, duplicate-safe retry, encrypted file round trip, quota enforcement, AI preference opt-out/package-search allowance independence and temporary cleanup.
- Existing hybrid encryption suite: passed.
- Existing document security validation suite: passed.
- Existing import-analysis, privacy and error-handling suites: 18 tests passed.
- Frontend DigiLocker, manual-upload and encryption suites: 12 tests passed across 3 files, including declining copy consent and retrying only failures. The final run used `--testTimeout=20000` after an RSA-generation test exceeded its default 5-second timeout under concurrent checks.
- Backend and frontend TypeScript checks: passed.
- Targeted ESLint and production frontend build: passed (the build retains its existing large-chunk advisory).
- OpenAPI validation: the mounted operations, matching coverage and valid schemas.

Remaining verification: registered live callback, real authorization/denial, actual requester scopes and HMAC download responses, full PostgreSQL import transaction checks, authenticated browser verification in light/dark themes on desktop/mobile, and hosted request duration/idle credential-cleanup behavior. No deployment was requested or performed.

## Modified files

Backend:

- `.env.example`, `package.json`, `prisma/schema.prisma`, the migration above.
- `src/config/digilocker.ts`.
- `src/services/digilocker/{digilocker.service,provider,importer,digilocker.test}.ts`.
- `src/routes/digilocker.routes.ts`.
- `src/privacy/operationalFields.ts`, `src/index.ts`, `src/middleware/errorHandling.ts`.
- `src/docs/digilocker.openapi.ts`, `src/docs/openapi.ts`, `src/docs/openapi.check.ts`.
- This delivery report.

Frontend (`/Users/ranjith/code/frontend-web`):

- `src/lib/digilocker-api.ts`.
- `src/pages/documents/digilocker-dialog.tsx` and `digilocker-dialog.test.tsx`.
- `src/pages/documents/documents-overview.tsx`.

## AI usage policy

DigiLocker document processing does not consume the AI package-search allowance. Explicit application consent and AI preferences still apply; storage quotas still apply. The import regression exercises document processing with an exhausted package-search allowance.
