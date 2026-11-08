import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { extractionSchema, fallbackHealthExtraction, type HealthExtraction } from "./healthExtraction.service";
import { memberSchema } from "./healthSchemas";
import { healthDocumentType } from "./healthDocumentTypes";
import { createHealthRecord } from "./healthRecordCreation";
import { getHealthRecord } from "./healthMembers";
import { pendingProfileResponse } from "./healthDtos";

const date = (value: string | null | undefined) => !value || (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);
export const reviewedHealthSchema = extractionSchema.omit({ pendingProcessingStatus: true }).superRefine((value, ctx) => {
  if (JSON.stringify(value).length > 500_000 || value.measurements.length > 1000 || value.medications.length > 200 || value.followUps.length > 200)
    ctx.addIssue({ code: "custom", message: "Too much clinical information." });
  if (!date(value.patient?.dateOfBirth) || !date(value.documentDate) || value.followUps.some(item => !date(item.explicitDate)))
    ctx.addIssue({ code: "custom", message: "Enter valid clinical dates (YYYY-MM-DD)." });
  if (value.patient?.age != null && (!Number.isInteger(value.patient.age) || value.patient.age < 0 || value.patient.age > 120))
    ctx.addIssue({ code: "custom", message: "Enter a valid patient age." });
  if (value.followUps.some(item => item.recommendedAfter && (item.recommendedAfter.value <= 0 || item.recommendedAfter.value > 1000)))
    ctx.addIssue({ code: "custom", message: "Enter a valid follow-up interval." });
});
export const healthReviewSchema = z.object({
  extraction: reviewedHealthSchema.optional(),
  memberId: z.string().min(1).optional(),
  newMember: memberSchema.optional(),
}).strict().refine(value => !(value.memberId && value.newMember), "Choose one patient profile.");

export const uploadAnalysisSchema = z.object({
  tempFileIds: z.array(z.string().uuid()).min(1).max(50),
  healthExtraction: extractionSchema.nullable(),
  status: z.enum(["analyzed", "failed", "ai_processing_disabled"]),
});

export async function savedUpload(userId: string, ids: string[], db: Prisma.TransactionClient = prisma) {
  const uploads = await db.temporaryUpload.findMany({ where: { id: { in: ids }, ownerProfileId: userId } });
  if (uploads.length !== ids.length || !uploads[0]?.savedDocumentId || uploads.some(upload => upload.savedDocumentId !== uploads[0]!.savedDocumentId)) return null;
  // A subset or a reordered batch is a different request, never a replay.
  const analysis = uploadAnalysisSchema.safeParse(uploads.find(upload => upload.id === ids[0])?.analysis);
  if (!analysis.success || JSON.stringify(analysis.data.tempFileIds) !== JSON.stringify(ids)) return null;
  return db.document.findFirst({ where: { id: uploads[0].savedDocumentId, ownerProfileId: userId, deletedAt: null }, include: { files: true } });
}

export async function markUploadSaved(db: Prisma.TransactionClient, userId: string, documentId: string, ids: string[], status: z.infer<typeof uploadAnalysisSchema>["status"] = "failed") {
  // The saved Health record owns the clinical data. Keep only the replay metadata.
  await db.temporaryUpload.updateMany({
    where: { ownerProfileId: userId, id: { in: ids } },
    data: { savedDocumentId: documentId, analysis: { tempFileIds: ids, healthExtraction: null, status } },
  });
}

export async function savedUploadHealth(userId: string, documentId: string, db: Prisma.TransactionClient = prisma) {
  const record = await db.healthDocument.findFirst({ where: { userId, documentId } });
  if (!record) return null;
  return record.memberId ? getHealthRecord(userId, record.id, db) : pendingProfileResponse(userId, record, db);
}

export function boundUploadAnalysis(ids: string[], uploads: Array<{ analysis: unknown }>) {
  const value = uploads[0]?.analysis;
  if (!value && uploads.every(upload => !upload.analysis)) return null; // Legacy/import manual saves.
  const parsed = uploadAnalysisSchema.safeParse(value);
  if (!parsed.success || JSON.stringify(parsed.data.tempFileIds) !== JSON.stringify(ids) || uploads.some(upload => JSON.stringify(upload.analysis) !== JSON.stringify(value)))
    throw Object.assign(new Error("Save must reference the complete analyzed document in its original page order."), { statusCode: 422 });
  return parsed.data;
}

export async function saveReviewedHealth(tx: Prisma.TransactionClient, userId: string,
  document: { id: string; documentType: string | null; category: string | null },
  analysis: z.infer<typeof uploadAnalysisSchema> | null, review?: z.infer<typeof healthReviewSchema>) {
  const type = healthDocumentType(document) ?? analysis?.healthExtraction?.documentType;
  if (!type) {
    if (review) throw Object.assign(new Error("Clinical review requires a medical document."), { statusCode: 422 });
    return null;
  }
  if (review?.extraction && !analysis) throw Object.assign(new Error("Clinical review requires an owned upload analysis."), { statusCode: 422 });
  const extraction: HealthExtraction = review?.extraction ?? analysis?.healthExtraction ?? fallbackHealthExtraction(type);
  // Processing outcome is server-owned, even when clinical fields were edited.
  const status = analysis?.status === "ai_processing_disabled" ? "ai_processing_disabled" : analysis?.status === "failed" || !analysis?.healthExtraction ? "failed" : undefined;
  const staged = { ...extraction, ...(status ? { pendingProcessingStatus: status } : {}) };
  const existing = await tx.healthDocument.findFirst({ where: { userId, documentId: document.id } });
  if (existing?.memberId) return getHealthRecord(userId, existing.id, tx); // Replacement must not silently replace clinical records.
  await tx.healthDocument.upsert({
    where: { userId_documentId: { userId, documentId: document.id } },
    create: { userId, documentId: document.id, type: extraction.documentType, processingStatus: "pending_identification", pendingExtraction: staged as Prisma.InputJsonValue },
    update: { type: extraction.documentType, pendingExtraction: staged as Prisma.InputJsonValue },
  });
  return createHealthRecord(userId, { documentId: document.id, type: extraction.documentType, memberId: review?.memberId, newMember: review?.newMember }, tx);
}
