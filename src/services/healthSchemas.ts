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


export const documentTypes = ["lab_report", "medical_report", "prescription"] as const;

export const medicationTimes = ["morning", "afternoon", "night"] as const;

export const mealTimings = ["before_food", "after_food", "with_food", "any_time"] as const;

export const reminderTypes = ["appointment", "medicine", "refill", "other"] as const;

export const reminderFrequencies = ["once", "daily", "weekly", "monthly"] as const;

export type MedicationTime = (typeof medicationTimes)[number];


export const memberSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    relation: z.string().trim().min(1).max(80),
    bloodGroup: z.enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "Unknown"]).optional().nullable(),
    dateOfBirth: z.string().trim().optional().nullable(),
    conditions: z.string().trim().max(2_000).optional().nullable(),
    allergies: z.string().trim().max(2_000).optional().nullable(),
    emergencyContactName: z.string().trim().max(120).optional().nullable(),
    emergencyContactPhone: z.string().trim().max(40).optional().nullable(),
    primaryDoctor: z.string().trim().max(160).optional().nullable(),
    insuranceProvider: z.string().trim().max(160).optional().nullable(),
    insurancePolicyNumber: z.string().trim().max(120).optional().nullable(),
  })
  .strict();


export const recordCreateSchema = z
  .object({
    memberId: z.string().trim().min(1).optional(),
    documentId: z.string().trim().min(1),
    type: z.enum(documentTypes).optional(),
  })
  .strict();


export const recordUpdateSchema = z
  .object({
    type: z.enum(documentTypes).optional(),
  })
  .strict();


export async function aiProcessingEnabledForUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { aiProcessingEnabled: true },
  });
  return Boolean(user?.aiProcessingEnabled);
}


export function requireManualHealthType(type: HealthDocumentType | undefined) {
  if (!type)
    throw Object.assign(
      new Error("Document type is required when AI processing is turned off."),
      { statusCode: 400 },
    );
  return type;
}


export function normalizePatientName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}


export async function resolveHealthMember(userId: string, patient: HealthExtraction["patient"]) {
  const name = patient?.name ? normalizePatientName(patient.name) : "";
  if (!name)
    return {
      status: "missing" as const,
      patient: patient ?? null,
      candidates: [],
    };
  const members = await prisma.healthMember.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  const nameMatches = members.filter((member) => normalizePatientName(member.name) === name);
  const patientDob = parseDate(patient?.dateOfBirth);
  const exactDob = patientDob ? nameMatches.filter((member) => member.dateOfBirth?.getTime() === patientDob.getTime()) : [];
  const candidates = exactDob.length ? exactDob : nameMatches;
  if (candidates.length === 1)
    return {
      status: "matched" as const,
      patient,
      member: candidates[0]!,
      candidates,
    };
  return {
    status: candidates.length ? ("ambiguous" as const) : ("unmatched" as const),
    patient,
    candidates,
  };
}


export const trackedMetricSchema = z
  .object({
    metricKey: z.string().trim().min(1).max(160),
    displayName: z.string().trim().min(1).max(160),
    context: z.string().trim().max(120).optional().nullable(),
    bodySite: z.string().trim().max(120).optional().nullable(),
  })
  .strict();


export const reminderSchema = z
  .object({
    memberId: z.string().trim().min(1),
    title: z.string().trim().min(1).max(180),
    type: z.enum(reminderTypes),
    dueDate: z.string().trim().min(1),
    frequency: z.enum(reminderFrequencies),
    recurrence: z.string().trim().max(80).optional().nullable(),
  })
  .strict();


export const manualMedicationSchema = z
  .object({
    name: z.string().trim().min(1).max(180),
    dose: z.string().trim().min(1).max(120),
    whenToTake: z.array(z.enum(medicationTimes)).min(1),
    mealTiming: z.enum(mealTimings),
    repeatRunsOut: z.string().trim().optional().nullable(),
  })
  .strict();


export const medicationUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(180).optional(),
    dose: z.string().trim().max(120).optional().nullable(),
    whenToTake: z.array(z.enum(medicationTimes)).min(1).optional(),
    mealTiming: z.enum(mealTimings).optional().nullable(),
    repeatRunsOut: z.string().trim().optional().nullable(),
    frequency: z.string().trim().max(160).optional().nullable(),
    duration: z.string().trim().max(160).optional().nullable(),
    quantity: z.string().trim().max(120).optional().nullable(),
    repeats: z.boolean().optional(),
    runsOutAt: z.string().trim().optional().nullable(),
    status: z.enum(["continuing", "stopped"]).optional(),
    stoppedAt: z.string().trim().optional().nullable(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one medication field is required.",
  });


export const manualMeasurementSchema = z
  .object({
    metricKey: z.string().trim().min(1).max(160),
    displayName: z.string().trim().min(1).max(160),
    originalName: z.string().trim().min(1).max(160).optional(),
    value: z.number().finite(),
    secondaryValue: z.number().finite().optional().nullable(),
    unit: z.string().trim().min(1).max(40),
    context: z.string().trim().max(120).optional().nullable(),
    bodySite: z.string().trim().max(120).optional().nullable(),
    referenceMin: z.number().finite().optional().nullable(),
    referenceMax: z.number().finite().optional().nullable(),
    referenceText: z.string().trim().max(240).optional().nullable(),
    measuredAt: z.string().trim().min(1),
  })
  .strict();


export function iso(date: Date | null | undefined) {
  return date ? date.toISOString().slice(0, 10) : null;
}


export function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}


export function parseOptionalDate(value: string | null | undefined, fieldName: string) {
  if (!value) return null;
  const dateOnly = value.slice(0, 10);
  const date = parseDate(dateOnly);
  if (!date || date.toISOString().slice(0, 10) !== dateOnly) {
    throw Object.assign(new Error(`${fieldName} must be a valid date.`), { statusCode: 400 });
  }
  return date;
}


export function inferWhenToTake(frequency: string | null | undefined): MedicationTime[] {
  if (!frequency) return [];
  const text = frequency.toLowerCase();
  return medicationTimes.filter((time) => new RegExp(`\\b${time}\\b`, "i").test(text));
}


export function inferMealTiming(frequency: string | null | undefined) {
  if (!frequency) return null;
  const text = frequency.toLowerCase();
  if (/\bbefore\s+(food|meal|meals)\b/.test(text)) return "before_food";
  if (/\bafter\s+(food|meal|meals)\b/.test(text)) return "after_food";
  if (/\bwith\s+(food|meal|meals)\b/.test(text)) return "with_food";
  if (/\bany\s*time\b/.test(text)) return "any_time";
  return null;
}


export function nextReminderDueDate(dueDate: Date, frequency: string | null | undefined) {
  if (!frequency || frequency === "once") return dueDate;
  const now = new Date();
  const next = new Date(dueDate);
  const advance = () => {
    if (frequency === "daily") next.setUTCDate(next.getUTCDate() + 1);
    else if (frequency === "weekly") next.setUTCDate(next.getUTCDate() + 7);
    else if (frequency === "monthly") next.setUTCMonth(next.getUTCMonth() + 1);
    else return false;
    return true;
  };
  while (next.getTime() < now.getTime()) {
    if (!advance()) break;
  }
  return next;
}
