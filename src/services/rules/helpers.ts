import type { DocumentCategory, DocumentRule, RuleScore, WeightedSignal } from "./types";

export function normalizeText(text: string) {
  return text
    .replace(/[\u00a0\u2000-\u200f\u2028-\u202f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function scoreSignals(text: string, fileName: string, positives: WeightedSignal[], negatives: WeightedSignal[] = []): RuleScore {
  // Filenames are user-controlled hints, not document evidence.
  void fileName;
  const haystack = text;
  const evidence = positives.flatMap((signal) => {
    const match = haystack.match(signal.pattern);
    return match ? [{ label: signal.label, text: match[0].slice(0, 160), points: signal.points }] : [];
  });

  const negativeEvidence = negatives.flatMap((signal) => {
    const match = haystack.match(signal.pattern);
    return match ? [{ label: signal.label, text: match[0].slice(0, 160), points: -Math.abs(signal.points) }] : [];
  });

  const allEvidence = [...evidence, ...negativeEvidence];
  const score = Math.max(0, allEvidence.reduce((sum, item) => sum + item.points, 0));
  const hasStrongIdentifier = positives.some((signal) => signal.strong && signal.pattern.test(haystack));

  return { score, evidence: allEvidence, hasStrongIdentifier };
}

export function createRule(input: {
  documentType: string;
  category: DocumentCategory;
  positives: WeightedSignal[];
  negatives?: WeightedSignal[];
  extractFields?: (text: string) => Record<string, string | number | boolean | string[] | undefined>;
}): DocumentRule {
  return {
    documentType: input.documentType,
    category: input.category,
    score: (text, fileName) => scoreSignals(text, fileName, input.positives, input.negatives),
    extractFields: input.extractFields ?? (() => ({})),
  };
}

export function extractValueAfterLabel(text: string, labels: string[]) {
  for (const label of labels) {
    const pattern = new RegExp(`${label}\\s*[:\\-]?\\s*([^\\n\\r]{2,80})`, "i");
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

export function extractNameNearLabel(text: string, labels: string[]) {
  const value = extractValueAfterLabel(text, labels);
  if (!value) return undefined;
  return value.replace(/\s{2,}.*/, "").trim();
}

export function extractDate(text: string) {
  return text.match(/\b(?:\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{4}-\d{2}-\d{2})\b/)?.[0];
}

export function extractMoney(text: string) {
  return text.match(/(?:rs\.?|inr|₹)\s*[0-9,]+(?:\.\d{1,2})?/i)?.[0];
}

export function extractPanNumber(text: string) {
  return text.match(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/)?.[0];
}

export function extractAadhaarLast4(text: string) {
  const full = text.match(/\b\d{4}\s?\d{4}\s?(\d{4})\b/)?.[1];
  const masked = text.match(/\b[xX]{4}\s?[xX]{4}\s?(\d{4})\b/)?.[1];
  return full ?? masked;
}

export function extractPassportNumber(text: string) {
  return text.match(/\b[A-Z][0-9]{7}\b/)?.[0];
}

export function extractEmail(text: string) {
  return text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0];
}

export function extractPhone(text: string) {
  return text.match(/\b(?:\+91[-\s]?)?[6-9]\d{9}\b/)?.[0];
}

export function extractIfsc(text: string) {
  return text.match(/\b[A-Z]{4}0[A-Z0-9]{6}\b/)?.[0];
}

export function extractAccountMasked(text: string) {
  return (
    text.match(/\b(?:x{2,}|\*{2,})\d{4}\b/i)?.[0] ??
    extractValueAfterLabel(text, ["account number", "a/c no", "account no"])
  );
}
