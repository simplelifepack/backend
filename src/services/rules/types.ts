export type DocumentCategory =
  | "identity"
  | "employment"
  | "finance"
  | "medical"
  | "insurance"
  | "property"
  | "education"
  | "travel"
  | "vehicle"
  | "legal"
  | "other";

export type Evidence = {
  label: string;
  text: string;
  points: number;
};

export type RuleScore = {
  score: number;
  evidence: Evidence[];
  hasStrongIdentifier?: boolean;
};

export type DocumentRule = {
  documentType: string;
  category: DocumentCategory;
  score: (text: string, fileName: string) => RuleScore;
  extractFields: (text: string) => Record<string, string | number | boolean | string[] | undefined>;
};

export type DocumentAnalysis = {
  analysisSource: "rules" | "manual";
  documentType: string;
  category: DocumentCategory;
  confidence: number;
  fields: Record<string, unknown>;
  evidence: Evidence[];
  sourceEvidence: string[];
  missingFields: string[];
  linkedPacks: string[];
  reason: string;
};

export type WeightedSignal = {
  label: string;
  pattern: RegExp;
  points: number;
  strong?: boolean;
};
