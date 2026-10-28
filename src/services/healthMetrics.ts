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
import { trackedMetricSchema, iso, manualMeasurementSchema, parseDate } from "./healthSchemas";
import { assertMember, memberDto, reminderDto, measurementDto } from "./healthDtos";
import { trackedKeySet, listHealthRecords } from "./healthMembers";
import { listTrackedMetrics, listMeasurements } from "./healthRecordReprocessing";


export async function enableTrackedMetric(userId: string, memberId: string, input: unknown) {
  await assertMember(userId, memberId);
  const data = trackedMetricSchema.parse(input);
  const existing = await prisma.trackedHealthMetric.findFirst({
    where: {
      userId,
      memberId,
      metricKey: data.metricKey,
      context: data.context ?? null,
      bodySite: data.bodySite ?? null,
    },
  });
  if (existing)
    return prisma.trackedHealthMetric.update({
      where: { id: existing.id },
      data: { displayName: data.displayName, enabled: true },
    });
  return prisma.trackedHealthMetric.create({
    data: {
      userId,
      memberId,
      metricKey: data.metricKey,
      displayName: data.displayName,
      context: data.context ?? null,
      bodySite: data.bodySite ?? null,
    },
  });
}


export async function disableTrackedMetric(userId: string, memberId: string, trackedId: string) {
  await assertMember(userId, memberId);
  await prisma.trackedHealthMetric.updateMany({
    where: { id: trackedId, userId, memberId },
    data: { enabled: false },
  });
}


export async function searchAvailableMetrics(userId: string, memberId: string, search = "") {
  await assertMember(userId, memberId);
  const measurements = await prisma.healthMeasurement.findMany({
    where: { userId, memberId },
    orderBy: { measuredAt: "desc" },
  });
  const tracked = await trackedKeySet(userId, memberId);
  const byKey = new Map<string, typeof measurements>();
  measurements.forEach((item) => byKey.set(item.metricKey, [...(byKey.get(item.metricKey) ?? []), item]));
  const q = search.trim().toLowerCase();
  return Array.from(byKey.entries()).flatMap(([metricKey, rows]) => {
    const latest = rows[0]!;
    const terms = metricSearchTerms(metricKey, latest.displayName);
    if (q && !terms.some((term) => term.includes(q)) && !rows.some((row) => row.originalName.toLowerCase().includes(q))) return [];
    return [
      {
        metricKey,
        displayName: latest.displayName,
        context: latest.context,
        bodySite: latest.bodySite,
        historicalReadingCount: rows.length,
        isTracked: tracked.has(metricKey),
        latestValue: latest.value,
        secondaryValue: latest.secondaryValue,
        unit: latest.unit,
      },
    ];
  });
}


export async function getOverview(userId: string, memberId: string) {
  const member = await assertMember(userId, memberId);
  const [records, tracked, reminders] = await Promise.all([
    listHealthRecords(userId, memberId),
    listTrackedMetrics(userId, memberId),
    prisma.healthReminder.findMany({
      where: {
        userId,
        memberId,
        status: "active",
      },
      orderBy: { dueDate: "asc" },
      take: 50,
    }),
  ]);
  const trackedMetrics = await Promise.all(
    tracked.map(async (metric) => {
      const measurements = await listMeasurements(userId, memberId, {
        metric: metric.metricKey,
        context: metric.context,
        bodySite: metric.bodySite,
      });
      return {
        ...metric,
        measurements,
        latest: measurements[measurements.length - 1] ?? null,
      };
    }),
  );
  return {
    member: memberDto(member),
    upcoming: reminders
      .map((item) => reminderDto(item))
      .sort((a, b) => new Date(a.dueDate ?? "").getTime() - new Date(b.dueDate ?? "").getTime())
      .slice(0, 5),
    trackedMetrics,
    recentRecords: records.slice(0, 5),
  };
}


export async function listActiveHealthReminders(userId: string) {
  const reminders = await prisma.healthReminder.findMany({
    where: { userId, status: "active" },
    include: { member: { select: { name: true } } },
    orderBy: { dueDate: "asc" },
    take: 20,
  });
  return reminders
    .map((item) => reminderDto(item))
    .sort((a, b) => new Date(a.dueDate ?? "").getTime() - new Date(b.dueDate ?? "").getTime())
    .slice(0, 20);
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
      include: {
        sourceDocument: { select: { documentDate: true, type: true } },
      },
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
      source: item.sourceDocument ? "Lab result" : "Manual reading",
      sourceType: item.sourceDocument?.type ?? "manual",
    })),
    ...medications.map((item) => ({
      id: item.id,
      eventType: "medication" as const,
      recordId: item.sourceDocumentId,
      occurredAt: iso(item.runsOutAt ?? item.sourceDocument?.documentDate ?? item.createdAt),
      title: item.name,
      detail: [item.dose, item.frequency, item.repeats ? "Ongoing" : item.duration, item.runsOutAt ? `Runs out ${iso(item.runsOutAt)}` : null].filter(Boolean).join(" · ") || null,
      source: item.sourceDocument ? "Medication recorded" : "Manual medication",
      sourceType: item.sourceDocument?.type ?? "manual",
      medication: {
        name: item.name,
        dose: item.dose,
        frequency: item.frequency,
        whenToTake: item.whenToTake,
        mealTiming: item.mealTiming,
        duration: item.duration,
        quantity: item.quantity,
        repeats: item.repeats,
        repeatRunsOut: iso(item.repeatRunsOut),
        runsOutAt: iso(item.runsOutAt),
        status: item.status,
        stoppedAt: iso(item.stoppedAt),
      },
    })),
  ].sort((a, b) => (b.occurredAt ?? "").localeCompare(a.occurredAt ?? ""));
}


export async function createManualMeasurement(userId: string, memberId: string, input: unknown) {
  await assertMember(userId, memberId);
  const data = manualMeasurementSchema.parse(input);
  const measuredAt = parseDate(data.measuredAt);
  if (!measuredAt)
    throw Object.assign(new Error("Enter a valid reading date."), {
      statusCode: 400,
    });
  const measurement = await prisma.healthMeasurement.create({
    data: {
      userId,
      memberId,
      sourceDocumentId: null,
      metricKey: data.metricKey,
      displayName: data.displayName,
      originalName: data.originalName || data.displayName,
      value: data.value,
      secondaryValue: data.secondaryValue ?? null,
      unit: data.unit,
      context: data.context ?? null,
      bodySite: data.bodySite ?? null,
      referenceMin: data.referenceMin ?? null,
      referenceMax: data.referenceMax ?? null,
      referenceText: data.referenceText ?? null,
      measuredAt,
    },
    include: { sourceDocument: true },
  });
  const tracked = await trackedKeySet(userId, memberId);
  return measurementDto(measurement, tracked);
}
