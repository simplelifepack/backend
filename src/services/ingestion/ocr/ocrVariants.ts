import sharp from "sharp";
import type { Sharp } from "sharp";

import { logPipelineStage } from "../logger";
import { detectDocumentLayout } from "./ocrLayout";
import type { ImageVariant } from "./ocrTypes";

async function resizeForOcr(image: Sharp) {
  const metadata = await image.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const maxDimension = Math.max(width, height);
  const minDimension = Math.min(width || maxDimension, height || maxDimension);

  if (maxDimension > 2600) {
    return image.resize({
      width: 2600,
      height: 2600,
      fit: "inside",
      withoutEnlargement: true,
    });
  }

  if (minDimension > 0 && minDimension < 900) {
    const scale = Math.min(3, 1100 / minDimension);
    return image.resize({
      width: Math.round(width * scale),
      height: Math.round(height * scale),
      fit: "fill",
    });
  }

  return image;
}

async function buildProcessedVariant(
  source: Buffer,
  name: string,
  rotation: number,
  cropped: boolean,
  mode: "gray" | "adaptive" | "contrast" | "inverted",
) {
  let image = sharp(source, { limitInputPixels: 80_000_000, failOn: "none" }).rotate(rotation);
  image = await resizeForOcr(image);

  if (mode === "adaptive") {
    image = image.grayscale().normalise().median(1).sharpen({ sigma: 1.1 }).threshold(165);
  } else if (mode === "contrast") {
    image = image.grayscale().linear(1.28, -18).normalise().sharpen({ sigma: 1.25 });
  } else if (mode === "inverted") {
    image = image.grayscale().normalise().negate().sharpen({ sigma: 1.15 });
  } else {
    image = image.grayscale().normalise().median(1).sharpen();
  }

  return {
    name: `${name}:${mode}:rot${rotation}`,
    buffer: await image.png().toBuffer(),
    rotation,
    cropped,
  };
}

export async function buildOcrVariants(input: string | Buffer) {
  const base = await sharp(input, { limitInputPixels: 80_000_000, failOn: "none" }).rotate().toBuffer();
  const layout = await detectDocumentLayout(base);
  const sources: Array<{ name: string; buffer: Buffer; cropped: boolean }> = [
    { name: "original", buffer: base, cropped: false },
  ];

  if (layout.crop) {
    const cropped = await sharp(base, { limitInputPixels: 80_000_000, failOn: "none" })
      .extract(layout.crop)
      .png()
      .toBuffer();
    sources.push({ name: "card-crop", buffer: cropped, cropped: true });
  }

  for (const detailCrop of layout.detailCrops ?? []) {
    const cropped = await sharp(base, { limitInputPixels: 80_000_000, failOn: "none" })
      .extract(detailCrop)
      .png()
      .toBuffer();
    sources.push({ name: detailCrop.name, buffer: cropped, cropped: true });
  }

  const variants: ImageVariant[] = [];
  for (const source of sources) {
    for (const rotation of [0, 90, 180, 270]) {
      variants.push(await buildProcessedVariant(source.buffer, source.name, rotation, source.cropped, "gray"));
    }
  }

  const preferredSource = sources.find((source) => source.cropped) ?? sources[0];
  for (const source of sources.filter((item) => item.name !== "original")) {
    for (const mode of ["adaptive", "contrast", "inverted"] as const) {
      for (const rotation of [0, 90, 180, 270]) {
        variants.push(await buildProcessedVariant(source.buffer, source.name, rotation, source.cropped, mode));
      }
    }
  }

  for (const mode of ["adaptive", "contrast"] as const) {
    for (const rotation of [0, 90, 180, 270]) {
      variants.push(await buildProcessedVariant(preferredSource.buffer, preferredSource.name, rotation, preferredSource.cropped, mode));
    }
  }

  return { variants, layout };
}

export async function preprocessImage(input: string | Buffer): Promise<Buffer> {
  const image = sharp(input, {
    limitInputPixels: 80_000_000,
    failOn: "none",
  }).rotate();
  const metadata = await image.metadata();
  const maxDimension = Math.max(metadata.width ?? 0, metadata.height ?? 0);
  const resize =
    maxDimension > 2500
      ? { width: 2500, height: 2500, fit: "inside" as const, withoutEnlargement: true }
      : undefined;

  const processed = await image
    .resize(resize)
    .grayscale()
    .normalise()
    .median(1)
    .sharpen()
    .png()
    .toBuffer();

  logPipelineStage("image_preprocessing_completed", {
    inputWidth: metadata.width,
    inputHeight: metadata.height,
    outputBytes: processed.length,
  });

  return processed;
}
