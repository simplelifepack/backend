import { healthDocumentType } from "./healthDocumentTypes";
import { matchHealthPatient, validPatientDob } from "./healthPatientIdentity";
import { lockAccount } from "./accountUsage.service";
import { createConfirmedHealthMember } from "./healthMembers";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { extractionSchema, fallbackHealthExtraction, type HealthExtraction } from "./healthExtraction.service";
import { normalizeMetricName } from "./healthMetricRegistry";
import { recordCreateSchema, aiProcessingEnabledForUser, parseDate, resolveHealthMember, inferWhenToTake, inferMealTiming } from "./healthSchemas";
import { pendingProfileResponse, prescriptionProcessingStatus, prescriptionProcessingMessage, assertMember, addDuration, memberDto } from "./healthDtos";
import { getHealthRecord } from "./healthMembers";


export async function createHealthRecord(userId: string, input: unknown, transaction?: Prisma.TransactionClient) {
  const db = transaction ?? prisma;
  const transact = <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) => transaction ? work(transaction) : prisma.$transaction(work);
  const data = recordCreateSchema.parse(input);
  const aiProcessingEnabled = await aiProcessingEnabledForUser(userId, db);

  const document = await db.document.findFirst({
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
  const existing = await db.healthDocument.findFirst({
    where: { userId, documentId: data.documentId },
  });
  if (existing?.memberId) return getHealthRecord(userId, existing.id, db);
  const type = healthDocumentType(document);
  if (!type) throw Object.assign(new Error("Health records require a medical document."), { statusCode: 422 });
  const cached = extractionSchema.safeParse(existing?.pendingExtraction);
  if (existing?.processingStatus === "awaiting_profile_match" && !data.memberId && !data.newMember) {
    const resolution = await resolveHealthMember(userId, cached.success ? cached.data.patient : null, cached.success ? cached.data.documentDate : null, db);
    if (resolution.status !== "matched") return pendingProfileResponse(userId, existing, db);
  }

  const extracted: HealthExtraction = cached.success ? cached.data : fallbackHealthExtraction(data.type ?? type);
  let processingStatus = cached.success
    ? extracted.pendingProcessingStatus ?? prescriptionProcessingStatus(extracted.documentType, extracted)
    : aiProcessingEnabled ? "failed" : "ai_processing_disabled";
  let extractionError = existing?.processingError ?? prescriptionProcessingMessage(processingStatus, extracted);
  if (processingStatus === "ai_processing_disabled") extractionError = "AI processing is turned off. Enter the details manually or enable AI in Preferences.";
  else if (processingStatus === "failed") extractionError = "No usable analysis is available. Enter the details manually or reanalyze the saved record.";
  if (extracted.patient?.identityConflicting) {
    extracted.measurements = []; extracted.medications = []; extracted.followUps = [];
    processingStatus = "patient_identity_conflict";
    extractionError = "Patient information conflicts across pages. Review the original document before processing.";
  }
  const recordType = extracted.documentType;
  const documentDate = parseDate(extracted.documentDate) ?? document.createdAt;
  let createdMember: Awaited<ReturnType<typeof assertMember>> | undefined;
  let matchedMember: Awaited<ReturnType<typeof assertMember>> | undefined;
  const patient = extracted.patient;
  const canProvision = cached.success && existing?.processingStatus === "pending_identification"
    && !cached.data.pendingProcessingStatus;
  const record = await transact(async tx => {
    await lockAccount(tx, userId);
    const current = await tx.healthDocument.findFirst({ where: { userId, documentId: data.documentId } });
    if (current?.memberId) return current;

    let assignedMemberId = data.memberId;
    if (assignedMemberId) await assertMember(userId, assignedMemberId, tx);
    else if (data.newMember) assignedMemberId = (await createConfirmedHealthMember(tx, userId, data.newMember, documentDate)).id;
    else {
      const profiles = await tx.healthMember.findMany({ where: { userId } });
      const resolution = matchHealthPatient(extracted.patient, profiles, extracted.documentDate);
      if (resolution.status === "matched") {
        matchedMember = resolution.member;
        assignedMemberId = resolution.member.id;
      } else if (canProvision && resolution.status === "unmatched") {
        // Potential matches are left for confirmation to avoid duplicate profiles.
        const relation = patient?.relation?.trim();
        const age = patient?.age;
        const validAge = age != null && Number.isInteger(age) && age >= 0 && age <= 120 ? age : null;
        createdMember = await tx.healthMember.create({ data: {
          userId,
          name: patient?.name?.trim().slice(0, 120) || "Unknown patient",
          relation: relation && !/^(myself|self)$/i.test(relation) ? relation : "Unknown",
          dateOfBirth: parseDate(validPatientDob(patient?.dateOfBirth)),
          age: validAge,
          ageRecordedAt: validAge == null ? null : documentDate,
          gender: patient?.gender?.trim().slice(0, 80) || null,
          bloodGroup: patient?.bloodGroup ?? null,
          conditions: patient?.conditions ?? null,
          allergies: patient?.allergies ?? null,
        } });
        assignedMemberId = createdMember.id;
      } else {
        const pending = {
          type: recordType,
          documentDate,
          provider: extracted.provider ?? null,
          doctor: extracted.doctor ?? null,
          processingStatus: "awaiting_profile_match",
          processingError: extractionError,
          patientName: extracted.patient?.name?.trim() || null,
          patientDateOfBirth: parseDate(validPatientDob(extracted.patient?.dateOfBirth)),
          pendingExtraction: { ...extracted, pendingProcessingStatus: processingStatus } as Prisma.InputJsonValue,
          processedAt: new Date(),
        };
        return tx.healthDocument.upsert({
          where: { userId_documentId: { userId, documentId: data.documentId } },
          create: { ...pending, userId, documentId: data.documentId },
          update: pending,
        });
      }
    }
    const memberId = assignedMemberId;
    const recordData = {
      memberId, type: recordType, documentDate,
      provider: extracted.provider ?? null, doctor: extracted.doctor ?? null,
      processingStatus, processingError: extractionError,
      patientName: extracted.patient?.name?.trim() || null,
      patientDateOfBirth: parseDate(validPatientDob(extracted.patient?.dateOfBirth)),
      pendingExtraction: extracted as Prisma.InputJsonValue, processedAt: new Date(),
    };
    const created = current
      ? await tx.healthDocument.update({ where: { id: current.id }, data: recordData })
      : await tx.healthDocument.create({ data: { ...recordData, userId, documentId: data.documentId } });
    const validMeasurements = extracted.measurements.filter((item) => Number.isFinite(item.value) && item.name.trim() && item.unit.trim());
    if (validMeasurements.length) {
      await tx.healthMeasurement.createMany({
        data: validMeasurements.map((item) => {
          const normalized = normalizeMetricName(item.metricKey || item.name);
          return {
            userId,
            memberId,
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
          memberId,
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
          memberId,
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
            memberId,
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
  if (!record.memberId) return pendingProfileResponse(userId, record, db);
  return {
    ...(await getHealthRecord(userId, record.id, db)),
    patient: extracted.patient ?? null,
    matchedMember: matchedMember ? memberDto(matchedMember) : null,
    createdMember: createdMember ? memberDto(createdMember) : undefined,
  };
}
