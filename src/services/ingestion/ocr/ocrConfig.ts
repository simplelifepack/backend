import fs from "node:fs";
import path from "node:path";

export const OCR_LANGUAGE = process.env.OCR_LANGUAGE || "eng";
export const OCR_TIMEOUT_MS = Number(process.env.OCR_TIMEOUT_MS || 120000);
export const LOW_CONFIDENCE_THRESHOLD = Number(
  process.env.OCR_LOW_CONFIDENCE || 55,
);

const LOCAL_TESSERACT_ROOT = path.resolve(process.cwd(), "node_modules");

export const LOCAL_TESSERACT_LANG_PATH = path.join(
  LOCAL_TESSERACT_ROOT,
  "@tesseract.js-data",
  OCR_LANGUAGE,
  "4.0.0_best_int",
);
export const LOCAL_TESSERACT_CORE_PATH = path.join(
  LOCAL_TESSERACT_ROOT,
  "tesseract.js-core",
);
export const LOCAL_TESSERACT_WORKER_PATH = path.join(
  LOCAL_TESSERACT_ROOT,
  "tesseract.js",
  "src",
  "worker-script",
  "node",
  "index.js",
);
export const LOCAL_TESSERACT_CACHE_PATH = path.resolve(
  process.cwd(),
  ".tesseract-cache",
);

export function validateLocalTesseractAssets() {
  const requiredFiles = [
    path.join(LOCAL_TESSERACT_LANG_PATH, `${OCR_LANGUAGE}.traineddata.gz`),
    path.join(LOCAL_TESSERACT_CORE_PATH, "tesseract-core.wasm.js"),
    LOCAL_TESSERACT_WORKER_PATH,
  ];
  const missingFiles = requiredFiles.filter((filePath) => !fs.existsSync(filePath));

  if (missingFiles.length > 0) {
    throw new Error(`Local OCR assets are missing: ${missingFiles.join(", ")}`);
  }
}
