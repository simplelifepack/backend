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

export type AIReadinessPackage = {
  packageName: string;
  category: string;
  description: string;
  requiredDocuments: AIRequiredDocument[];
};
