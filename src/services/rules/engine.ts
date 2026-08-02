import { rules } from "./index";
import { normalizeText } from "./helpers";
import type { DocumentAnalysis } from "./types";

const DEBUG_RULES = process.env.DEBUG_RULES === "true";

export function analyzeWithRules(input: { text?: string | null; fileName: string }): DocumentAnalysis {
  const originalText = normalizeText(input.text ?? "");
  const normalizedText = originalText.toLowerCase();

  const scored = rules
    .map((rule) => ({
      rule,
      result: rule.score(normalizedText, input.fileName.toLowerCase()),
    }))
    .sort((left, right) => right.result.score - left.result.score);

  const [top, second] = scored;
  const isTie = top && second && top.result.score >= 40 && top.result.score - second.result.score <= 10;
  const shouldReturnUnknown = !top || top.result.score < 40 || (isTie && !top.result.hasStrongIdentifier);

  const analysis: DocumentAnalysis = shouldReturnUnknown
    ? {
        analysisSource: "manual",
        documentType: "unknown",
        category: "other",
        confidence: 0,
        fields: {},
        evidence: top?.result.evidence ?? [],
        sourceEvidence: top?.result.evidence.map((item) => item.text) ?? [],
        missingFields: [],
        linkedPacks: [],
        reason: "Manual review required.",
      }
    : {
        analysisSource: "rules",
        documentType: top.rule.documentType,
        category: top.rule.category,
        confidence: Math.min(100, top.result.score),
        fields: top.rule.extractFields(originalText),
        evidence: top.result.evidence,
        sourceEvidence: top.result.evidence.map((item) => `${item.label}: ${item.text}`),
        missingFields: [],
        linkedPacks: [],
        reason: "Detected using local rules",
      };

  if (analysis.documentType === "passport") {
    const labels = new Set(analysis.evidence.filter((item) => item.points > 0).map((item) => item.label));
    const mandatory = ["passportHeading", "passportNumber", "mrzDetected"];
    const allSignals = [...mandatory, "expiryDate", "nationality", "dateOfBirth", "holderName"];
    if (!mandatory.every((label) => labels.has(label)) || !allSignals.every((label) => labels.has(label))) {
      analysis.confidence = Math.min(analysis.confidence, 99);
    }
  }

  if (DEBUG_RULES) {
    console.log("rules:textLength", originalText.length);
    console.log(
      "rules:top5",
      scored.slice(0, 5).map((item) => ({
        documentType: item.rule.documentType,
        score: item.result.score,
      })),
    );
    console.log("rules:selected", analysis.documentType);
    console.log("rules:evidence", analysis.evidence);
    console.log("rules:fields", analysis.fields);
  }

  return analysis;
}
