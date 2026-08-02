export type RequirementWithPack = {
  id: string;
  title: string;
  documentType: string;
  owner: string;
  metadata: unknown;
  description: string;
  required: boolean;
  group: string;
  acceptedDocumentTypes: string[];
  alternativeLabels: string[];
  sortOrder: number;
};

export type PackWithRequirements = {
  id: string;
  slug: string;
  title: string;
  category: string;
  aliases: string[];
  description: string;
  keywords: string[];
  createdBy: string;
  version: number;
  requirements: RequirementWithPack[];
};

export type DocumentForReadiness = {
  id: string;
  originalName: string;
  mimeType: string;
  path: string;
  documentType: string;
  normalizedType: string | null;
  displayName: string | null;
  uniqueIdentifier: string | null;
  confidence: number;
  createdAt: Date;
  fields: unknown;
};
