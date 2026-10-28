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
import { recordCreateSchema, aiProcessingEnabledForUser, requireManualHealthType, parseDate, resolveHealthMember, inferWhenToTake, inferMealTiming } from "./healthSchemas";
import { pendingProfileResponse, prescriptionProcessingStatus, prescriptionProcessingMessage, healthSource, assertMember, addDuration, memberDto } from "./healthDtos";
import { getHealthRecord } from "./healthMembers";


export async function createHealthRecord(userId: string, input: unknown) {
  const data = recordCreateSchema.parse(input);
  const aiProcessingEnabled = await aiProcessingEnabledForUser(userId);
  if (!aiProcessingEnabled) requireManualHealthType(data.type);
  const document = await prisma.document.findFirst({
    where: { id: data.documentId, ownerProfileId: userId, deletedAt: null },
    include: { files: true },
  });
  if (!document) throw Object.assign(new Error("Document not found."), { statusCode: 404 });
  if (!(document.mimeType === "application/pdf" || document.mimeType.startsWith("image/"))) {
    throw Object.assign(new Error("Only images and PDF files are supported."), {
      statusCode: 415,
      code: "UNSUPPORTED_FILE_TYPE",
    });
  }
  const existing = await prisma.healthDocument.findFirst({
    where: { userId, documentId: data.documentId },
  });
  if (existing?.memberId) return getHealthRecord(userId, existing.id);
  if (existing && !data.memberId) return pendingProfileResponse(userId, existing);

  let originalFiles: OriginalDocumentFile[] = [];
  let extractionError: string | null = null;
  let extraction: HealthExtraction | null = null;
  let processingStatus = "processing";
  if (existing?.pendingExtraction && data.memberId) {
    extraction = extractionSchema.parse(existing.pendingExtraction);
    processingStatus = prescriptionProcessingStatus(extraction.documentType, extraction);
    extractionError = prescriptionProcessingMessage(processingStatus, extraction);
  } else if (!aiProcessingEnabled) {
    const manualType = requireManualHealthType(data.type);
    extraction = fallbackHealthExtraction(manualType);
    processingStatus = "ai_processing_disabled";
    extractionError = "AI processing is turned off. Turn on AI processing in Preferences to automatically extract medications from prescriptions, or enter the medications manually.";
  } else
    try {
      originalFiles = await healthSource(document);
    } catch (error) {
      // The record remains available for review, but never pretends extraction
      // succeeded when its encrypted source could not be read.
      extractionError = "The original document could not be read. Retry or enter the information manually.";
    }
  if (!extraction)
    try {
      if (!originalFiles.length) throw new Error("The original document could not be read.");
      extraction = await extractHealthDocument({
        type: data.type,
        files: originalFiles,
      });
      const extractedType = extraction.documentType;
      const suspiciousLabExtraction = extractedType === "lab_report" && extraction.measurements.length === 0 && !extraction.provider && !extraction.doctor;
      if (suspiciousLabExtraction) throw new Error("No structured data could be extracted from this lab report.");
      processingStatus = prescriptionProcessingStatus(extractedType, extraction);
      extractionError = prescriptionProcessingMessage(processingStatus, extraction);
    } catch (error) {
      extraction = fallbackHealthExtraction(data.type ?? "medical_report");
      if ((error as { code?: unknown })?.code === "AI_PROCESSING_DISABLED") {
        processingStatus = "ai_processing_disabled";
        extractionError = "AI processing is turned off. Turn on AI processing in Preferences to automatically extract medications from prescriptions, or enter the medications manually.";
      } else {
        processingStatus = "failed";
        extractionError = "AI could not extract this health document. Retry or enter the information manually.";
      }
    } finally { originalFiles.forEach(file => file.bytes.fill(0)); }

  const extracted = extraction ?? fallbackHealthExtraction(data.type ?? "medical_report");
  const recordType = extracted.documentType;
  const documentDate = parseDate(extracted.documentDate) ?? document.createdAt;
  let memberId = data.memberId;
  let matchedMember: Awaited<ReturnType<typeof assertMember>> | undefined;
  if (memberId) {
    await assertMember(userId, memberId);
  } else if (processingStatus !== "failed" && processingStatus !== "ai_processing_disabled") {
    const resolution = await resolveHealthMember(userId, extracted.patient);
    if (resolution.status !== "matched") {
      const pending = await prisma.healthDocument.upsert({
        where: { userId_documentId: { userId, documentId: data.documentId } },
        create: {
          userId,
          documentId: data.documentId,
          type: recordType,
          documentDate,
          provider: extracted.provider ?? null,
          doctor: extracted.doctor ?? null,
          processingStatus: "awaiting_profile_match",
          patientName: extracted.patient?.name?.trim() || null,
          patientDateOfBirth: parseDate(extracted.patient?.dateOfBirth),
          pendingExtraction: extracted as Prisma.InputJsonValue,
          processedAt: new Date(),
        },
        update: {
          type: recordType,
          documentDate,
          provider: extracted.provider ?? null,
          doctor: extracted.doctor ?? null,
          processingStatus: "awaiting_profile_match",
          processingError: null,
          patientName: extracted.patient?.name?.trim() || null,
          patientDateOfBirth: parseDate(extracted.patient?.dateOfBirth),
          pendingExtraction: extracted as Prisma.InputJsonValue,
          processedAt: new Date(),
        },
      });
      return pendingProfileResponse(userId, pending);
    }
    memberId = resolution.member.id;
    matchedMember = resolution.member;
  }
  if (!memberId) throw Object.assign(new Error("A health profile must be selected before this record can be saved."), { statusCode: 400 });
  const assignedMemberId = memberId;
  const record = await prisma.$transaction(async (tx) => {
    const created = existing
      ? await tx.healthDocument.update({
          where: { id: existing.id },
          data: {
            memberId: assignedMemberId,
            type: recordType,
            documentDate,
            provider: extracted.provider ?? null,
            doctor: extracted.doctor ?? null,
            processingStatus,
            processingError: extractionError,
            patientName: extracted.patient?.name?.trim() || null,
            patientDateOfBirth: parseDate(extracted.patient?.dateOfBirth),
            pendingExtraction: Prisma.JsonNull,
            processedAt: new Date(),
          },
        })
      : await tx.healthDocument.create({
          data: {
            userId,
            memberId: assignedMemberId,
            documentId: data.documentId,
            type: recordType,
            documentDate,
            provider: extracted.provider ?? null,
            doctor: extracted.doctor ?? null,
            processingStatus,
            processingError: extractionError,
            patientName: extracted.patient?.name?.trim() || null,
            patientDateOfBirth: parseDate(extracted.patient?.dateOfBirth),
            processedAt: new Date(),
          },
        });
    const validMeasurements = extracted.measurements.filter((item) => Number.isFinite(item.value) && item.name.trim() && item.unit.trim());
    if (validMeasurements.length) {
      await tx.healthMeasurement.createMany({
        data: validMeasurements.map((item) => {
          const normalized = normalizeMetricName(item.metricKey || item.name);
          return {
            userId,
            memberId: assignedMemberId,
            sourceDocumentId: created.id,
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
    }
    const medications = extracted.medications.filter((item) => item.name.trim());
    if (medications.length) {
      await tx.healthMedication.createMany({
        data: medications.map((item) => ({
          userId,
          memberId: assignedMemberId,
          sourceDocumentId: created.id,
          name: item.name.trim(),
          dose: item.dose ?? null,
          frequency: item.frequency ?? null,
          whenToTake: inferWhenToTake(item.frequency),
          mealTiming: inferMealTiming(item.frequency),
          duration: item.duration ?? null,
          quantity: item.quantity ?? null,
        })),
      });
    }
    for (const item of extracted.followUps.filter((followUp) => followUp.title.trim())) {
      const explicitDate = parseDate(item.explicitDate);
      const dueDate = explicitDate ?? addDuration(documentDate, item.recommendedAfter);
      const followUp = await tx.healthFollowUp.create({
        data: {
          userId,
          memberId: assignedMemberId,
          sourceDocumentId: created.id,
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
            sourceDocumentId: created.id,
            sourceFollowUpId: followUp.id,
            title: item.title.trim(),
            dueDate,
            origin: "document_follow_up",
          },
        });
    }
    return created;
  });
  return {
    ...(await getHealthRecord(userId, record.id)),
    patient: extracted.patient ?? null,
    matchedMember: matchedMember ? memberDto(matchedMember) : null,
  };
}
