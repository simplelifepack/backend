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
import { manualMedicationSchema, parseOptionalDate, medicationUpdateSchema, parseDate, reminderSchema, reminderUpdateSchema, parseHealthDate, reminderLocalDate } from "./healthSchemas";
import { reminderDto, assertMember } from "./healthDtos";


function invalid(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 400 });
}

async function medicationDetails(userId: string, memberId: string, data: z.infer<typeof medicationUpdateSchema>, current?: { courseStartDate: Date | null; courseEndDate: Date | null }) {
  const courseStartDate = data.courseStartDate === undefined ? undefined : parseOptionalDate(data.courseStartDate, "courseStartDate");
  const courseEndDate = data.courseEndDate === undefined ? undefined : parseOptionalDate(data.courseEndDate, "courseEndDate");
  const start = courseStartDate === undefined ? current?.courseStartDate : courseStartDate;
  const end = courseEndDate === undefined ? current?.courseEndDate : courseEndDate;
  if (start && end && start > end) invalid("Course end date must be on or after the start date.");
  if (data.sourceDocumentId && !await prisma.healthDocument.findFirst({
    where: { id: data.sourceDocumentId, userId, memberId, type: "prescription" },
    select: { id: true },
  })) invalid("Choose a prescription for this member.");
  return { route: data.route, instructions: data.instructions, courseStartDate, courseEndDate, prescribingDoctor: data.prescribingDoctor, sourceDocumentId: data.sourceDocumentId };
}

export async function createManualMedication(userId: string, memberId: string, input: unknown) {
  await assertMember(userId, memberId);
  const data = manualMedicationSchema.parse(input);
  const details = await medicationDetails(userId, memberId, data);
  return prisma.healthMedication.create({
    data: {
      userId,
      memberId,
      name: data.name,
      dose: data.dose,
      ...details,
      frequency: data.frequency === undefined ? data.whenToTake.join(", ") : data.frequency,
      whenToTake: data.whenToTake,
      mealTiming: data.mealTiming,
      repeats: Boolean(data.repeatRunsOut),
      repeatRunsOut: parseOptionalDate(data.repeatRunsOut, "repeatRunsOut"),
      runsOutAt: parseOptionalDate(data.repeatRunsOut, "repeatRunsOut"),
      status: "continuing",
      stoppedAt: null,
    },
  }).then(medication => ({ ...medication, reminderIds: [] as string[] }));
}


export async function updateMedication(userId: string, medicationId: string, input: unknown) {
  const medication = await prisma.healthMedication.findFirst({
    where: { id: medicationId, userId },
  });
  if (!medication)
    throw Object.assign(new Error("Medication not found."), {
      statusCode: 404,
    });
  const data = medicationUpdateSchema.parse(input);
  const details = await medicationDetails(userId, medication.memberId, data, medication);
  const status = data.status;
  const stoppedAt =
    status === "stopped"
      ? parseDate(data.stoppedAt) ?? new Date()
      : status === "continuing"
        ? null
        : data.stoppedAt === undefined
          ? undefined
          : parseDate(data.stoppedAt);
  const saved = await prisma.healthMedication.update({
    where: { id: medicationId, userId },
    data: {
      ...details,
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.dose !== undefined ? { dose: data.dose || null } : {}),
      whenToTake: data.whenToTake,
      ...(data.whenToTake !== undefined && medication.frequency === medication.whenToTake.join(", ")
        ? { frequency: data.whenToTake.join(", ") }
        : {}),
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
  const reminders = await prisma.healthReminder.findMany({ where: { medicationId, userId }, select: { id: true } });
  return { ...saved, reminderIds: reminders.map(reminder => reminder.id) };
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
  const fields = await reminderDetails(userId, data.memberId, data);
  const reminder = await prisma.healthReminder.create({
    data: { userId, memberId: data.memberId, title: data.title, type: data.type, origin: "manual", ...fields },
  });
  return { ...reminder, ...reminderDto(reminder), dueDate: reminder.timeZone ? reminder.dueDate.toISOString() : reminder.dueDate };
}

async function reminderDetails(userId: string, memberId: string, data: z.infer<typeof reminderSchema>) {
  const dueDate = parseHealthDate(data.dueDate, data.timeZone, "dueDate");
  const endDate = parseOptionalDate(data.endDate, "endDate");
  if (endDate && (data.frequency === "once" || data.endDate! < reminderLocalDate(dueDate, data.timeZone))) {
    invalid("Set an end date on or after the first occurrence of a recurring reminder.");
  }
  if (data.medicationId && !await prisma.healthMedication.findFirst({
    where: { id: data.medicationId, userId, memberId }, select: { id: true },
  })) invalid("Choose a medicine for this member.");
  if (data.trackedMetricId && (data.type !== "reading" || !await prisma.trackedHealthMetric.findFirst({
    where: { id: data.trackedMetricId, userId, memberId }, select: { id: true },
  }))) invalid("Choose a tracked metric for this reading reminder.");
  return { dueDate, endDate, timeZone: data.timeZone, frequency: data.frequency, notes: data.notes,
    medicationId: data.medicationId, trackedMetricId: data.trackedMetricId,
    recurrence: data.frequency === "once" ? null : data.frequency };
}

export async function updateReminder(userId: string, reminderId: string, input: unknown) {
  const data = reminderUpdateSchema.parse(input);
  const reminder = await prisma.healthReminder.findFirst({ where: { id: reminderId, userId } });
  if (!reminder) throw Object.assign(new Error("Reminder not found."), { statusCode: 404 });
  const merged = reminderSchema.parse({
    memberId: reminder.memberId, title: reminder.title, type: reminder.type ?? "other",
    dueDate: reminder.timeZone ? reminder.dueDate.toISOString() : reminder.dueDate.toISOString().slice(0, 10),
    endDate: reminder.endDate?.toISOString().slice(0, 10), timeZone: reminder.timeZone,
    frequency: reminder.frequency ?? reminder.recurrence ?? "once", notes: reminder.notes,
    medicationId: reminder.medicationId, trackedMetricId: reminder.trackedMetricId,
    ...data,
  });
  const fields = await reminderDetails(userId, reminder.memberId, merged);
  const saved = await prisma.healthReminder.update({
    where: { id: reminderId, userId },
    data: { title: data.title, type: data.type, ...fields },
  });
  return { ...saved, ...reminderDto(saved), dueDate: saved.timeZone ? saved.dueDate.toISOString() : saved.dueDate };

}
