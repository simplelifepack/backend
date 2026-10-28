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
import { nextReminderDueDate, iso, resolveHealthMember } from "./healthSchemas";


export function reminderDto(item: { id: string; title: string; type: string | null; dueDate: Date; frequency: string | null; recurrence: string | null; origin: string; status: string; memberId: string; member?: { name: string } }) {
  const frequency = item.frequency ?? (item.recurrence ? item.recurrence : "once");
  const dueDate = nextReminderDueDate(item.dueDate, frequency);
  return {
    id: item.id,
    title: item.title,
    type: item.type ?? "other",
    dueDate: iso(dueDate),
    frequency,
    memberId: item.memberId,
    memberName: item.member?.name,
    origin: item.origin,
    status: item.status,
  };
}


export function prescriptionProcessingStatus(type: HealthDocumentType, extraction: HealthExtraction) {
  if (type !== "prescription") return "processed";
  const outcome = extraction.prescriptionAnalysis?.outcome;
  if (outcome === "partial_medications_detected") return "partial_medication_extraction";
  if (outcome === "handwriting_unreadable") return "handwritten_unreadable";
  if (outcome === "no_medications_detected") return "no_medications_detected";
  return extraction.medications.length ? "processed" : "no_medications_detected";
}


export function prescriptionProcessingMessage(status: string, extraction: HealthExtraction) {
  if (status === "partial_medication_extraction") {
    return "Some information in this prescription couldn't be read. Please review the detected medications and add any missing medicines manually.";
  }
  if (status === "handwritten_unreadable") {
    return "We couldn't reliably identify the medicines from this handwriting. You can enter the medications manually.";
  }
  if (status === "no_medications_detected") {
    return extraction.prescriptionAnalysis?.message || "No medications were detected in this prescription. You can enter medications manually.";
  }
  return null;
}


export function addDuration(base: Date | null, duration: { value: number; unit: string } | null | undefined) {
  if (!base || !duration || !Number.isFinite(duration.value) || duration.value <= 0) return null;
  const date = new Date(base);
  if (duration.unit === "days") date.setUTCDate(date.getUTCDate() + duration.value);
  if (duration.unit === "weeks") date.setUTCDate(date.getUTCDate() + duration.value * 7);
  if (duration.unit === "months") date.setUTCMonth(date.getUTCMonth() + duration.value);
  if (duration.unit === "years") date.setUTCFullYear(date.getUTCFullYear() + duration.value);
  return date;
}


export type HealthSourceDocument = Prisma.DocumentGetPayload<{ include: { files: true } }>;

export async function healthSource(document: HealthSourceDocument): Promise<OriginalDocumentFile[]> {
  const pages = [...document.files].sort((a, b) => a.pageIndex - b.pageIndex);
  const files: OriginalDocumentFile[] = [];
  try {
    for (const page of pages.length ? pages : [document]) files.push({
      bytes: await readDecryptedDocumentLocation(page), mimeType: page.mimeType,
      name: decryptString(page.originalName) ?? "health-record",
    });
    return files;
  } catch {
    files.forEach(file => file.bytes.fill(0));
    throw new Error("The original health document could not be read. Retry or enter the information manually.");
  }
}


export function parseBirthDate(value: string | null | undefined) {
  if (!value) return null;
  const input = value.trim();
  const match = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match)
    throw Object.assign(new Error("Enter a valid date of birth."), {
      statusCode: 400,
    });
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  const isRealDate = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  if (!isRealDate)
    throw Object.assign(new Error("Enter a valid date of birth."), {
      statusCode: 400,
    });
  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const minimum = new Date(todayUtc);
  minimum.setUTCFullYear(minimum.getUTCFullYear() - 120);
  if (date.getTime() > todayUtc.getTime())
    throw Object.assign(new Error("Date of birth cannot be in the future."), {
      statusCode: 400,
    });
  if (date.getTime() < minimum.getTime()) throw Object.assign(new Error("Date of birth must be within the last 120 years."), { statusCode: 400 });
  return date;
}


export function memberDto(member: { id: string; name: string; relation: string; bloodGroup: string | null; dateOfBirth: Date | null; conditions: string | null; allergies: string | null; emergencyContactName: string | null; emergencyContactPhone: string | null; primaryDoctor: string | null; insuranceProvider: string | null; insurancePolicyNumber: string | null; createdAt: Date; updatedAt: Date }) {
  return {
    id: member.id,
    name: member.name,
    relation: member.relation,
    bloodGroup: member.bloodGroup,
    dateOfBirth: iso(member.dateOfBirth),
    conditions: member.conditions,
    allergies: member.allergies,
    emergencyContactName: member.emergencyContactName,
    emergencyContactPhone: member.emergencyContactPhone,
    primaryDoctor: member.primaryDoctor,
    insuranceProvider: member.insuranceProvider,
    insurancePolicyNumber: member.insurancePolicyNumber,
    createdAt: member.createdAt,
    updatedAt: member.updatedAt,
  };
}


export function metricIdentity(metric: { metricKey: string; context?: string | null; bodySite?: string | null }) {
  return [metric.metricKey, metric.context ?? "", metric.bodySite ?? ""].join("\u0000");
}


export function measurementDto(
  item: Prisma.HealthMeasurementGetPayload<{
    include: { sourceDocument: true };
  }>,
  tracked?: Set<string>,
) {
  return {
    id: item.id,
    sourceDocumentId: item.sourceDocumentId,
    recordId: item.sourceDocumentId,
    metricKey: item.metricKey,
    displayName: item.displayName,
    originalName: item.originalName,
    value: item.value,
    secondaryValue: item.secondaryValue,
    unit: item.unit,
    context: item.context,
    bodySite: item.bodySite,
    referenceMin: item.referenceMin,
    referenceMax: item.referenceMax,
    referenceText: item.referenceText,
    measuredAt: iso(item.measuredAt),
    sourceType: item.sourceDocument?.type ?? "manual",
    isTracked: tracked?.has(metricIdentity(item)) ?? false,
    aliases: metricSearchTerms(item.metricKey, item.displayName),
  };
}


export function recordSummary(
  record: Prisma.HealthDocumentGetPayload<{
    include: { measurements: true; medications: true; followUps: true };
  }>,
  trackedKeys: Set<string>,
) {
  return {
    id: record.id,
    memberId: record.memberId,
    documentId: record.documentId,
    type: record.type,
    documentDate: iso(record.documentDate),
    provider: record.provider,
    doctor: record.doctor,
    processingStatus: record.processingStatus,
    processingError: record.processingError,
    measurementCount: record.measurements.length,
    trackedMeasurementCount: record.measurements.filter((item) => trackedKeys.has(metricIdentity(item))).length,
    medicationCount: record.medications.length,
    followUpCount: record.followUps.length,
    createdAt: record.createdAt,
    processedAt: record.processedAt,
  };
}


export async function pendingProfileResponse(
  userId: string,
  record: {
    documentId: string;
    type: string;
    patientName: string | null;
    patientDateOfBirth: Date | null;
  },
) {
  const patient = record.patientName
    ? {
        name: record.patientName,
        dateOfBirth: iso(record.patientDateOfBirth),
        age: null,
        gender: null,
      }
    : null;
  const resolution = await resolveHealthMember(userId, patient);
  return {
    documentId: record.documentId,
    type: record.type as HealthDocumentType,
    processingStatus: "awaiting_profile_match" as const,
    patient,
    memberMatch: {
      status: resolution.status,
      candidates: resolution.candidates.map(memberDto),
    },
    measurements: [],
  };
}


export async function assertMember(userId: string, memberId: string) {
  const member = await prisma.healthMember.findFirst({
    where: { id: memberId, userId },
  });
  if (!member)
    throw Object.assign(new Error("Health member not found."), {
      statusCode: 404,
    });
  return member;
}
