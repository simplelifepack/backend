import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { operationalFields } from "./operationalFields";
import { assertPrivateOwner, currentPrivateUserId } from "./access";
import { decryptPrivateValue, encryptPrivateValue, privateLookup } from "./fieldEncryption";

// Typed health values are stored in dedicated ciphertext columns. Original
// columns contain only keyed equality tokens or fixed, noninformative sentinels.
// Keeping their Prisma-facing types preserves the existing application API.
export const encryptedModels = new Set([
  "HealthMember", "HealthDocument", "HealthMeasurement", "TrackedHealthMetric",
  "HealthMedication", "HealthFollowUp", "HealthReminder",
  "WealthRecord", "ExternalConnection", "ExternalDocumentCandidate", "UserIdentityProfile",
  "TemporaryUpload", "DigiLockerConsentSession", "PushSubscription", "AccountChangeOtp",
  "Document", "DocumentFile",
  "User", "SignupVerification", "ExternalIdentity",
  "TrustMember",
  "ReadinessPack", "Requirement", "AccountExportJob",
]);
const credentialVerifiers = new Set(["User.passwordHash", "User.pinHash", "SignupVerification.passwordHash", "SignupVerification.otpHash", "AccountChangeOtp.newPasswordHash", "AccountChangeOtp.newPinHash", "AccountChangeOtp.otpHash", "TrustMember.inviteTokenHash", "TrustMember.invitePinHash"]);
export function ownerField(model: string) { return model === "ReadinessPack" ? "createdBy" : ["User", "SignupVerification"].includes(model) ? "id" : ["DocumentFile", "Requirement"].includes(model) ? "privacyOwnerId" : ["WealthRecord", "TrustMember"].includes(model) ? "ownerUserId" : ["TemporaryUpload", "Document"].includes(model) ? "ownerProfileId" : "userId"; }
export function isPublicDefinition(model: string, row: Record<string, unknown>) { return ["ReadinessPack", "Requirement"].includes(model) && row[ownerField(model)] === "seed"; }
export function recordOwner(model: string, row: Record<string, unknown>) { return String(row[ownerField(model)] ?? (model === "DocumentFile" ? `orphan:Document:${row.documentId}` : `orphan:${model}:${row.id}`)); }
export const modelDefinitions = new Map(Prisma.dmmf.datamodel.models.map(model => [model.name, model]));
export type ScalarField = Prisma.DMMF.Field;
export const cipherColumn = (field: string) => `private_${field}`;
export function protectedFields(model: string): ScalarField[] {
  if (!encryptedModels.has(model)) return [];
  return modelDefinitions.get(model)!.fields.filter(field => field.kind !== "object" && !field.name.startsWith("private_") && !["legacyPrivateMetadata", "cataloguePrivacyVersion"].includes(field.name) && !credentialVerifiers.has(`${model}.${field.name}`) && !(operationalFields[model] ?? []).includes(field.name));
}
export function protectedField(model: string, field: string) { return protectedFields(model).find(item => item.name === field); }
const globalLookups = new Set(["User.email", "SignupVerification.email", "ExternalIdentity.providerAccountId", "PushSubscription.endpoint", "TrustMember.email"]);
export function lookupToken(model: string, field: string, value: unknown, ownerId = currentPrivateUserId()) {
  const scope = globalLookups.has(`${model}.${field}`) || field === "upsert" ? "global-unique-index" : ownerId ?? (["ReadinessPack", "Requirement"].includes(model) ? "public-read" : null);
  if (!scope) throw new Error("PRIVATE_LOOKUP_SCOPE_REQUIRED");
  // Preserve PostgreSQL NULL-distinct uniqueness for optional identity columns.
  // The original null is still authenticated in its dedicated ciphertext.
  const definition = protectedField(model, field);
  if (value === null && definition?.type === "String" && !definition.isRequired && !definition.isList) return null;
  return privateLookup(value, { model, field, ownerId: scope });
}
export function storageUsageToken(ownerId: string, locator: string | null | undefined) {
  return locator ? privateLookup(locator, { model: "StorageObject", field: "locator", ownerId }) : null;
}

export function maskedValue(model: string, field: ScalarField, value: unknown, ownerId?: string): unknown {
  if (field.isList) return [];
  if (field.type === "String") return lookupToken(model, field.name, value, ownerId);
  if (field.type === "Json") return field.isRequired ? {} : Prisma.DbNull;
  if (!field.isRequired) return null;
  if (field.kind === "enum") return Prisma.dmmf.datamodel.enums.find(item => item.name === field.type)!.values[0].name;
  if (field.type === "DateTime") return new Date(0);
  if (field.type === "Boolean") return false;
  if (["Float", "Int", "Decimal"].includes(field.type)) return 0;
  throw new Error("UNSUPPORTED_PRIVATE_FIELD_TYPE");
}

export function encodePrivatePatch(model: string, identity: { id: string; userId: string }, input: Record<string, unknown>, create = false) {
  assertPrivateOwner(identity.userId);
  const result = { ...input };
  for (const field of protectedFields(model)) {
    const column = cipherColumn(field.name);
    if (column in input) throw new Error("PRIVATE_CIPHERTEXT_INPUT_REJECTED");
    let value = input[field.name];
    if (value === undefined) {
      if (!create) continue;
      if (field.hasDefaultValue) value = field.default;
      else if (field.isList) value = [];
      else if (!field.isRequired) value = null;
      else throw new Error("PRIVATE_REQUIRED_FIELD_MISSING");
    }
    // Supported Prisma scalar updates use set. Arithmetic/list mutation needs
    // a locked read-modify-write and is rejected instead of storing plaintext.
    if (value && typeof value === "object" && !(value instanceof Date) && !Array.isArray(value) && field.type !== "Json") {
      if (Object.keys(value).length !== 1 || !("set" in value)) throw new Error("PRIVATE_UPDATE_OPERATOR_UNSUPPORTED");
      value = (value as { set: unknown }).set;
    }
    if (field.type === "Json" && (value === Prisma.JsonNull || value === Prisma.DbNull)) value = null;
    if (field.type === "Json" && value === Prisma.AnyNull) throw new Error("PRIVATE_JSON_WRITE_UNSUPPORTED");
    if (field.type === "DateTime" && value !== null) value = new Date(value as string | Date).toISOString();
    result[column] = encryptPrivateValue(value, { model, recordId: identity.id, ownerId: identity.userId, field: field.name });
    result[field.name] = maskedValue(model, field, value, identity.userId);
  }
  return result;
}

export function decodePrivateRow(model: string, input: Record<string, unknown>, fields?: Set<string>) {
  if (model === "ReadinessPack" && input.cataloguePrivacyVersion !== 2) throw new Error("PRIVATE_DATA_MIGRATION_REQUIRED");
  if (!encryptedModels.has(model) || isPublicDefinition(model, input)) return { ...input };
  const identity = { id: String(input.id), userId: recordOwner(model, input) };
  const readsPrivate = protectedFields(model).some(field => !fields || fields.has(field.name));
  if (!readsPrivate) return Object.fromEntries(Object.entries(input).filter(([key]) => !key.startsWith("private_")));
  assertPrivateOwner(identity.userId); // Must precede every cryptographic read.
  const result = { ...input };
  for (const field of protectedFields(model)) {
    const column = cipherColumn(field.name);
    if (fields && !fields.has(field.name)) { delete result[column]; continue; }
    if (typeof input[column] !== "string") throw new Error("PRIVATE_DATA_MIGRATION_REQUIRED");
    let value = decryptPrivateValue<unknown>(input[column] as string, { model, recordId: identity.id, ownerId: identity.userId, field: field.name });
    if (field.type === "Json" && (value === Prisma.JsonNull || value === Prisma.DbNull)) value = null;
    if (field.type === "Json" && value === Prisma.AnyNull) throw new Error("PRIVATE_JSON_WRITE_UNSUPPORTED");
    if (field.type === "DateTime" && value !== null) value = new Date(value as string);
    result[field.name] = value;
    delete result[column];
  }
  return result;
}

export function newPrivateId() { return randomUUID(); }
