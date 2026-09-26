import { Prisma, type Prisma as PrismaTypes } from "@prisma/client";
import { z } from "zod";

import { prisma } from "../lib/prisma";
import { drainStorageCleanup, queueStorageCleanup } from "./storageCleanup.service";
import { readDecryptedDocumentFile } from "./documentFileStorage";
import { withIsolatedPlaintextFile } from "./documentSecurityValidation";
import { ingestDocument } from "./ingestion/pipeline";
import { decryptJson, decryptString } from "../utils/documentEncryption";
import { extractHealthDocument, extractionSchema, fallbackHealthExtraction, type HealthDocumentType, type HealthExtraction } from "./healthExtraction.service";
import { metricSearchTerms, normalizeMetricName } from "./healthMetricRegistry";

const documentTypes = ["lab_report", "medical_report", "prescription"] as const;

export const memberSchema = z.object({
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
}).strict();

export const recordCreateSchema = z.object({
  memberId: z.string().trim().min(1).optional(),
  documentId: z.string().trim().min(1),
  type: z.enum(documentTypes),
}).strict();

function normalizePatientName(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9 ]/g, " ").trim().toLowerCase().replace(/\s+/g, " ");
}

async function resolveHealthMember(userId: string, patient: HealthExtraction["patient"]) {
  const name = patient?.name ? normalizePatientName(patient.name) : "";
  if (!name) return { status: "missing" as const, patient: patient ?? null, candidates: [] };
  const members = await prisma.healthMember.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  const nameMatches = members.filter((member) => normalizePatientName(member.name) === name);
  const patientDob = parseDate(patient?.dateOfBirth);
  const exactDob = patientDob ? nameMatches.filter((member) => member.dateOfBirth?.getTime() === patientDob.getTime()) : [];
  const candidates = exactDob.length ? exactDob : nameMatches;
  if (candidates.length === 1) return { status: "matched" as const, patient, member: candidates[0]!, candidates };
  return { status: candidates.length ? "ambiguous" as const : "unmatched" as const, patient, candidates };
}

export const trackedMetricSchema = z.object({
  metricKey: z.string().trim().min(1).max(160),
  displayName: z.string().trim().min(1).max(160),
  context: z.string().trim().max(120).optional().nullable(),
  bodySite: z.string().trim().max(120).optional().nullable(),
}).strict();

export const reminderSchema = z.object({
  memberId: z.string().trim().min(1),
  title: z.string().trim().min(1).max(180),
  dueDate: z.string().trim().min(1),
  recurrence: z.string().trim().max(80).optional().nullable(),
}).strict();

export const manualMedicationSchema = z.object({
  name: z.string().trim().min(1).max(180),
  dose: z.string().trim().min(1).max(120),
  frequency: z.string().trim().max(160).optional().nullable(),
  repeats: z.boolean().default(false),
  runsOutAt: z.string().trim().optional().nullable(),
}).strict();

function iso(date: Date | null | undefined) {
  return date ? date.toISOString().slice(0, 10) : null;
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDuration(base: Date | null, duration: { value: number; unit: string } | null | undefined) {
  if (!base || !duration || !Number.isFinite(duration.value) || duration.value <= 0) return null;
  const date = new Date(base);
  if (duration.unit === "days") date.setUTCDate(date.getUTCDate() + duration.value);
  if (duration.unit === "weeks") date.setUTCDate(date.getUTCDate() + duration.value * 7);
  if (duration.unit === "months") date.setUTCMonth(date.getUTCMonth() + duration.value);
  if (duration.unit === "years") date.setUTCFullYear(date.getUTCFullYear() + duration.value);
  return date;
}

function sourceText(document: { rawText: string | null; fields: PrismaTypes.JsonValue }) {
  const rawText = decryptString(document.rawText) ?? "";
  const fields = decryptJson<Record<string, unknown> | null>(document.fields, null);
  return [
    rawText,
    fields && typeof fields === "object" ? JSON.stringify(fields).slice(0, 12_000) : "",
  ].filter(Boolean).join("\n\n");
}

function extensionForMimeType(mimeType: string) {
  return ({ "application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" } as Record<string, string>)[mimeType] ?? ".bin";
}

async function healthSource(document: Prisma.DocumentGetPayload<Record<string, never>>) {
  const saved = sourceText(document);
  const bytes = await readDecryptedDocumentFile(document.storageKey ?? document.path, document);
  if (saved.trim()) return { text: saved, bytes };

  // The normal document-save path intentionally does not retain full OCR text.
  // Health extraction therefore reads the encrypted original only long enough to
  // run the existing local extractor; the temporary plaintext is removed by the
  // isolation helper before the record is persisted.
  const text = await withIsolatedPlaintextFile(bytes, extensionForMimeType(document.mimeType), async (filePath) => {
    const analysis = await ingestDocument({
      path: filePath,
      originalName: decryptString(document.originalName) ?? "health-record",
      mimeType: document.mimeType,
      size: document.size,
    });
    return analysis.extractedText;
  });
  return { text, bytes };
}

function parseOptionalDate(value: string | null | undefined, field = "Date") {
  if (!value) return null;
  const input = value.trim();
  const match = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw Object.assign(new Error("Enter a valid date of birth."), { statusCode: 400 });
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  const isRealDate =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  if (!isRealDate) throw Object.assign(new Error("Enter a valid date of birth."), { statusCode: 400 });
  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const minimum = new Date(todayUtc);
  minimum.setUTCFullYear(minimum.getUTCFullYear() - 120);
  if (date.getTime() > todayUtc.getTime()) throw Object.assign(new Error("Date of birth cannot be in the future."), { statusCode: 400 });
  if (date.getTime() < minimum.getTime()) throw Object.assign(new Error("Date of birth must be within the last 120 years."), { statusCode: 400 });
  return date;
}

function memberDto(member: { id: string; name: string; relation: string; bloodGroup: string | null; dateOfBirth: Date | null; conditions: string | null; allergies: string | null; emergencyContactName: string | null; emergencyContactPhone: string | null; primaryDoctor: string | null; insuranceProvider: string | null; insurancePolicyNumber: string | null; createdAt: Date; updatedAt: Date }) {
  return { id: member.id, name: member.name, relation: member.relation, bloodGroup: member.bloodGroup, dateOfBirth: iso(member.dateOfBirth), conditions: member.conditions, allergies: member.allergies, emergencyContactName: member.emergencyContactName, emergencyContactPhone: member.emergencyContactPhone, primaryDoctor: member.primaryDoctor, insuranceProvider: member.insuranceProvider, insurancePolicyNumber: member.insurancePolicyNumber, createdAt: member.createdAt, updatedAt: member.updatedAt };
}

function metricIdentity(metric: { metricKey: string; context?: string | null; bodySite?: string | null }) {
  return [metric.metricKey, metric.context ?? "", metric.bodySite ?? ""].join("\u0000");
}

function measurementDto(item: Prisma.HealthMeasurementGetPayload<{ include: { sourceDocument: true } }>, tracked?: Set<string>) {
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
    sourceType: item.sourceDocument.type,
    isTracked: tracked?.has(metricIdentity(item)) ?? false,
    aliases: metricSearchTerms(item.metricKey, item.displayName),
  };
}

function recordSummary(record: Prisma.HealthDocumentGetPayload<{ include: { measurements: true; medications: true; followUps: true } }>, trackedKeys: Set<string>) {
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

async function pendingProfileResponse(userId: string, record: { documentId: string; type: string; patientName: string | null; patientDateOfBirth: Date | null }) {
  const patient = record.patientName ? { name: record.patientName, dateOfBirth: iso(record.patientDateOfBirth), age: null, gender: null } : null;
  const resolution = await resolveHealthMember(userId, patient);
  return {
    documentId: record.documentId,
    type: record.type as HealthDocumentType,
    processingStatus: "awaiting_profile_match" as const,
    patient,
    memberMatch: { status: resolution.status, candidates: resolution.candidates.map(memberDto) },
    measurements: [],
  };
}

async function assertMember(userId: string, memberId: string) {
  const member = await prisma.healthMember.findFirst({ where: { id: memberId, userId } });
  if (!member) throw Object.assign(new Error("Health member not found."), { statusCode: 404 });
  return member;
}

export async function ensureDefaultHealthMember(userId: string, name = "Myself") {
  const existing = await prisma.healthMember.findFirst({ where: { userId, relation: "Myself" }, orderBy: { createdAt: "asc" } });
  if (existing) return existing;
  return prisma.healthMember.create({ data: { userId, name, relation: "Myself" } });
}

export async function listHealthMembers(userId: string, userName?: string) {
  await ensureDefaultHealthMember(userId, userName || "Myself");
  const members = await prisma.healthMember.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  return members.map(memberDto);
}

export async function createHealthMember(userId: string, input: unknown) {
  const data = memberSchema.parse(input);
  return memberDto(await prisma.healthMember.create({ data: { userId, name: data.name, relation: data.relation, bloodGroup: data.bloodGroup || null, dateOfBirth: parseOptionalDate(data.dateOfBirth, "Date of birth") } }));
}

export async function updateHealthMember(userId: string, memberId: string, input: unknown) {
  await assertMember(userId, memberId);
  const data = memberSchema.partial().parse(input);
  return memberDto(await prisma.healthMember.update({
    where: { id: memberId },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.relation !== undefined ? { relation: data.relation } : {}),
      ...(data.bloodGroup !== undefined ? { bloodGroup: data.bloodGroup || null } : {}),
      ...(data.dateOfBirth !== undefined ? { dateOfBirth: parseOptionalDate(data.dateOfBirth, "Date of birth") } : {}),
      ...(data.conditions !== undefined ? { conditions: data.conditions || null } : {}),
      ...(data.allergies !== undefined ? { allergies: data.allergies || null } : {}),
      ...(data.emergencyContactName !== undefined ? { emergencyContactName: data.emergencyContactName || null } : {}),
      ...(data.emergencyContactPhone !== undefined ? { emergencyContactPhone: data.emergencyContactPhone || null } : {}),
      ...(data.primaryDoctor !== undefined ? { primaryDoctor: data.primaryDoctor || null } : {}),
      ...(data.insuranceProvider !== undefined ? { insuranceProvider: data.insuranceProvider || null } : {}),
      ...(data.insurancePolicyNumber !== undefined ? { insurancePolicyNumber: data.insurancePolicyNumber || null } : {}),
    },
  }));
}

export async function deleteHealthMember(userId: string, memberId: string) {
  const member = await assertMember(userId, memberId);
  if (member.relation === "Myself") throw Object.assign(new Error("The default health member cannot be deleted."), { statusCode: 400 });
  await prisma.healthMember.delete({ where: { id: memberId } });
}

async function trackedKeySet(userId: string, memberId: string) {
  const tracked = await prisma.trackedHealthMetric.findMany({ where: { userId, memberId, enabled: true } });
  return new Set(tracked.map(metricIdentity));
}

export async function listHealthRecords(userId: string, memberId: string) {
  await assertMember(userId, memberId);
  const tracked = await trackedKeySet(userId, memberId);
  const records = await prisma.healthDocument.findMany({
    where: { userId, memberId },
    include: { measurements: true, medications: true, followUps: true },
    orderBy: [{ documentDate: "desc" }, { createdAt: "desc" }],
  });
  return records.map((record) => recordSummary(record, tracked));
}

export async function getHealthRecord(userId: string, recordId: string) {
  const record = await prisma.healthDocument.findFirst({
    where: { id: recordId, userId },
    include: {
      measurements: { include: { sourceDocument: true }, orderBy: { displayName: "asc" } },
      medications: true,
      followUps: true,
      reminders: true,
    },
  });
  if (!record) throw Object.assign(new Error("Health record not found."), { statusCode: 404 });
  if (!record.memberId) throw Object.assign(new Error("This health record is awaiting profile assignment."), { statusCode: 409 });
  const tracked = await trackedKeySet(userId, record.memberId);
  return {
    ...recordSummary(record, tracked),
    measurements: record.measurements.map((item) => measurementDto(item, tracked)),
    medications: record.medications,
    followUps: record.followUps.map((item) => ({ ...item, explicitDate: iso(item.explicitDate), dueDate: iso(item.dueDate) })),
    reminders: record.reminders.map((item) => ({ ...item, dueDate: iso(item.dueDate) })),
  };
}

export async function createHealthRecord(userId: string, input: unknown) {
  const data = recordCreateSchema.parse(input);
  const document = await prisma.document.findFirst({ where: { id: data.documentId, ownerProfileId: userId, deletedAt: null } });
  if (!document) throw Object.assign(new Error("Document not found."), { statusCode: 404 });
  if (!(document.mimeType === "application/pdf" || document.mimeType.startsWith("image/"))) {
    throw Object.assign(new Error("Only images and PDF files are supported."), { statusCode: 415, code: "UNSUPPORTED_FILE_TYPE" });
  }
  const existing = await prisma.healthDocument.findFirst({ where: { userId, documentId: data.documentId } });
  if (existing?.memberId) return getHealthRecord(userId, existing.id);
  if (existing && !data.memberId) return pendingProfileResponse(userId, existing);

  let text = "";
  let documentBytes: Buffer | null = null;
  let extractionError: string | null = null;
  let extraction: HealthExtraction | null = null;
  let processingStatus = "processing";
  if (existing?.pendingExtraction && data.memberId) {
    extraction = extractionSchema.parse(existing.pendingExtraction);
    processingStatus = "processed";
  } else try {
    const source = await healthSource(document);
    text = source.text;
    documentBytes = source.bytes;
  } catch (error) {
    // The record remains available for review, but never pretends extraction
    // succeeded when its encrypted source could not be read.
    text = "";
    extractionError = error instanceof Error ? error.message : "The original document could not be read.";
  }
  if (!extraction) try {
    if (!documentBytes) throw new Error(extractionError ?? "The original document could not be read.");
    extraction = await extractHealthDocument({
      type: data.type,
      text,
      file: {
        bytes: documentBytes,
        mimeType: document.mimeType,
        name: decryptString(document.originalName) ?? "health-record",
      },
    });
    const suspiciousLabExtraction = data.type === "lab_report"
      && extraction.measurements.length === 0
      && !extraction.provider
      && !extraction.doctor;
    if (suspiciousLabExtraction) throw new Error("No structured data could be extracted from this lab report.");
    processingStatus = "processed";
  } catch (error) {
    extraction = fallbackHealthExtraction(data.type);
    processingStatus = "failed";
    extractionError = error instanceof Error ? error.message : "Health document extraction failed.";
  }

  const extracted = extraction ?? fallbackHealthExtraction(data.type);
  const documentDate = parseDate(extracted.documentDate) ?? document.createdAt;
  let memberId = data.memberId;
  let matchedMember: Awaited<ReturnType<typeof assertMember>> | undefined;
  if (memberId) {
    await assertMember(userId, memberId);
  } else if (processingStatus === "processed") {
    const resolution = await resolveHealthMember(userId, extracted.patient);
    if (resolution.status !== "matched") {
      const pending = await prisma.healthDocument.upsert({
        where: { userId_documentId: { userId, documentId: data.documentId } },
        create: { userId, documentId: data.documentId, type: data.type, documentDate, provider: extracted.provider ?? null, doctor: extracted.doctor ?? null, processingStatus: "awaiting_profile_match", patientName: extracted.patient?.name?.trim() || null, patientDateOfBirth: parseDate(extracted.patient?.dateOfBirth), pendingExtraction: extracted as Prisma.InputJsonValue, processedAt: new Date() },
        update: { documentDate, provider: extracted.provider ?? null, doctor: extracted.doctor ?? null, processingStatus: "awaiting_profile_match", processingError: null, patientName: extracted.patient?.name?.trim() || null, patientDateOfBirth: parseDate(extracted.patient?.dateOfBirth), pendingExtraction: extracted as Prisma.InputJsonValue, processedAt: new Date() },
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
      ? await tx.healthDocument.update({ where: { id: existing.id }, data: {
        memberId: assignedMemberId, type: data.type, documentDate, provider: extracted.provider ?? null, doctor: extracted.doctor ?? null, processingStatus, processingError: extractionError, patientName: extracted.patient?.name?.trim() || null, patientDateOfBirth: parseDate(extracted.patient?.dateOfBirth), pendingExtraction: Prisma.JsonNull, processedAt: new Date(),
      } })
      : await tx.healthDocument.create({
      data: {
        userId,
        memberId: assignedMemberId,
        documentId: data.documentId,
        type: data.type,
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
      await tx.healthMedication.createMany({ data: medications.map((item) => ({ userId, memberId: assignedMemberId, sourceDocumentId: created.id, name: item.name.trim(), dose: item.dose ?? null, frequency: item.frequency ?? null, duration: item.duration ?? null, quantity: item.quantity ?? null })) });
    }
    for (const item of extracted.followUps.filter((followUp) => followUp.title.trim())) {
      const explicitDate = parseDate(item.explicitDate);
      const dueDate = explicitDate ?? addDuration(documentDate, item.recommendedAfter);
      const followUp = await tx.healthFollowUp.create({ data: { userId, memberId: assignedMemberId, sourceDocumentId: created.id, title: item.title.trim(), explicitDate, recommendedAfterValue: item.recommendedAfter?.value ? Math.round(item.recommendedAfter.value) : null, recommendedAfterUnit: item.recommendedAfter?.unit ?? null, dueDate, sourceText: item.sourceText ?? null } });
      if (dueDate) await tx.healthReminder.create({ data: { userId, memberId: assignedMemberId, sourceDocumentId: created.id, sourceFollowUpId: followUp.id, title: item.title.trim(), dueDate, origin: "document_follow_up" } });
    }
    return created;
  });
  return { ...(await getHealthRecord(userId, record.id)), patient: extracted.patient ?? null, matchedMember: matchedMember ? memberDto(matchedMember) : null };
}

export async function reprocessHealthRecord(userId: string, recordId: string) {
  const record = await prisma.healthDocument.findFirst({ where: { id: recordId, userId } });
  if (!record) throw Object.assign(new Error("Health record not found."), { statusCode: 404 });
  if (!record.memberId) throw Object.assign(new Error("Assign this health record to a profile before reprocessing."), { statusCode: 409 });
  const assignedMemberId = record.memberId;
  await assertMember(userId, assignedMemberId);
  const document = await prisma.document.findFirst({ where: { id: record.documentId, ownerProfileId: userId, deletedAt: null } });
  if (!document) throw Object.assign(new Error("Original document not found."), { statusCode: 404 });

  let extraction: HealthExtraction;
  let processingStatus = "processing";
  let processingError: string | null = null;
  try {
    const source = await healthSource(document);
    extraction = await extractHealthDocument({
      type: record.type as HealthDocumentType,
      text: source.text,
      file: { bytes: source.bytes, mimeType: document.mimeType, name: decryptString(document.originalName) ?? "health-record" },
    });
    if (record.type === "lab_report" && extraction.measurements.length === 0 && !extraction.provider && !extraction.doctor) {
      throw new Error("No structured data could be extracted from this lab report.");
    }
    processingStatus = "processed";
  } catch (error) {
    extraction = fallbackHealthExtraction(record.type as HealthDocumentType);
    processingStatus = "failed";
    processingError = error instanceof Error ? error.message : "Health document extraction failed.";
  }
  const documentDate = parseDate(extraction.documentDate) ?? record.documentDate ?? document.createdAt;
  await prisma.$transaction(async (tx) => {
    await tx.healthReminder.deleteMany({ where: { sourceDocumentId: record.id } });
    await tx.healthMeasurement.deleteMany({ where: { sourceDocumentId: record.id } });
    await tx.healthMedication.deleteMany({ where: { sourceDocumentId: record.id } });
    await tx.healthFollowUp.deleteMany({ where: { sourceDocumentId: record.id } });
    await tx.healthDocument.update({ where: { id: record.id }, data: {
      documentDate,
      provider: extraction.provider ?? null,
      doctor: extraction.doctor ?? null,
      processingStatus,
      processingError,
      processedAt: new Date(),
    } });
    if (processingStatus !== "processed") return;
    const validMeasurements = extraction.measurements.filter((item) => Number.isFinite(item.value) && item.name.trim() && item.unit.trim());
    if (validMeasurements.length) await tx.healthMeasurement.createMany({ data: validMeasurements.map((item) => {
      const normalized = normalizeMetricName(item.metricKey || item.name);
      return { userId, memberId: assignedMemberId, sourceDocumentId: record.id, metricKey: normalized.metricKey, displayName: normalized.displayName, originalName: item.name.trim(), value: item.value, secondaryValue: item.secondaryValue ?? null, unit: item.unit.trim(), context: item.context ?? null, bodySite: item.bodySite ?? null, referenceMin: item.referenceMin ?? null, referenceMax: item.referenceMax ?? null, referenceText: item.referenceText ?? null, measuredAt: documentDate };
    }) });
    const medications = extraction.medications.filter((item) => item.name.trim());
    if (medications.length) await tx.healthMedication.createMany({ data: medications.map((item) => ({ userId, memberId: assignedMemberId, sourceDocumentId: record.id, name: item.name.trim(), dose: item.dose ?? null, frequency: item.frequency ?? null, duration: item.duration ?? null, quantity: item.quantity ?? null })) });
    for (const item of extraction.followUps.filter((followUp) => followUp.title.trim())) {
      const explicitDate = parseDate(item.explicitDate);
      const dueDate = explicitDate ?? addDuration(documentDate, item.recommendedAfter);
      const followUp = await tx.healthFollowUp.create({ data: { userId, memberId: assignedMemberId, sourceDocumentId: record.id, title: item.title.trim(), explicitDate, recommendedAfterValue: item.recommendedAfter?.value ? Math.round(item.recommendedAfter.value) : null, recommendedAfterUnit: item.recommendedAfter?.unit ?? null, dueDate, sourceText: item.sourceText ?? null } });
      if (dueDate) await tx.healthReminder.create({ data: { userId, memberId: assignedMemberId, sourceDocumentId: record.id, sourceFollowUpId: followUp.id, title: item.title.trim(), dueDate, origin: "document_follow_up" } });
    }
  });
  return getHealthRecord(userId, record.id);
}

export async function deleteHealthRecord(userId: string, recordId: string) {
  const record = await prisma.healthDocument.findFirst({ where: { id: recordId, userId } });
  if (!record) throw Object.assign(new Error("Health record not found."), { statusCode: 404 });
  await prisma.$transaction(async (tx) => {
    const document = await tx.document.findFirst({
      where: { id: record.documentId, ownerProfileId: userId, deletedAt: null },
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
  }, { maxWait: 30_000, timeout: 60_000 });
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
  return prisma.trackedHealthMetric.findMany({ where: { userId, memberId, enabled: true }, orderBy: { createdAt: "asc" } });
}

export async function enableTrackedMetric(userId: string, memberId: string, input: unknown) {
  await assertMember(userId, memberId);
  const data = trackedMetricSchema.parse(input);
  const existing = await prisma.trackedHealthMetric.findFirst({ where: { userId, memberId, metricKey: data.metricKey, context: data.context ?? null, bodySite: data.bodySite ?? null } });
  if (existing) return prisma.trackedHealthMetric.update({ where: { id: existing.id }, data: { displayName: data.displayName, enabled: true } });
  return prisma.trackedHealthMetric.create({ data: { userId, memberId, metricKey: data.metricKey, displayName: data.displayName, context: data.context ?? null, bodySite: data.bodySite ?? null } });
}

export async function disableTrackedMetric(userId: string, memberId: string, trackedId: string) {
  await assertMember(userId, memberId);
  await prisma.trackedHealthMetric.updateMany({ where: { id: trackedId, userId, memberId }, data: { enabled: false } });
}

export async function searchAvailableMetrics(userId: string, memberId: string, search = "") {
  await assertMember(userId, memberId);
  const measurements = await prisma.healthMeasurement.findMany({ where: { userId, memberId }, orderBy: { measuredAt: "desc" } });
  const tracked = await trackedKeySet(userId, memberId);
  const byKey = new Map<string, typeof measurements>();
  measurements.forEach((item) => byKey.set(item.metricKey, [...(byKey.get(item.metricKey) ?? []), item]));
  const q = search.trim().toLowerCase();
  return Array.from(byKey.entries()).flatMap(([metricKey, rows]) => {
    const latest = rows[0]!;
    const terms = metricSearchTerms(metricKey, latest.displayName);
    if (q && !terms.some((term) => term.includes(q)) && !rows.some((row) => row.originalName.toLowerCase().includes(q))) return [];
    return [{
      metricKey,
      displayName: latest.displayName,
      context: latest.context,
      bodySite: latest.bodySite,
      historicalReadingCount: rows.length,
      isTracked: tracked.has(metricKey),
      latestValue: latest.value,
      secondaryValue: latest.secondaryValue,
      unit: latest.unit,
    }];
  });
}

export async function getOverview(userId: string, memberId: string) {
  const member = await assertMember(userId, memberId);
  const [records, tracked, reminders] = await Promise.all([
    listHealthRecords(userId, memberId),
    listTrackedMetrics(userId, memberId),
    prisma.healthReminder.findMany({ where: { userId, memberId, status: "active", dueDate: { gte: new Date() } }, orderBy: { dueDate: "asc" }, take: 5 }),
  ]);
  const trackedMetrics = await Promise.all(tracked.map(async (metric) => {
    const measurements = await listMeasurements(userId, memberId, {
      metric: metric.metricKey,
      context: metric.context,
      bodySite: metric.bodySite,
    });
    return { ...metric, measurements, latest: measurements[measurements.length - 1] ?? null };
  }));
  return { member: memberDto(member), upcoming: reminders.map((item) => ({ ...item, dueDate: iso(item.dueDate) })), trackedMetrics, recentRecords: records.slice(0, 5) };
}

export async function listActiveHealthReminders(userId: string) {
  const reminders = await prisma.healthReminder.findMany({
    where: { userId, status: "active" },
    include: { member: { select: { name: true } } },
    orderBy: { dueDate: "asc" },
    take: 20,
  });
  return reminders.map((item) => ({
    id: item.id,
    title: item.title,
    dueDate: iso(item.dueDate),
    memberId: item.memberId,
    memberName: item.member.name,
    origin: item.origin,
  }));
}

export async function getTimeline(userId: string, memberId: string) {
  await assertMember(userId, memberId);
  const [measurements, medications] = await Promise.all([
    prisma.healthMeasurement.findMany({
      where: { userId, memberId },
      include: { sourceDocument: { select: { type: true } } },
      orderBy: { measuredAt: "desc" },
    }),
    prisma.healthMedication.findMany({
      where: { userId, memberId },
      include: { sourceDocument: { select: { documentDate: true, type: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return [
    ...measurements.map((item) => ({
      id: item.id,
      eventType: "measurement" as const,
      recordId: item.sourceDocumentId,
      occurredAt: iso(item.measuredAt),
      title: item.displayName,
      value: item.value,
      secondaryValue: item.secondaryValue,
      unit: item.unit,
      source: "Lab result",
      sourceType: item.sourceDocument.type,
    })),
    ...medications.map((item) => ({
      id: item.id,
      eventType: "medication" as const,
      recordId: item.sourceDocumentId,
      occurredAt: iso(item.runsOutAt ?? item.sourceDocument?.documentDate ?? item.createdAt),
      title: item.name,
      detail: [
        item.dose,
        item.frequency,
        item.repeats ? "Ongoing" : item.duration,
        item.runsOutAt ? `Runs out ${iso(item.runsOutAt)}` : null,
      ].filter(Boolean).join(" · ") || null,
      source: item.sourceDocument ? "Medication recorded" : "Manual medication",
      sourceType: item.sourceDocument?.type ?? "manual",
    })),
  ].sort((a, b) => (b.occurredAt ?? "").localeCompare(a.occurredAt ?? ""));
}

export async function createManualMedication(userId: string, memberId: string, input: unknown) {
  await assertMember(userId, memberId);
  const data = manualMedicationSchema.parse(input);
  return prisma.healthMedication.create({
    data: {
      userId,
      memberId,
      name: data.name,
      dose: data.dose,
      frequency: data.frequency || null,
      repeats: data.repeats,
      runsOutAt: parseDate(data.runsOutAt),
    },
  });
}

export async function createManualReminder(userId: string, input: unknown) {
  const data = reminderSchema.parse(input);
  await assertMember(userId, data.memberId);
  const dueDate = parseDate(data.dueDate);
  if (!dueDate) throw Object.assign(new Error("Reminder due date is invalid."), { statusCode: 400 });
  return prisma.healthReminder.create({ data: { userId, memberId: data.memberId, title: data.title, dueDate, recurrence: data.recurrence ?? null, origin: "manual" } });
}
