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
import { memberSchema, iso, recordUpdateSchema } from "./healthSchemas";
import { memberDto, parseBirthDate, assertMember, metricIdentity, recordSummary, measurementDto, reminderDto } from "./healthDtos";


export async function ensureDefaultHealthMember(userId: string, name = "Myself") {
  const existing = await prisma.healthMember.findFirst({
    where: { userId, relation: "Myself" },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;
  return prisma.healthMember.create({
    data: { userId, name, relation: "Myself" },
  });
}


export async function listHealthMembers(userId: string, userName?: string) {
  await ensureDefaultHealthMember(userId, userName || "Myself");
  const members = await prisma.healthMember.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  return members.map(memberDto);
}


export async function createHealthMember(userId: string, input: unknown) {
  const data = memberSchema.parse(input);
  return memberDto(
    await prisma.healthMember.create({
      data: {
        userId,
        name: data.name,
        relation: data.relation,
        bloodGroup: data.bloodGroup || null,
        dateOfBirth: parseBirthDate(data.dateOfBirth),
      },
    }),
  );
}


export async function updateHealthMember(userId: string, memberId: string, input: unknown) {
  await assertMember(userId, memberId);
  const data = memberSchema.partial().parse(input);
  return memberDto(
    await prisma.healthMember.update({
      where: { id: memberId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.relation !== undefined ? { relation: data.relation } : {}),
        ...(data.bloodGroup !== undefined ? { bloodGroup: data.bloodGroup || null } : {}),
        ...(data.dateOfBirth !== undefined
          ? {
              dateOfBirth: parseBirthDate(data.dateOfBirth),
            }
          : {}),
        ...(data.conditions !== undefined ? { conditions: data.conditions || null } : {}),
        ...(data.allergies !== undefined ? { allergies: data.allergies || null } : {}),
        ...(data.emergencyContactName !== undefined ? { emergencyContactName: data.emergencyContactName || null } : {}),
        ...(data.emergencyContactPhone !== undefined ? { emergencyContactPhone: data.emergencyContactPhone || null } : {}),
        ...(data.primaryDoctor !== undefined ? { primaryDoctor: data.primaryDoctor || null } : {}),
        ...(data.insuranceProvider !== undefined ? { insuranceProvider: data.insuranceProvider || null } : {}),
        ...(data.insurancePolicyNumber !== undefined ? { insurancePolicyNumber: data.insurancePolicyNumber || null } : {}),
      },
    }),
  );
}


export async function deleteHealthMember(userId: string, memberId: string) {
  const member = await assertMember(userId, memberId);
  if (member.relation === "Myself") throw Object.assign(new Error("The default health member cannot be deleted."), { statusCode: 400 });
  await prisma.healthMember.delete({ where: { id: memberId } });
}


export async function trackedKeySet(userId: string, memberId: string) {
  const tracked = await prisma.trackedHealthMetric.findMany({
    where: { userId, memberId, enabled: true },
  });
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
      measurements: {
        include: { sourceDocument: true },
        orderBy: { displayName: "asc" },
      },
      medications: true,
      followUps: true,
      reminders: true,
    },
  });
  if (!record)
    throw Object.assign(new Error("Health record not found."), {
      statusCode: 404,
    });
  if (!record.memberId) throw Object.assign(new Error("This health record is awaiting profile assignment."), { statusCode: 409 });
  const tracked = await trackedKeySet(userId, record.memberId);
  return {
    ...recordSummary(record, tracked),
    measurements: record.measurements.map((item) => measurementDto(item, tracked)),
    medications: record.medications,
    followUps: record.followUps.map((item) => ({
      ...item,
      explicitDate: iso(item.explicitDate),
      dueDate: iso(item.dueDate),
    })),
    reminders: record.reminders.map((item) => reminderDto(item)),
  };
}


export async function updateHealthRecord(userId: string, recordId: string, input: unknown) {
  const data = recordUpdateSchema.parse(input);
  const record = await prisma.healthDocument.findFirst({
    where: { id: recordId, userId },
  });
  if (!record)
    throw Object.assign(new Error("Health record not found."), {
      statusCode: 404,
    });
  if (data.type !== undefined) {
    await prisma.healthDocument.update({
      where: { id: record.id },
      data: { type: data.type },
    });
  }
  return getHealthRecord(userId, record.id);
}
