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
const documentTypes = { type: "string", enum: ["AADHAAR", "PAN", "DRIVING_LICENSE"] };
const requestedTypes = { ...array(documentTypes), minItems: 1, maxItems: 3 };
const session = object({ id: string, status: string, statusMessage: nullable(string), consentUrl: nullable(string), requestedDocuments: array(documentTypes), availableDocuments: array(documentTypes), expiresAt: dateTime, authenticatedAt: nullable(dateTime) });
const sessionPath = "/api/integrations/digilocker/sessions/{id}";
const packageInput = object({
  packageType: { ...string, minLength: 1, maxLength: 160, description: "Public package intent only. Personal identifiers, document contents, markup and long numeric sequences are rejected." },
  documentLabels: { ...array({ ...string, maxLength: 100 }), maxItems: 100, default: [], description: "Only allowlisted public document labels are used." },
}, ["packageType"], true);
const packageExample = { packageType: "Passport renewal", documentLabels: ["Passport"] };
const customPackage = object({
  title: { ...string, minLength: 1, maxLength: 120 }, description: { ...string, maxLength: 1000 },
  requirements: { ...array({ ...string, minLength: 1, maxLength: 120 }), minItems: 1, maxItems: 40 },
  searchMetadata: { type: "object", additionalProperties: true },
  source: object({ name: { ...string, maxLength: 160 }, title: { ...string, maxLength: 200 }, url: { ...string, format: "uri", maxLength: 500 }, lastCheckedAt: { ...string, maxLength: 40 } }),
  verificationSources: { ...array({}), maxItems: 10 }, verificationStatus: { ...string, maxLength: 80 },
}, ["title", "requirements"], true);
const draft = object({
  packageName: string, category: string, description: string,
  searchMetadata: object({ intent: string, searchPhrases: array(string), jurisdiction: string, destination: string, purpose: string, subject: string }),
  sourceTitle: string, sourceUrl: string, sourceOrganization: string, lastChecked: string,
  verificationSources: array(object({ title: string, organization: string, url: string, type: string, retrievedAt: string })),
  lastVerifiedAt: nullable(string), verificationStatus: { ...string, enum: ["verified", "unverified_guidance"] },
  hasVerifiedOfficialSource: { type: "boolean" }, confidence: { ...string, enum: ["high", "medium", "low"] }, disclaimer: string,
  requiredDocuments: array(object({ id: string, category: string, documentType: string, owner: string, name: string, title: string, required: { type: "boolean" }, whyNeeded: string, sourceName: string, sourceUrl: string, sourceAuthorityTier: string, lastVerifiedAt: string })),
});
const job = object({
  id: string, status: { ...string, enum: ["queued", "researching", "generating", "saving", "completed", "completed_with_unverified_sources", "failed"] },
  statusMessage: string, draft, errorMessage: string, queuedAt: dateTime, startedAt: dateTime, completedAt: dateTime, failedAt: dateTime,
  queueWaitMs: { type: "integer" }, aiMs: { type: "integer" }, processingMs: { type: "integer" }, retryCount: { type: "integer" }, provider429Count: { type: "integer" }, hasVerifiedOfficialSource: { type: "boolean" }, confidence: string, disclaimer: string,
}, ["id", "status", "statusMessage", "queuedAt", "retryCount", "provider429Count", "hasVerifiedOfficialSource"]);

export const latestOperations: Operation[] = [
  {
    method: "get", path: "/api/integrations/digilocker/worker", tags: ["DigiLocker"], operationId: "processDigiLockerQueue",
    summary: "Process durable DigiLocker imports", description: "Scheduler only. Requires the CRON_SECRET bearer credential; user bearer tokens are rejected. Resumes expired worker leases and retries terminal credential revocation.",
    security: secured, responses: { 200: response("Worker completed", object({ ok: { type: "boolean" } })), ...errors(401, 503) },
  },
  {
    method: "get", path: "/api/search", tags: ["Search"], operationId: "globalSearch", summary: "Search the authenticated user's records",
    security: secured, description: "Searches Packages, Documents, Health, Wealth, Family and Trust Center. Results contain navigation paths, not private source payloads. limit is per section (default 5).",
    parameters: [{ name: "q", in: "query", required: true, schema: { ...string, minLength: 1, maxLength: 160 } }, { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 10, default: 5 } }],
    responses: { 200: response("Grouped search results", object({ query: string, groups: array(object({ section: { ...string, enum: ["packages", "documents", "health", "wealth", "family", "trust"] }, label: string, results: array(object({ id: string, title: string, subtitle: string, section: string, navigation: object({ path: string }, ["path"]) }, ["id", "title", "subtitle", "section", "navigation"])) }, ["section", "label", "results"])) }, ["query", "groups"]), { query: "passport", groups: [{ section: "documents", label: "Documents", results: [] }] }), ...errors(400, 401, 403) },
  },
  {
    method: "post", path: "/api/health/members/{memberId}/measurements", tags: ["Health"], operationId: "createManualHealthMeasurement", summary: "Record a manual health measurement", security: secured,
    description: "Creates a reading for an owned health profile without a source document. Returns sourceType=manual and null sourceDocumentId/recordId.", parameters: [param("memberId")],
    requestBody: body(object({ metricKey: { ...string, minLength: 1, maxLength: 160 }, displayName: { ...string, minLength: 1, maxLength: 160 }, originalName: { ...string, minLength: 1, maxLength: 160 }, value: { type: "number" }, secondaryValue: nullable({ type: "number" }), unit: { ...string, minLength: 1, maxLength: 40 }, context: nullable({ ...string, maxLength: 120 }), bodySite: nullable({ ...string, maxLength: 120 }), referenceMin: nullable({ type: "number" }), referenceMax: nullable({ type: "number" }), referenceText: nullable({ ...string, maxLength: 240 }), measuredAt: { ...string, format: "date" } }, ["metricKey", "displayName", "value", "unit", "measuredAt"], true), { metricKey: "weight", displayName: "Weight", value: 70, unit: "kg", measuredAt: "2026-10-24" }),
    responses: { 201: response("Created measurement", ref("HealthMeasurement")), ...errors(400, 401, 403, 404) },
  },
];

for (const [prefix, suffix] of [["/packs", "Packs"], ["/packages", "Packages"], ["/api/packages", "ApiPackages"]]) {
  const common = { tags: ["Packages"], security: secured };
  latestOperations.push(
    { ...common, method: "post", path: `${prefix}/custom/draft`, operationId: `draftCustom${suffix}`, summary: "Generate or queue a private package draft", description: "Creates/reuses a generation job and attempts processing. Returns 200 with draft and job when ready, or 202 with job while queued/in progress. Does not create a saved package; save an edited checklist with POST /custom.", requestBody: body(packageInput, packageExample), responses: { 200: response("Draft ready", object({ draft, job }, ["draft", "job"])), 202: response("Draft queued", object({ job }, ["job"])), ...errors(400, 401, 403, 404, 429, 503) } },
    { ...common, method: "post", path: `${prefix}/custom/generation-jobs`, operationId: `queueCustom${suffix}`, summary: "Queue a private package generation job", description: "Creates or reuses the authenticated user's active job for the same package intent and document labels. Poll the job endpoint to progress generation.", requestBody: body(packageInput, packageExample), responses: { 202: response("Queued job", object({ job }, ["job"]), { job: { id: "job_example", status: "queued", statusMessage: "Waiting to generate your package...", queuedAt: "2026-10-24T12:00:00Z", retryCount: 0, provider429Count: 0, hasVerifiedOfficialSource: false } }), ...errors(400, 401, 403, 429, 503) } },
    { ...common, method: "get", path: `${prefix}/custom/generation-jobs/{jobId}`, operationId: `pollCustom${suffix}`, summary: "Read and progress own package generation job", description: "Reads only the authenticated user's job and may process it if capacity is available. Completed jobs contain draft; inspect status, disclaimer and verified-source fields before saving.", parameters: [param("jobId")], responses: { 200: response("Job state", object({ job }, ["job"])), ...errors(400, 401, 403, 404, 429, 503) } },
    { ...common, method: "post", path: `${prefix}/custom`, operationId: `createCustom${suffix}`, summary: "Save a private custom package", description: "Saves the reviewed title and requirement strings for the authenticated user. Does not modify the shared catalogue.", requestBody: body(customPackage, { title: "My travel checklist", description: "Records to prepare", requirements: ["Passport", "Travel insurance"] }), responses: { 201: response("Saved package", object({ package: ref("PackageDefinition") }, ["package"])), ...errors(400, 401, 403) } },
    { ...common, method: "patch", path: `${prefix}/{slug}/custom`, operationId: `updateCustom${suffix}`, summary: "Replace own custom package checklist", description: "Requires the complete title and requirements payload; this is not a partial field patch. Shared or other users' packages cannot be edited.", parameters: [param("slug")], requestBody: body(customPackage), responses: { 200: response("Updated package", object({ package: ref("PackageDefinition") }, ["package"])), ...errors(400, 401, 403, 404) } },
    { ...common, method: "delete", path: `${prefix}/{slug}/custom`, operationId: `deleteCustom${suffix}`, summary: "Delete own custom package", description: "Deletes only an owned custom package. Shared or other users' packages return 404.", parameters: [param("slug")], responses: { 204: response("Deleted; empty response"), ...errors(400, 401, 403, 404) } },
  );
}
