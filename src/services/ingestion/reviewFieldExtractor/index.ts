import type { DocumentAnalysis } from "../../rules/types";
import type { PageText, ReviewField } from "../types";
import {
  addField,
  collectReviewFieldCandidates,
  toTitleCase,
} from "./candidateFields";

export function extractReviewFields(input: {
  analysis: DocumentAnalysis;
  text: string;
  pages: PageText[];
}): ReviewField[] {
  const fields: ReviewField[] = [];
  const seen = new Set<string>();
  const candidates = collectReviewFieldCandidates(input.analysis, input.text);

  for (const candidate of candidates) {
    addField(fields, seen, candidate);
  }

  return fields.slice(0, 30).map((field, index) => ({
    ...field,
    id: field.id || `${field.key}-${index + 1}`,
  }));
}

export function generateDocumentTitle(input: {
  reviewFields: ReviewField[];
  documentType: string;
  originalName: string;
}) {
  const typeLabel =
    input.documentType === "unknown" ? "Document" : toTitleCase(input.documentType);
  const findValue = (keys: string[]) =>
    input.reviewFields.find((field) => keys.includes(field.key))?.value;

  const name = findValue([
    "fullName",
    "name",
    "patientName",
    "studentName",
    "employeeName",
    "accountHolderName",
  ]);
  if (name) return `${typeLabel} - ${name}`;

  const number = findValue([
    "panNumber",
    "aadhaarNumber",
    "passportNumber",
    "licenseNumber",
    "epicNumber",
    "policyNumber",
    "accountNumber",
  ]);
  if (number) return `${typeLabel} - ${number}`;

  const organization = input.reviewFields.find((field) =>
    /organization|bank|insurer|hospital|institution|employer/i.test(field.label),
  )?.value;
  if (organization) return `${typeLabel} - ${organization}`;

  return input.originalName;
}
