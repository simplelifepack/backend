import type { DocumentOwner } from "../services/readiness/metadataTypes";

export type AIRequiredDocument = {
  id: string;
  category: string;
  documentType: string;
  owner: DocumentOwner;
  name: string;
  title: string;
  required: boolean;
};

export type AIVerificationSource = {
  title: string;
  organization: string;
  url: string;
  type: "government" | "official" | "bank" | "university" | "insurance" | "authority";
  retrievedAt: string;
};

export type AIReadinessPackage = {
  packageName: string;
  category: string;
  description: string;
  sourceTitle: string;
  sourceUrl: string;
  sourceOrganization: string;
  lastChecked: string;
  verificationSources: AIVerificationSource[];
  lastVerifiedAt: string | null;
  verificationStatus: "verified";
  requiredDocuments: AIRequiredDocument[];
};
