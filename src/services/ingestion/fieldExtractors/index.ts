import type { DocumentAnalysis } from "../../rules/types";

export function extractStructuredFields(analysis: DocumentAnalysis) {
  return analysis.fields;
}
