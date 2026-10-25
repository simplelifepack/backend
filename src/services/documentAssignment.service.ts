import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { decryptJson, encryptJson } from "../utils/documentEncryption";

type Owner = { id: string; name: string };
type AssignmentClient = Pick<Prisma.TransactionClient, "trustMember" | "document">;

export const assignDocumentsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100)
    .refine(ids => new Set(ids).size === ids.length, "Duplicate documents."),
  assigneeId: z.string().min(1),
}).strict();

export async function documentAssignmentOptions(client: Pick<AssignmentClient, "trustMember">, owner: Owner) {
  const members = await client.trustMember.findMany({
    where: { ownerUserId: owner.id, status: { in: ["ACTIVE", "INVITED"] } },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
  return [{ id: owner.id, name: owner.name || "You" }, ...members];
}

/** Filing labels only: assignment never changes document ownership or access. */
export async function assignOwnedDocuments(client: AssignmentClient, owner: Owner, input: z.infer<typeof assignDocumentsSchema>) {
  const { ids, assigneeId } = assignDocumentsSchema.parse(input);
  const options = await documentAssignmentOptions(client, owner);
  const assignee = options.find(option => option.id === assigneeId);
  if (!assignee) throw Object.assign(new Error("Person not found."), { statusCode: 404 });
  const documents = await client.document.findMany({
    where: { id: { in: ids }, ownerProfileId: owner.id, deletedAt: null },
  });
  if (documents.length !== ids.length) {
    throw Object.assign(new Error("One or more documents were not found."), { statusCode: 404 });
  }
  const byId = new Map(documents.map(document => [document.id, document]));
  const updated = [];
  for (const id of ids) {
    const fields = decryptJson<Record<string, unknown>>(byId.get(id)!.fields, {});
    updated.push(await client.document.update({
      where: { id, ownerProfileId: owner.id, deletedAt: null },
      data: { fields: encryptJson({ ...fields, assignedPerson: assignee }) as Prisma.InputJsonValue },
      include: { files: true },
    }));
  }
  return updated;
}

export const documentDetailsSchema = z.object({
  notes: z.string().max(5000).optional(),
  expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "Invalid date.").nullable().optional(),
}).strict().refine(value => Object.keys(value).length > 0, "No changes provided.");

export async function updateOwnedDocumentDetails(client: AssignmentClient, owner: Owner, id: string, input: z.infer<typeof documentDetailsSchema>) {
  const patch = documentDetailsSchema.parse(input);
  const document = await client.document.findFirst({ where: { id, ownerProfileId: owner.id, deletedAt: null } });
  if (!document) throw Object.assign(new Error("Document not found."), { statusCode: 404 });
  const fields = decryptJson<Record<string, unknown>>(document.fields, {});
  return client.document.update({
    where: { id, ownerProfileId: owner.id, deletedAt: null },
    data: { fields: encryptJson({ ...fields, ...(patch.notes !== undefined ? { documentNotes: patch.notes } : {}), ...(patch.expiry !== undefined ? { userExpiry: patch.expiry } : {}) }) as Prisma.InputJsonValue },
    include: { files: true },
  });
}
