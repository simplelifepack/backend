import { lockAccount } from "./accountUsage.service";
import { normalizePatientName } from "./healthPatientIdentity";
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
import { memberSchema, iso } from "./healthSchemas";
import { memberDto, parseBirthDate, assertMember, metricIdentity, recordSummary, measurementDto, reminderDto } from "./healthDtos";


export async function ensureDefaultHealthMember(userId: string, name = "Myself") {
  return prisma.$transaction(async tx => {
    await lockAccount(tx, userId);
    const existing = await tx.healthMember.findFirst({ where: { userId, relation: "Myself" }, orderBy: { createdAt: "asc" } });
    if (existing) return existing;
    return tx.healthMember.create({ data: { userId, name, relation: "Myself" } });
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
  return prisma.$transaction(async tx => {
    await lockAccount(tx, userId);
    return memberDto(await createConfirmedHealthMember(tx, userId, data));
  });
}

export async function createConfirmedHealthMember(tx: Prisma.TransactionClient, userId: string, data: z.infer<typeof memberSchema>, ageRecordedAt = new Date()) {
  const dob = parseBirthDate(data.dateOfBirth);
  const members = await tx.healthMember.findMany({ where: { userId } });
  const sameName = members.filter(member => normalizePatientName(member.name) === normalizePatientName(data.name));
  const relation = /^(myself|self)$/i.test(data.relation) ? "Myself" : data.relation;
  const duplicate = (relation === "Myself" ? members.find(member => member.relation === "Myself") : undefined) ?? sameName.find(member => !dob || !member.dateOfBirth || member.dateOfBirth.getTime() === dob.getTime());
  if (duplicate) throw Object.assign(new Error("A profile with this patient name already exists. Choose the existing profile or review the date of birth."), { statusCode: 409, code: "HEALTH_PROFILE_EXISTS" });
  return tx.healthMember.create({ data: {
    userId, ...data, relation, dateOfBirth: dob,
    ageRecordedAt: data.age != null ? ageRecordedAt : null,
    bloodGroup: data.bloodGroup || null,
  } });
}



export async function updateHealthMember(userId: string, memberId: string, input: unknown) {
  const data = memberSchema.partial().parse(input);
  return prisma.$transaction(async tx => {
    await lockAccount(tx, userId);
    const member = await tx.healthMember.findFirst({ where: { id: memberId, userId } });
    if (!member) throw Object.assign(new Error("Health member not found."), { statusCode: 404 });
    const relation = /^(myself|self)$/i.test(data.relation ?? "") ? "Myself" : data.relation;
    if (relation !== undefined && (relation === "Myself") !== (member.relation === "Myself")) {
      throw Object.assign(new Error("The account holder relationship cannot be changed."), { statusCode: 400 });
    }
    return memberDto(await tx.healthMember.update({
      where: { id: memberId },
      data: {
        ...(data.gender !== undefined ? { gender: data.gender || null } : {}),
        ...(data.age !== undefined ? { age: data.age, ageRecordedAt: data.age != null ? new Date() : null } : {}),
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(relation !== undefined ? { relation } : {}),
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
    }));
  });
}


export async function deleteHealthMember(userId: string, memberId: string) {
  const member = await assertMember(userId, memberId);
  if (member.relation === "Myself") throw Object.assign(new Error("The default health member cannot be deleted."), { statusCode: 400 });
  await prisma.healthMember.delete({ where: { id: memberId } });
}


export async function trackedKeySet(userId: string, memberId: string, db: Prisma.TransactionClient = prisma) {
  const tracked = await db.trackedHealthMetric.findMany({
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


export async function getHealthRecord(userId: string, recordId: string, db: Prisma.TransactionClient = prisma) {
  const record = await db.healthDocument.findFirst({
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
  const tracked = await trackedKeySet(userId, record.memberId, db);
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
