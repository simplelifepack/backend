import type { Prisma } from "@prisma/client";

import { prisma } from "../lib/prisma";
import { decryptDocumentRecord } from "../routes/documents.helpers";
import { listPackageSummaries } from "./packs.service";
import { listWealthRecords } from "./wealthRecords.service";
import type { GlobalSearchResult } from "./globalSearch.service";

type SearchableValue = string | number | boolean | Date | null | undefined;

function text(value: SearchableValue) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (value === null || value === undefined) return "";
  return String(value);
}

function flattenJson(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(flattenJson);
  if (typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => [key, ...flattenJson(nested)]);
}

function scoreMatch(query: string, title: SearchableValue, fields: SearchableValue[] = []) {
  const needle = query.toLowerCase();
  const titleText = text(title).toLowerCase();
  if (titleText === needle) return 1000;
  if (titleText.startsWith(needle)) return 900;
  if (titleText.includes(needle)) return 800;
  for (const field of fields) {
    const value = text(field).toLowerCase();
    if (value === needle) return 700;
    if (value.startsWith(needle)) return 650;
    if (value.includes(needle)) return 600;
  }
  return 0;
}

function limitAndSort(results: GlobalSearchResult[], limit: number) {
  return results
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .slice(0, limit);
}

export async function searchPackages(userId: string, query: string, limit: number): Promise<GlobalSearchResult[]> {
  const response = await listPackageSummaries({ limit, page: 1, search: query, sort: "relevance", userId });
  return limitAndSort(response.items.map((pack) => {
    const requirementText = pack.requirements.flatMap((requirement) => [requirement.title, requirement.description, ...requirement.acceptedDocumentTypes]);
    return {
      id: pack.id,
      title: pack.title,
      subtitle: pack.subtitle ?? pack.category,
      section: "packages" as const,
      navigation: { path: `/packages?pack=${encodeURIComponent(pack.slug)}` },
      score: scoreMatch(query, pack.title, [pack.subtitle, pack.category, pack.description, ...requirementText]),
    };
  }), limit);
}

export async function searchDocuments(userId: string, query: string, limit: number): Promise<GlobalSearchResult[]> {
  const documents = await prisma.document.findMany({
    where: { ownerProfileId: userId, deletedAt: null },
    include: { files: { select: { originalName: true } } },
    orderBy: { updatedAt: "desc" },
    take: 250,
  });
  return limitAndSort(documents.map((document) => {
    const decrypted = decryptDocumentRecord(document);
    const fileNames = document.files.map((file) => text(decryptDocumentRecord({ originalName: file.originalName }).originalName));
    const title = decrypted.title || decrypted.displayName || decrypted.originalName;
    return {
      id: document.id,
      title: title || "Document",
      subtitle: [decrypted.documentType, decrypted.category].filter(Boolean).join(" · "),
      section: "documents" as const,
      navigation: { path: `/documents/${encodeURIComponent(decrypted.category)}/${encodeURIComponent(document.id)}` },
      score: scoreMatch(query, title, [
        decrypted.displayName,
        decrypted.originalName,
        decrypted.documentType,
        decrypted.normalizedType,
        decrypted.documentTypeCode,
        decrypted.category,
        decrypted.sourceProvider,
        ...fileNames,
        ...flattenJson(decrypted.fields),
        ...flattenJson(decrypted.extractedKeyFields),
      ]),
    };
  }), limit);
}

export async function searchHealth(userId: string, query: string, limit: number): Promise<GlobalSearchResult[]> {
  const [members, records, medications] = await Promise.all([
    prisma.healthMember.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, take: 100 }),
    prisma.healthDocument.findMany({
      where: { userId },
      include: { member: true, document: true },
      orderBy: [{ documentDate: "desc" }, { createdAt: "desc" }],
      take: 150,
    }),
    prisma.healthMedication.findMany({ where: { userId }, include: { member: true }, orderBy: { updatedAt: "desc" }, take: 150 }),
  ]);
  return limitAndSort([
    ...members.map((member) => ({
      id: member.id,
      title: member.name,
      subtitle: [member.relation, member.bloodGroup, member.primaryDoctor].filter(Boolean).join(" · ") || "Health profile",
      section: "health" as const,
      navigation: { path: `/health?member=${encodeURIComponent(member.id)}&tab=Overview` },
      score: scoreMatch(query, member.name, [
        member.relation, member.bloodGroup, member.conditions, member.allergies, member.emergencyContactName,
        member.emergencyContactPhone, member.primaryDoctor, member.insuranceProvider, member.insurancePolicyNumber,
      ]),
    })),
    ...records.map((record) => {
      const document = decryptDocumentRecord(record.document);
      const title = document.title || document.displayName || document.originalName || record.type;
      return {
        id: record.id,
        title,
        subtitle: [record.member?.name, record.type, record.provider || record.doctor].filter(Boolean).join(" · "),
        section: "health" as const,
        navigation: { path: `/health?member=${encodeURIComponent(record.memberId ?? "")}&tab=Records&record=${encodeURIComponent(record.id)}` },
        score: scoreMatch(query, title, [record.type, record.provider, record.doctor, record.patientName, record.member?.name, document.documentType, document.normalizedType, ...flattenJson(document.fields)]),
      };
    }),
    ...medications.map((medication) => ({
      id: medication.id,
      title: medication.name,
      subtitle: [medication.member.name, medication.dose, medication.status].filter(Boolean).join(" · "),
      section: "health" as const,
      navigation: { path: `/health?member=${encodeURIComponent(medication.memberId)}&tab=Medications&medication=${encodeURIComponent(medication.id)}` },
      score: scoreMatch(query, medication.name, [
        medication.member.name, medication.dose, medication.frequency, medication.duration, medication.quantity,
        medication.mealTiming, medication.status, ...medication.whenToTake,
      ]),
    })),
  ], limit);
}

export async function searchWealth(userId: string, query: string, limit: number): Promise<GlobalSearchResult[]> {
  const records = await listWealthRecords(userId);
  return limitAndSort(records.map((record) => ({
    id: record.id,
    title: record.title,
    subtitle: wealthSubtitle(record.type, record.details),
    section: "wealth" as const,
    navigation: { path: `/wealth?record=${encodeURIComponent(record.id)}` },
    score: scoreMatch(query, record.title, [record.type, ...flattenJson(record.details), record.notes, record.followUpDate ? new Date(record.followUpDate) : null]),
  })), limit);
}

function wealthSubtitle(type: string, details: Prisma.JsonValue) {
  const values = details && typeof details === "object" && !Array.isArray(details) ? details as Record<string, unknown> : {};
  return [type.replace(/_/g, " ").toLowerCase(), values.provider, values.institution, values.party, values.amount].filter(Boolean).map(String).join(" · ");
}

export async function searchTrustMembers(userId: string, query: string, limit: number, section: "family" | "trust"): Promise<GlobalSearchResult[]> {
  const where: Prisma.TrustMemberWhereInput = section === "family"
    ? { ownerUserId: userId, accessType: "FAMILY_MEMBER", status: { not: "REVOKED" } }
    : { status: { not: "REVOKED" }, OR: [{ ownerUserId: userId, accessType: { not: "FAMILY_MEMBER" } }, { memberUserId: userId }] };
  const members = await prisma.trustMember.findMany({
    where,
    include: { owner: { select: { name: true, email: true } }, permissions: true },
    orderBy: { updatedAt: "desc" },
    take: 150,
  });
  return limitAndSort(members.map((member) => ({
    id: member.id,
    title: member.name,
    subtitle: [member.customRelation || member.relation.toLowerCase(), member.email, member.accessType.replace(/_/g, " ").toLowerCase()].filter(Boolean).join(" · "),
    section,
    navigation: { path: section === "family" ? `/family?member=${encodeURIComponent(member.id)}` : `/trust?member=${encodeURIComponent(member.id)}` },
    score: scoreMatch(query, member.name, [
      member.email, member.customRelation, member.relation, member.bloodGroup, member.accessType,
      member.status, member.owner.name, member.owner.email, ...member.permissions.map((permission) => permission.module),
    ]),
  })), limit);
}
