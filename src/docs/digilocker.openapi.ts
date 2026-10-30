import type { Operation } from "./openapi";

type Schema = Record<string, unknown>;
const string = { type: "string" };
const dateTime = { type: "string", format: "date-time" };
const nullable = (schema: Schema) => ({ ...schema, nullable: true });
const object = (properties: Record<string, Schema>, required: string[] = [], strict = false): Schema => ({ type: "object", properties, required, ...(strict ? { additionalProperties: false } : {}) });
const array = (items: Schema) => ({ type: "array", items });
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const response = (description: string, schema?: Schema, example?: unknown) => ({ description, ...(schema ? { content: { "application/json": { schema, ...(example ? { example } : {}) } } } : {}) });
const errors = (...codes: number[]) => Object.fromEntries(codes.map(code => [code, response(`${code} error`, ref("ErrorResponse"))]));
const body = (schema: Schema, example?: unknown) => ({ required: true, content: { "application/json": { schema, ...(example ? { example } : {}) } } });
const param = (name: string) => ({ name, in: "path", required: true, schema: { type: "string", minLength: 1 } });
const secured = [{ bearerAuth: [] as string[] }];
const lockerDocument = object({ reference: string, name: string, type: string, issuer: nullable(string), issueDate: nullable(string), modifiedAt: nullable(string), mimeType: string, available: { type: "boolean" }, reason: nullable(string) });
const session = object({ id: string, status: string, expiresAt: nullable(dateTime), progress: array(object({ reference: string, phase: { ...string, enum: ["Importing", "Encrypting", "Processing with AI", "Completed", "Failed"] }, documentId: string, duplicate: { type: "boolean" }, message: string })) });
const sessionPath = "/api/integrations/digilocker/sessions/{id}";

export const digiLockerOperations: Operation[] = [
  {
    method: "get", path: "/api/integrations/digilocker/status", tags: ["DigiLocker"], operationId: "digilockerStatus", summary: "Get direct DigiLocker availability", security: secured,
    description: "Reports configuration only; configured does not prove provider credential validity or permissions.",
    responses: { 200: response("Configuration status", object({ configured: { type: "boolean" }, environment: string, provider: string, consentVersion: string, message: nullable(string) })), ...errors(401, 403) },
  },
  {
    method: "post", path: "/api/integrations/digilocker/sessions", tags: ["DigiLocker"], operationId: "startDigilockerSession", summary: "Start direct DigiLocker authorization with PKCE", security: secured,
    description: "Returns a backend-generated authorization URL. No document bytes are fetched. Requires configured production requester credentials.", requestBody: { ...body(object({ redirectUrl: { ...string, description: "Optional exact return target: readiness://digilocker or the configured frontend Documents URL. Omit for web." } }, [], true)), required: false },
    responses: { 201: response("Created session", object({ id: string, status: string, expiresAt: dateTime, progress: array({}), authorizationUrl: { ...string, format: "uri" } })), ...errors(400, 401, 403, 429, 503) },
  },
  {
    method: "get", path: "/api/integrations/digilocker/callback", tags: ["DigiLocker"], operationId: "completeDigilockerAuthorization", summary: "Complete DigiLocker authorization", security: [],
    description: "Validates and consumes one-time state, exchanges the authorization code server-side with PKCE, and lists provider-authorized issued metadata. Redirects to the state-bound allow-listed mobile or web return target. Never returns tokens or provider error descriptions.",
    parameters: [{ name: "state", in: "query", required: true, schema: string }, { name: "code", in: "query", schema: string }, { name: "error", in: "query", schema: string }],
    responses: { 303: { description: "Redirect to Documents with session reference or generic error in fragment", headers: { Location: { schema: string } } } },
  },
  {
    method: "get", path: `${sessionPath}/status`, tags: ["DigiLocker"], operationId: "getDigilockerSession", summary: "Read owned DigiLocker session and import progress", security: secured, parameters: [param("id")],
    description: "Returns safe progress metadata for the owner. Expires inactive sessions and never returns credentials or document bytes.",
    responses: { 200: response("Session", session), ...errors(401, 403, 404) },
  },
  {
    method: "post", path: `${sessionPath}/cancel`, tags: ["DigiLocker"], operationId: "cancelDigilockerSession", summary: "Cancel connection and remove credentials", security: secured, parameters: [param("id")],
    description: "Attempts provider token revocation, removes local credentials and retains encrypted copy-consent audit. Stops active work cooperatively; retained encrypted credentials are retried for revocation until expiry. Copies and consent audits are retained.", responses: { 200: response("Cancelled session", session), ...errors(401, 403, 404, 409) },
  },
  {
    method: "get", path: `${sessionPath}/documents`, tags: ["DigiLocker"], operationId: "listDigilockerDocuments", summary: "List issued documents returned by DigiLocker", security: secured, parameters: [param("id")],
    description: "Returns only provider-returned metadata from this authorization. Restricted Aadhaar and XML-only documents are unavailable for import. Provider date is last-modified, not an issue date.", responses: { 200: response("Documents", object({ session, documents: array(lockerDocument) })), ...errors(401, 403, 404, 409) },
  },
  {
    method: "post", path: `${sessionPath}/import`, tags: ["DigiLocker"], operationId: "importDigilockerDocuments", summary: "Copy selected documents with explicit consent", security: secured, parameters: [param("id")],
    description: "Records encrypted consent before fetching selected files. Applies normal validation, encryption, storage allowance, AI preference and usage accounting. Poll session status for per-document progress. Partial successes persist; retry failed references without duplicating successful copies.",
    requestBody: body(object({ references: { ...array({ ...string, minLength: 1, maxLength: 1024 }), minItems: 1, maxItems: 50, uniqueItems: true }, consent: { type: "boolean", enum: [true] }, consentVersion: { ...string, enum: ["digilocker-copy-v1"] } }, ["references", "consent", "consentVersion"], true)),
    responses: { 202: response("Queued import", session), ...errors(400, 401, 403, 404, 409, 429, 503) },
  },
];
