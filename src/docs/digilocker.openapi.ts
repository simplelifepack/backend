import type { Operation } from "./openapi";

type Schema = Record<string, unknown>;
const string = { type: "string" };
const dateTime = { type: "string", format: "date-time" };
const nullable = (schema: Schema) => ({ ...schema, nullable: true });
const object = (properties: Record<string, Schema>, required: string[] = [], strict = false): Schema => ({ type: "object", properties, required, ...(strict ? { additionalProperties: false } : {}) });
const array = (items: Schema) => ({ type: "array", items });
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const response = (description: string, schema?: Schema, example?: unknown) => ({ description, ...(schema ? { content: { "application/json": { schema, ...(example ? { example } : {}) } } } : {}) });
const errorDescriptions: Record<number, string> = {
  400: "Invalid request/schema/consent/selection/return URL. Service validation uses DIGILOCKER_INVALID_REQUEST; schema validation may omit code.",
  401: "Bearer authentication required or invalid.", 403: "Account access denied.",
  404: "DIGILOCKER_SESSION_NOT_FOUND: unknown and other users' session IDs both return 404.",
  409: "DIGILOCKER_SESSION_CONFLICT: session is not in a state that permits this operation.",
  429: "API rate limit. Body may contain only message; honor Retry-After seconds.",
  503: "DIGILOCKER_NOT_CONFIGURED or service/admission temporarily unavailable. Retry-After: 2.",
};
const errors = (...codes: number[]) => Object.fromEntries([...new Set([...codes, 429, 503])].map(code => [code, { ...response(errorDescriptions[code] ?? `${code} error`, ref("ErrorResponse")), ...([429, 503].includes(code) ? { headers: { "Retry-After": { description: "Seconds before retrying. Rate-limit responses use the remaining window; busy responses use 2 seconds.", schema: { type: "integer", minimum: 1 } } } } : {}) }]));
const body = (schema: Schema, example?: unknown) => ({ required: true, content: { "application/json": { schema, ...(example ? { example } : {}) } } });
const param = (name: string) => ({ name, in: "path", required: true, schema: { type: "string", minLength: 1 } });
const secured = [{ bearerAuth: [] as string[] }];
const lockerDocument = object({ reference: string, name: string, type: string, issuer: nullable(string), issueDate: nullable(string), modifiedAt: nullable(string), mimeType: string, available: { type: "boolean" }, reason: nullable(string) }, ["reference", "name", "type", "issuer", "issueDate", "modifiedAt", "mimeType", "available", "reason"]);
const session = object({ id: string, status: { ...string, enum: ["PENDING", "AUTHENTICATED", "IMPORTING", "CONSENT_DENIED", "FAILED", "CANCELLED", "EXPIRED"] }, expiresAt: nullable(dateTime), progress: array(object({ reference: string, phase: { ...string, enum: ["Importing", "Encrypting", "Processing with AI", "Completed", "Failed"] }, documentId: string, duplicate: { type: "boolean" }, message: string, code: { ...string, description: "Optional diagnostic code; clients must also handle message-only failures.", enum: ["STORAGE_LIMIT_EXCEEDED", "FILE_TOO_LARGE", "FILE_SIGNATURE_MISMATCH", "UNSUPPORTED_FILE_TYPE", "PASSWORD_PROTECTED_FILE", "UNSAFE_FILE", "FILE_CORRUPTED", "MALWARE_DETECTED", "DIGILOCKER_ACCESS_EXPIRED", "DIGILOCKER_ACCESS_DENIED", "DIGILOCKER_FILE_UNAVAILABLE", "DIGILOCKER_INTEGRITY_FAILED", "DIGILOCKER_PROVIDER_ERROR", "DIGILOCKER_RATE_LIMITED", "DOCUMENT_SAVE_FAILED", "IMPORT_FAILED"] } }, ["reference", "phase"])) }, ["id", "status", "expiresAt", "progress"]);
const sessionPath = "/api/integrations/digilocker/sessions/{id}";

export const digiLockerOperations: Operation[] = [
  {
    method: "get", path: "/api/integrations/digilocker/status", tags: ["DigiLocker"], operationId: "digilockerStatus", summary: "Get direct DigiLocker availability", security: secured,
    description: "Production direct-provider integration only; sandbox fails closed. The registered DigiLocker callback remains HTTPS on the backend domain; no separate native registration is required. Reports configuration only; configured does not prove provider credential validity or permissions.",
    responses: { 200: response("Configuration status", object({ configured: { type: "boolean" }, environment: string, provider: { ...string, enum: ["direct"] }, consentVersion: { ...string, enum: ["digilocker-copy-v1"] }, message: nullable(string) }, ["configured", "environment", "provider", "consentVersion", "message"]), { configured: true, environment: "production", provider: "direct", consentVersion: "digilocker-copy-v1", message: null }), ...errors(401, 403) },
  },
  {
    method: "post", path: "/api/integrations/digilocker/sessions", tags: ["DigiLocker"], operationId: "startDigilockerSession", summary: "Start direct DigiLocker authorization with PKCE", security: secured,
    description: "Pending authorization expires after 10 minutes. Authenticated access is limited to 30 minutes or earlier provider expiry. Returns a backend-generated authorization URL. No document bytes are fetched. Requires configured production requester credentials. Defaults: session-start and import-start share the upload limiter (30 requests/hour/IP); the general API limit is 300 requests/15 minutes/IP. Environment overrides may change these defaults.", requestBody: { ...body(object({ redirectUrl: { ...string, description: "Optional exact return target: readiness://digilocker or the configured frontend Documents URL. Omit for web." }, returnFormat: { ...string, enum: ["session-v1"], description: "Opt in to session/error native returns. Omit to preserve older native clients." } }, [], true), { redirectUrl: "readiness://digilocker", returnFormat: "session-v1" }), required: false },
    responses: { 201: response("Created session", { ...session, properties: { ...(session.properties as Record<string, Schema>), authorizationUrl: { ...string, format: "uri" } }, required: ["id", "status", "expiresAt", "progress", "authorizationUrl"] }), ...errors(400, 401, 403, 429, 503) },
  },
  {
    method: "get", path: "/api/integrations/digilocker/callback", tags: ["DigiLocker"], operationId: "completeDigilockerAuthorization", summary: "Complete DigiLocker authorization", security: [],
    description: "Validates and consumes one-time state, exchanges the authorization code server-side with PKCE, and lists provider-authorized issued metadata. With returnFormat=session-v1 stored at session creation, redirects to the state-bound allow-listed target: readiness://digilocker?session=<id> on success or ?error=consent_denied|authorization_failed|session_expired|cancelled on failure. Without returnFormat, native clients retain readiness://digilocker?digilocker=<id>&result=<status>. Web retains /documents#digilocker=<id>&result=<status>. Targets are exact-match allow-listed, revalidated and cannot be overridden by callback input. Invalid, expired or replayed state uses a safe web error because no mobile target can be trusted. Never returns tokens or provider error descriptions.",
    parameters: [{ name: "state", in: "query", required: true, schema: string }, { name: "code", in: "query", schema: string }, { name: "error", in: "query", schema: string }],
    responses: { 303: { description: "303 to the state-bound native/web return; invalid state falls back to the configured web Documents error fragment", headers: { Location: { schema: string } } } },
  },
  {
    method: "get", path: `${sessionPath}/status`, tags: ["DigiLocker"], operationId: "getDigilockerSession", summary: "Read owned DigiLocker session and import progress", security: secured, parameters: [param("id")],
    description: "Returns safe progress metadata for the owner. Expires inactive sessions and never returns credentials or document bytes. Completed batches return to AUTHENTICATED, not a session-level COMPLETED. Inspect per-reference progress: Completed with duplicate=true means an existing copy, not a new import or AI analysis. Unknown and foreign session IDs both return 404.",
    responses: { 200: response("Session", session), ...errors(401, 403, 404) },
  },
  {
    method: "post", path: `${sessionPath}/cancel`, tags: ["DigiLocker"], operationId: "cancelDigilockerSession", summary: "Cancel connection and remove credentials", security: secured, parameters: [param("id")],
    description: "Attempts provider token revocation, removes local credentials and retains encrypted copy-consent audit. Stops active work cooperatively; retained encrypted credentials are retried for revocation until expiry. Copies and consent audits are retained. Cancellation does not guarantee immediate provider revocation: failed attempts retain encrypted credentials for durable retries until expiry. Idle/abandoned sessions expire and maintenance clears credentials. Reset by cancelling and starting a new session; no separate revoke/reset endpoint exists.", responses: { 200: response("Cancelled session", session), ...errors(401, 403, 404, 409) },
  },
  {
    method: "get", path: `${sessionPath}/documents`, tags: ["DigiLocker"], operationId: "listDigilockerDocuments", summary: "List issued documents returned by DigiLocker", security: secured, parameters: [param("id")],
    description: "Returns only provider-returned metadata from this authorization. Restricted Aadhaar and XML-only documents are unavailable for import. Provider date is last-modified, not an issue date.", responses: { 200: response("Documents", object({ session, documents: array(lockerDocument) }, ["session", "documents"])), ...errors(401, 403, 404, 409) },
  },
  {
    method: "post", path: `${sessionPath}/import`, tags: ["DigiLocker"], operationId: "importDigilockerDocuments", summary: "Copy selected documents with explicit consent", security: secured, parameters: [param("id")],
    description: "Records encrypted consent before fetching selected files. Accepts 1–50 distinct references, at most 10 MiB per file. Applies validation, encryption, storage allowance and account AI preference without consuming package-search allowance. Worker attempts are bounded to 240 seconds; total completion time depends on queue, retries and session expiry. Poll session status for per-document progress. Partial successes persist. Terminal failure requires a new authorization and explicit consent before manual retry; successful copies deduplicate. Retryable work has up to five attempts per current item, with exponential backoff capped at 60 seconds and bounded by session expiry. Consent disclosure (identical on web/mobile): Readines will securely copy your selected DigiLocker documents into your account. These copies will be encrypted. Your existing AI processing preference applies. No per-import AI override is accepted. Saved copies appear in GET /api/documents with sourceProvider=DIGILOCKER. Provider 429s become per-file failures/retries and are not necessarily HTTP 429 responses from import-start.",
    requestBody: body(object({ references: { ...array({ ...string, minLength: 1, maxLength: 1024 }), minItems: 1, maxItems: 50, uniqueItems: true }, consent: { type: "boolean", enum: [true] }, consentVersion: { ...string, enum: ["digilocker-copy-v1"] } }, ["references", "consent", "consentVersion"], true), { references: ["issued-document-reference"], consent: true, consentVersion: "digilocker-copy-v1" }),
    responses: { 202: response("Queued import", session), ...errors(400, 401, 403, 404, 409, 429, 503) },
  },
];
