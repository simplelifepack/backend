import type { HealthDocumentType } from "./healthExtraction.service";

export function healthDocumentType(document: { documentType: string | null; category: string | null }): HealthDocumentType | null {
  const type = document.documentType?.toLowerCase().replace(/[ -]+/g, "_");
  if (type === "prescription" || type === "lab_report" || type === "medical_report") return type;
  return document.category?.toLowerCase() === "medical" ? "medical_report" : null;
}
