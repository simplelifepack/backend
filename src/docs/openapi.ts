/* eslint-disable max-lines */
type Schema = Record<string, unknown>;
type Operation = {
  method: "get" | "post" | "patch" | "delete";
  path: string;
  tags: string[];
  summary: string;
  description: string;
  operationId: string;
  security?: Array<Record<string, string[]>>;
  parameters?: Schema[];
  requestBody?: Schema;
  responses?: Record<string, Schema>;
};

const json = "application/json";
const html = "text/html";

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const arrayOf = (items: Schema) => ({ type: "array", items });
const nullable = (schema: Schema) => ({ ...schema, nullable: true });
const stringEnum = (values: string[]) => ({ type: "string", enum: values });
const date = { type: "string", format: "date", example: "2026-09-22" };
const dateTime = { type: "string", format: "date-time", example: "2026-09-22T12:00:00.000Z" };
const idParam = (name: string, description = `${name} identifier`) => ({
  name,
  in: "path",
  required: true,
  description,
  schema: { type: "string", minLength: 1 },
});
const query = (name: string, schema: Schema, description: string, required = false) => ({
  name,
  in: "query",
  required,
  description,
  schema,
});
const body = (schema: Schema, example?: unknown, contentType = json) => ({
  required: true,
  content: {
    [contentType]: {
      schema,
      ...(example === undefined ? {} : { example }),
    },
  },
});
const response = (description: string, schema?: Schema, example?: unknown, contentType = json) => ({
  description,
  ...(schema ? { content: { [contentType]: { schema, ...(example === undefined ? {} : { example }) } } } : {}),
});
const binaryResponse = (description: string) => ({
  description,
  headers: {
    "Content-Type": { schema: { type: "string" } },
    "Content-Disposition": { schema: { type: "string" } },
  },
  content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } },
});
const errorResponses = (...codes: string[]) => Object.fromEntries(
  codes.map((code) => [code, response(`${code} error`, ref("ErrorResponse"))]),
);
const secured = [{ bearerAuth: [] }];
const refreshSecured = [{ refreshCookie: [] }];
const adminSecured = [{ adminSeedToken: [] }];

const objectSchema = (properties: Record<string, Schema>, required: string[] = [], extra: Schema = {}) => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
  ...extra,
});

const describeDynamic = (description: string, example: unknown): Schema => ({
  type: "object",
  additionalProperties: true,
  description,
  example,
});

const schemas: Record<string, Schema> = {
  ErrorResponse: objectSchema({
    message: { type: "string", example: "Invalid request." },
    code: { type: "string", example: "INVALID_ENCRYPTION_ENVELOPE" },
    errorId: { type: "string", format: "uuid" },
    metadata: { type: "object", additionalProperties: true },
  }),
  UsageLimitErrorResponse: objectSchema({
    success: { type: "boolean", const: false },
    code: stringEnum(["STORAGE_LIMIT_EXCEEDED", "AI_MONTHLY_LIMIT_EXCEEDED"]),
    message: { type: "string" },
    usageBytes: { type: "integer" },
    limitBytes: { type: "integer" },
    incomingBytes: { type: "integer" },
    used: { type: "integer" },
    limit: { type: "integer" },
    period: { type: "string", example: "2026-09" },
  }),
  AuthUser: objectSchema({
    id: { type: "string" },
    name: { type: "string" },
    email: { type: "string", format: "email" },
    authVersion: { type: "integer", minimum: 0 },
    accountTier: stringEnum(["free", "paid"]),
  }, ["id", "name", "email"]),
  AuthResult: objectSchema({
    token: { type: "string", description: "Bearer access token. Same value as accessToken." },
    accessToken: { type: "string", description: "Use as Authorization: Bearer <token>." },
    user: ref("AuthUser"),
  }, ["token", "accessToken", "user"]),
  AccountUsage: objectSchema({
    accountTier: stringEnum(["free", "paid"]),
    storage: objectSchema({
      usedBytes: { type: "integer", minimum: 0 },
      limitBytes: nullable({ type: "integer", minimum: 0 }),
      unlimited: { type: "boolean" },
    }),
    aiUsage: objectSchema({
      used: nullable({ type: "integer", minimum: 0 }),
      limit: nullable({ type: "integer", minimum: 0 }),
      remaining: nullable({ type: "integer", minimum: 0 }),
      unlimited: { type: "boolean" },
      period: { type: "string", pattern: "^\\d{4}-\\d{2}$" },
    }),
  }),
  BootstrapResponse: objectSchema({
    user: objectSchema({ id: { type: "string" }, name: { type: "string" }, email: { type: "string", format: "email" } }),
    accountTier: { type: "string" },
    storage: objectSchema({
      usedBytes: { type: "integer", minimum: 0 },
      limitBytes: nullable({ type: "integer", minimum: 0 }),
      unlimited: { type: "boolean" },
    }),
    aiUsage: objectSchema({
      used: nullable({ type: "integer", minimum: 0 }),
      limit: nullable({ type: "integer", minimum: 0 }),
      remaining: nullable({ type: "integer", minimum: 0 }),
      unlimited: { type: "boolean" },
      period: { type: "string", pattern: "^\\d{4}-\\d{2}$" },
    }),
    documentCount: { type: "integer", minimum: 0 },
    version: { type: "string", example: "1" },
  }),
  PublicDocumentEncryptionKey: objectSchema({
    keyId: { type: "string", minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9._-]+$", description: "Identifier for the active RSA public key used in encrypted document envelopes." },
    keyVersion: { type: "integer", minimum: 1, description: "Positive version for the active RSA public key." },
    algorithm: { type: "string", enum: ["RSA-OAEP-4096-SHA256"], description: "Key-wrapping algorithm expected by the backend." },
    publicKeyPem: { type: "string", description: "RSA-4096 public key in PEM/SPKI format. Private key material is never exposed." },
  }, ["keyId", "keyVersion", "algorithm", "publicKeyPem"]),
  EncryptedDocumentEnvelope: objectSchema({
    wrappedKey: { type: "string", minLength: 1, maxLength: 4096, pattern: "^[A-Za-z0-9_-]+$" },
    iv: { type: "string", pattern: "^[A-Za-z0-9_-]+$", description: "base64url AES-GCM IV; must decode to 12 bytes." },
    encryptionVersion: { type: "integer" },
    keyId: { type: "string", minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9._-]+$" },
    keyVersion: { type: "integer", minimum: 1 },
    contentAlgorithm: { type: "string", example: "AES-256-GCM" },
    keyAlgorithm: { type: "string", example: "RSA-OAEP-4096-SHA256" },
    originalFilename: { type: "string", minLength: 1, maxLength: 255, description: "Safe basename only; no slash, backslash, or control characters." },
    originalMimeType: stringEnum(["application/pdf", "image/jpeg", "image/png", "image/webp"]),
    originalSize: { type: "integer", minimum: 1, maximum: 20971520 },
    originalSha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
    encryptedSha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
    aiAnalysisConsent: { type: "boolean", default: false },
  }, ["wrappedKey", "iv", "encryptionVersion", "keyId", "keyVersion", "contentAlgorithm", "keyAlgorithm", "originalFilename", "originalMimeType", "originalSize", "originalSha256", "encryptedSha256"]),
  DocumentAnalysis: objectSchema({
    success: { type: "boolean", const: true, description: "True when encrypted upload analysis completed and temporary uploads were created." },
    document: objectSchema({
      title: { type: "string", description: "Display title chosen from detected document type or original filename." },
      documentType: { type: "string", description: "Detected document type from AI/rules, or Unknown fallback." },
      category: { type: "string", description: "Safe high-level category. Unsupported categories are normalized to Other." },
      confidence: { type: "number", minimum: 0, maximum: 100, description: "Classifier confidence percentage." },
      fields: describeDynamic("Extracted metadata fields. Keys depend on detected document type.", { nameOnDocument: "Example User", expiryDate: "2030-01-01" }),
      reviewFields: arrayOf(describeDynamic("Review field produced for user confirmation.", { key: "expiryDate", label: "Expiry date", value: "2030-01-01" })),
      rawExtractedText: { type: "string", description: "Safe extracted text summary returned by the analyzer when available." },
      evidence: arrayOf(describeDynamic("Classification evidence signal.", { label: "Detected passport label", points: 20 })),
      ownership: { type: "string", enum: ["mine", "other", "unknown"], description: "Best-effort ownership match against the current user's name." },
    }, ["title", "documentType", "category", "confidence", "ownership"], { additionalProperties: true }),
    files: arrayOf(objectSchema({
      tempFileId: { type: "string", format: "uuid", description: "Temporary upload id to pass to POST /documents." },
      originalName: { type: "string", description: "Original safe filename from the encrypted envelope." },
      mimeType: { type: "string", description: "Original MIME type from the encrypted envelope." },
      size: { type: "integer", description: "Original file size in bytes before encryption tag." },
    }, ["tempFileId", "originalName", "mimeType", "size"])),
    warnings: arrayOf(objectSchema({ code: { type: "string" }, message: { type: "string" } })),
  }, ["success", "document", "files", "warnings"]),
  DocumentValidation: objectSchema({
    normalizedType: { type: "string", description: "Normalized document type used for readiness matching." },
    displayName: { type: "string", description: "Human-readable document type label." },
    category: { type: "string", description: "Normalized document category." },
    uniqueIdentifierField: { type: "string", description: "Field used as the duplicate/identity identifier." },
    uniqueIdentifier: nullable({ type: "string", description: "Validated unique identifier, or null when absent." }),
    documentFingerprint: { type: "string", description: "Backend-generated fingerprint from normalized type and available metadata." },
    capabilities: arrayOf({ type: "string" }),
    validatedFields: describeDynamic("Per-field validation details keyed by metadata field name.", { nameOnDocument: { value: "Example User", status: "valid" } }),
    reviewFields: arrayOf(describeDynamic("Fields that may need user review.", { key: "expiryDate", value: "2030-01-01" })),
    missingRequiredFields: arrayOf({ type: "string" }),
    invalidFields: arrayOf({ type: "string" }),
    lowConfidenceFields: arrayOf({ type: "string" }),
    canSave: { type: "boolean", description: "Whether the document may be saved without additional user action." },
    requiresUserConfirmation: { type: "boolean", description: "Whether the user must explicitly confirm uncertain data." },
    warnings: arrayOf(describeDynamic("Validation warning.", { code: "LOW_CONFIDENCE", message: "Review extracted fields." })),
  }),
  DocumentSaveRequest: objectSchema({
    tempFileIds: { type: "array", minItems: 1, maxItems: 10, uniqueItems: true, items: { type: "string", format: "uuid" } },
    originalName: { type: "string", minLength: 1 },
    mimeType: { type: "string", minLength: 1 },
    size: { type: "integer", minimum: 0 },
    title: { type: "string", minLength: 1 },
    category: { type: "string", minLength: 1 },
    documentType: { type: "string", description: "Required for rules/ai saves; defaults to empty string for manual saves." },
    confidence: { type: "number", minimum: 0, maximum: 100, default: 0 },
    fields: describeDynamic("Reviewed metadata fields to persist with the document. Keys vary by document type.", { nameOnDocument: "Example User", expiryDate: "2030-01-01" }),
    reviewFields: { type: "array", items: describeDynamic("Review field from analysis UI.", { key: "expiryDate", label: "Expiry date", value: "2030-01-01" }), default: [] },
    rawExtractedText: { type: "string", default: "" },
    warnings: { type: "array", items: {}, default: [] },
    extraction: describeDynamic("Optional raw analyzer extraction payload for AI/hybrid saves.", { provider: "rules", model: "local" }),
    evidence: { type: "array", items: describeDynamic("Classification evidence signal.", { label: "Document heading", points: 15 }), default: [] },
    analysisSource: { type: "string", enum: ["rules", "manual", "ai"], default: "rules" },
    duplicateAction: { type: "string", enum: ["fail", "replace", "keep_both"], default: "fail" },
    userConfirmedUnknown: { type: "boolean", default: false },
    owner: stringEnum(["self", "spouse", "father", "mother", "child", "seller", "buyer", "employer", "bank", "hospital", "government", "other", "unknown"]),
    subType: nullable({ type: "string", minLength: 1 }),
    expiry: nullable({ type: "string", description: "For manual saves, use YYYY-MM-DD when supplied." }),
    verified: { type: "boolean", default: false },
    targetProfileId: { type: "string", minLength: 1 },
  }, ["tempFileIds", "category"]),
  Document: objectSchema({
    id: { type: "string" },
    ownerProfileId: nullable({ type: "string" }),
    title: nullable({ type: "string" }),
    displayName: nullable({ type: "string" }),
    uniqueIdentifier: nullable({ type: "string" }),
    extractedKeyFields: describeDynamic("Decrypted key fields derived from validated metadata.", { nameOnDocument: "Example User", expiryDate: "2030-01-01" }),
    rawText: nullable({ type: "string" }),
    originalName: { type: "string" },
    mimeType: { type: "string" },
    size: { type: "integer" },
    documentType: { type: "string" },
    normalizedType: nullable({ type: "string" }),
    category: { type: "string" },
    analysisSource: { type: "string" },
    confidence: { type: "number" },
    classificationStatus: { type: "string" },
    classificationConfidence: { type: "number" },
    ownershipStatus: { type: "string" },
    readinessEligible: { type: "boolean" },
    fields: describeDynamic("Decrypted persisted document metadata. Keys vary by document type.", { owner: "self", expiryDate: "2030-01-01" }),
    source: stringEnum(["MANUAL_UPLOAD", "GMAIL", "GOOGLE_DRIVE"]),
    sourceProvider: nullable({ type: "string" }),
    driveFileId: nullable({ type: "string" }),
    openUrl: nullable({ type: "string", format: "uri" }),
    lastAnalyzed: nullable(dateTime),
    createdAt: dateTime,
    updatedAt: dateTime,
  }),
  PackageDefinition: objectSchema({
    id: { type: "string" },
    slug: { type: "string" },
    title: { type: "string" },
    subtitle: nullable({ type: "string" }),
    category: { type: "string" },
    aliases: arrayOf({ type: "string" }),
    description: { type: "string" },
    keywords: arrayOf({ type: "string" }),
    searchMetadata: describeDynamic("Search metadata used by package matching.", { country: "Exampleland", intent: ["visitor visa"] }),
    sourceType: nullable({ type: "string" }),
    sourceName: nullable({ type: "string" }),
    sourceTitle: nullable({ type: "string" }),
    sourceUrl: nullable({ type: "string", format: "uri" }),
    lastCheckedAt: nullable(dateTime),
    verificationSources: arrayOf(describeDynamic("Public source used to verify package requirements.", { title: "Example immigration guide", url: "https://example.gov/visitor-visa" })),
    lastVerifiedAt: nullable(dateTime),
    verificationStatus: nullable({ type: "string" }),
    createdBy: { type: "string" },
    createdAt: dateTime,
    version: { type: "integer" },
    requirements: { type: "array", items: ref("PackageRequirement") },
  }, ["id", "slug", "title", "category", "description", "requirements"]),
  PackageRequirement: objectSchema({
    id: { type: "string" },
    title: { type: "string" },
    description: { type: "string" },
    required: { type: "boolean" },
    group: { type: "string" },
    documentType: { type: "string" },
    owner: { type: "string" },
    metadata: describeDynamic("Requirement metadata used by readiness matching.", { maxAgeDays: 180, acceptedOwners: ["self"] }),
    acceptedDocumentTypes: arrayOf({ type: "string" }),
    alternativeLabels: arrayOf({ type: "string" }),
    sortOrder: { type: "integer" },
  }, ["id", "title", "required", "group", "documentType", "owner", "acceptedDocumentTypes", "sortOrder"]),
  PackageSummary: objectSchema({
    id: { type: "string" },
    slug: { type: "string" },
    title: { type: "string" },
    category: { type: "string" },
    description: { type: "string" },
    source: objectSchema({
      name: { type: "string" },
      title: { type: "string" },
      url: { type: "string", format: "uri" },
      lastCheckedAt: date,
    }),
    requirements: arrayOf(objectSchema({
      id: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      required: { type: "boolean" },
      group: { type: "string" },
      owner: { type: "string" },
      acceptedDocumentTypes: arrayOf({ type: "string" }),
      metadata: describeDynamic("Requirement metadata returned by the summary endpoint when present.", { maxAgeDays: 180 }),
    })),
  }, ["id", "slug", "title", "category", "description", "requirements"]),
  PackageListResponse: objectSchema({
    query: { type: "string" },
    items: arrayOf(ref("PackageSummary")),
    matches: arrayOf(objectSchema({
      id: { type: "string" },
      name: { type: "string" },
      slug: { type: "string" },
      matchType: stringEnum(["exact_name", "alias", "keyword_similarity"]),
      confidence: { type: "number", minimum: 0, maximum: 1 },
      matchedTokens: arrayOf({ type: "string" }),
      missingTokens: arrayOf({ type: "string" }),
    })),
    hasConfidentMatch: { type: "boolean" },
    canGenerate: { type: "boolean" },
    pagination: objectSchema({ page: { type: "integer" }, limit: { type: "integer" }, total: { type: "integer" }, hasNextPage: { type: "boolean" } }),
  }, ["query", "items", "matches", "hasConfidentMatch", "canGenerate", "pagination"]),
  PackageSearchOrGenerateRequest: objectSchema({
    packageType: { type: "string", minLength: 1, maxLength: 160, description: "Must ask for package/public requirements and must not include personal document details." },
    documentLabels: { type: "array", maxItems: 100, items: { type: "string", maxLength: 100 }, default: [] },
  }, ["packageType"]),
  PackageSearchOrGenerateResult: objectSchema({
    source: stringEnum(["existing", "official_source"]),
    confidence: nullable({ type: "number" }),
    matchReason: nullable({ type: "string" }),
    package: ref("PackageDefinition"),
  }),
  GmailStatus: objectSchema({ connected: { type: "boolean" }, account: nullable({ type: "string" }), lastScannedAt: nullable(dateTime), scanning: { type: "boolean" } }),
  GmailCandidate: objectSchema({
    id: { type: "string" },
    userId: { type: "string" },
    provider: { type: "string", example: "gmail" },
    subject: nullable({ type: "string" }),
    sender: nullable({ type: "string" }),
    filename: nullable({ type: "string" }),
    mimeType: nullable({ type: "string" }),
    size: nullable({ type: "integer" }),
    receivedAt: nullable(dateTime),
    relevanceScore: nullable({ type: "number" }),
    status: { type: "string" },
  }, [], { additionalProperties: true }),
  GmailImportResult: objectSchema({ candidateId: { type: "string" }, status: { type: "string" }, documentId: nullable({ type: "string" }), error: nullable({ type: "string" }) }, [], { additionalProperties: true }),
  DriveStatus: objectSchema({
    connected: { type: "boolean" },
    account: nullable({ type: "string" }),
    scanStatus: stringEnum(["idle", "scanning", "failed", "completed"]),
    lastScannedAt: nullable(dateTime),
    lastSuccessfulSync: nullable(dateTime),
    scanning: { type: "boolean" },
    phase: nullable({ type: "string" }),
    processed: { type: "integer" },
    total: { type: "integer" },
    indexedCount: { type: "integer" },
    error: nullable({ type: "string" }),
  }),
  DriveScanResult: objectSchema({
    scanned: { type: "integer" },
    imported: { type: "integer" },
    skipped: { type: "integer" },
    candidates: { type: "integer" },
    errors: arrayOf({ type: "string" }),
  }, [], { additionalProperties: true }),
  TrustPermission: objectSchema({ module: stringEnum(["DOCUMENTS", "HEALTH", "WEALTH"]), canView: { type: "boolean" }, canDownload: { type: "boolean" } }, ["module", "canView", "canDownload"]),
  TrustMember: objectSchema({
    id: { type: "string" },
    name: { type: "string" },
    email: { type: "string", format: "email" },
    relation: { type: "string" },
    customRelation: nullable({ type: "string" }),
    relationLabel: { type: "string" },
    dateOfBirth: date,
    bloodGroup: stringEnum(["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"]),
    accessType: { type: "object", additionalProperties: true },
    status: { type: "string" },
    invitationStatus: stringEnum(["PENDING", "ACCEPTED", "EXPIRED", "REJECTED", "NONE"]),
    permissions: arrayOf(ref("TrustPermission")),
  }, [], { additionalProperties: true }),
  TrustConnection: objectSchema({ id: { type: "string" }, owner: objectSchema({ id: { type: "string" }, name: { type: "string" }, email: { type: "string" } }), relation: { type: "string" }, relationLabel: { type: "string" }, accessType: { type: "object" }, status: { type: "string" }, acceptedAt: nullable(dateTime) }),
  TrustCenter: objectSchema({ role: stringEnum(["OWNER", "BOTH"]), owner: nullable({ type: "object", additionalProperties: true }), memberCount: { type: "integer" }, members: arrayOf(ref("TrustMember")), connections: arrayOf(ref("TrustConnection")), accessTypes: arrayOf({ type: "object", additionalProperties: true }) }),
  WealthFormCategory: objectSchema({ code: { type: "string" }, label: { type: "string" }, description: nullable({ type: "string" }) }),
  WealthFormSubtype: objectSchema({ code: { type: "string" }, label: { type: "string" }, description: nullable({ type: "string" }) }),
  WealthFormField: objectSchema({ id: { type: "string" }, label: { type: "string" }, inputType: { type: "string" }, required: { type: "boolean" }, placeholder: nullable({ type: "string" }), defaultValue: {}, options: {}, validation: {}, group: nullable({ type: "string" }), visibility: {}, order: { type: "integer" } }),
  WealthRecord: objectSchema({
    id: { type: "string" },
    type: stringEnum(["ASSET", "LOAN_TAKEN", "LOAN_GIVEN", "INSURANCE", "PAYMENT_PROOF"]),
    title: { type: "string" },
    details: { type: "object", additionalProperties: true },
    notes: nullable({ type: "string" }),
    followUpDate: nullable(dateTime),
    followUpNote: nullable({ type: "string" }),
    attachments: arrayOf({ type: "object", additionalProperties: true }),
    loanBreakdown: nullable({ type: "object", additionalProperties: true }),
    createdAt: dateTime,
    updatedAt: dateTime,
  }),
  WealthHandoffSummary: objectSchema({
    generatedAt: dateTime,
    recipients: objectSchema({ family: arrayOf({ type: "object", additionalProperties: true }), emergency: arrayOf({ type: "object", additionalProperties: true }) }),
    handoffTypes: arrayOf(objectSchema({ type: stringEnum(["family", "emergency"]), label: { type: "string" }, contents: arrayOf({ type: "string" }), excluded: arrayOf({ type: "string" }), counts: { type: "object", additionalProperties: { type: "integer" } } })),
  }),
  HealthMember: objectSchema({
    id: { type: "string" },
    name: { type: "string" },
    relation: { type: "string" },
    bloodGroup: nullable(stringEnum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "Unknown"])),
    dateOfBirth: nullable(date),
    conditions: nullable({ type: "string" }),
    allergies: nullable({ type: "string" }),
    emergencyContactName: nullable({ type: "string" }),
    emergencyContactPhone: nullable({ type: "string" }),
    primaryDoctor: nullable({ type: "string" }),
    insuranceProvider: nullable({ type: "string" }),
    insurancePolicyNumber: nullable({ type: "string" }),
    createdAt: dateTime,
    updatedAt: dateTime,
  }),
  HealthRecordSummary: objectSchema({
    id: { type: "string" },
    memberId: nullable({ type: "string" }),
    documentId: { type: "string" },
    type: stringEnum(["lab_report", "medical_report", "prescription"]),
    documentDate: nullable(date),
    provider: nullable({ type: "string" }),
    doctor: nullable({ type: "string" }),
    processingStatus: { type: "string" },
    processingError: nullable({ type: "string" }),
    measurementCount: { type: "integer" },
    trackedMeasurementCount: { type: "integer" },
    medicationCount: { type: "integer" },
    followUpCount: { type: "integer" },
    createdAt: dateTime,
    processedAt: nullable(dateTime),
  }),
  HealthMeasurement: objectSchema({
    id: { type: "string" },
    sourceDocumentId: { type: "string" },
    recordId: { type: "string" },
    metricKey: { type: "string" },
    displayName: { type: "string" },
    originalName: { type: "string" },
    value: { type: "number" },
    secondaryValue: nullable({ type: "number" }),
    unit: { type: "string" },
    context: nullable({ type: "string" }),
    bodySite: nullable({ type: "string" }),
    referenceMin: nullable({ type: "number" }),
    referenceMax: nullable({ type: "number" }),
    referenceText: nullable({ type: "string" }),
    measuredAt: nullable(date),
    sourceType: { type: "string" },
    isTracked: { type: "boolean" },
    aliases: arrayOf({ type: "string" }),
  }),
  HealthRecord: objectSchema({
    ...schemasPlaceholderHealthRecord(),
  }),
  TrackedHealthMetric: objectSchema({ id: { type: "string" }, userId: { type: "string" }, memberId: { type: "string" }, metricKey: { type: "string" }, displayName: { type: "string" }, context: nullable({ type: "string" }), bodySite: nullable({ type: "string" }), enabled: { type: "boolean" }, createdAt: dateTime, updatedAt: dateTime }),
  HealthReminder: objectSchema({ id: { type: "string" }, title: { type: "string" }, dueDate: nullable(date), memberId: { type: "string" }, memberName: { type: "string" }, origin: { type: "string" } }, [], { additionalProperties: true }),
  HealthTimelineEvent: {
    oneOf: [
      objectSchema({ id: { type: "string" }, eventType: { const: "measurement" }, recordId: { type: "string" }, occurredAt: nullable(date), title: { type: "string" }, value: { type: "number" }, secondaryValue: nullable({ type: "number" }), unit: { type: "string" }, source: { type: "string" }, sourceType: { type: "string" } }),
      objectSchema({ id: { type: "string" }, eventType: { const: "medication" }, recordId: nullable({ type: "string" }), occurredAt: nullable(date), title: { type: "string" }, detail: nullable({ type: "string" }), source: { type: "string" }, sourceType: { type: "string" } }),
    ],
  },
};

function schemasPlaceholderHealthRecord() {
  return {
    id: { type: "string" },
    memberId: nullable({ type: "string" }),
    documentId: { type: "string" },
    type: stringEnum(["lab_report", "medical_report", "prescription"]),
    documentDate: nullable(date),
    provider: nullable({ type: "string" }),
    doctor: nullable({ type: "string" }),
    processingStatus: { type: "string" },
    processingError: nullable({ type: "string" }),
    measurementCount: { type: "integer" },
    trackedMeasurementCount: { type: "integer" },
    medicationCount: { type: "integer" },
    followUpCount: { type: "integer" },
    createdAt: dateTime,
    processedAt: nullable(dateTime),
    measurements: arrayOf(ref("HealthMeasurement")),
    medications: arrayOf({ type: "object", additionalProperties: true }),
    followUps: arrayOf({ type: "object", additionalProperties: true }),
    reminders: arrayOf({ type: "object", additionalProperties: true }),
  };
}

const hex64 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const uuid = "550e8400-e29b-41d4-a716-446655440000";
const authUserExample = {
  id: "user_example_123",
  name: "Example User",
  email: "developer@example.com",
  authVersion: 0,
  accountTier: "free",
};
const documentExample = {
  id: "doc_example_123",
  ownerProfileId: "user_example_123",
  title: "Example Passport",
  displayName: "Passport",
  uniqueIdentifier: "EXAMPLE-PASSPORT-ID",
  extractedKeyFields: { nameOnDocument: "Example User", expiryDate: "2030-01-01" },
  rawText: "Sample extracted text for documentation.",
  originalName: "passport.pdf",
  mimeType: "application/pdf",
  size: 245760,
  documentType: "passport",
  normalizedType: "passport",
  category: "travel",
  analysisSource: "ai",
  confidence: 95,
  classificationStatus: "verified",
  classificationConfidence: 95,
  ownershipStatus: "verified",
  readinessEligible: true,
  fields: { owner: "self", expiryDate: "2030-01-01", verified: true },
  source: "MANUAL_UPLOAD",
  sourceProvider: null,
  driveFileId: null,
  openUrl: null,
  lastAnalyzed: "2026-09-22T12:00:00.000Z",
  createdAt: "2026-09-22T12:00:00.000Z",
  updatedAt: "2026-09-22T12:00:00.000Z",
};
const packageRequirementExample = {
  id: "requirement_passport",
  title: "Passport",
  description: "Valid passport for identity and travel verification.",
  required: true,
  group: "Identity",
  documentType: "passport",
  owner: "self",
  metadata: { maxAgeDays: 3650 },
  acceptedDocumentTypes: ["passport"],
  alternativeLabels: ["Travel document"],
  sortOrder: 1,
};
const packageDefinitionExample = {
  id: "pack_visitor_visa",
  slug: "visitor-visa",
  title: "Visitor Visa",
  subtitle: "Documents commonly requested for a visitor visa application.",
  category: "Travel & Immigration",
  aliases: ["tourist visa"],
  description: "Public checklist for a generic visitor visa application.",
  keywords: ["visa", "travel", "passport"],
  searchMetadata: { intent: ["visitor visa"], region: "generic" },
  sourceType: "official",
  sourceName: "Example Public Agency",
  sourceTitle: "Visitor visa requirements",
  sourceUrl: "https://example.gov/visitor-visa",
  lastCheckedAt: "2026-09-22T00:00:00.000Z",
  verificationSources: [{ title: "Visitor visa requirements", url: "https://example.gov/visitor-visa" }],
  lastVerifiedAt: "2026-09-22T00:00:00.000Z",
  verificationStatus: "verified",
  createdBy: "seed",
  createdAt: "2026-09-22T00:00:00.000Z",
  version: 1,
  requirements: [packageRequirementExample],
};
const healthMemberExample = {
  id: "health_member_123",
  name: "Example User",
  relation: "Myself",
  bloodGroup: "O+",
  dateOfBirth: "1990-01-01",
  conditions: "No chronic conditions recorded.",
  allergies: "No known allergies.",
  emergencyContactName: "Example Contact",
  emergencyContactPhone: "+1-555-0100",
  primaryDoctor: "Dr. Example",
  insuranceProvider: "Example Health",
  insurancePolicyNumber: "POLICY-EXAMPLE",
  createdAt: "2026-09-22T12:00:00.000Z",
  updatedAt: "2026-09-22T12:00:00.000Z",
};
const healthMeasurementExample = {
  id: "measurement_example_123",
  sourceDocumentId: "health_record_123",
  recordId: "health_record_123",
  metricKey: "blood_pressure",
  displayName: "Blood Pressure",
  originalName: "BP",
  value: 120,
  secondaryValue: 80,
  unit: "mmHg",
  context: null,
  bodySite: null,
  referenceMin: null,
  referenceMax: null,
  referenceText: "Example reference range",
  measuredAt: "2026-09-20",
  sourceType: "lab_report",
  isTracked: true,
  aliases: ["blood pressure", "bp"],
};
const healthRecordSummaryExample = {
  id: "health_record_123",
  memberId: "health_member_123",
  documentId: "doc_example_123",
  type: "lab_report",
  documentDate: "2026-09-20",
  provider: "Example Diagnostics",
  doctor: "Dr. Example",
  processingStatus: "processed",
  processingError: null,
  measurementCount: 1,
  trackedMeasurementCount: 1,
  medicationCount: 0,
  followUpCount: 1,
  createdAt: "2026-09-22T12:00:00.000Z",
  processedAt: "2026-09-22T12:01:00.000Z",
};

const schemaExamples: Record<string, unknown> = {
  ErrorResponse: { message: "Invalid request.", code: "INVALID_ENCRYPTION_ENVELOPE", errorId: uuid, metadata: {} },
  UsageLimitErrorResponse: { success: false, code: "STORAGE_LIMIT_EXCEEDED", message: "This upload would exceed your 50 MB cloud storage limit.", usageBytes: 50000000, limitBytes: 52428800, incomingBytes: 3145728 },
  AuthUser: authUserExample,
  AuthResult: { token: "<example-access-token>", accessToken: "<example-access-token>", user: authUserExample },
  AccountUsage: { accountTier: "free", storage: { usedBytes: 1048576, limitBytes: 52428800, unlimited: false }, aiUsage: { used: 1, limit: 3, remaining: 2, unlimited: false, period: "2026-09" } },
  BootstrapResponse: { user: { id: "user_example_123", name: "Example User", email: "developer@example.com" }, accountTier: "free", storage: { usedBytes: 1048576, limitBytes: 52428800, unlimited: false }, aiUsage: { used: 1, limit: 3, remaining: 2, unlimited: false, period: "2026-09" }, documentCount: 4, version: "1" },
  PublicDocumentEncryptionKey: { keyId: "lifepack-development", keyVersion: 1, algorithm: "RSA-OAEP-4096-SHA256", publicKeyPem: "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AEXAMPLEONLY\n-----END PUBLIC KEY-----\n" },
  EncryptedDocumentEnvelope: { wrappedKey: "AbCdEf0123456789_example_wrapped_key", iv: "AbCdEf0123456789", encryptionVersion: 1, keyId: "lifepack-development", keyVersion: 1, contentAlgorithm: "AES-256-GCM", keyAlgorithm: "RSA-OAEP-4096-SHA256", originalFilename: "passport.pdf", originalMimeType: "application/pdf", originalSize: 245760, originalSha256: hex64, encryptedSha256: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789", aiAnalysisConsent: true },
  DocumentAnalysis: { success: true, document: { title: "Passport", documentType: "passport", category: "Travel", confidence: 95, fields: { nameOnDocument: "Example User" }, reviewFields: [], rawExtractedText: "", evidence: [{ label: "Document title", points: 20 }], ownership: "mine" }, files: [{ tempFileId: uuid, originalName: "passport.pdf", mimeType: "application/pdf", size: 245760 }], warnings: [] },
  DocumentValidation: { normalizedType: "passport", displayName: "Passport", category: "travel", uniqueIdentifierField: "passportNumber", uniqueIdentifier: "EXAMPLE-PASSPORT-ID", documentFingerprint: "passport:example-fingerprint", capabilities: ["passport"], validatedFields: { nameOnDocument: { value: "Example User", status: "valid" } }, reviewFields: [], missingRequiredFields: [], invalidFields: [], lowConfidenceFields: [], canSave: true, requiresUserConfirmation: false, warnings: [] },
  DocumentSaveRequest: { tempFileIds: [uuid], title: "Passport", category: "Travel", documentType: "passport", confidence: 95, fields: { nameOnDocument: "Example User" }, reviewFields: [], rawExtractedText: "", warnings: [], evidence: [], analysisSource: "ai", duplicateAction: "fail", userConfirmedUnknown: false, owner: "self", verified: true },
  Document: documentExample,
  PackageRequirement: packageRequirementExample,
  PackageDefinition: packageDefinitionExample,
  PackageSummary: { id: "pack_visitor_visa", slug: "visitor-visa", title: "Visitor Visa", category: "Travel & Immigration", description: "Public checklist for a generic visitor visa application.", source: { name: "Example Public Agency", title: "Visitor visa requirements", url: "https://example.gov/visitor-visa", lastCheckedAt: "2026-09-22" }, requirements: [packageRequirementExample] },
  PackageListResponse: { query: "visitor visa", items: [{ id: "pack_visitor_visa", slug: "visitor-visa", title: "Visitor Visa", category: "Travel & Immigration", description: "Public checklist for a generic visitor visa application.", requirements: [packageRequirementExample] }], matches: [{ id: "pack_visitor_visa", name: "Visitor Visa", slug: "visitor-visa", matchType: "exact_name", confidence: 1, matchedTokens: ["visitor", "visa"], missingTokens: [] }], hasConfidentMatch: true, canGenerate: false, pagination: { page: 1, limit: 20, total: 1, hasNextPage: false } },
  PackageSearchOrGenerateRequest: { packageType: "Visitor visa", documentLabels: ["Passport", "Bank statement"] },
  PackageSearchOrGenerateResult: { source: "existing", confidence: 0.98, matchReason: "exact_name", package: packageDefinitionExample },
  GmailStatus: { connected: true, account: "developer@example.com", lastScannedAt: "2026-09-22T12:00:00.000Z", scanning: false },
  GmailCandidate: { id: "gmail_candidate_123", userId: "user_example_123", provider: "gmail", subject: "Example statement attached", sender: "sender@example.com", filename: "statement.pdf", mimeType: "application/pdf", size: 245760, receivedAt: "2026-09-20T09:00:00.000Z", relevanceScore: 0.92, status: "pending" },
  GmailImportResult: { candidateId: "gmail_candidate_123", status: "imported", documentId: "doc_example_123", error: null },
  DriveStatus: { connected: true, account: "developer@example.com", scanStatus: "completed", lastScannedAt: "2026-09-22T12:00:00.000Z", lastSuccessfulSync: "2026-09-22T12:00:00.000Z", scanning: false, phase: null, processed: 12, total: 12, indexedCount: 8, error: null },
  DriveScanResult: { scanned: 12, imported: 2, skipped: 10, candidates: 2, errors: [] },
  TrustPermission: { module: "DOCUMENTS", canView: true, canDownload: false },
  TrustMember: { id: "trust_member_123", name: "Example Member", email: "member@example.com", relation: "OTHER", customRelation: "Caregiver", relationLabel: "Caregiver", dateOfBirth: "1990-01-01", bloodGroup: "O+", accessType: { id: "VIEW_ONLY", code: "VIEW_ONLY", name: "View only", description: "Can only view explicitly permitted modules." }, status: "INVITED", invitationStatus: "PENDING", permissions: [{ module: "DOCUMENTS", canView: true, canDownload: false }] },
  TrustConnection: { id: "trust_connection_123", owner: { id: "user_example_123", name: "Example Owner", email: "owner@example.com" }, relation: "PARENT", relationLabel: "Parent", accessType: { id: "FAMILY_MEMBER", code: "FAMILY_MEMBER", name: "Family member" }, status: "ACTIVE", acceptedAt: "2026-09-22T12:00:00.000Z" },
  TrustCenter: { role: "OWNER", owner: { id: "user_example_123", name: "Example User", email: "developer@example.com", accessType: "OWNER", note: "Owner access cannot be changed" }, memberCount: 1, members: [], connections: [], accessTypes: [{ id: "VIEW_ONLY", code: "VIEW_ONLY", name: "View only" }] },
  WealthFormCategory: { code: "loan", label: "Loan", description: null },
  WealthFormSubtype: { code: "home_loan", label: "Home Loan", description: null },
  WealthFormField: { id: "principalAmount", label: "Principal amount", inputType: "number", required: true, placeholder: null, defaultValue: null, options: null, validation: null, group: "Loan", visibility: null, order: 5 },
  WealthRecord: { id: "wealth_record_123", type: "LOAN_TAKEN", title: "Example home loan", details: { principalAmount: 500000, institution: "Example Bank" }, notes: "Example note", followUpDate: "2026-10-01T00:00:00.000Z", followUpNote: "Review rate", attachments: [], loanBreakdown: { principal: 500000, interest: 25000, payments: 10000, outstanding: 515000, monthsElapsed: 6, calculationType: "simple" }, createdAt: "2026-09-22T12:00:00.000Z", updatedAt: "2026-09-22T12:00:00.000Z" },
  WealthHandoffSummary: { generatedAt: "2026-09-22T12:00:00.000Z", recipients: { family: [], emergency: [] }, handoffTypes: [{ type: "family", label: "Family Handoff", contents: ["All Wealth records"], excluded: [], counts: { assets: 1, insurance: 0, loans: 1, financialRecords: 0, documents: 1, images: 0 } }] },
  HealthMember: healthMemberExample,
  HealthRecordSummary: healthRecordSummaryExample,
  HealthMeasurement: healthMeasurementExample,
  HealthRecord: { ...healthRecordSummaryExample, measurements: [healthMeasurementExample], medications: [], followUps: [], reminders: [] },
  TrackedHealthMetric: { id: "tracked_metric_123", userId: "user_example_123", memberId: "health_member_123", metricKey: "blood_pressure", displayName: "Blood Pressure", context: null, bodySite: null, enabled: true, createdAt: "2026-09-22T12:00:00.000Z", updatedAt: "2026-09-22T12:00:00.000Z" },
  HealthReminder: { id: "health_reminder_123", title: "Book follow-up", dueDate: "2026-10-01", memberId: "health_member_123", memberName: "Example User", origin: "manual" },
  HealthTimelineEvent: { id: "measurement_example_123", eventType: "measurement", recordId: "health_record_123", occurredAt: "2026-09-20", title: "Blood Pressure", value: 120, secondaryValue: 80, unit: "mmHg", source: "Lab result", sourceType: "lab_report" },
};

function humanize(key: string) {
  return key.replace(/([A-Z])/g, " $1").trim().replace(/^./, (char) => char.toUpperCase());
}

function enrichSchemaExamples() {
  for (const [name, schema] of Object.entries(schemas)) {
    const example = schemaExamples[name];
    if (example !== undefined && schema.example === undefined) schema.example = example;
    if (!schema.description) schema.description = `${humanize(name)} schema returned or accepted by the Readiness API.`;
    const properties = schema.properties as Record<string, Schema> | undefined;
    if (!properties) continue;
    const sample = example && typeof example === "object" && !Array.isArray(example) ? example as Record<string, unknown> : {};
    for (const [propertyName, property] of Object.entries(properties)) {
      if (!property.description) property.description = `${humanize(propertyName)} for ${humanize(name)}.`;
      if (Object.prototype.hasOwnProperty.call(sample, propertyName) && property.example === undefined) {
        property.example = sample[propertyName];
      }
    }
  }
}

enrichSchemaExamples();

const healthMemberInput = objectSchema({
  name: { type: "string", minLength: 1, maxLength: 120 },
  relation: { type: "string", minLength: 1, maxLength: 80 },
  bloodGroup: nullable(stringEnum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "Unknown"])),
  dateOfBirth: nullable({ ...date, description: "Must be a real date, not in the future, and within the last 120 years." }),
  conditions: nullable({ type: "string", maxLength: 2000 }),
  allergies: nullable({ type: "string", maxLength: 2000 }),
  emergencyContactName: nullable({ type: "string", maxLength: 120 }),
  emergencyContactPhone: nullable({ type: "string", maxLength: 40 }),
  primaryDoctor: nullable({ type: "string", maxLength: 160 }),
  insuranceProvider: nullable({ type: "string", maxLength: 160 }),
  insurancePolicyNumber: nullable({ type: "string", maxLength: 120 }),
}, ["name", "relation"]);

const trustMemberBase = objectSchema({
  name: { type: "string", minLength: 1, maxLength: 120 },
  email: { type: "string", format: "email", maxLength: 254 },
  relation: stringEnum(["SPOUSE", "PARENT", "CHILD", "SIBLING", "GUARDIAN", "RELATIVE", "FRIEND", "OTHER"]),
  customRelation: { type: "string", minLength: 1, maxLength: 80, description: "Required when relation is OTHER." },
  dateOfBirth: date,
  bloodGroup: stringEnum(["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"]),
  accessTypeCode: stringEnum(["VIEW_ONLY", "FAMILY_MEMBER", "EMERGENCY_ACCESS"]),
  permissions: { type: "array", items: ref("TrustPermission"), default: [] },
}, ["name", "email", "relation", "dateOfBirth", "bloodGroup", "accessTypeCode"]);

const ops: Operation[] = [
  { method: "get", path: "/health", tags: ["System"], summary: "Service health check", operationId: "getHealth", description: "Public liveness check for the backend service.", responses: { 200: response("Service is healthy", objectSchema({ status: { const: "ok" }, service: { const: "readiness-backend" }, timestamp: dateTime }), { status: "ok", service: "readiness-backend", timestamp: "2026-09-22T12:00:00.000Z" }) } },

  { method: "post", path: "/auth/signup", tags: ["Authentication"], summary: "Create account", operationId: "signup", description: "Creates a user. The JSON response omits the refresh token; the server sets the HttpOnly readiness_refresh cookie.", requestBody: body(objectSchema({ name: { type: "string", minLength: 1 }, email: { type: "string", format: "email" }, password: { type: "string", minLength: 8 } }, ["name", "email", "password"]), { name: "Example User", email: "user@example.com", password: "ExamplePassword1!" }), responses: { 201: response("Authenticated signup result. Sets readiness_refresh cookie.", ref("AuthResult")), ...errorResponses("400", "409", "429") } },
  { method: "post", path: "/auth/login", tags: ["Authentication"], summary: "Sign in with email and password", operationId: "login", description: "Authenticates with email and password. Copy accessToken into Swagger Authorize for protected APIs. The refresh token is sent only as an HttpOnly readiness_refresh cookie.", requestBody: body(objectSchema({ email: { type: "string", format: "email" }, password: { type: "string", minLength: 1 } }, ["email", "password"]), { email: "user@example.com", password: "ExamplePassword1!" }), responses: { 200: response("Authenticated login result. Sets readiness_refresh cookie.", ref("AuthResult")), ...errorResponses("400", "401", "429") } },
  { method: "post", path: "/auth/google", tags: ["Authentication"], summary: "Sign in with Google credential", operationId: "googleLogin", description: "Exchanges a Google ID credential for the normal Readiness session. Returns the public auth result and sets readiness_refresh. Google sign-in must be configured.", requestBody: body(objectSchema({ credential: { type: "string", minLength: 1 } }, ["credential"]), { credential: "fake-google-id-credential" }), responses: { 200: response("Authenticated Google result", ref("AuthResult")), ...errorResponses("400", "401", "429", "503") } },
  { method: "post", path: "/auth/refresh", tags: ["Authentication"], summary: "Rotate session from refresh cookie", operationId: "refreshSession", security: refreshSecured, description: "Uses the HttpOnly readiness_refresh cookie. No JSON body is normally sent. Success rotates the refresh cookie and returns a new access token.", responses: { 200: response("New auth result. Rotates readiness_refresh cookie.", ref("AuthResult")), ...errorResponses("401", "429") } },
  { method: "post", path: "/auth/logout", tags: ["Authentication"], summary: "Logout current session", operationId: "logout", security: refreshSecured, description: "Revokes the current refresh token when present and always clears the Readiness refresh cookie. If no cookie is present, it still returns a logged-out response.", responses: { 200: response("Logged out", objectSchema({ message: { type: "string" } })), ...errorResponses("429") } },
  { method: "post", path: "/auth/logout-all", tags: ["Authentication"], summary: "Logout all sessions", operationId: "logoutAll", security: secured, description: "Bearer auth required. Revokes all refresh sessions for the current user and clears the refresh cookie.", responses: { 200: response("All sessions revoked", objectSchema({ message: { type: "string" } })), ...errorResponses("401", "429") } },
  { method: "post", path: "/auth/forgot-password", tags: ["Authentication"], summary: "Request password reset link", operationId: "forgotPassword", description: "Privacy-preserving endpoint. It returns the same generic message whether an account exists or not.", requestBody: body(objectSchema({ email: { type: "string", format: "email" } }, ["email"]), { email: "user@example.com" }), responses: { 200: response("Generic reset response", objectSchema({ message: { type: "string" } })), ...errorResponses("400", "429") } },
  { method: "post", path: "/auth/forgot-password/otp", tags: ["Authentication"], summary: "Request password reset OTP", operationId: "forgotPasswordOtp", description: "Current HTTP API for requesting a 6-digit password reset OTP by email. Response is privacy-preserving.", requestBody: body(objectSchema({ email: { type: "string", format: "email" } }, ["email"]), { email: "user@example.com" }), responses: { 200: response("Generic OTP response", objectSchema({ message: { type: "string" } })), ...errorResponses("400", "429", "502") } },
  { method: "post", path: "/auth/reset-password", tags: ["Authentication"], summary: "Reset password with token", operationId: "resetPassword", description: "Resets a password with a reset token. Token must be trimmed and at least 32 characters.", requestBody: body(objectSchema({ token: { type: "string", minLength: 32 }, password: { type: "string", minLength: 8 } }, ["token", "password"]), { token: "reset-token-with-at-least-32-characters", password: "NewPassword123!" }), responses: { 200: response("Password reset", objectSchema({ message: { type: "string" } })), ...errorResponses("400", "429") } },
  { method: "post", path: "/auth/reset-password/otp", tags: ["Authentication"], summary: "Reset password with OTP", operationId: "resetPasswordOtp", description: "Resets a password using email, 6-digit OTP, and a new password. This stricter OTP path requires lowercase, uppercase, number, and symbol in the new password.", requestBody: body(objectSchema({ email: { type: "string", format: "email" }, otp: { type: "string", pattern: "^\\d{6}$" }, password: { type: "string", minLength: 8 } }, ["email", "otp", "password"]), { email: "user@example.com", otp: "123456", password: "NewPassword123!" }), responses: { 200: response("Password reset", objectSchema({ message: { type: "string" } })), ...errorResponses("400", "429") } },
  { method: "get", path: "/auth/me", tags: ["Authentication"], summary: "Get current user", operationId: "getCurrentUser", security: secured, description: "Returns the user embedded in the validated bearer access token.", responses: { 200: response("Current user", objectSchema({ user: ref("AuthUser") })), ...errorResponses("401") } },

  { method: "get", path: "/api/bootstrap", tags: ["Bootstrap"], summary: "Bootstrap authenticated app state", operationId: "getBootstrap", security: secured, description: "Returns the current user, account usage, document count, recovery setup state, and API bootstrap version.", responses: { 200: response("Bootstrap response", ref("BootstrapResponse")), ...errorResponses("401") } },
  { method: "get", path: "/api/bootstrap/usage", tags: ["Bootstrap"], summary: "Get account usage", operationId: "getAccountUsage", security: secured, description: "Drains pending storage cleanup before calculating storage and monthly AI usage for the current account.", responses: { 200: response("Account usage", ref("AccountUsage")), ...errorResponses("401") } },
];

const documentUploadDescription = "Bearer auth required. Multipart client-side encrypted upload. Preferred multi-file format uses encryptedFiles (1-10 application/octet-stream parts) plus an envelopes form field containing a serialized JSON array of EncryptedDocumentEnvelope objects. The server also accepts the legacy single-file fallback encryptedFile with envelope fields as individual form fields. Original files must be PDF/JPEG/PNG/WebP, max 10 MB before AES-GCM tag.";
ops.push(
  { method: "get", path: "/documents/encryption-key", tags: ["Documents"], summary: "Get public document encryption key", operationId: "getDocumentEncryptionKey", security: secured, description: "Returns the active public RSA key and encryption contract used by browser-side hybrid encryption. Private key material is never exposed.", responses: { 200: response("Public encryption key", ref("PublicDocumentEncryptionKey")), ...errorResponses("401") } },
  { method: "post", path: "/documents/analyze", tags: ["Documents"], summary: "Analyze encrypted document upload", operationId: "analyzeDocumentUpload", security: secured, description: `${documentUploadDescription} Success returns analysis and temporary upload IDs for review; it does not permanently save the document.`, requestBody: { required: true, content: { "multipart/form-data": { schema: objectSchema({ encryptedFiles: { type: "array", minItems: 1, maxItems: 10, items: { type: "string", format: "binary" } }, envelopes: { type: "string", description: "JSON.stringify array of EncryptedDocumentEnvelope objects." }, aiAnalysisConsent: { type: "string", enum: ["true", "false"], default: "false" } }, ["encryptedFiles", "envelopes"]) } } }, responses: { 200: response("Analysis response", ref("DocumentAnalysis")), 409: response("Duplicate document", objectSchema({ code: { const: "DUPLICATE_DOCUMENT" }, message: { type: "string" }, duplicateDocument: ref("Document") })), ...errorResponses("400", "401", "413", "415", "422", "429") } },
  { method: "post", path: "/documents/upload", tags: ["Documents"], summary: "Upload encrypted document for review", operationId: "uploadDocumentForReview", security: secured, description: `${documentUploadDescription} Same contract and response shape as /documents/analyze, but returns 202 for clients that treat upload as an accepted review step.`, requestBody: { required: true, content: { "multipart/form-data": { schema: objectSchema({ encryptedFiles: { type: "array", minItems: 1, maxItems: 10, items: { type: "string", format: "binary" } }, envelopes: { type: "string" }, aiAnalysisConsent: { type: "string", enum: ["true", "false"], default: "false" } }, ["encryptedFiles", "envelopes"]) } } }, responses: { 202: response("Accepted analysis response", ref("DocumentAnalysis")), 409: response("Duplicate document", ref("ErrorResponse")), ...errorResponses("400", "401", "413", "415", "422", "429") } },
  { method: "post", path: "/documents", tags: ["Documents"], summary: "Save reviewed document", operationId: "saveDocument", security: secured, description: "Persists reviewed temporary uploads. Manual saves require category only as mandatory metadata; manual expiry must be YYYY-MM-DD when supplied. Temporary upload references expire and cannot be reused. Duplicate behavior is controlled by duplicateAction.", requestBody: body(ref("DocumentSaveRequest"), { tempFileIds: ["00000000-0000-4000-8000-000000000000"], category: "Medical", analysisSource: "manual", duplicateAction: "fail" }), responses: { 201: response("Document created", objectSchema({ document: ref("Document"), validation: ref("DocumentValidation") })), 200: response("Document replaced", objectSchema({ document: ref("Document"), validation: ref("DocumentValidation"), replaced: { type: "boolean" } })), 404: response("Temporary upload expired", objectSchema({ code: { const: "TEMPORARY_UPLOAD_EXPIRED" }, message: { type: "string" } })), 409: response("Duplicate document", objectSchema({ code: { const: "DUPLICATE_DOCUMENT" }, message: { type: "string" }, duplicateDocument: ref("Document"), actions: arrayOf({ type: "string" }), validation: ref("DocumentValidation") })), 422: response("Validation failed, including CATEGORY_REQUIRED or INVALID_EXPIRY_DATE", ref("ErrorResponse")), ...errorResponses("400", "401", "429") } },
  { method: "get", path: "/documents", tags: ["Documents"], summary: "List saved documents", operationId: "listDocuments", security: secured, description: "Returns all non-deleted documents owned by the current user in newest-first order.", responses: { 200: response("Documents", arrayOf(ref("Document"))), ...errorResponses("401") } },
  { method: "post", path: "/documents/bulk-download", tags: ["Documents"], summary: "Download documents ZIP", operationId: "bulkDownloadDocuments", security: secured, description: "Streams a ZIP containing decrypted originals for documents owned by the current user. Original filenames are preserved and made unique inside the archive.", requestBody: body(objectSchema({ ids: { type: "array", minItems: 1, maxItems: 100, items: { type: "string", minLength: 1 } } }, ["ids"]), { ids: ["document_1", "document_2"] }), responses: { 200: binaryResponse("ZIP file stream"), ...errorResponses("400", "401", "404", "500") } },
  { method: "post", path: "/documents/bulk-delete", tags: ["Documents"], summary: "Delete documents", operationId: "bulkDeleteDocuments", security: secured, description: "Deletes multiple owned documents and queues encrypted storage cleanup for every associated stored file.", requestBody: body(objectSchema({ ids: { type: "array", minItems: 1, maxItems: 100, items: { type: "string", minLength: 1 } } }, ["ids"]), { ids: ["document_1", "document_2"] }), responses: { 204: response("Deleted"), ...errorResponses("400", "401", "404") } },
  { method: "get", path: "/documents/{id}", tags: ["Documents"], summary: "Get document", operationId: "getDocument", security: secured, description: "Returns one decrypted document DTO owned by the current user.", parameters: [idParam("id", "Document id")], responses: { 200: response("Document", ref("Document")), ...errorResponses("401", "404") } },
  { method: "delete", path: "/documents/{id}", tags: ["Documents"], summary: "Delete document", operationId: "deleteDocument", security: secured, description: "Deletes the document record and queues encrypted storage cleanup for owned files.", parameters: [idParam("id", "Document id")], responses: { 204: response("Deleted"), ...errorResponses("401", "404") } },
  { method: "get", path: "/documents/{id}/download", tags: ["Documents"], summary: "Download document file", operationId: "downloadDocument", security: secured, description: "Streams the decrypted original document with attachment Content-Disposition. Public storage URLs are never exposed.", parameters: [idParam("id", "Document id")], responses: { 200: binaryResponse("Binary file stream"), ...errorResponses("401", "404", "500") } },
  { method: "get", path: "/documents/{id}/preview", tags: ["Documents"], summary: "Preview document file", operationId: "previewDocument", security: secured, description: "Streams the decrypted document inline for browser preview. Google Drive-sourced documents redirect to the Drive open URL with HTTP 302.", parameters: [idParam("id", "Document id")], responses: { 200: binaryResponse("Inline binary file stream"), 302: response("Redirect to Google Drive file"), ...errorResponses("401", "404", "500") } },
);

function addPackageAlias(prefix: "/packs" | "/packages" | "/api/packages") {
  const canonical = prefix === "/api/packages";
  ops.push(
    { method: "get", path: `${prefix}/search`, tags: ["Packages"], summary: `Search package definitions (${prefix})`, operationId: `searchPackages${prefix.replace(/\W/g, "_")}`, security: secured, description: "Finds at most one matching default package definition by query text.", parameters: [query("q", { type: "string", minLength: 1, maxLength: 160 }, "Package search query", true)], responses: { 200: response("Zero or one matching package definitions", arrayOf(ref("PackageDefinition"))), ...errorResponses("400", "401") } },
    { method: "post", path: `${prefix}/search-or-generate`, tags: ["Packages"], summary: `Search or generate package (${prefix})`, operationId: `searchOrGeneratePackage${prefix.replace(/\W/g, "_")}`, security: secured, description: "Searches for an existing package definition or generates one from public requirements. Send Accept: application/json for JSON or Accept: text/event-stream for SSE events. SSE event types are delta { text }, result PackageSearchOrGenerateResult, and error ErrorResponse.", requestBody: body(ref("PackageSearchOrGenerateRequest"), { packageType: "Canada visitor visa", documentLabels: ["Passport", "Bank statement"] }), responses: { 200: { description: "JSON result or SSE stream", content: { [json]: { schema: ref("PackageSearchOrGenerateResult") }, "text/event-stream": { schema: { type: "string", description: "Server-sent events: delta, result, error." } } } }, ...errorResponses("400", "401", "404", "429", "503") } },
    { method: "get", path: `${prefix}/{slug}`, tags: ["Packages"], summary: `Get package by slug (${prefix})`, operationId: `getPackage${prefix.replace(/\W/g, "_")}`, security: secured, description: "Loads a full package definition by slug.", parameters: [idParam("slug", "Package slug")], responses: { 200: response("Package definition", ref("PackageDefinition")), ...errorResponses("401", "404") } },
    { method: "get", path: prefix, tags: ["Packages"], summary: `List packages (${prefix})`, operationId: `listPackages${prefix.replace(/\W/g, "_")}`, security: secured, description: canonical ? "Lists package summaries with filters. If ids is supplied, returns matching full definitions by comma-separated slugs." : "Without ids, returns getPackageDefinitions() full definitions. If ids is supplied, returns matching full definitions by comma-separated slugs.", parameters: [
      query("ids", { type: "string", minLength: 1, maxLength: 500 }, "Optional comma-separated slugs."),
      ...(canonical ? [
        query("category", { type: "string", minLength: 1, maxLength: 80 }, "Category filter."),
        query("limit", { type: "integer", minimum: 1, maximum: 200, default: 200 }, "Page size."),
        query("location", { type: "string", minLength: 1, maxLength: 80 }, "Location filter."),
        query("page", { type: "integer", minimum: 1, default: 1 }, "Page number."),
        query("provider", { type: "string", minLength: 1, maxLength: 80 }, "Provider/source filter."),
        query("search", { type: "string", minLength: 1, maxLength: 160 }, "Text search."),
        query("sort", { type: "string", enum: ["category", "newest", "relevance", "title"], default: "category" }, "Sort order."),
      ] : []),
    ], responses: { 200: response(canonical ? "Paginated package summaries, or package definitions when ids is supplied" : "Package definitions", canonical ? { oneOf: [ref("PackageListResponse"), arrayOf(ref("PackageDefinition"))] } : arrayOf(ref("PackageDefinition"))), ...errorResponses("400", "401") } },
  );
}
addPackageAlias("/packs");
addPackageAlias("/packages");
addPackageAlias("/api/packages");

ops.push(
  { method: "post", path: "/admin/readiness/seed", tags: ["Admin"], summary: "Seed readiness packages", operationId: "seedReadinessPackages", security: adminSecured, description: "Admin seed endpoint. In production, ALLOW_READINESS_SEED must be true. If ADMIN_SEED_TOKEN is configured, pass x-admin-seed-token.", responses: { 200: response("Seed result", objectSchema({ seeded: { type: "integer" } })), ...errorResponses("403", "429", "500") } },
);

function oauthCallback(provider: "gmail" | "drive") {
  const name = provider === "gmail" ? "Gmail" : "Google Drive";
  const prefix = provider === "gmail" ? "/api/integrations/gmail" : "/api/integrations/drive";
  ops.push({ method: "get", path: `${prefix}/callback`, tags: [provider === "gmail" ? "Gmail Integration" : "Google Drive Integration"], summary: `${name} OAuth callback`, operationId: `${provider}OAuthCallback`, description: "Public OAuth popup callback. Either code or error is expected. Returns HTML that posts a message to the opener and includes a fallback redirect.", parameters: [query("code", { type: "string", minLength: 1 }, "OAuth code."), query("state", { type: "string", minLength: 1 }, "OAuth state."), query("error", { type: "string", minLength: 1 }, "OAuth error."), query("error_description", { type: "string", minLength: 1 }, "OAuth error description.")], responses: { 200: response("Callback HTML", { type: "string" }, "<!doctype html><html>...</html>", html) } });
}
oauthCallback("gmail");
ops.push(
  { method: "get", path: "/api/integrations/gmail/status", tags: ["Gmail Integration"], summary: "Get Gmail status", operationId: "getGmailStatus", security: secured, description: "Checks whether Gmail is connected and whether a scan is active.", responses: { 200: response("Gmail status", ref("GmailStatus")), ...errorResponses("401") } },
  { method: "post", path: "/api/integrations/gmail/authorize", tags: ["Gmail Integration"], summary: "Create Gmail authorization URL", operationId: "authorizeGmail", security: secured, description: "Creates an OAuth authorization URL. Open it in a popup, then wait for the callback.", responses: { 200: response("Authorization URL", objectSchema({ authorizationUrl: { type: "string", format: "uri" } })), ...errorResponses("401", "429", "503") } },
  { method: "post", path: "/api/integrations/gmail/scan", tags: ["Gmail Integration"], summary: "Scan Gmail attachments", operationId: "scanGmail", security: secured, description: "Scans Gmail for relevant document candidates. Only one scan per user is executed at a time in-process.", requestBody: body(objectSchema({ full: { type: "boolean", default: false } }), { full: false }), responses: { 200: response("Scan result", { type: "object", additionalProperties: true }), ...errorResponses("400", "401", "429", "503") } },
  { method: "get", path: "/api/integrations/gmail/candidates", tags: ["Gmail Integration"], summary: "List Gmail candidates", operationId: "listGmailCandidates", security: secured, description: "Returns up to 500 Gmail external document candidates sorted by relevance and received date.", responses: { 200: response("Candidates", objectSchema({ candidates: arrayOf(ref("GmailCandidate")) })), ...errorResponses("401") } },
  { method: "post", path: "/api/integrations/gmail/candidates/{id}/dismiss", tags: ["Gmail Integration"], summary: "Dismiss Gmail candidate", operationId: "dismissGmailCandidate", security: secured, description: "Marks a candidate as dismissed for the current user.", parameters: [idParam("id", "Candidate id")], responses: { 204: response("Dismissed"), ...errorResponses("401", "404") } },
  { method: "post", path: "/api/integrations/gmail/import", tags: ["Gmail Integration"], summary: "Import Gmail candidates", operationId: "importGmailCandidates", security: secured, description: "Imports selected Gmail candidates as temporary uploads/documents according to importer behavior.", requestBody: body(objectSchema({ candidateIds: { type: "array", minItems: 1, maxItems: 25, items: { type: "string", minLength: 1 } } }, ["candidateIds"]), { candidateIds: ["candidate_1"] }), responses: { 200: response("Import results", objectSchema({ results: arrayOf(ref("GmailImportResult")) })), ...errorResponses("400", "401", "413", "429", "503") } },
  { method: "delete", path: "/api/integrations/gmail", tags: ["Gmail Integration"], summary: "Disconnect Gmail", operationId: "disconnectGmail", security: secured, description: "Disconnects Gmail and removes non-imported candidates. Returns 204 even when no connection exists; returns 409 while a scan is running.", responses: { 204: response("Disconnected"), ...errorResponses("401", "409", "429") } },
);

oauthCallback("drive");
ops.push(
  { method: "get", path: "/api/integrations/drive/status", tags: ["Google Drive Integration"], summary: "Get Google Drive status", operationId: "getDriveStatus", security: secured, description: "Checks Google Drive connection, scan status, progress, and indexed count.", responses: { 200: response("Drive status", ref("DriveStatus")), ...errorResponses("401") } },
  { method: "post", path: "/api/integrations/drive/authorize", tags: ["Google Drive Integration"], summary: "Create Drive authorization URL", operationId: "authorizeDrive", security: secured, description: "Creates a Google Drive OAuth authorization URL for the current user.", responses: { 200: response("Authorization URL", objectSchema({ authorizationUrl: { type: "string", format: "uri" } })), ...errorResponses("401", "429", "503") } },
  { method: "post", path: "/api/integrations/drive/scan", tags: ["Google Drive Integration"], summary: "Scan Google Drive", operationId: "scanDrive", security: secured, description: "Scans Drive documents and imports/indexes them according to duplicateAction. Returns 409 if a scan is already running.", requestBody: body(objectSchema({ full: { type: "boolean", default: false }, duplicateAction: { type: "string", enum: ["replace", "keep_both", "ignore"], default: "ignore" } }), { full: false, duplicateAction: "ignore" }), responses: { 200: response("Drive scan result", ref("DriveScanResult")), ...errorResponses("400", "401", "409", "429", "503") } },
  { method: "delete", path: "/api/integrations/drive", tags: ["Google Drive Integration"], summary: "Disconnect Google Drive", operationId: "disconnectDrive", security: secured, description: "Disconnects Google Drive. Returns 204 even when absent; returns 409 while a scan is running.", responses: { 204: response("Disconnected"), ...errorResponses("401", "409", "429") } },
);

ops.push(
  { method: "get", path: "/api/trust/invitations/{token}", tags: ["Trust Center"], summary: "Get public trust invitation", operationId: "getTrustInvitation", description: "Public endpoint for invitation preview. Token must be at least 32 trimmed characters and invitation must be active/unexpired.", parameters: [idParam("token", "Invitation token")], responses: { 200: response("Invitation", objectSchema({ id: { type: "string" }, ownerName: { type: "string" }, memberName: { type: "string" }, relationLabel: { type: "string" }, accessType: { type: "object", additionalProperties: true }, expiresAt: dateTime })), ...errorResponses("404") } },
  { method: "post", path: "/api/trust/invitations/{token}/accept", tags: ["Trust Center"], summary: "Accept public trust invitation", operationId: "acceptTrustInvitation", description: "Accepts an invitation using a 6-digit PIN. After 5 wrong attempts, the PIN is temporarily locked for 15 minutes.", parameters: [idParam("token", "Invitation token")], requestBody: body(objectSchema({ pin: { type: "string", pattern: "^\\d{6}$" } }, ["pin"]), { pin: "123456" }), responses: { 200: response("Accepted", objectSchema({ message: { type: "string" } })), ...errorResponses("400", "404", "429") } },
  { method: "post", path: "/api/trust/invitations/{token}/reject", tags: ["Trust Center"], summary: "Reject public trust invitation", operationId: "rejectTrustInvitation", description: "Rejects an active invitation and clears token expiry.", parameters: [idParam("token", "Invitation token")], responses: { 200: response("Rejected", objectSchema({ message: { type: "string" } })), ...errorResponses("404") } },
  { method: "get", path: "/api/trust", tags: ["Trust Center"], summary: "Get Trust Center", operationId: "getTrustCenter", security: secured, description: "Returns owned members, accepted connections where current user is a member, and access type metadata.", responses: { 200: response("Trust center", ref("TrustCenter")), ...errorResponses("401") } },
  { method: "post", path: "/api/trust/family-members", tags: ["Trust Center"], summary: "Create family member profile", operationId: "createFamilyMember", security: secured, description: "Creates an active family profile without sending an invitation. Used by Manage Family Members; permissions control whether the profile can receive Wealth SOS handoffs.", requestBody: body(trustMemberBase, { name: "Example Member", email: "member@example.com", relation: "PARENT", customRelation: "Father", dateOfBirth: "1990-01-01", bloodGroup: "O+", accessTypeCode: "FAMILY_MEMBER", permissions: [{ module: "WEALTH", canView: true, canDownload: true }] }), responses: { 201: response("Trust member", ref("TrustMember")), ...errorResponses("400", "401", "409") } },
  { method: "post", path: "/api/trust/members", tags: ["Trust Center"], summary: "Invite trust member", operationId: "createTrustMember", security: secured, description: "Creates an invitation with a 24-hour token lifecycle. customRelation is required when relation is OTHER. PIN is required only for creation/reset.", requestBody: body({ ...trustMemberBase, properties: { ...(trustMemberBase.properties as object), pin: { type: "string", pattern: "^\\d{6}$" } }, required: [...(trustMemberBase.required as string[]), "pin"] }, { name: "Example Member", email: "member@example.com", relation: "OTHER", customRelation: "Neighbor", dateOfBirth: "1990-01-01", bloodGroup: "O+", accessTypeCode: "VIEW_ONLY", permissions: [{ module: "DOCUMENTS", canView: true, canDownload: false }], pin: "123456" }), responses: { 201: response("Trust member", ref("TrustMember")), ...errorResponses("400", "401", "409", "502") } },
  { method: "patch", path: "/api/trust/members/{id}", tags: ["Trust Center"], summary: "Update trust member", operationId: "updateTrustMember", security: secured, description: "Partial update for Trust member fields and permissions. PIN is intentionally not accepted by this route; use reset-pin.", parameters: [idParam("id", "Trust member id")], requestBody: body({ ...trustMemberBase, required: [] }, { permissions: [{ module: "HEALTH", canView: true, canDownload: false }] }), responses: { 200: response("Trust member", ref("TrustMember")), ...errorResponses("400", "401", "404") } },
  { method: "post", path: "/api/trust/members/{id}/resend-invitation", tags: ["Trust Center"], summary: "Resend trust invitation", operationId: "resendTrustInvitation", security: secured, description: "Creates a new 24-hour invitation token for an invited or rejected member and sends email.", parameters: [idParam("id", "Trust member id")], responses: { 200: response("Trust member", ref("TrustMember")), ...errorResponses("401", "404", "502") } },
  { method: "post", path: "/api/trust/members/{id}/reset-pin", tags: ["Trust Center"], summary: "Reset invitation PIN", operationId: "resetTrustPin", security: secured, description: "Sets a new 6-digit PIN for an invited member and clears lockout state.", parameters: [idParam("id", "Trust member id")], requestBody: body(objectSchema({ pin: { type: "string", pattern: "^\\d{6}$" } }, ["pin"]), { pin: "123456" }), responses: { 200: response("Trust member", ref("TrustMember")), ...errorResponses("400", "401", "404") } },
  { method: "delete", path: "/api/trust/members/{id}", tags: ["Trust Center"], summary: "Revoke trust member", operationId: "deleteTrustMember", security: secured, description: "Revokes an owned Trust member invitation/connection.", parameters: [idParam("id", "Trust member id")], responses: { 204: response("Revoked"), ...errorResponses("401", "404") } },
  { method: "post", path: "/api/trust/connections/{id}/leave", tags: ["Trust Center"], summary: "Leave trust connection", operationId: "leaveTrustConnection", security: secured, description: "Revokes an active connection where the current user is the member.", parameters: [idParam("id", "Trust connection id")], responses: { 204: response("Left connection"), ...errorResponses("401", "404") } },
);

ops.push(
  { method: "get", path: "/api/wealth/form/categories", tags: ["Wealth"], summary: "List Wealth form categories", operationId: "listWealthFormCategories", security: secured, description: "Returns available Wealth form categories from dynamic form tables or the built-in catalog fallback.", responses: { 200: response("Categories", arrayOf(ref("WealthFormCategory"))), ...errorResponses("401") } },
  { method: "get", path: "/api/wealth/form/categories/{categoryCode}/subtypes", tags: ["Wealth"], summary: "List Wealth form subtypes", operationId: "listWealthFormSubtypes", security: secured, description: "Returns active subtypes for a Wealth category. Retrieve these before submitting dynamic form values.", parameters: [idParam("categoryCode", "Wealth category code")], responses: { 200: response("Subtypes", arrayOf(ref("WealthFormSubtype"))), ...errorResponses("401", "404") } },
  { method: "get", path: "/api/wealth/form/categories/{categoryCode}/subtypes/{subtypeCode}/schema", tags: ["Wealth"], summary: "Get Wealth form schema", operationId: "getWealthFormSchema", security: secured, description: "Returns dynamic field definitions. Required values are determined by this schema; clients should call this before POST /api/wealth/form/records.", parameters: [idParam("categoryCode", "Wealth category code"), idParam("subtypeCode", "Wealth subtype code")], responses: { 200: response("Schema", objectSchema({ category: ref("WealthFormCategory"), subtype: ref("WealthFormSubtype"), fields: arrayOf(ref("WealthFormField")) })), ...errorResponses("401", "404") } },
  { method: "post", path: "/api/wealth/form/records", tags: ["Wealth"], summary: "Create Wealth record from dynamic form", operationId: "createWealthRecordFromForm", security: secured, description: "Creates a Wealth record from category/subtype schema values. Values may be string, number, boolean, null, or array of strings. For loan forms, supported fields include principalAmount, institution, referenceNumber, location, startDate, durationMonths, interestRate, interestFrequency, interestCalculationType, paymentsMade, attachmentDocumentIds, notes, followUpDate, and followUpNote when present in the schema.", requestBody: body(objectSchema({ categoryCode: { type: "string", minLength: 1 }, subtypeCode: { type: "string", minLength: 1 }, values: { type: "object", additionalProperties: { oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "null" }, { type: "array", items: { type: "string" } }] } } }, ["categoryCode", "subtypeCode", "values"]), { categoryCode: "loan", subtypeCode: "home_loan", values: { principalAmount: 500000, institution: "Example Bank" } }), responses: { 201: response("Wealth record", ref("WealthRecord")), ...errorResponses("400", "401", "404", "503") } },
  { method: "get", path: "/api/wealth/records", tags: ["Wealth"], summary: "List Wealth records", operationId: "listWealthRecords", security: secured, description: "Returns encrypted/decrypted Wealth records for the current user. If the records table has not been migrated yet, the current implementation returns an empty array.", responses: { 200: response("Wealth records", arrayOf(ref("WealthRecord"))), ...errorResponses("401") } },
  { method: "post", path: "/api/wealth/records", tags: ["Wealth"], summary: "Create Wealth record", operationId: "createWealthRecord", security: secured, description: "Creates a direct Wealth record. attachmentDocumentIds must belong to the current user.", requestBody: body(objectSchema({ type: stringEnum(["ASSET", "LOAN_TAKEN", "LOAN_GIVEN", "INSURANCE", "PAYMENT_PROOF"]), title: { type: "string", minLength: 1, maxLength: 160 }, details: { type: "object", additionalProperties: { oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "null" }, { type: "array", items: { type: "string" } }] }, default: {} }, notes: { type: "string", maxLength: 4000 }, followUpDate: nullable({ type: "string" }), followUpNote: { type: "string", maxLength: 2000 }, attachmentDocumentIds: { type: "array", items: { type: "string", minLength: 1 }, default: [] } }, ["type", "title"]), { type: "ASSET", title: "Example fixed deposit", details: { institution: "Example Bank" }, attachmentDocumentIds: [] }), responses: { 201: response("Wealth record", ref("WealthRecord")), ...errorResponses("400", "401", "503") } },
  { method: "patch", path: "/api/wealth/records/{recordId}", tags: ["Wealth"], summary: "Update Wealth record", operationId: "updateWealthRecord", security: secured, description: "Updates an existing Wealth record owned by the current user, including notes, access fields stored in details, and linked proof documents.", parameters: [idParam("recordId", "Wealth record id")], requestBody: body(objectSchema({ type: stringEnum(["ASSET", "LOAN_TAKEN", "LOAN_GIVEN", "INSURANCE", "PAYMENT_PROOF"]), title: { type: "string", minLength: 1, maxLength: 160 }, details: { type: "object", additionalProperties: true }, notes: { type: "string", maxLength: 4000 }, followUpDate: nullable({ type: "string" }), followUpNote: { type: "string", maxLength: 2000 }, attachmentDocumentIds: { type: "array", items: { type: "string", minLength: 1 }, default: [] } }, ["type", "title"]), { type: "ASSET", title: "Updated fixed deposit", details: { accessInstruction: "Ask the branch manager" }, attachmentDocumentIds: [] }), responses: { 200: response("Wealth record", ref("WealthRecord")), ...errorResponses("400", "401", "404", "503") } },
  { method: "delete", path: "/api/wealth/records/{recordId}", tags: ["Wealth"], summary: "Delete Wealth record", operationId: "deleteWealthRecord", security: secured, description: "Deletes a Wealth record owned by the current user. Linked documents remain in Documents.", parameters: [idParam("recordId", "Wealth record id")], responses: { 204: response("Deleted"), ...errorResponses("401", "404", "503") } },
  { method: "get", path: "/api/wealth/handoff/summary", tags: ["Wealth"], summary: "Get Wealth handoff summary", operationId: "getWealthHandoffSummary", security: secured, description: "Shows verified recipients with Wealth download permission, available family/emergency handoff types, included/excluded content, and counts.", responses: { 200: response("Handoff summary", ref("WealthHandoffSummary")), ...errorResponses("401") } },
  { method: "post", path: "/api/wealth/handoff/send", tags: ["Wealth"], summary: "Send Wealth handoff", operationId: "sendWealthHandoff", security: secured, description: "Sends ZIP handoffs to selected verified Trust Center members. At least one verified family or emergency recipient must be selected.", requestBody: body(objectSchema({ familyRecipientIds: { type: "array", items: { type: "string", minLength: 1 }, default: [] }, emergencyRecipientIds: { type: "array", items: { type: "string", minLength: 1 }, default: [] } }), { familyRecipientIds: ["member_1"], emergencyRecipientIds: [] }), responses: { 200: response("Send result", objectSchema({ message: { type: "string" }, results: arrayOf({ type: "object", additionalProperties: true }) })), ...errorResponses("400", "401", "502") } },
);

ops.push(
  { method: "get", path: "/api/health/members", tags: ["Health"], summary: "List Health profiles", operationId: "listHealthMembers", security: secured, description: "Returns Health profiles and ensures a default Myself profile exists for the current user.", responses: { 200: response("Members", arrayOf(ref("HealthMember"))), ...errorResponses("401") } },
  { method: "post", path: "/api/health/members", tags: ["Health"], summary: "Create Health profile", operationId: "createHealthMember", security: secured, description: "Creates a Health profile. dateOfBirth must be a real YYYY-MM-DD date, not future, and within the last 120 years. Current create behavior persists core member fields; update supports the extended profile fields.", requestBody: body(healthMemberInput, { name: "Example User", relation: "Myself", bloodGroup: "O+", dateOfBirth: "1990-01-01" }), responses: { 201: response("Member", ref("HealthMember")), ...errorResponses("400", "401") } },
  { method: "patch", path: "/api/health/members/{memberId}", tags: ["Health"], summary: "Update Health profile", operationId: "updateHealthMember", security: secured, description: "Partial update for Health profile fields including conditions, allergies, doctor, and insurance details.", parameters: [idParam("memberId", "Health member id")], requestBody: body({ ...healthMemberInput, required: [] }, { primaryDoctor: "Dr Example", allergies: "None" }), responses: { 200: response("Member", ref("HealthMember")), ...errorResponses("400", "401", "404") } },
  { method: "delete", path: "/api/health/members/{memberId}", tags: ["Health"], summary: "Delete Health profile", operationId: "deleteHealthMember", security: secured, description: "Deletes a Health profile. The default Myself member cannot be deleted.", parameters: [idParam("memberId", "Health member id")], responses: { 204: response("Deleted"), ...errorResponses("400", "401", "404") } },
  { method: "get", path: "/api/health/members/{memberId}/overview", tags: ["Health"], summary: "Get Health overview", operationId: "getHealthOverview", security: secured, description: "Returns member details, upcoming reminders, tracked metrics with measurements, and recent records.", parameters: [idParam("memberId", "Health member id")], responses: { 200: response("Overview", objectSchema({ member: ref("HealthMember"), upcoming: arrayOf(ref("HealthReminder")), trackedMetrics: arrayOf({ type: "object", additionalProperties: true }), recentRecords: arrayOf(ref("HealthRecordSummary")) })), ...errorResponses("401", "404") } },
  { method: "get", path: "/api/health/members/{memberId}/records", tags: ["Health"], summary: "List Health records", operationId: "listHealthRecords", security: secured, description: "Returns record summaries for a Health profile.", parameters: [idParam("memberId", "Health member id")], responses: { 200: response("Records", arrayOf(ref("HealthRecordSummary"))), ...errorResponses("401", "404") } },
  { method: "post", path: "/api/health/records", tags: ["Health"], summary: "Create Health record from document", operationId: "createHealthRecord", security: secured, description: "Creates a Health record from an existing Readiness document. Upload/save the source through the Documents APIs first and pass its documentId. The source document must belong to the user and be PDF/image. If memberId is omitted, Readiness attempts exact patient/profile matching; response may use processingStatus awaiting_profile_match, which is valid and requires profile assignment.", requestBody: body(objectSchema({ memberId: { type: "string", minLength: 1 }, documentId: { type: "string", minLength: 1 }, type: stringEnum(["lab_report", "medical_report", "prescription"]) }, ["documentId", "type"]), { documentId: "doc_123", type: "lab_report" }), responses: { 201: response("Health record or awaiting profile match", { oneOf: [ref("HealthRecord"), objectSchema({ documentId: { type: "string" }, type: { type: "string" }, processingStatus: { const: "awaiting_profile_match" }, patient: nullable({ type: "object", additionalProperties: true }), memberMatch: { type: "object", additionalProperties: true }, measurements: arrayOf({}) })] }), ...errorResponses("400", "401", "404", "415") } },
  { method: "get", path: "/api/health/records/{recordId}", tags: ["Health"], summary: "Get Health record", operationId: "getHealthRecord", security: secured, description: "Returns the full Health record with summary, measurements, medications, follow-ups, and reminders. Records awaiting profile assignment return 409.", parameters: [idParam("recordId", "Health record id")], responses: { 200: response("Health record", ref("HealthRecord")), ...errorResponses("401", "404", "409") } },
  { method: "delete", path: "/api/health/records/{recordId}", tags: ["Health"], summary: "Delete Health record", operationId: "deleteHealthRecord", security: secured, description: "Deletes the Health record. Related measurements/medications/follow-ups/reminders cascade. If the source document is not attached to Wealth, the current implementation also deletes the Health-owned source document through normal document cleanup.", parameters: [idParam("recordId", "Health record id")], responses: { 204: response("Deleted"), ...errorResponses("401", "404") } },
  { method: "post", path: "/api/health/records/{recordId}/reprocess", tags: ["Health"], summary: "Reprocess Health record", operationId: "reprocessHealthRecord", security: secured, description: "Re-runs health extraction using the original document. The record must already be assigned to a profile.", parameters: [idParam("recordId", "Health record id")], responses: { 200: response("Health record", ref("HealthRecord")), ...errorResponses("401", "404", "409") } },
  { method: "get", path: "/api/health/members/{memberId}/measurements", tags: ["Health"], summary: "List Health measurements", operationId: "listHealthMeasurements", security: secured, description: "Lists measurements for a member. The current HTTP route forwards only the optional metric query; context/bodySite are service-only filters and are not accepted as query params.", parameters: [idParam("memberId", "Health member id"), query("metric", { type: "string" }, "Optional metricKey filter.")], responses: { 200: response("Measurements", arrayOf(ref("HealthMeasurement"))), ...errorResponses("401", "404") } },
  { method: "get", path: "/api/health/members/{memberId}/tracked-metrics", tags: ["Health"], summary: "List tracked Health metrics", operationId: "listTrackedHealthMetrics", security: secured, description: "Returns enabled tracked metrics for a member.", parameters: [idParam("memberId", "Health member id")], responses: { 200: response("Tracked metrics", arrayOf(ref("TrackedHealthMetric"))), ...errorResponses("401", "404") } },
  { method: "post", path: "/api/health/members/{memberId}/tracked-metrics", tags: ["Health"], summary: "Track Health metric", operationId: "trackHealthMetric", security: secured, description: "Enables or updates a tracked metric preference for a member.", parameters: [idParam("memberId", "Health member id")], requestBody: body(objectSchema({ metricKey: { type: "string", minLength: 1, maxLength: 160 }, displayName: { type: "string", minLength: 1, maxLength: 160 }, context: nullable({ type: "string", maxLength: 120 }), bodySite: nullable({ type: "string", maxLength: 120 }) }, ["metricKey", "displayName"]), { metricKey: "hemoglobin", displayName: "Hemoglobin", context: null, bodySite: null }), responses: { 201: response("Tracked metric", ref("TrackedHealthMetric")), ...errorResponses("400", "401", "404") } },
  { method: "delete", path: "/api/health/members/{memberId}/tracked-metrics/{trackedId}", tags: ["Health"], summary: "Untrack Health metric", operationId: "untrackHealthMetric", security: secured, description: "Disables a tracked metric preference.", parameters: [idParam("memberId", "Health member id"), idParam("trackedId", "Tracked metric id")], responses: { 204: response("Disabled"), ...errorResponses("401", "404") } },
  { method: "get", path: "/api/health/members/{memberId}/available-metrics", tags: ["Health"], summary: "Search available Health metrics", operationId: "searchAvailableHealthMetrics", security: secured, description: "Searches distinct metrics present in the member's measurements and includes latest value, unit, historical count, and tracking state.", parameters: [idParam("memberId", "Health member id"), query("search", { type: "string" }, "Optional case-insensitive metric search text.")], responses: { 200: response("Available metrics", arrayOf(objectSchema({ metricKey: { type: "string" }, displayName: { type: "string" }, context: nullable({ type: "string" }), bodySite: nullable({ type: "string" }), historicalReadingCount: { type: "integer" }, isTracked: { type: "boolean" }, latestValue: { type: "number" }, secondaryValue: nullable({ type: "number" }), unit: { type: "string" } }))), ...errorResponses("401", "404") } },
  { method: "get", path: "/api/health/members/{memberId}/timeline", tags: ["Health"], summary: "Get Health timeline", operationId: "getHealthTimeline", security: secured, description: "Returns measurement and medication timeline events sorted newest first. Timeline is event/value based, not another document list.", parameters: [idParam("memberId", "Health member id")], responses: { 200: response("Timeline events", arrayOf(ref("HealthTimelineEvent"))), ...errorResponses("401", "404") } },
  { method: "post", path: "/api/health/members/{memberId}/medications", tags: ["Health"], summary: "Create manual Health medication", operationId: "createManualHealthMedication", security: secured, description: "Creates a manually entered medication for the selected Health profile. Name and dose are required; frequency and runsOutAt are optional.", parameters: [idParam("memberId", "Health member id")], requestBody: body(objectSchema({ name: { type: "string", minLength: 1, maxLength: 180 }, dose: { type: "string", minLength: 1, maxLength: 120 }, frequency: nullable({ type: "string", maxLength: 160 }), repeats: { type: "boolean", default: false }, runsOutAt: nullable({ type: "string", example: "2026-10-25" }) }, ["name", "dose"]), { name: "Metformin", dose: "500 mg", frequency: "Twice daily", repeats: true, runsOutAt: "2026-10-25" }), responses: { 201: response("Medication", objectSchema({ id: { type: "string" }, memberId: { type: "string" }, name: { type: "string" }, dose: nullable({ type: "string" }), frequency: nullable({ type: "string" }), repeats: { type: "boolean" }, runsOutAt: nullable(date), createdAt: dateTime })), ...errorResponses("400", "401", "404") } },
  { method: "get", path: "/api/health/reminders", tags: ["Health"], summary: "List active Health reminders", operationId: "listHealthReminders", security: secured, description: "Returns up to 20 active reminders, including overdue reminders, across the current user's Health profiles.", responses: { 200: response("Reminders", arrayOf(ref("HealthReminder"))), ...errorResponses("401") } },
  { method: "post", path: "/api/health/reminders", tags: ["Health"], summary: "Create manual Health reminder", operationId: "createHealthReminder", security: secured, description: "Creates a manual Health reminder. dueDate is parsed as YYYY-MM-DD by current client usage and backend date parsing.", requestBody: body(objectSchema({ memberId: { type: "string", minLength: 1 }, title: { type: "string", minLength: 1, maxLength: 180 }, dueDate: { type: "string", minLength: 1, example: "2026-10-01" }, recurrence: nullable({ type: "string", maxLength: 80 }) }, ["memberId", "title", "dueDate"]), { memberId: "member_123", title: "Book follow-up", dueDate: "2026-10-01", recurrence: null }), responses: { 201: response("Reminder", ref("HealthReminder")), ...errorResponses("400", "401", "404") } },
);

function buildPaths() {
  const paths: Record<string, Record<string, Schema>> = {};
  for (const op of ops) {
    paths[op.path] ??= {};
    paths[op.path]![op.method] = {
      tags: op.tags,
      summary: op.summary,
      description: op.description,
      operationId: op.operationId,
      ...(op.security ? { security: op.security } : {}),
      ...(op.parameters ? { parameters: op.parameters } : {}),
      ...(op.requestBody ? { requestBody: op.requestBody } : {}),
      responses: op.responses ?? { 200: response("Success") },
    };
  }
  return paths;
}

export const expectedOperations = ops.map(({ method, path }) => `${method.toUpperCase()} ${path}`).sort();

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Readiness API",
    version: "1.0.0",
    summary: "Developer documentation for the Readiness backend.",
    description: [
      "Normal authentication flow: POST /auth/signup, /auth/login, or /auth/google; copy token/accessToken; click Authorize and enter Bearer <token>; POST /auth/refresh uses the HttpOnly readiness_refresh cookie to rotate sessions; POST /auth/logout clears the current cookie; POST /auth/logout-all revokes all sessions.",
      "Document flow: GET /documents/encryption-key, encrypt files in the browser using the hybrid envelope contract, POST /documents/analyze or /documents/upload, review the response, POST /documents to save, then GET /documents.",
      "Health flow: save a source document first, then POST /api/health/records with documentId and type. If memberId is omitted, the backend attempts patient/profile matching and may return awaiting_profile_match.",
      "Google flow: authorize, open authorizationUrl, callback completes the popup OAuth flow, then call status and scan/import.",
      "Package flow: lookup existing packages or generate public requirement packages. /search-or-generate supports JSON and SSE.",
      "Trust flow: owners manage authenticated members; invitees use public token endpoints with a 6-digit PIN and 24-hour invitation lifecycle.",
    ].join("\n\n"),
  },
  servers: [{ url: "/", description: "Current host / same-origin server" }],
  tags: [
    "System", "Authentication", "Bootstrap", "Documents", "Packages",
    "Gmail Integration", "Google Drive Integration", "Trust Center", "Wealth", "Health", "Admin",
  ].map((name) => ({ name })),
  paths: buildPaths(),
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT", description: "Authorization: Bearer <accessToken>" },
      refreshCookie: { type: "apiKey", in: "cookie", name: "readiness_refresh", description: "HttpOnly refresh token cookie set/rotated by login, signup, google, and refresh. Legacy lifepack_refresh is compatibility-only and not preferred." },
      adminSeedToken: { type: "apiKey", in: "header", name: "x-admin-seed-token", description: "Admin seed token used only by the readiness seed endpoint when configured." },
    },
    schemas,
  },
} as const;

function schemaNameFromRef(schema: unknown) {
  const refValue = schema && typeof schema === "object" ? (schema as { $ref?: unknown }).$ref : undefined;
  return typeof refValue === "string" ? refValue.replace("#/components/schemas/", "") : null;
}

function exampleForSchema(schema: unknown): unknown {
  const direct = schemaNameFromRef(schema);
  if (direct && schemaExamples[direct] !== undefined) return schemaExamples[direct];
  if (schema && typeof schema === "object") {
    const record = schema as { type?: unknown; items?: unknown; oneOf?: unknown };
    if (record.type === "array") {
      const itemExample = exampleForSchema(record.items);
      return itemExample === undefined ? undefined : [itemExample];
    }
    if (Array.isArray(record.oneOf)) return exampleForSchema(record.oneOf[0]);
  }
  return undefined;
}

function addOperationResponseExamples() {
  for (const pathItem of Object.values(openApiDocument.paths) as Array<Record<string, unknown>>) {
    for (const operation of Object.values(pathItem) as Array<{ responses?: Record<string, unknown> }>) {
      for (const responseValue of Object.values(operation.responses ?? {}) as Array<{ content?: Record<string, { schema?: unknown; example?: unknown }> }>) {
        const media = responseValue.content?.[json];
        if (!media || media.example !== undefined) continue;
        const example = exampleForSchema(media.schema);
        if (example !== undefined) media.example = example;
      }
    }
  }
}

addOperationResponseExamples();

export function getOpenApiOperationCount() {
  return expectedOperations.length;
}
