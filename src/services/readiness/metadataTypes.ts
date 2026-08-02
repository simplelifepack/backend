export type DocumentOwner =
  | "self"
  | "spouse"
  | "father"
  | "mother"
  | "child"
  | "seller"
  | "buyer"
  | "employer"
  | "bank"
  | "hospital"
  | "government"
  | "other"
  | "unknown";

export type NormalizedDocumentMetadata = {
  documentId: string;
  documentType: string;
  owner: DocumentOwner;
  subType: string | null;
  expiry: string | null;
  verified: boolean;
  attributes: Record<string, string | number | boolean | null>;
};

export type ReadinessRequirementMetadata = {
  id: string;
  title: string;
  documentType: string;
  acceptedDocumentTypes: string[];
  owner: DocumentOwner;
  category: string;
  required: boolean;
  constraints?: Record<string, string | number | boolean | null>;
};

export type MetadataMatchState = "ready" | "partial" | "missing";
