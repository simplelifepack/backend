import type { DocumentExtractor } from "../types";
import { imageExtractor } from "./imageExtractor";
import { officeExtractor } from "./officeExtractor";
import { pdfExtractor } from "./pdfExtractor";
import { textExtractor } from "./textExtractor";

export const extractors: DocumentExtractor[] = [
  textExtractor,
  pdfExtractor,
  officeExtractor,
  imageExtractor,
];
