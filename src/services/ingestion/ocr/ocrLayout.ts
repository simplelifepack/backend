import sharp from "sharp";

import type { ImageLayout } from "./ocrTypes";

function clampBox(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function componentBoxesFromMask(
  mask: Uint8Array,
  width: number,
  height: number,
  minPixels: number,
) {
  const seen = new Uint8Array(mask.length);
  const queue: number[] = [];
  const components: Array<{
    count: number;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }> = [];

  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index] || seen[index]) continue;
    let count = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    queue.length = 0;
    queue.push(index);
    seen[index] = 1;

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const pixel = queue[cursor];
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      count += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      for (const neighbor of [
        { next: pixel + 1, valid: x < width - 1 },
        { next: pixel - 1, valid: x > 0 },
        { next: pixel + width, valid: y < height - 1 },
        { next: pixel - width, valid: y > 0 },
      ]) {
        if (neighbor.valid && mask[neighbor.next] && !seen[neighbor.next]) {
          seen[neighbor.next] = 1;
          queue.push(neighbor.next);
        }
      }
    }

    if (count >= minPixels) components.push({ count, minX, minY, maxX, maxY });
  }

  return components.sort((left, right) => right.count - left.count);
}

function scaleComponentBox(
  component: { minX: number; minY: number; maxX: number; maxY: number },
  info: { width: number; height: number },
  original: { width: number; height: number },
  paddingRatio: number,
) {
  const scaleX = original.width / info.width;
  const scaleY = original.height / info.height;
  const componentWidth = component.maxX - component.minX + 1;
  const componentHeight = component.maxY - component.minY + 1;
  const padX = Math.round(componentWidth * paddingRatio * scaleX);
  const padY = Math.round(componentHeight * paddingRatio * scaleY);
  const left = clampBox(Math.floor(component.minX * scaleX) - padX, 0, original.width - 1);
  const top = clampBox(Math.floor(component.minY * scaleY) - padY, 0, original.height - 1);
  const right = clampBox(Math.ceil((component.maxX + 1) * scaleX) + padX, left + 1, original.width);
  const bottom = clampBox(Math.ceil((component.maxY + 1) * scaleY) + padY, top + 1, original.height);
  return { left, top, width: right - left, height: bottom - top };
}

function addDetailCrop(
  detailCrops: NonNullable<ImageLayout["detailCrops"]>,
  component: { minX: number; minY: number; maxX: number; maxY: number },
  info: { width: number; height: number },
  original: { width: number; height: number },
  name: string,
  paddingRatio: number,
) {
  detailCrops.push({
    name,
    ...scaleComponentBox(component, info, original, paddingRatio),
  });
}

export async function detectDocumentLayout(input: Buffer): Promise<ImageLayout> {
  const metadata = await sharp(input, { limitInputPixels: 80_000_000, failOn: "none" }).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const signals = new Set<string>();
  if (!width || !height) return { signals: [] };

  const aspect = Math.max(width, height) / Math.max(1, Math.min(width, height));
  if (aspect >= 1.35 && aspect <= 1.95) signals.add("id_card_aspect_ratio");

  const sampleWidth = 700;
  const { data, info } = await sharp(input, { limitInputPixels: 80_000_000, failOn: "none" })
    .resize({ width: sampleWidth, withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels;
  const pixelCount = info.width * info.height;
  const corners = [0, Math.max(0, info.width - 1), Math.max(0, (info.height - 1) * info.width), Math.max(0, info.height * info.width - 1)];
  const cornerBrightness = corners.reduce((sum, pixelIndex) => {
    const offset = pixelIndex * channels;
    return sum + (data[offset] + data[offset + 1] + data[offset + 2]) / 3;
  }, 0) / corners.length;

  let minX = info.width;
  let minY = info.height;
  let maxX = 0;
  let maxY = 0;
  let foreground = 0;
  let greenHeader = 0;
  let chipLike = 0;
  let photoLike = 0;
  const greenMask = new Uint8Array(info.width * info.height);
  const goldMask = new Uint8Array(info.width * info.height);
  const redMask = new Uint8Array(info.width * info.height);

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * channels;
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      const brightness = (red + green + blue) / 3;
      const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
      const pixelIndex = y * info.width + x;
      if (Math.abs(brightness - cornerBrightness) > 22) {
        foreground += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      if (green > 75 && green > red * 1.2 && green > blue * 1.2 && green - red > 20 && green - blue > 20) {
        greenHeader += 1;
        greenMask[pixelIndex] = 1;
      }
      if (red > 115 && green > 85 && blue < 95 && red - green < 95 && green - blue > 20 && chroma > 35) {
        chipLike += 1;
        goldMask[pixelIndex] = 1;
      }
      if (red > 115 && red > green * 1.25 && red > blue * 1.25 && red - green > 25) redMask[pixelIndex] = 1;
      if (x < info.width * 0.45 && y > info.height * 0.2 && y < info.height * 0.85 && brightness < 175) photoLike += 1;
    }
  }

  if (greenHeader / pixelCount > 0.025) signals.add("green_band_or_header");
  if (chipLike / pixelCount > 0.006) signals.add("chip_or_smart_card_layout");
  if (photoLike / pixelCount > 0.035) signals.add("photo_area");

  const detailCrops: ImageLayout["detailCrops"] = [];
  const original = { width, height };
  const greenComponent = componentBoxesFromMask(greenMask, info.width, info.height, 250).find((component) => {
    const componentWidth = component.maxX - component.minX + 1;
    const componentHeight = component.maxY - component.minY + 1;
    const componentAspect = Math.max(componentWidth, componentHeight) / Math.max(1, Math.min(componentWidth, componentHeight));
    return componentAspect >= 3 && component.count / pixelCount > 0.01;
  });
  if (greenComponent) {
    signals.add("green_text_band");
    addDetailCrop(detailCrops, greenComponent, info, original, "green-band", 0.25);
  }

  const goldComponent = componentBoxesFromMask(goldMask, info.width, info.height, 180).find((component) => {
    const componentWidth = component.maxX - component.minX + 1;
    const componentHeight = component.maxY - component.minY + 1;
    const componentAspect = Math.max(componentWidth, componentHeight) / Math.max(1, Math.min(componentWidth, componentHeight));
    return componentAspect >= 1 && componentAspect <= 2.6;
  });
  if (goldComponent) {
    signals.add("visible_chip");
    addDetailCrop(detailCrops, goldComponent, info, original, "chip-neighborhood", 1.3);
  }

  const redComponent = componentBoxesFromMask(redMask, info.width, info.height, 120).find((component) => {
    const componentWidth = component.maxX - component.minX + 1;
    const componentHeight = component.maxY - component.minY + 1;
    const componentAspect = Math.max(componentWidth, componentHeight) / Math.max(1, Math.min(componentWidth, componentHeight));
    return componentAspect >= 1.8 && component.count / pixelCount > 0.001;
  });
  if (redComponent) {
    signals.add("red_serial_text");
    addDetailCrop(detailCrops, redComponent, info, original, "red-serial", 0.9);
  }

  const foregroundRatio = foreground / pixelCount;
  let crop: ImageLayout["crop"];
  if (foregroundRatio > 0.12 && minX < maxX && minY < maxY) {
    const scaleX = width / info.width;
    const scaleY = height / info.height;
    const padX = Math.round((maxX - minX) * 0.035 * scaleX);
    const padY = Math.round((maxY - minY) * 0.035 * scaleY);
    const left = clampBox(Math.floor(minX * scaleX) - padX, 0, width - 1);
    const top = clampBox(Math.floor(minY * scaleY) - padY, 0, height - 1);
    const right = clampBox(Math.ceil((maxX + 1) * scaleX) + padX, left + 1, width);
    const bottom = clampBox(Math.ceil((maxY + 1) * scaleY) + padY, top + 1, height);
    const cropWidth = right - left;
    const cropHeight = bottom - top;
    const cropAreaRatio = (cropWidth * cropHeight) / (width * height);
    const cropAspect = Math.max(cropWidth, cropHeight) / Math.max(1, Math.min(cropWidth, cropHeight));
    if (cropAreaRatio >= 0.18 && cropAreaRatio <= 0.96 && cropAspect >= 1.2 && cropAspect <= 2.4) {
      crop = { left, top, width: cropWidth, height: cropHeight };
      signals.add("document_boundary_crop");
      if (cropAspect >= 1.35 && cropAspect <= 1.95) signals.add("cropped_id_card_aspect_ratio");
    }
  }

  return { signals: [...signals], crop, detailCrops };
}
