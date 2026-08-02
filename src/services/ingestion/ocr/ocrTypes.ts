import type { ExtractionHints, ExtractionWarning } from "../types";

export type OcrResult = {
  text: string;
  confidence: number;
  warnings: ExtractionWarning[];
  hints?: ExtractionHints;
};

export type ImageVariant = {
  name: string;
  buffer: Buffer;
  rotation: number;
  cropped: boolean;
};

export type OcrCandidate = ImageVariant & {
  text: string;
  confidence: number;
  keywordScore: number;
  regexScore: number;
  textQuality: number;
  score: number;
};

export type ImageLayout = {
  signals: string[];
  crop?: { left: number; top: number; width: number; height: number };
  detailCrops?: Array<{
    name: string;
    left: number;
    top: number;
    width: number;
    height: number;
  }>;
};
