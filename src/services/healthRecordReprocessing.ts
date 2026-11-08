import { normalizePatientName, validPatientDob } from "./healthPatientIdentity";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { drainStorageCleanup, queueStorageCleanup } from "./storageCleanup.service";
import { readDecryptedDocumentLocation } from "./documentFileStorage";
import { decryptString } from "../utils/documentEncryption";
import type { OriginalDocumentFile } from "./documentAnalyzer/fileInput";
import { extractHealthDocument, extractionSchema, fallbackHealthExtraction, type HealthDocumentType, type HealthExtraction } from "./healthExtraction.service";
import { metricSearchTerms, normalizeMetricName } from "./healthMetricRegistry";
import { assertAIProcessingEnabled } from "./aiProcessing.service";
import { parseDate, inferWhenToTake, inferMealTiming } from "./healthSchemas";
import { assertMember, healthSource, prescriptionProcessingStatus, prescriptionProcessingMessage, addDuration, measurementDto } from "./healthDtos";
import { getHealthRecord, trackedKeySet } from "./healthMembers";


export async function reprocessHealthRecord(userId: string, recordId: string) {
  const record = await prisma.healthDocument.findFirst({
    where: { id: recordId, userId },
  });
  if (!record)
    throw Object.assign(new Error("Health record not found."), {
      statusCode: 404,
    });
  if (!record.memberId) throw Object.assign(new Error("Assign this health record to a profile before reprocessing."), { statusCode: 409 });
  const assignedMemberId = record.memberId;
  const assignedMember = await assertMember(userId, assignedMemberId);
  const document = await prisma.document.findFirst({
    where: { id: record.documentId, ownerProfileId: userId, deletedAt: null },
    include: { files: true },
  });
  if (!document)
    throw Object.assign(new Error("Original document not found."), {
      statusCode: 404,
    });

  const startedAt = new Date();
  const busy = () => Object.assign(new Error("This health record is already being reanalyzed."), { statusCode: 409 });
  if (record.processingStatus === "processing" && record.processedAt && startedAt.getTime() - record.processedAt.getTime() < 180_000) throw busy();
  const claimed = await prisma.healthDocument.updateMany({
    where: { id: record.id, userId, processingStatus: record.processingStatus, processedAt: record.processedAt },
    data: { processingStatus: "processing", processedAt: startedAt },
  });
  if (claimed.count !== 1) throw busy();
  const claim = { id: record.id, userId, processingStatus: "processing", processedAt: startedAt };

  let extraction: HealthExtraction;
  let processingStatus = "processing";
  let processingError: string | null = null;
  let originalFiles: OriginalDocumentFile[] = [];
  try {
    await assertAIProcessingEnabled(userId);
    originalFiles = await healthSource(document);
    extraction = await extractHealthDocument({
      type: record.type as HealthDocumentType,
      files: originalFiles,
    });
    if (record.type === "lab_report" && extraction.measurements.length === 0 && !extraction.provider && !extraction.doctor) {
      throw new Error("No structured data could be extracted from this lab report.");
    }
    processingStatus = prescriptionProcessingStatus(record.type as HealthDocumentType, extraction);
    processingError = prescriptionProcessingMessage(processingStatus, extraction);
  } catch (error) {
    extraction = fallbackHealthExtraction(record.type as HealthDocumentType);
    if ((error as { code?: unknown })?.code === "AI_PROCESSING_DISABLED") {
      processingStatus = "ai_processing_disabled";
      processingError = "AI processing is turned off. Turn on AI processing in Preferences to automatically extract medications from prescriptions, or enter the medications manually.";
    } else {
      processingStatus = "failed";
      processingError = "AI could not extract this health document. Retry or enter the information manually.";
    }
  } finally { originalFiles.forEach(file => file.bytes.fill(0)); }
  const patient = extraction.patient;
  const dob = validPatientDob(patient?.dateOfBirth);
  if (patient?.identityConflicting || (patient?.name && normalizePatientName(patient.name) !== normalizePatientName(assignedMember.name)) ||
      (dob && assignedMember.dateOfBirth && dob !== assignedMember.dateOfBirth.toISOString().slice(0, 10))) {
    processingStatus = "patient_identity_conflict";
    processingError = "Patient information differs from this profile. Review the original document.";
  }
  if (["failed", "ai_processing_disabled", "patient_identity_conflict"].includes(processingStatus)) {
    await prisma.healthDocument.updateMany({ where: claim, data: { processingStatus, processingError, processedAt: new Date() } });
    return getHealthRecord(userId, record.id);
  }
  const documentDate = parseDate(extraction.documentDate) ?? record.documentDate ?? document.createdAt;
  await prisma.$transaction(async (tx) => {
    const completed = await tx.healthDocument.updateMany({
      where: claim,
      data: { documentDate, provider: extraction.provider ?? null, doctor: extraction.doctor ?? null, pendingExtraction: extraction as Prisma.InputJsonValue, processingStatus, processingError, processedAt: new Date() },
    });
    if (completed.count !== 1) throw busy();

    await tx.healthReminder.deleteMany({
      where: { sourceDocumentId: record.id },
    });
    await tx.healthMeasurement.deleteMany({
      where: { sourceDocumentId: record.id },
    });
    await tx.healthMedication.deleteMany({
      where: { sourceDocumentId: record.id },
    });
    await tx.healthFollowUp.deleteMany({
      where: { sourceDocumentId: record.id },
    });
    const validMeasurements = extraction.measurements.filter((item) => Number.isFinite(item.value) && item.name.trim() && item.unit.trim());
    if (validMeasurements.length)
      await tx.healthMeasurement.createMany({
        data: validMeasurements.map((item) => {
          const normalized = normalizeMetricName(item.metricKey || item.name);
          return {
            userId,
            memberId: assignedMemberId,
            sourceDocumentId: record.id,
            metricKey: normalized.metricKey,
            displayName: normalized.displayName,
            originalName: item.name.trim(),
            value: item.value,
            secondaryValue: item.secondaryValue ?? null,
            unit: item.unit.trim(),
            context: item.context ?? null,
            bodySite: item.bodySite ?? null,
            referenceMin: item.referenceMin ?? null,
            referenceMax: item.referenceMax ?? null,
            referenceText: item.referenceText ?? null,
            measuredAt: documentDate,
          };
        }),
      });
    const medications = extraction.medications.filter((item) => item.name.trim());
    if (medications.length)
      await tx.healthMedication.createMany({
        data: medications.map((item) => ({
          userId,
          memberId: assignedMemberId,
          sourceDocumentId: record.id,
          name: item.name.trim(),
          dose: item.dose ?? null,
          frequency: item.frequency ?? null,
          whenToTake: inferWhenToTake(item.frequency),
          mealTiming: inferMealTiming(item.frequency),
          duration: item.duration ?? null,
          quantity: item.quantity ?? null,
        })),
      });
    for (const item of extraction.followUps.filter((followUp) => followUp.title.trim())) {
      const explicitDate = parseDate(item.explicitDate);
      const dueDate = explicitDate ?? addDuration(documentDate, item.recommendedAfter);
      const followUp = await tx.healthFollowUp.create({
        data: {
          userId,
          memberId: assignedMemberId,
          sourceDocumentId: record.id,
          title: item.title.trim(),
          explicitDate,
          recommendedAfterValue: item.recommendedAfter?.value ? Math.round(item.recommendedAfter.value) : null,
          recommendedAfterUnit: item.recommendedAfter?.unit ?? null,
          dueDate,
          sourceText: item.sourceText ?? null,
        },
      });
      if (dueDate)
        await tx.healthReminder.create({
          data: {
            userId,
            memberId: assignedMemberId,
            sourceDocumentId: record.id,
            sourceFollowUpId: followUp.id,
            title: item.title.trim(),
            dueDate,
            origin: "document_follow_up",
          },
        });
    }
  });
  return getHealthRecord(userId, record.id);
}


export async function deleteHealthRecord(userId: string, recordId: string) {
  const record = await prisma.healthDocument.findFirst({
    where: { id: recordId, userId },
  });
  if (!record)
    throw Object.assign(new Error("Health record not found."), {
      statusCode: 404,
    });
  await prisma.$transaction(
    async (tx) => {
      const document = await tx.document.findFirst({
        where: {
          id: record.documentId,
          ownerProfileId: userId,
          deletedAt: null,
        },
        include: { files: true, wealthAttachments: { select: { id: true } } },
      });
      // These relations cascade to measurements, medications, follow-ups, and
      // document-derived reminders. TrackedHealthMetric deliberately has no
      // relation to the record and is therefore retained as a preference.
      await tx.healthDocument.delete({ where: { id: record.id } });
      // A document shared with Wealth remains there; otherwise this Health-owned
      // upload follows the normal document deletion and encrypted-storage cleanup.
      if (document && document.wealthAttachments.length === 0) {
        await queueStorageCleanup(tx, userId, [document, ...document.files]);
        await tx.document.delete({ where: { id: document.id } });
      }
    },
    { maxWait: 30_000, timeout: 60_000 },
  );
  await drainStorageCleanup(userId);
}


export async function listMeasurements(userId: string, memberId: string, query: { metric?: string; context?: string | null; bodySite?: string | null }) {
  await assertMember(userId, memberId);
  const rows = await prisma.healthMeasurement.findMany({
    where: {
      userId,
      memberId,
      ...(query.metric ? { metricKey: query.metric } : {}),
      ...(query.context !== undefined ? { context: query.context } : {}),
      ...(query.bodySite !== undefined ? { bodySite: query.bodySite } : {}),
    },
    include: { sourceDocument: true },
    orderBy: { measuredAt: "asc" },
  });
  const tracked = await trackedKeySet(userId, memberId);
  return rows.map((item) => measurementDto(item, tracked));
}


export async function listTrackedMetrics(userId: string, memberId: string) {
  await assertMember(userId, memberId);
  return prisma.trackedHealthMetric.findMany({
    where: { userId, memberId, enabled: true },
    orderBy: { createdAt: "asc" },
  });
}
