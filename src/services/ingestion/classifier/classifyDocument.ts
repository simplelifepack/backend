import { analyzeWithRules } from "../../rules/engine";
import type { DocumentAnalysis, DocumentCategory, Evidence } from "../../rules/types";
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

function paymentStatementAnalysis(base: DocumentAnalysis, input: { fileName: string; text: string }) {
  const haystack = `${input.fileName} ${input.text}`.replace(/[_-]+/g, " ");
  if (!/\b(?:paytm|upi|payment)\s+statement\b/i.test(haystack)) return null;
  const evidence = [
    ...base.evidence,
    { label: "payment statement filename/text", text: input.fileName.slice(0, 160), points: 55 },
  ];

  return {
    ...base,
    analysisSource: "rules" as const,
    documentType: "payment_statement",
    category: "finance" as const,
    confidence: Math.max(base.confidence, 70),
    evidence,
    sourceEvidence: evidence.map((item) => `${item.label}: ${item.text}`),
    reason: "Detected as a payment statement from filename and document text.",
  };
}

function filenameFallbackAnalysis(base: DocumentAnalysis, input: { fileName: string; text: string }) {
  const fileName = input.fileName.replace(/[_-]+/g, " ");
  const sparseText = input.text.replace(/\s+/g, " ").trim();
  const haystack = `${fileName} ${sparseText}`.toLowerCase();
  const matches: Array<{ documentType: string; category: DocumentCategory; pattern: RegExp; label: string }> = [
    { documentType: "bonafide_certificate", category: "education", pattern: /\bbonafide\b/i, label: "bonafide certificate filename/text" },
    { documentType: "degree_certificate", category: "education", pattern: /\b(?:provision(?:al)? certificate|degree certificate)\b/i, label: "degree certificate filename/text" },
    { documentType: "birth_certificate", category: "identity", pattern: /\bbirth certificate\b/i, label: "birth certificate filename/text" },
    { documentType: "income_certificate", category: "other", pattern: /\bincome certificate\b/i, label: "income certificate filename/text" },
    { documentType: "domicile_certificate", category: "other", pattern: /\b(?:residence|domicile) certificate\b/i, label: "residence certificate filename/text" },
    { documentType: "aadhaar", category: "identity", pattern: /\b(?:aadhaar|aadhar|adhar)\b/i, label: "aadhaar filename/text" },
    { documentType: "marks_memo", category: "education", pattern: /\b(?:ssc|inter|marks?|memo|memorandum|marksheet|grade|ogpa)\b/i, label: "marks memo filename/text" },
    { documentType: "marks_memo", category: "education", pattern: /\b(?:ielts|gre|trf)\b/i, label: "exam score report filename/text" },
    { documentType: "visa_approval", category: "travel", pattern: /\b(?:i\s*20|i-20|form i-20)\b/i, label: "i-20 filename/text" },
  ];
  const match = matches.find((candidate) => candidate.pattern.test(haystack));
  if (!match) return null;
  const evidence = [
    ...base.evidence,
    { label: match.label, text: fileName.slice(0, 160), points: 45 },
  ];

  return {
    ...base,
    analysisSource: "manual" as const,
    documentType: match.documentType,
    category: match.category,
    confidence: Math.max(base.confidence, sparseText.length >= 80 ? 55 : 45),
    evidence,
    sourceEvidence: evidence.map((item) => `${item.label}: ${item.text}`),
    reason: "Detected from clear document name and available PDF text. Please review extracted fields.",
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

  const paymentStatement = paymentStatementAnalysis(analysis, input);
  if (paymentStatement) return paymentStatement;

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

  if (analysis.documentType === "unknown") {
    const filenameAnalysis = filenameFallbackAnalysis(analysis, input);
    if (filenameAnalysis) return filenameAnalysis;
  }

  return analysis;
}

export { drivingLicenceSatisfies };
