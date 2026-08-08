import { Prisma, WealthRecordType } from "@prisma/client";
import { z } from "zod";

import { prisma } from "../lib/prisma";
import { decryptString } from "../utils/documentEncryption";
import { assertModuleEntitlement } from "./entitlements.service";

const types = ["ASSET", "LOAN_TAKEN", "LOAN_GIVEN", "INSURANCE", "PAYMENT_PROOF"] as const;
let wealthRecordsTableAvailable: boolean | null = null;

const recordSchema = z.object({
  type: z.enum(types),
  title: z.string().trim().min(1).max(160),
  details: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  notes: z.string().trim().max(4000).optional(),
  followUpDate: z.string().trim().optional().nullable(),
  followUpNote: z.string().trim().max(2000).optional(),
  attachmentDocumentIds: z.array(z.string().trim().min(1)).default([]),
}).strict();

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw Object.assign(new Error("Follow-up date is invalid."), { statusCode: 400 });
  return date;
}

function money(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 0;
  const normalized = value.replace(/[^0-9.-]/g, "");
  return normalized ? Number(normalized) || 0 : 0;
}

function monthsBetween(start: unknown, duration: unknown) {
  if (typeof duration === "number" && duration > 0) return duration;
  if (typeof duration === "string" && Number(duration) > 0) return Number(duration);
  if (typeof start !== "string") return 0;
  const started = new Date(start);
  if (Number.isNaN(started.getTime())) return 0;
  const now = new Date();
  return Math.max(0, (now.getFullYear() - started.getFullYear()) * 12 + now.getMonth() - started.getMonth());
}

function loanBreakdown(record: { type: WealthRecordType; details: Prisma.JsonValue }) {
  if (record.type !== "LOAN_TAKEN" && record.type !== "LOAN_GIVEN") return null;
  const details = typeof record.details === "object" && record.details ? record.details as Record<string, unknown> : {};
  const principal = money(details.principalAmount ?? details.amount);
  const rate = money(details.interestRate) / 100;
  const enteredMonths = monthsBetween(details.startDate, details.durationMonths);
  const frequency = details.interestFrequency === "yearly" ? "yearly" : "monthly";
  const months = enteredMonths || (rate > 0 ? 12 : 0);
  const periods = frequency === "monthly" ? months : months / 12;
  const calculation = String(details.interestCalculationType ?? "simple");
  const payments = money(details.paymentsMade);
  const interest =
    calculation === "compound" ? principal * ((1 + rate) ** periods - 1) :
    calculation === "flat" ? principal * rate * Math.max(1, periods) :
    calculation === "no-interest" ? 0 :
    principal * rate * periods;
  const totalPayable = principal + Math.max(0, interest);
  return {
    principal,
    interest: Math.round(Math.max(0, interest)),
    payments,
    outstanding: Math.max(0, Math.round(totalPayable - payments)),
    monthsElapsed: months,
    calculationType: calculation,
  };
}

function attachmentDto(attachment: Prisma.WealthRecordAttachmentGetPayload<{ include: { document: true } }>) {
  return {
    id: attachment.id,
    documentId: attachment.documentId,
    originalName: decryptString(attachment.document.originalName) ?? attachment.document.originalName,
    title: decryptString(attachment.document.title) ?? attachment.document.title,
    mimeType: attachment.document.mimeType,
    size: attachment.document.size,
  };
}

function recordDto(record: Prisma.WealthRecordGetPayload<{ include: { attachments: { include: { document: true } } } }>) {
  return {
    id: record.id,
    type: record.type,
    title: record.title,
    details: record.details,
    notes: record.notes,
    followUpDate: record.followUpDate,
    followUpNote: record.followUpNote,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    attachments: record.attachments.map(attachmentDto),
    loanBreakdown: loanBreakdown(record),
  };
}

export async function listWealthRecords(userId: string) {
  await assertModuleEntitlement(userId, "wealth");
  if (wealthRecordsTableAvailable === null) {
    const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`SELECT to_regclass('public.wealth_records') IS NOT NULL AS "exists"`;
    wealthRecordsTableAvailable = Boolean(rows[0]?.exists);
  }
  if (!wealthRecordsTableAvailable) return [];
  const records = await prisma.wealthRecord.findMany({
    where: { ownerUserId: userId },
    include: { attachments: { include: { document: true } } },
    orderBy: { updatedAt: "desc" },
  });
  return records.map(recordDto);
}

export async function createWealthRecord(userId: string, input: unknown) {
  await assertModuleEntitlement(userId, "wealth");
  if (wealthRecordsTableAvailable === null) {
    const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`SELECT to_regclass('public.wealth_records') IS NOT NULL AS "exists"`;
    wealthRecordsTableAvailable = Boolean(rows[0]?.exists);
  }
  if (!wealthRecordsTableAvailable) throw Object.assign(new Error("Wealth records storage is not migrated yet."), { statusCode: 503 });
  const data = recordSchema.parse(input);
  const documentIds = [...new Set(data.attachmentDocumentIds)];
  if (documentIds.length) {
    const count = await prisma.document.count({ where: { id: { in: documentIds }, ownerProfileId: userId, deletedAt: null } });
    if (count !== documentIds.length) throw Object.assign(new Error("One or more attached documents could not be found."), { statusCode: 400 });
  }
  const record = await prisma.wealthRecord.create({
    data: {
      ownerUserId: userId,
      type: data.type,
      title: data.title,
      details: data.details,
      notes: data.notes || null,
      followUpDate: parseDate(data.followUpDate),
      followUpNote: data.followUpNote || null,
      attachments: { create: documentIds.map((documentId) => ({ documentId })) },
    },
    include: { attachments: { include: { document: true } } },
  });
  return recordDto(record);
}
