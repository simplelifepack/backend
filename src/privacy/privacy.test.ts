import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { Prisma, type CustomPackageGenerationJob } from "@prisma/client";
import { assertPrivateDataKeysConfigured, decryptPrivateBytes, decryptPrivateValue, encryptPrivateBytes, encryptPrivateValue, privateLookup } from "./fieldEncryption";
import { decryptPackageJob, encryptJobPatch, privateJobFields } from "./packageJob";
import { migratePackageJob } from "./migratePackageJob";
import { assertPrivateWrite } from "./persistenceGuard";
import { operationalFields, operationalProjection, publicDefinitionModels, reviewRequiredModels } from "./operationalFields";
import { decryptJson, decryptString, encryptJson } from "../utils/documentEncryption";
import { protectedFields, encryptedModels } from "./modelCodec";

const key = () => `base64:${randomBytes(32).toString("base64")}`;
const firstKey = key();
process.env.PRIVATE_DATA_KEYRING_JSON = JSON.stringify({ test1: firstKey });
process.env.PRIVATE_DATA_ACTIVE_KEY_ID = "test1";
process.env.PRIVATE_DATA_LOOKUP_KEY = key();
process.env.DOCUMENT_METADATA_ENCRYPTION_KEY = key();
process.env.DOCUMENT_ENCRYPTION_KEY = key();
const binding = { model: "HealthMeasurement", recordId: "record-one", ownerId: "user-one", field: "value" };
const privateSample = "Amelia SecretSample cardiology 4829.71 private-medication@example.test";

test("bound AEAD preserves JSON values and uses fresh nonces without plaintext copies", () => {
  for (const value of [privateSample, "", null, 0, 143.25, false, [privateSample], { nested: privateSample, measuredAt: "2026-10-15" }]) {
    const a = encryptPrivateValue(value, binding), b = encryptPrivateValue(value, binding);
    assert.notEqual(a, b);
    assert.deepEqual(decryptPrivateValue(a, binding), value);
    assert(!a.includes(privateSample));
  }
});

test("binding rejects cross-user, cross-record, cross-model and cross-field substitution", () => {
  const encrypted = encryptPrivateValue(privateSample, binding);
  for (const patch of [{ ownerId: "user-two" }, { recordId: "record-two" }, { model: "WealthRecord" }, { field: "notes" }]) {
    assert.throws(() => decryptPrivateValue(encrypted, { ...binding, ...patch }), /PRIVATE_DATA_UNAVAILABLE/);
  }
});

test("tampered and malformed ciphertext fails closed without plaintext or fallback", () => {
  const encrypted = encryptPrivateValue(privateSample, binding);
  for (const value of [privateSample, "enc:v2:", encrypted.replace("v2", "v3"), encrypted + ":extra", encrypted.slice(0, -4) + "AAAA", encrypted.replace(":test1:", ":unknown:")]) {
    assert.throws(() => decryptPrivateValue(value, binding), /PRIVATE_DATA_UNAVAILABLE/);
  }
});

test("keyring supports encryption rotation with old-key reads and rejects removed keys", () => {
  const encrypted = encryptPrivateValue(privateSample, binding);
  process.env.PRIVATE_DATA_KEYRING_JSON = JSON.stringify({ test1: firstKey, test2: key() });
  process.env.PRIVATE_DATA_ACTIVE_KEY_ID = "test2";
  assert.equal(decryptPrivateValue(encrypted, binding), privateSample);
  assert.match(encryptPrivateValue(privateSample, binding), /^enc:v2:test2:/);
  process.env.PRIVATE_DATA_KEYRING_JSON = JSON.stringify({ test2: key() });
  assert.throws(() => decryptPrivateValue(encrypted, binding), /PRIVATE_DATA_UNAVAILABLE/);
  process.env.PRIVATE_DATA_KEYRING_JSON = JSON.stringify({ test1: firstKey });
  process.env.PRIVATE_DATA_ACTIVE_KEY_ID = "test1";
});

test("configuration has no fallback key or weak passphrase and rejects lookup key reuse", () => {
  const lookup = process.env.PRIVATE_DATA_LOOKUP_KEY;
  process.env.PRIVATE_DATA_LOOKUP_KEY = firstKey;
  assert.throws(assertPrivateDataKeysConfigured, /distinct/);
  process.env.PRIVATE_DATA_LOOKUP_KEY = "password";
  assert.throws(assertPrivateDataKeysConfigured, /32 random bytes/);
  process.env.PRIVATE_DATA_LOOKUP_KEY = lookup;
});

test("keyed lookups separate users, fields and models, and survive ciphertext rotation", () => {
  const scope = { model: "User", field: "email", ownerId: "auth-global" };
  const hash = privateLookup(privateSample, scope);
  assert.equal(hash, privateLookup(privateSample, scope));
  for (const patch of [{ model: "TrustMember" }, { field: "name" }, { ownerId: "another-owner" }]) assert.notEqual(hash, privateLookup(privateSample, { ...scope, ...patch }));
  assert(!hash.includes(privateSample));
});

test("export archive bytes are encrypted and bound to the requesting user/job", () => {
  const context = { model: "AccountExportJob", recordId: "export-one", ownerId: "user-one", field: "archive" };
  const archive = Buffer.from(`PK\u0003\u0004${privateSample}`);
  const stored = encryptPrivateBytes(archive, context);
  assert(!stored.includes(privateSample));
  assert.deepEqual(decryptPrivateBytes(stored, context), archive);
  assert.throws(() => decryptPrivateBytes(stored, { ...context, ownerId: "another-user" }));
});

function legacyJob(): CustomPackageGenerationJob {
  return {
    id: "job-one", userId: "user-one", dedupeKey: "legacy-unkeyed-hash", packageType: privateSample,
    documentLabels: ["Medical record", "Salary details"], status: "queued", statusMessage: privateSample,
    draft: { privateSample }, errorMessage: privateSample, errorCode: null, confidence: "high", disclaimer: privateSample,
    retryCount: 0, provider429Count: 0, hasVerifiedOfficialSource: false, queuedAt: new Date(), startedAt: null,
    completedAt: null, failedAt: null, leaseExpiresAt: null, lockedBy: null, processingMs: null,
    aiMs: null, saveMs: null, createdAt: new Date(), updatedAt: new Date(),
  };
}

test("migration encrypts every job copy, preserves IDs, roundtrips and is idempotent", () => {
  const legacy = legacyJob();
  const patch = migratePackageJob(legacy);
  const stored = { ...legacy, ...patch } as CustomPackageGenerationJob;
  assert(!JSON.stringify(stored).includes(privateSample));
  assert(!JSON.stringify(stored).includes("Salary details"));
  assert.equal(stored.id, legacy.id);
  assert.equal(stored.userId, legacy.userId);
  assert.match(stored.dedupeKey, /^hmac:v2:/);
  assert.deepEqual(migratePackageJob(stored), {});
  const plain = decryptPackageJob(stored, "user-one");
  for (const field of privateJobFields) assert.deepEqual(plain[field], legacy[field]);
  assert.throws(() => decryptPackageJob(stored, "user-two"), /not found/);
});

test("mixed migration resumes and detects corruption rather than wrapping it", () => {
  const legacy = legacyJob();
  const first = encryptJobPatch(legacy, { packageType: legacy.packageType });
  const mixed = { ...legacy, ...first };
  const next = migratePackageJob(mixed);
  assert(!("packageType" in next));
  assert.throws(() => migratePackageJob({ ...legacy, packageType: "enc:v2:broken" }));
});

test("persistence guard rejects ordinary, bulk and update-operator plaintext writes", () => {
  for (const operation of ["create", "update", "updateMany", "createMany"]) {
    assert.throws(() => assertPrivateWrite("CustomPackageGenerationJob", operation, { data: { packageType: privateSample } }), /PLAINTEXT_WRITE_REJECTED/);
  }
  assert.throws(() => assertPrivateWrite("CustomPackageGenerationJob", "upsert", { create: { draft: { privateSample } } }));
  assert.throws(() => assertPrivateWrite("CustomPackageGenerationJob", "update", { data: { documentLabels: { push: privateSample } } }));
  const identity = legacyJob();
  assertPrivateWrite("CustomPackageGenerationJob", "create", { data: encryptJobPatch(identity, { packageType: privateSample, documentLabels: [] }) });
  assertPrivateWrite("CustomPackageGenerationJob", "updateMany", { data: { status: "queued", statusMessage: null } });
});

test("all Prisma models have an explicit classification; allowlisted fields exist", () => {
  for (const model of Prisma.dmmf.datamodel.models) {
    const known = model.name in operationalFields || [...publicDefinitionModels, ...reviewRequiredModels].includes(model.name as never);
    assert(known, `Unclassified Prisma model: ${model.name}`);
    if (encryptedModels.has(model.name)) for (const field of protectedFields(model.name)) assert(model.fields.some(item => item.name === `private_${field.name}` && item.type === "String"), `Missing ciphertext storage: ${model.name}.${field.name}`);
    for (const field of operationalFields[model.name] ?? []) assert(model.fields.some(item => item.name === field && item.kind !== "object"), `${model.name}.${field} is not scalar`);
  }
});

test("operator projections exclude private content, ciphertext and nested records", () => {
  const row = { ...legacyJob(), unrelated: { privateSample } };
  const result = operationalProjection("CustomPackageGenerationJob", row);
  assert(!JSON.stringify(result).includes(privateSample));
  assert(!("dedupeKey" in result));
  assert(!("draft" in result));
  assert(!("unrelated" in result));
  assert.throws(() => operationalProjection("Unknown", row));
  assert.deepEqual(operationalProjection("Document", { id: "one", ownershipStatus: "verified", uniqueIdentifier: privateSample }), { id: "one" });
  assert.deepEqual(operationalProjection("HealthMeasurement", { id: "one", value: 143, metricKey: "glucose", measuredAt: new Date() }), { id: "one" });
});

test("legacy malformed envelopes and corrupt JSON fail closed", () => {
  assert.throws(() => decryptString("enc:v1:broken"));
  const stored = encryptJson({ privateSample });
  assert.throws(() => decryptJson({ ...stored, tag: "broken" }, {}));
  assert.throws(() => decryptJson({ __lifepackEncrypted: true, version: 2 }, {}));
});
