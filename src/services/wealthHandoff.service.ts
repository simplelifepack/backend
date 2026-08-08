import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { Prisma, WealthRecordType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { decryptString } from "../utils/documentEncryption";
import { createStoredZip, sanitizeArchiveName, type ArchiveFile } from "./archiveZip";
import { readDecryptedDocumentFile } from "./documentFileStorage";
import { assertModuleEntitlement } from "./entitlements.service";
import { sendWealthHandoffEmail } from "./email/emailService";
import { createSummaryPdf } from "./wealthHandoffPdf";

type HandoffType = "family" | "emergency";
type RecordWithAttachments = Prisma.WealthRecordGetPayload<{ include: { attachments: { include: { document: true } } } }>;
let wealthRecordsTableAvailable: boolean | null = null;

const emergencyExclusions = ["Notes", "Follow-up note"];
const sendSchema = z.object({
  familyRecipientIds: z.array(z.string().trim().min(1)).default([]),
  emergencyRecipientIds: z.array(z.string().trim().min(1)).default([]),
}).strict();

const folders: Record<WealthRecordType, string> = {
  ASSET: "Assets",
  LOAN_TAKEN: "Loans-Taken",
  LOAN_GIVEN: "Loans-Given",
  INSURANCE: "Insurance",
  PAYMENT_PROOF: "Financial-Records",
};

function label(type: WealthRecordType) {
  return type.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function safeDetails(record: RecordWithAttachments, type: HandoffType) {
  const base = typeof record.details === "object" && record.details ? record.details as Record<string, unknown> : {};
  return {
    ...base,
    ...(type === "family" && record.notes ? { notes: record.notes } : {}),
    ...(record.followUpDate ? { followUpDate: record.followUpDate.toISOString() } : {}),
    ...(type === "family" && record.followUpNote ? { followUpNote: record.followUpNote } : {}),
  };
}

function counts(records: RecordWithAttachments[]) {
  return {
    assets: records.filter((record) => record.type === "ASSET").length,
    insurance: records.filter((record) => record.type === "INSURANCE").length,
    loans: records.filter((record) => record.type === "LOAN_TAKEN" || record.type === "LOAN_GIVEN").length,
    financialRecords: records.filter((record) => record.type === "PAYMENT_PROOF").length,
    documents: records.reduce((total, record) => total + record.attachments.filter((item) => !item.document.mimeType.startsWith("image/")).length, 0),
    images: records.reduce((total, record) => total + record.attachments.filter((item) => item.document.mimeType.startsWith("image/")).length, 0),
  };
}

async function getVerifiedRecipients(userId: string) {
  const members = await prisma.trustMember.findMany({
    where: { ownerUserId: userId, status: "ACTIVE", permissions: { some: { module: "WEALTH", canView: true, canDownload: true } } },
    include: { permissions: true },
    orderBy: { acceptedAt: "desc" },
  });
  return members.map((member) => ({
    id: member.id,
    name: member.name,
    email: member.email,
    relationship: member.customRelation ?? member.relation,
    verificationStatus: "verified" as const,
    type: member.accessType === "FAMILY_MEMBER" ? "family" as const : member.accessType === "EMERGENCY_ACCESS" ? "emergency" as const : "other" as const,
  }));
}

async function getRecords(userId: string) {
  if (wealthRecordsTableAvailable === null) {
    const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`SELECT to_regclass('public.wealth_records') IS NOT NULL AS "exists"`;
    wealthRecordsTableAvailable = Boolean(rows[0]?.exists);
  }
  if (!wealthRecordsTableAvailable) return [];
  return prisma.wealthRecord.findMany({
    where: { ownerUserId: userId },
    include: { attachments: { include: { document: true } } },
    orderBy: [{ type: "asc" }, { updatedAt: "desc" }],
  });
}

function summaryLines(records: RecordWithAttachments[], type: HandoffType) {
  return [
    "Wealth Summary",
    `Generated: ${new Date().toISOString()}`,
    "",
    ...records.flatMap((record) => [
      `${label(record.type)}: ${record.title}`,
      ...Object.entries(safeDetails(record, type)).map(([key, value]) => `${key}: ${String(value)}`),
      `Attached documents: ${record.attachments.length}`,
      "",
    ]),
    type === "family" ? "Family handoff includes notes and follow-up notes." : "Emergency access excludes notes and follow-up notes.",
  ];
}

async function buildPackage(userId: string, type: HandoffType) {
  const records = await getRecords(userId);
  const files: ArchiveFile[] = [{
    name: "LifePack-Wealth-Handoff/Wealth-Summary.pdf",
    data: createSummaryPdf(summaryLines(records, type)),
  }];

  for (const record of records) {
    const prefix = `LifePack-Wealth-Handoff/${folders[record.type]}/${sanitizeArchiveName(record.title)}-${record.id}`;
    files.push({
      name: `${prefix}/record.json`,
      data: Buffer.from(JSON.stringify({
        id: record.id,
        type: record.type,
        title: record.title,
        details: safeDetails(record, type),
        attachmentCount: record.attachments.length,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      }, null, 2), "utf8"),
      modifiedAt: record.updatedAt,
    });
    for (const attachment of record.attachments) {
      const document = attachment.document;
      const name = sanitizeArchiveName(decryptString(document.title) ?? decryptString(document.originalName) ?? "document");
      files.push({
        name: `${prefix}/Attachments/${name}`,
        data: await readDecryptedDocumentFile(document.storageKey ?? document.path, document),
        modifiedAt: document.updatedAt,
      });
    }
  }

  return {
    fileName: `LifePack-Wealth-${type === "family" ? "Family" : "Emergency"}-Handoff.zip`,
    zip: createStoredZip(files),
    counts: counts(records),
  };
}

function contentSummary(type: HandoffType) {
  const base = ["All Wealth records", "Assets", "Loans Taken", "Loans Given", "Insurance", "Payment / Financial Proof", "Attached documents", "Readable Wealth summary"];
  return type === "family" ? [...base, "Notes", "Follow-up information"] : base;
}

export async function getWealthHandoffSummary(userId: string) {
  await assertModuleEntitlement(userId, "wealth");
  const [recipients, records] = await Promise.all([getVerifiedRecipients(userId), getRecords(userId)]);
  return {
    generatedAt: new Date().toISOString(),
    recipients: {
      family: recipients.filter((recipient) => recipient.type === "family"),
      emergency: recipients.filter((recipient) => recipient.type === "emergency"),
    },
    handoffTypes: (["family", "emergency"] as const).map((type) => ({
      type,
      label: type === "family" ? "Family Handoff" : "Emergency Access",
      contents: contentSummary(type),
      excluded: type === "emergency" ? emergencyExclusions : [],
      counts: counts(records),
    })),
  };
}

export async function sendWealthHandoff(userId: string, input: unknown) {
  await assertModuleEntitlement(userId, "wealth");
  const data = sendSchema.parse(input);
  const recipients = await getVerifiedRecipients(userId);
  const groups = [
    { type: "family" as const, label: "Family Handoff", recipients: recipients.filter((item) => item.type === "family" && data.familyRecipientIds.includes(item.id)) },
    { type: "emergency" as const, label: "Emergency Access", recipients: recipients.filter((item) => item.type === "emergency" && data.emergencyRecipientIds.includes(item.id)) },
  ];
  if (groups[0].recipients.length !== data.familyRecipientIds.length || groups[1].recipients.length !== data.emergencyRecipientIds.length) {
    throw Object.assign(new Error("Only verified recipients can receive a Wealth handoff."), { statusCode: 400 });
  }
  if (!groups.some((group) => group.recipients.length)) throw Object.assign(new Error("Select at least one verified recipient."), { statusCode: 400 });
  const owner = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  const results = [];
  for (const group of groups) {
    if (!group.recipients.length) continue;
    const archive = await buildPackage(userId, group.type);
    const summary = `${group.label}\nRecords included in ZIP. Documents are attached only when linked to Wealth records.`;
    for (const recipient of group.recipients) {
      const delivery = await sendWealthHandoffEmail({
        handoffId: randomUUID(),
        to: recipient.email,
        recipientName: recipient.name,
        ownerName: owner?.name ?? null,
        handoffLabel: group.label,
        summary,
        attachment: { filename: archive.fileName, content: archive.zip, contentType: "application/zip" },
      });
      results.push({ recipientId: recipient.id, email: recipient.email, handoffType: group.type, ...delivery });
    }
  }
  return { message: "Wealth SOS handoff completed.", results };
}
