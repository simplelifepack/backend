import { analyzeWithRules } from "../../rules/engine";
import type { DocumentAnalysis, Evidence } from "../../rules/types";
import type { ExtractionHints } from "../types";

const drivingLicenceSatisfies = ["identity_proof", "address_proof", "photo_id", "driving_authorization"];
const drivingLicenceNumberPattern = /\b[A-Z]{2}[0-9]{2,}[0-9A-Z]{8,}\b/i;

function titleCaseName(input: string) {
  return input
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
    .replace(/^([A-Z])\s+/, "$1. ");
}

function normalizeDlDate(input?: string) {
  if (!input) return undefined;
  const match = input.match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})\b/);
  if (!match) return undefined;
  const [, day, month, year] = match;
  return `${day.padStart(2, "0")}/${month.padStart(2, "0")}/${year.length === 2 ? `20${year}` : year}`;
}

function extractDrivingLicenceFields(text: string, evidence: Evidence[] = []) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const evidenceLabels = new Set(evidence.map((item) => item.label));
  const hasTelanganaDlVisualLayout =
    evidenceLabels.has("green_text_band") &&
    (evidenceLabels.has("visible_chip") || evidenceLabels.has("chip_or_smart_card_layout")) &&
    evidenceLabels.has("photo_area");
  const authority =
    normalized.match(/\bRTA\s+(?:JOGULAMBA|JOGULAMBA\s+GADWAL|[A-Z][A-Z\s]{2,28})\b/i)?.[0] ??
    normalized.match(/\bLICEN[CS]ING AUTHORITY\s*[:-]?\s*([A-Z][A-Z\s]{2,28})\b/i)?.[1];
  const detectedLicenseNumber =
    normalized.match(drivingLicenceNumberPattern)?.[0]?.toUpperCase();
  const holderName =
    normalized.match(/\b(?:name|holder'?s?\s+name|s\/o|d\/o|w\/o)\s*[:-]?\s*([A-Z][A-Z.\s]{4,60})\b/i)?.[1]?.trim();
  const issueDate =
    normalizeDlDate(normalized.match(/\bissued?\s+on\s*[:-]?\s*(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\b/i)?.[1]) ??
    normalizeDlDate(normalized.match(/\b(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\b/)?.[1]);
  const addressMatch = normalized.match(/\b(?:address|addr)\s*[:-]?\s*([A-Z0-9,\s-]{8,120})/i)?.[1];

  return {
    licenceNumber: detectedLicenseNumber,
    licenseNumber: detectedLicenseNumber,
    holderName: holderName ? titleCaseName(holderName) : undefined,
    holderNameNote: holderName ? "Appears to be read from a low-confidence card photo." : undefined,
    state:
      /telangana/i.test(normalized) || /\bTS[0-9]{2,}\b/i.test(normalized) || /\bTS\b/i.test(normalized) || hasTelanganaDlVisualLayout
        ? "Telangana"
        : undefined,
    address: addressMatch?.trim(),
    addressLines: addressMatch ? addressMatch.split(/,\s*/).map((line) => line.trim()).filter(Boolean) : undefined,
    issuingAuthority: authority
      ? authority.replace(/\s+/g, " ").trim()
      : /\brta\b/i.test(normalized)
          ? "RTA"
          : undefined,
    issueDate,
  };
}

function drivingLicenceEvidence(text: string, hints?: ExtractionHints) {
  const haystack = text.replace(/\s+/g, " ").toUpperCase();
  const evidence: Evidence[] = [];
  const add = (label: string, pattern: RegExp, points: number) => {
    const match = haystack.match(pattern);
    if (match) evidence.push({ label, text: match[0], points });
  };

  add("indian union driving licence", /\bINDIAN UNION DRIVING LICEN[CS]E\b/, 65);
  add("driving licence", /\bDRIVING LICEN[CS]E\b/, 55);
  add("licence", /\bLICEN[CS]E\b/, 30);
  add("licensing authority", /\bLICEN[CS]ING AUTHORITY\b/, 35);
  add("telangana state", /\bTELANGANA STATE\b/, 45);
  add("telangana", /\bTELANGANA\b/, 25);
  add("rta", /\bRTA\b/, 35);
  add("ts licence number", /\bTS[0-9]{2,}\b/, 45);
  add("ap licence number", /\bAP[0-9]{2,}\b/, 35);
  add("licence number", /\b[A-Z]{2}[0-9]{13,}\b/, 45);
  add("state code", /\bTS\b/, 8);

  const layoutSignals = hints?.ocr?.layoutSignals ?? [];
  for (const signal of layoutSignals) {
    const points =
      signal === "photo_area"
        ? 15
        : signal === "green_band_or_header"
          ? 15
          : signal === "green_text_band"
            ? 22
            : signal === "visible_chip" || signal === "chip_or_smart_card_layout"
              ? 18
              : signal === "red_serial_text"
                ? 10
          : signal.includes("id_card_aspect")
            ? 18
            : signal === "document_boundary_crop"
              ? 12
              : 6;
    evidence.push({ label: signal, text: signal, points });
  }

  const textScore = evidence
    .filter((item) => !layoutSignals.includes(item.label))
    .reduce((sum, item) => sum + item.points, 0);
  const layoutScore = evidence
    .filter((item) => layoutSignals.includes(item.label))
    .reduce((sum, item) => sum + item.points, 0);

  return { evidence, textScore, layoutScore, score: textScore + Math.min(layoutScore, 45) };
}

function toDrivingLicenceAnalysis(base: DocumentAnalysis, text: string, confidence: number, evidence: Evidence[], source: DocumentAnalysis["analysisSource"]) {
  return {
    ...base,
    analysisSource: source,
    documentType: "Indian Driving Licence",
    category: "identity" as const,
    confidence,
    fields: {
      ...base.fields,
      ...extractDrivingLicenceFields(text, evidence),
    },
    evidence,
    sourceEvidence: evidence.map((item) => `${item.label}: ${item.text}`),
    reason: source === "rules" ? "Detected using local rules" : "Detected using OCR and ID-card layout clues. Please review extracted fields.",
  };
}

export function classifyDocument(input: { fileName: string; text: string; hints?: ExtractionHints }) {
  const analysis = analyzeWithRules({
    fileName: input.fileName,
    text: input.text,
  });
  const fallback = drivingLicenceEvidence(input.text, input.hints);

  if (analysis.documentType === "driving_license") {
    return toDrivingLicenceAnalysis(analysis, input.text, Math.max(analysis.confidence, 80), [...analysis.evidence, ...fallback.evidence], "rules");
  }

  const hasStrongText = fallback.textScore >= 45;
  const hasVisualAndPartialText = fallback.layoutScore >= 25 && fallback.textScore >= 30;
  const hasTelanganaLayout = fallback.layoutScore >= 30 && /\b(?:TELANGANA|RTA|TS)\b/i.test(input.text);
  const layoutSignals = input.hints?.ocr?.layoutSignals ?? [];
  const hasDrivingLicenceVisualLayout =
    layoutSignals.includes("green_text_band") &&
    (layoutSignals.includes("photo_area") || layoutSignals.includes("visible_chip")) &&
    (layoutSignals.includes("chip_or_smart_card_layout") || layoutSignals.includes("visible_chip"));

  if (
    (analysis.documentType === "unknown" || analysis.confidence < 60) &&
    (hasStrongText || hasVisualAndPartialText || hasTelanganaLayout || hasDrivingLicenceVisualLayout)
  ) {
    const confidence = Math.max(70, Math.min(85, 62 + fallback.textScore * 0.35 + fallback.layoutScore * 0.3));
    return toDrivingLicenceAnalysis(analysis, input.text, Math.round(confidence), fallback.evidence, "manual");
  }

  return analysis;
}

export { drivingLicenceSatisfies };
