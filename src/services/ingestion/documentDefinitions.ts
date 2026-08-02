import crypto from "node:crypto";

import { normalizeDocumentType } from "../readiness/normalization";
import { documentDefinitions } from "./documentDefinitions.registry";
import type { ReviewField } from "./types";

export type FieldValidationStatus = "accepted" | "needs_review" | "missing" | "invalid";

export type DocumentFieldValidation = {
  key: string;
  label: string;
  value: string;
  confidence: number;
  required: boolean;
  valid: boolean;
  status: FieldValidationStatus;
  message?: string;
};

export type DocumentValidationResult = {
  normalizedType: string;
  displayName: string;
  category: string;
  uniqueIdentifierField: string;
  uniqueIdentifier: string | null;
  documentFingerprint: string;
  capabilities: string[];
  validatedFields: Record<string, DocumentFieldValidation>;
  reviewFields: ReviewField[];
  missingRequiredFields: string[];
  invalidFields: string[];
  lowConfidenceFields: string[];
  canSave: boolean;
  requiresUserConfirmation: boolean;
  warnings: Array<{ code: string; message: string }>;
};

export type DocumentDefinition = {
  normalizedType: string;
  displayName: string;
  category: string;
  uniqueIdentifierField: string;
  requiredFields: string[];
  optionalFields: string[];
  validationRules: Partial<Record<string, RegExp>>;
  supportedReadinessCapabilities: string[];
};

const labels: Record<string, string> = {
  aadhaarNumber: "Aadhaar number",
  aadhaarLast4: "Aadhaar last 4 digits",
  accountNumberMasked: "Masked account number",
  address: "Address",
  billNumber: "Bill number",
  certificateNumber: "Certificate number",
  consumerNumber: "Consumer number",
  dob: "Date of birth",
  documentFingerprint: "Document fingerprint",
  employeeId: "Employee ID",
  expiryDate: "Expiry date",
  fullName: "Full name",
  gstNumber: "GST number",
  holderName: "Holder name",
  issueDate: "Issue date",
  issuingAuthority: "Issuing authority",
  licenceNumber: "Licence number",
  month: "Month",
  panNumber: "PAN number",
  passportNumber: "Passport number",
  policyNumber: "Policy number",
  registrationNumber: "Registration number",
  state: "State",
};

export function getDocumentDefinition(documentType?: string | null, text?: string | null) {
  const normalizedType = normalizeDocumentType(documentType, text);
  return (
    documentDefinitions[normalizedType] ?? {
      normalizedType,
      displayName: normalizedType === "unknown" ? "Unknown document" : normalizedType.replace(/_/g, " "),
      category: "other",
      uniqueIdentifierField: "documentFingerprint",
      requiredFields: [],
      optionalFields: ["holderName", "issueDate", "issuingAuthority"],
      validationRules: {},
      supportedReadinessCapabilities: normalizedType === "unknown" ? [] : [normalizedType],
    }
  );
}

function labelForField(key: string) {
  return labels[key] ?? key.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function fieldsFromReview(reviewFields: Array<ReviewField | Record<string, unknown>>) {
  const output: Record<string, { value: string; confidence: number; source?: unknown }> = {};
  for (const field of reviewFields) {
    const key = typeof field.key === "string" ? field.key : "";
    if (!key) continue;
    const value = stringValue(field.value);
    const confidence = typeof field.confidence === "number" ? field.confidence : field.source === "user" ? 100 : 0;
    if (value || !(key in output)) output[key] = { value, confidence, source: field.source };
  }
  return output;
}

export function buildDocumentFingerprint(input: { normalizedType: string; fields: Record<string, unknown>; rawText?: string }) {
  const stableSource = [
    input.normalizedType,
    stringValue(input.fields.holderName ?? input.fields.fullName ?? input.fields.name),
    stringValue(input.fields.issueDate ?? input.fields.date),
    stringValue(input.fields.issuingAuthority ?? input.fields.issuer),
    stringValue(input.fields.address),
    stringValue(input.rawText).slice(0, 500),
  ].join("|");

  return crypto.createHash("sha256").update(stableSource).digest("hex");
}

export function validateDocumentMetadata(input: {
  documentType: string;
  rawText?: string;
  fields?: Record<string, unknown>;
  reviewFields?: Array<ReviewField | Record<string, unknown>>;
  confidence?: number;
  userConfirmedUnknown?: boolean;
}) {
  const definition = getDocumentDefinition(input.documentType, input.rawText);
  const baseFields = input.fields ?? {};
  const reviewedFields = fieldsFromReview(input.reviewFields ?? []);
  const mergedFields: Record<string, unknown> = { ...baseFields };
  const fieldKeys = new Set([...definition.requiredFields, ...definition.optionalFields, definition.uniqueIdentifierField]);
  for (const [key, reviewed] of Object.entries(reviewedFields)) {
    if (reviewed.value) mergedFields[key] = reviewed.value;
  }

  const validatedFields: Record<string, DocumentFieldValidation> = {};
  const reviewFields: ReviewField[] = [];
  const missingRequiredFields: string[] = [];
  const invalidFields: string[] = [];
  const lowConfidenceFields: string[] = [];

  for (const key of fieldKeys) {
    if (!key) continue;
    const value = stringValue(mergedFields[key]);
    const reviewed = reviewedFields[key];
    const confidence = reviewed?.confidence ?? (value ? input.confidence ?? 0 : 0);
    const required = definition.requiredFields.includes(key);
    const rule = definition.validationRules[key];
    const valid = !value || !rule || rule.test(value);
    let status: FieldValidationStatus = "accepted";
    let message: string | undefined;

    if (required && !value) {
      status = "missing";
      message = `${labelForField(key)} is required.`;
      missingRequiredFields.push(key);
    } else if (value && !valid) {
      status = "invalid";
      message = `This doesn't look like a valid ${labelForField(key)}.`;
      invalidFields.push(key);
    } else if (value && confidence < 90 && reviewed?.source !== "user") {
      status = confidence >= 70 ? "needs_review" : "missing";
      message = confidence >= 70 ? "Please verify this value." : "Please enter this value manually.";
      lowConfidenceFields.push(key);
    }

    validatedFields[key] = {
      key,
      label: labelForField(key),
      value,
      confidence,
      required,
      valid,
      status,
      message,
    };

    if (status !== "accepted") {
      reviewFields.push({
        id: `validation-${key}`,
        key,
        label: labelForField(key),
        value,
        confidence,
        source: reviewed?.source === "user" ? "user" : "rule",
        editable: true,
        important: required,
      });
    }
  }

  const fingerprint = buildDocumentFingerprint({ normalizedType: definition.normalizedType, fields: mergedFields, rawText: input.rawText });
  const uniqueIdentifierValue = stringValue(mergedFields[definition.uniqueIdentifierField]);
  const uniqueIdentifier = definition.uniqueIdentifierField === "documentFingerprint" ? fingerprint : uniqueIdentifierValue || null;
  const unknownNeedsConfirmation = definition.normalizedType === "unknown" && !input.userConfirmedUnknown;
  const warnings: DocumentValidationResult["warnings"] = [];

  if (missingRequiredFields.length || invalidFields.length || lowConfidenceFields.length) {
    warnings.push({
      code: "PLEASE_REVIEW_FIELDS",
      message: "Some required or low-confidence fields need review before saving.",
    });
  }

  if (unknownNeedsConfirmation) {
    warnings.push({
      code: "UNKNOWN_DOCUMENT_REQUIRES_CONFIRMATION",
      message: "We couldn't identify this document. Choose a document type and enter the required identifier before saving.",
    });
  }

  if (!uniqueIdentifier) {
    warnings.push({
      code: "MISSING_UNIQUE_IDENTIFIER",
      message: `${labelForField(definition.uniqueIdentifierField)} is required before saving.`,
    });
  }

  return {
    normalizedType: definition.normalizedType,
    displayName: definition.displayName,
    category: definition.category,
    uniqueIdentifierField: definition.uniqueIdentifierField,
    uniqueIdentifier,
    documentFingerprint: fingerprint,
    capabilities: definition.supportedReadinessCapabilities,
    validatedFields,
    reviewFields,
    missingRequiredFields,
    invalidFields,
    lowConfidenceFields,
    canSave: Boolean(uniqueIdentifier) && !missingRequiredFields.length && !invalidFields.length && !unknownNeedsConfirmation,
    requiresUserConfirmation: unknownNeedsConfirmation || Boolean(lowConfidenceFields.length),
    warnings,
  } satisfies DocumentValidationResult;
}
