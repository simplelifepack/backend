import path from "node:path";

import { prisma } from "../lib/prisma";
import { decryptString } from "../utils/documentEncryption";

export type HandoffType = "family" | "emergency";

const privateFieldPattern = /(private|personal|comment|internal|follow|draft|note)/i;

export function categoryFor(document: { category: string; documentType: string; normalizedType: string | null; mimeType: string }) {
  const source = `${document.category} ${document.documentType} ${document.normalizedType ?? ""}`.toLowerCase();
  if (document.mimeType.startsWith("image/")) return "Photos";
  if (source.includes("insurance")) return "Insurance";
  if (source.includes("loan") || source.includes("liability") || source.includes("debt")) return "Loans";
  if (source.includes("asset") || source.includes("property") || source.includes("vehicle") || source.includes("land") || source.includes("house")) return "Assets";
  if (source.includes("finance") || source.includes("financial") || source.includes("bank") || source.includes("tax") || source.includes("investment")) return "Financial-Records";
  return "Documents";
}

export type HandoffCounts = {
  assets: number;
  insurance: number;
  loans: number;
  financialRecords: number;
  documents: number;
  images: number;
};

function countType(category: string) {
  if (category === "Photos") return "images";
  if (category === "Insurance") return "insurance";
  if (category === "Loans") return "loans";
  if (category === "Assets") return "assets";
  if (category === "Financial-Records") return "financialRecords";
  return "documents";
}

export function emptyCounts(): HandoffCounts {
  return { assets: 0, insurance: 0, loans: 0, financialRecords: 0, documents: 0, images: 0 };
}

export function countDocuments(documents: Array<{ archiveCategory: string }>) {
  const counts = emptyCounts();
  for (const document of documents) counts[countType(document.archiveCategory)] += 1;
  return counts;
}

function decryptDocument<T extends { originalName: string; title: string | null; displayName: string | null; uniqueIdentifier: string | null }>(
  document: T,
): T {
  return {
    ...document,
    originalName: decryptString(document.originalName) ?? "document",
    title: decryptString(document.title),
    displayName: decryptString(document.displayName),
    uniqueIdentifier: decryptString(document.uniqueIdentifier),
  };
}

function safeFields(fields: unknown, type: HandoffType) {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return {};
  const entries = Object.entries(fields as Record<string, unknown>).filter(([key]) =>
    type === "family" ? true : !privateFieldPattern.test(key),
  );
  return Object.fromEntries(entries);
}

export async function getWealthDocuments(userId: string, type: HandoffType) {
  const encrypted = await prisma.document.findMany({
    where: {
      ownerProfileId: userId,
      targetProfileId: userId,
      deletedAt: null,
      OR: [
        { category: { in: ["Finance", "Insurance", "Property", "Vehicle", "Legal", "Photo", "Other"] } },
        { documentType: { contains: "loan", mode: "insensitive" } },
        { documentType: { contains: "insurance", mode: "insensitive" } },
        { documentType: { contains: "asset", mode: "insensitive" } },
        { documentType: { contains: "bank", mode: "insensitive" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      displayName: true,
      uniqueIdentifier: true,
      originalName: true,
      mimeType: true,
      size: true,
      path: true,
      storageKey: true,
      documentType: true,
      normalizedType: true,
      category: true,
      confidence: true,
      fields: true,
      createdAt: true,
      updatedAt: true,
      encryptionVersion: true,
      contentAlgorithm: true,
      keyAlgorithm: true,
      keyId: true,
      keyVersion: true,
      encryptionIv: true,
      wrappedKey: true,
      originalSha256: true,
      encryptedSha256: true,
      ciphertextHash: true,
      encryptedSize: true,
    },
  });

  return encrypted.map((document) => {
    const decrypted = decryptDocument(document);
    const archiveCategory = categoryFor(decrypted);
    return {
      ...decrypted,
      archiveCategory,
      exportedFields: safeFields(decrypted.fields, type),
    };
  });
}

export function archiveFolder(category: string) {
  return category === "Loans" ? "Loans-Taken" : category;
}

export function archiveFileName(originalName: string, baseName: string) {
  const extension = path.extname(originalName);
  return `${baseName}${extension && !baseName.endsWith(extension) ? extension : ""}`;
}
