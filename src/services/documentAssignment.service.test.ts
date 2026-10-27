import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import type { Prisma } from "@prisma/client";
import { assignDocumentsSchema, assignOwnedDocuments, documentAssignmentOptions, documentDetailsSchema, updateOwnedDocumentDetails } from "./documentAssignment.service";
import { decryptJson, encryptJson } from "../utils/documentEncryption";

process.env.DOCUMENT_ENCRYPTION_KEY = `base64:${randomBytes(32).toString("base64")}`;
const owner = { id: "owner", name: "Owner" };
const family = { id: "family", name: "Family person" };
function fixture(missingDocument = false) {
  const writes: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  const reads: unknown[] = [];
  const client = {
    trustMember: { findMany: async (query: unknown) => { reads.push(query); return [family]; } },
    document: {
      findMany: async (query: unknown) => { reads.push(query); return missingDocument ? [] : [{ id: "doc", fields: encryptJson({ patientName: "Extracted name", reviewFields: [{ label: "Expiry", value: "2027-01-01" }] }) }]; },
      update: async (input: typeof writes[number]) => { writes.push(input); return { id: "doc", ...input.data }; },
    },
  } as unknown as Pick<Prisma.TransactionClient, "trustMember" | "document">;
  return { client, writes, reads };
}

test("options include the account and only its active/invited family members", async () => {
  const { client, reads } = fixture();
  assert.deepEqual(await documentAssignmentOptions(client, owner), [owner, family]);
  assert.deepEqual(reads[0], { where: { ownerUserId: "owner", status: { in: ["ACTIVE", "INVITED"] } }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } });
});
test("assignment preserves extracted metadata, encrypts labels, and retains ownership", async () => {
  const { client, writes, reads } = fixture();
  await assignOwnedDocuments(client, owner, { ids: ["doc"], assigneeId: family.id });
  assert.deepEqual(reads[1], { where: { id: { in: ["doc"] }, ownerProfileId: "owner", deletedAt: null } });
  assert.deepEqual(writes[0].where, { id: "doc", ownerProfileId: "owner", deletedAt: null });
  assert.deepEqual(Object.keys(writes[0].data), ["fields"]);
  assert(!JSON.stringify(writes[0].data).includes(family.name));
  assert.deepEqual(decryptJson(writes[0].data.fields, {}), { patientName: "Extracted name", reviewFields: [{ label: "Expiry", value: "2027-01-01" }], assignedPerson: family });
});
test("self assignment is supported without using a family membership", async () => {
  const { client, writes } = fixture();
  await assignOwnedDocuments(client, owner, { ids: ["doc"], assigneeId: owner.id });
  assert.deepEqual(decryptJson<{ assignedPerson: unknown }>(writes[0].data.fields, { assignedPerson: null }).assignedPerson, owner);
});
test("unknown assignees and missing or foreign documents cause no writes", async () => {
  for (const [missing, assigneeId] of [[false, "foreign-person"], [true, family.id]] as const) {
    const { client, writes } = fixture(missing);
    await assert.rejects(assignOwnedDocuments(client, owner, { ids: ["doc"], assigneeId }), { statusCode: 404 });
    assert.equal(writes.length, 0);
  }
});
test("empty, duplicate, oversized and unexpected assignment payloads are rejected", () => {
  for (const input of [{ ids: [], assigneeId: "owner" }, { ids: ["doc", "doc"], assigneeId: "owner" }, { ids: Array.from({ length: 101 }, (_, i) => String(i)), assigneeId: "owner" }, { ids: ["doc"], assigneeId: "" }, { ids: ["doc"], assigneeId: "owner", ownerProfileId: "foreign" }]) assert.equal(assignDocumentsSchema.safeParse(input).success, false);
});

test("notes and expiry updates preserve assignment and extracted fields", async () => {
  const writes: Array<{ data: { fields: unknown } }> = [];
  const client = { document: {
    findFirst: async () => ({ fields: encryptJson({ assignedPerson: family, patientName: "Original" }) }),
    update: async (input: typeof writes[number]) => { writes.push(input); return input.data; },
  } } as unknown as Pick<Prisma.TransactionClient, "document" | "trustMember">;
  await updateOwnedDocumentDetails(client, owner, "doc", { notes: "Family note", expiry: "2027-07-02" });
  assert.deepEqual(decryptJson(writes[0].data.fields, {}), { assignedPerson: family, patientName: "Original", documentNotes: "Family note", userExpiry: "2027-07-02" });
  assert(!JSON.stringify(writes[0]).includes("Family note"));
  await updateOwnedDocumentDetails(client, owner, "doc", { expiry: null });
  assert.equal(decryptJson<{ userExpiry: unknown }>(writes[1].data.fields, { userExpiry: "" }).userExpiry, null);
});
test("document details reject invalid dates, oversized notes, and foreign documents", async () => {
  for (const input of [{}, { expiry: "2027-02-30" }, { expiry: "not-date" }, { notes: "x".repeat(5001) }, { ownerProfileId: "foreign" }]) assert.equal(documentDetailsSchema.safeParse(input).success, false);
  const client = { document: { findFirst: async () => null } } as unknown as Pick<Prisma.TransactionClient, "document" | "trustMember">;
  await assert.rejects(updateOwnedDocumentDetails(client, owner, "foreign", { notes: "Note" }), { statusCode: 404 });
});
