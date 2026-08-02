import fs from "node:fs";
import Tesseract from "tesseract.js";

import { logPipelineStage } from "../logger";
import type { ExtractionWarning } from "../types";
import {
  LOCAL_TESSERACT_CACHE_PATH,
  LOCAL_TESSERACT_CORE_PATH,
  LOCAL_TESSERACT_LANG_PATH,
  LOCAL_TESSERACT_WORKER_PATH,
  LOW_CONFIDENCE_THRESHOLD,
  OCR_LANGUAGE,
  OCR_TIMEOUT_MS,
  validateLocalTesseractAssets,
} from "./ocrConfig";
import {
  scoreDrivingLicenceText,
  scorePassportText,
  scoreTextQuality,
} from "./ocrScoring";
import type { OcrCandidate, OcrResult } from "./ocrTypes";
import { buildOcrVariants, preprocessImage } from "./ocrVariants";

export type { OcrResult } from "./ocrTypes";
export { preprocessImage };

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<T>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function uniqueWarnings(warnings: ExtractionWarning[]) {
  const seen = new Set<string>();
  return warnings.filter((warning) => {
    const key = `${warning.code}:${warning.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildCandidate(variant: OcrCandidate, best: OcrCandidate | undefined) {
  return variant !== best;
}

export async function ocrImage(input: string | Buffer): Promise<OcrResult> {
  const warnings: ExtractionWarning[] = [];

  try {
    validateLocalTesseractAssets();
    fs.mkdirSync(LOCAL_TESSERACT_CACHE_PATH, { recursive: true });

    const { variants, layout } = await buildOcrVariants(input);
    const worker = await Tesseract.createWorker(OCR_LANGUAGE, 1, {
      workerPath: LOCAL_TESSERACT_WORKER_PATH,
      corePath: LOCAL_TESSERACT_CORE_PATH,
      langPath: LOCAL_TESSERACT_LANG_PATH,
      cachePath: LOCAL_TESSERACT_CACHE_PATH,
      cacheMethod: "readOnly",
      gzip: true,
    });

    try {
      await worker.setParameters({
        preserve_interword_spaces: "1",
        user_defined_dpi: "300",
      });

      const candidates: OcrCandidate[] = [];
      const perVariantTimeout = Math.max(
        15000,
        Math.floor(OCR_TIMEOUT_MS / Math.max(1, Math.min(variants.length, 6))),
      );

      for (const variant of variants) {
        const result = await withTimeout(
          worker.recognize(variant.buffer),
          perVariantTimeout,
          "OCR timed out.",
        );
        const confidence = Number.isFinite(result.data.confidence)
          ? result.data.confidence
          : 0;
        const text = result.data.text ?? "";
        const drivingLicenceScore = scoreDrivingLicenceText(text);
        const passportScore = scorePassportText(text);
        const keywordScore =
          drivingLicenceScore.keywordScore + passportScore.keywordScore;
        const regexScore = drivingLicenceScore.regexScore + passportScore.regexScore;
        const textQuality = scoreTextQuality(text);
        candidates.push({
          ...variant,
          text,
          confidence,
          keywordScore,
          regexScore,
          textQuality,
          score:
            confidence * Math.min(1, textQuality / 35) +
            keywordScore +
            regexScore +
            textQuality * 0.18 +
            (variant.cropped ? 4 : 0),
        });
      }

      const [best] = candidates.sort((left, right) => right.score - left.score);
      const confidence = best?.confidence ?? 0;
      const combinedText = [
        best?.text ?? "",
        ...candidates
          .filter((candidate) => buildCandidate(candidate, best))
          .sort(
            (left, right) =>
              right.keywordScore +
              right.regexScore +
              right.textQuality +
              right.confidence * 0.25 -
              (left.keywordScore +
                left.regexScore +
                left.textQuality +
                left.confidence * 0.25),
          )
          .slice(0, 6)
          .map((candidate) => candidate.text),
      ]
        .join("\n")
        .trim();

      if (confidence < LOW_CONFIDENCE_THRESHOLD) {
        warnings.push({
          code: "LOW_OCR_CONFIDENCE",
          message: "Some text could not be read clearly. Please review extracted fields.",
        });
      }

      if (confidence < LOW_CONFIDENCE_THRESHOLD || layout.signals.length > 0) {
        warnings.push({
          code: "PLEASE_REVIEW_FIELDS",
          message:
            "Document fields were extracted from low-confidence OCR or visual layout clues.",
        });
      }

      logPipelineStage("ocr_completed", {
        confidence,
        textLength: combinedText.length,
        bestVariant: best?.name,
        bestRotation: best?.rotation,
        variantCount: candidates.length,
        layoutSignals: layout.signals,
      });

      return {
        text: combinedText,
        confidence,
        warnings: uniqueWarnings(warnings),
        hints: {
          ocr: {
            bestVariant: best?.name,
            bestRotation: best?.rotation,
            variantCount: candidates.length,
            keywordScore: best?.keywordScore ?? 0,
            regexScore: best?.regexScore ?? 0,
            layoutSignals: layout.signals,
            allText: combinedText,
          },
        },
      };
    } finally {
      await worker.terminate().catch(() => undefined);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "OCR failed.";
    logPipelineStage("ocr_failed", { message });

    return {
      text: "",
      confidence: 0,
      hints: {},
      warnings: [
        {
          code:
            message === "OCR timed out."
              ? "OCR_TIMEOUT"
              : message.startsWith("Local OCR assets are missing")
                ? "OCR_LOCAL_ASSETS_MISSING"
                : "OCR_FAILED",
          message,
        },
      ],
    };
  }
}
