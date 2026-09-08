import fs from "node:fs/promises";
import OpenAI from "openai";

import type { DocumentAnalyzer } from "./DocumentAnalyzer";
import {
  documentCategories,
  fallbackDocumentAIResult,
  type DocumentAIResult,
  type UploadedFile,
} from "./types";

const allowedCategories = new Set<string>(documentCategories);
const imageMimeTypes = new Set([
  "image/bmp",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/tiff",
  "image/webp",
]);

const prompt = `You are the document vision classifier for Readiness.

All supplied images belong to ONE logical document and may represent the front, back, or additional pages of the same document. Analyze all images together. Use visual layout, logos, headings, issuer information, labels, identifier patterns, and only the visible text needed for recognition. Do not perform or return full-document OCR.

Return ONLY valid JSON with exactly these keys:

{
  "category": "",
  "documentType": "",
  "uniqueNumber": "",
  "nameOnDocument": null,
  "expiryDate": null
}

Category must be exactly one of:
Identity, Employment, Finance, Insurance, Property, Medical, Education, Travel, Vehicle, Legal, Photo, Other.

Your only tasks:
1. Identify which category the document belongs to.
2. Identify the most specific document type.
3. Extract only the primary unique document/account/policy/licence/certificate/reference number, primary holder name, and a clearly labelled expiry/valid-until/end date.

Rules:
- Do not extract full text.
- Do not determine ownership.
- Do not extract addresses.
- Do not extract DOB.
- Do not extract phone numbers.
- Do not extract salary.
- Do not return address, DOB, gender, phone, email, salary, balance, transactions, marks, medical readings, issue date, relatives' names, or full OCR text.
- Do not confuse DOB, issue/statement/due/start dates with expiry.
- Never return extra fields.
- Never invent a unique number.
- If the unique number is not visible/readable, return null.
- If the name on document is not visible/readable, return null.
- If unsure about document type, use documentType "Unknown".
- If unsure about category, use category "Other".
- Return JSON only.
- No markdown.
- No explanation outside JSON.

Indian identity document hints:
- PAN Card usually says Income Tax Department, Government of India, Permanent Account Number, and has a 10-character PAN like ABCDE1234F. If you see that pattern, documentType must be "PAN Card".
- Passport usually has a passport number like one letter followed by seven digits, an MRZ at the bottom, and Republic of India. If you see that layout, documentType must be "Passport".
- Aadhaar usually has a 12-digit Aadhaar number, UIDAI, or Unique Identification Authority of India. If you see that, documentType must be "Aadhaar".
- Voter ID usually has Election Commission text or an EPIC number. If you see that, documentType must be "Voter ID".
- Passport-size photo usually contains only a centered headshot/portrait with no printed document text or ID number. If you see a standalone photo, use category "Photo", documentType "Passport Size Photo", and uniqueNumber null.

Category guidance:
- Passport, Aadhaar, PAN Card, Voter ID -> Identity
- Passport-size photos, standalone ID photos, headshot prints -> Photo
- Driving Licence can be Identity or Vehicle, but prefer Vehicle in this app
- Vehicle RC, pollution certificate -> Vehicle
- Bank statement, passbook, Form 16, ITR, salary slip -> Finance
- Health insurance, life insurance, vehicle insurance, travel insurance -> Insurance
- Medical report, prescription, discharge summary -> Medical
- Degree certificate, marksheet, transfer certificate, hall ticket -> Education
- Visa, boarding pass, travel booking -> Travel
- Offer letter, experience letter, relieving letter, employee letter -> Employment
- Sale deed, property tax receipt, electricity bill, water bill, rental agreement -> Property
- Agreement, affidavit, legal notice, court document -> Legal
- Anything else -> Other`;

function parseJsonObject(input: string) {
  try {
    return JSON.parse(input);
  } catch {
    const match = input.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function normalizeIdentifier(value: string) {
  return value.trim().replace(/\s+/g, "").toUpperCase();
}

function normalizeName(value: string | null | undefined) {
  if (!value) return null;
  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned || null;
}

export function inferDocumentAIResult(result: DocumentAIResult): DocumentAIResult {
  if (!result.uniqueNumber) {
    return {
      ...result,
      nameOnDocument: normalizeName(result.nameOnDocument),
      expiryDate: result.expiryDate,
    };
  }

  const normalized = normalizeIdentifier(result.uniqueNumber);
  const documentType = result.documentType.trim().toLowerCase();

  if (/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(normalized)) {
    return {
      category: "Identity",
      documentType: documentType === "unknown" || documentType === "pan" ? "PAN Card" : result.documentType,
      uniqueNumber: normalized,
      nameOnDocument: normalizeName(result.nameOnDocument),
      expiryDate: result.expiryDate,
    };
  }

  if (/^[A-Z][0-9]{7}$/.test(normalized) && (result.category === "Identity" || documentType === "unknown")) {
    return {
      category: "Identity",
      documentType: documentType === "unknown" ? "Passport" : result.documentType,
      uniqueNumber: normalized,
      nameOnDocument: normalizeName(result.nameOnDocument),
      expiryDate: result.expiryDate,
    };
  }

  if (/^[0-9]{12}$/.test(normalized) || /^[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{4}$/.test(result.uniqueNumber.trim())) {
    return {
      category: "Identity",
      documentType: documentType === "unknown" ? "Aadhaar" : result.documentType,
      uniqueNumber: normalized,
      nameOnDocument: normalizeName(result.nameOnDocument),
      expiryDate: result.expiryDate,
    };
  }

  return {
    ...result,
    nameOnDocument: normalizeName(result.nameOnDocument),
  };
}

export function validateDocumentAIResult(value: unknown): DocumentAIResult {
  if (!value || typeof value !== "object") {
    return fallbackDocumentAIResult;
  }

  const raw = value as Record<string, unknown>;
  const category = typeof raw.category === "string" && allowedCategories.has(raw.category.trim())
    ? (raw.category.trim() as DocumentAIResult["category"])
    : "Other";
  const documentType = typeof raw.documentType === "string" && raw.documentType.trim()
    ? raw.documentType.trim()
    : "Unknown";
  const uniqueNumber = typeof raw.uniqueNumber === "string" && raw.uniqueNumber.trim()
    ? raw.uniqueNumber.trim()
    : null;
  const nameOnDocument = typeof raw.nameOnDocument === "string" && raw.nameOnDocument.trim()
    ? raw.nameOnDocument.trim()
    : null;
  const expiryDate = normalizeExpiryDate(raw.expiryDate);

  return inferDocumentAIResult({
    category,
    documentType,
    uniqueNumber,
    nameOnDocument,
    expiryDate,
  });
}

function normalizeExpiryDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value.trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

export class OpenAIDocumentAnalyzer implements DocumentAnalyzer {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(apiKey = process.env.OPENAI_API_KEY, model = process.env.OPENAI_ICR_MODEL ?? process.env.OPENAI_VISION_MODEL ?? "gpt-5-mini") {
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not configured.");
    }

    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async analyzeDocument(files: UploadedFile[]): Promise<DocumentAIResult> {
    if (!files.length) throw new Error("At least one document image is required.");
    if (files.some((file) => file.mimeType === "application/pdf")) {
      throw new Error("PDF document analysis needs manual review until PDF page rendering is available.");
    }

    if (files.some((file) => !imageMimeTypes.has(file.mimeType))) {
      throw new Error("Document analysis is currently available for image uploads only.");
    }

    const images = await Promise.all(files.map(async (file) => ({ type: "input_image" as const, image_url: `data:${file.mimeType};base64,${await fs.readFile(file.path, "base64")}`, detail: "auto" as const })));
    const response = await this.client.responses.create({
      store: false,
      model: this.model,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            ...images,
          ],
        },
      ],
      text: {
        format: { type: "json_schema", name: "readiness_document_analysis", strict: true, schema: { type: "object", properties: { category: { type: "string", enum: [...documentCategories] }, documentType: { type: "string" }, uniqueNumber: { type: ["string", "null"] }, nameOnDocument: { type: ["string", "null"] }, expiryDate: { type: ["string", "null"] } }, required: ["category", "documentType", "uniqueNumber", "nameOnDocument", "expiryDate"], additionalProperties: false } },
      },
    });

    return validateDocumentAIResult(parseJsonObject(response.output_text));
  }
}
