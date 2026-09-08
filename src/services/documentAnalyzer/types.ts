export const documentCategories = [
  "Identity",
  "Employment",
  "Finance",
  "Insurance",
  "Property",
  "Medical",
  "Education",
  "Travel",
  "Vehicle",
  "Legal",
  "Photo",
  "Other",
] as const;

export type DocumentCategory = (typeof documentCategories)[number];

export type DocumentAIResult = {
  category: DocumentCategory;
  documentType: string;
  uniqueNumber: string | null;
  nameOnDocument: string | null;
  expiryDate: string | null;
};

export type UploadedFile = {
  path: string;
  originalName: string;
  mimeType: string;
  size: number;
};

export const fallbackDocumentAIResult: DocumentAIResult = {
  category: "Other",
  documentType: "Unknown",
  uniqueNumber: null,
  nameOnDocument: null,
  expiryDate: null,
};
