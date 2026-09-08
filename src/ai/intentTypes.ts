import type { DocumentOwner } from "../services/readiness/metadataTypes";

export type AIRequiredDocument = {
  id: string;
  category: string;
  documentType: string;
  owner: DocumentOwner;
  name: string;
  title: string;
  required: boolean;
  whyNeeded: string;
  sourceName: string;
  sourceUrl: string;
  sourceAuthorityTier: "government" | "authority" | "official" | "commercial" | "aggregator";
  lastVerifiedAt: string;
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
  searchMetadata: {
    intent?: string;
    searchPhrases: string[];
    jurisdiction?: string;
    destination?: string;
    purpose?: string;
    subject?: string;
  };
  sourceTitle: string;
  sourceUrl: string;
  sourceOrganization: string;
  lastChecked: string;
  verificationSources: AIVerificationSource[];
  lastVerifiedAt: string | null;
  verificationStatus: "verified";
  requiredDocuments: AIRequiredDocument[];
};
