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
import { manualMedicationSchema, parseOptionalDate, medicationUpdateSchema, parseDate, reminderSchema } from "./healthSchemas";
import { assertMember } from "./healthDtos";


export async function createManualMedication(userId: string, memberId: string, input: unknown) {
  await assertMember(userId, memberId);
  const data = manualMedicationSchema.parse(input);
  return prisma.healthMedication.create({
    data: {
      userId,
      memberId,
      name: data.name,
      dose: data.dose,
      frequency: data.whenToTake.join(", "),
      whenToTake: data.whenToTake,
      mealTiming: data.mealTiming,
      repeats: Boolean(data.repeatRunsOut),
      repeatRunsOut: parseOptionalDate(data.repeatRunsOut, "repeatRunsOut"),
      runsOutAt: parseOptionalDate(data.repeatRunsOut, "repeatRunsOut"),
      status: "continuing",
      stoppedAt: null,
    },
  });
}


export async function updateMedication(userId: string, medicationId: string, input: unknown) {
  const medication = await prisma.healthMedication.findFirst({
    where: { id: medicationId, userId },
    select: { id: true },
  });
  if (!medication)
    throw Object.assign(new Error("Medication not found."), {
      statusCode: 404,
    });
  const data = medicationUpdateSchema.parse(input);
  const status = data.status;
  const stoppedAt =
    status === "stopped"
      ? parseDate(data.stoppedAt) ?? new Date()
      : status === "continuing"
        ? null
        : data.stoppedAt === undefined
          ? undefined
          : parseDate(data.stoppedAt);
  return prisma.healthMedication.update({
    where: { id: medicationId },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.dose !== undefined ? { dose: data.dose || null } : {}),
      ...(data.whenToTake !== undefined ? { whenToTake: data.whenToTake, frequency: data.whenToTake.join(", ") } : {}),
      ...(data.mealTiming !== undefined ? { mealTiming: data.mealTiming } : {}),
      ...(data.repeatRunsOut !== undefined ? { repeatRunsOut: parseOptionalDate(data.repeatRunsOut, "repeatRunsOut"), runsOutAt: parseOptionalDate(data.repeatRunsOut, "repeatRunsOut"), repeats: Boolean(data.repeatRunsOut) } : {}),
      ...(data.frequency !== undefined ? { frequency: data.frequency || null } : {}),
      ...(data.duration !== undefined ? { duration: data.duration || null } : {}),
      ...(data.quantity !== undefined ? { quantity: data.quantity || null } : {}),
      ...(data.repeats !== undefined ? { repeats: data.repeats } : {}),
      ...(data.runsOutAt !== undefined ? { runsOutAt: parseDate(data.runsOutAt) } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(stoppedAt !== undefined ? { stoppedAt } : {}),
    },
  });
}


export async function deleteMedication(userId: string, medicationId: string) {
  const medication = await prisma.healthMedication.findFirst({
    where: { id: medicationId, userId },
    select: { id: true },
  });
  if (!medication)
    throw Object.assign(new Error("Medication not found."), {
      statusCode: 404,
    });
  await prisma.healthMedication.delete({ where: { id: medicationId } });
}


export async function createManualReminder(userId: string, input: unknown) {
  const data = reminderSchema.parse(input);
  await assertMember(userId, data.memberId);
  const dueDate = parseDate(data.dueDate);
  if (!dueDate)
    throw Object.assign(new Error("Reminder due date is invalid."), {
      statusCode: 400,
    });
  return prisma.healthReminder.create({
    data: {
      userId,
      memberId: data.memberId,
      title: data.title,
      type: data.type,
      dueDate,
      frequency: data.frequency,
      recurrence: data.frequency === "once" ? null : data.frequency,
      origin: "manual",
    },
  });
}
