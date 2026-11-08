import type { HealthDocumentType } from "./healthExtraction.service";

export function classifiedHealthDocumentType(document: { documentType: string | null; category: string | null }) {
  const type = document.documentType?.trim().toLowerCase().replace(/[ -]+/g, "_");
  if (document.category?.toLowerCase() !== "medical") return null;
  if (type === "prescription" || type === "lab_report" || type === "medical_report") return type;
  return type === "discharge_summary" || type === "vaccination_certificate" ? "medical_report" : null;
}

export function healthDocumentType(document: { documentType: string | null; category: string | null }): HealthDocumentType | null {
  if (document.category?.toLowerCase() !== "medical") return null;
  const type = document.documentType?.trim().toLowerCase();
  // Preserve legacy and manually categorized Medical documents without a specific type.
  return !type || type === "unknown" || type === "medical" ? "medical_report" : classifiedHealthDocumentType(document);
}
