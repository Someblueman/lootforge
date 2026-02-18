import sharp from "sharp";

import type { PlannedTarget } from "../providers/types.js";

const DEFAULT_STRIP_PX = 4;
const DEFAULT_STRENGTH = 0.6;

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, value));
}

function blendPixelPair(
  data: Buffer,
  leftIndex: number,
  rightIndex: number,
  channels: number,
  strength: number,
): void {
  for (let channel = 0; channel < channels; channel += 1) {
    const left = data[leftIndex + channel];
    const right = data[rightIndex + channel];
    const average = (left + right) / 2;
    data[leftIndex + channel] = clampByte(
      Math.round(left + (average - left) * strength),
    );
    data[rightIndex + channel] = clampByte(
      Math.round(right + (average - right) * strength),
    );
  }
}

function resolveSeamHeal(target: PlannedTarget): { stripPx: number; strength: number } | undefined {
  if (!target.tileable || !target.seamHeal || target.seamHeal.enabled === false) {
    return undefined;
  }

  const stripPx = Math.max(
    1,
    Math.round(target.seamHeal.stripPx ?? target.seamStripPx ?? DEFAULT_STRIP_PX),
  );
  const strengthRaw =
    typeof target.seamHeal.strength === "number"
      ? target.seamHeal.strength
      : DEFAULT_STRENGTH;
  const strength = Math.max(0, Math.min(1, strengthRaw));

  if (strength <= 0) {
    return undefined;
  }

  return { stripPx, strength };
}

export async function applySeamHeal(
  imageBuffer: Buffer,
  target: PlannedTarget,
): Promise<Buffer> {
  const seamHeal = resolveSeamHeal(target);
  if (!seamHeal) {
    return imageBuffer;
  }

  const rawResult = await sharp(imageBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const width = rawResult.info.width;
  const height = rawResult.info.height;
  const channels = rawResult.info.channels;

  if (width <= 1 || height <= 1 || channels <= 0) {
    return imageBuffer;
  }

  const maxStrip = Math.floor(Math.min(width, height) / 2);
  if (maxStrip <= 0) {
    return imageBuffer;
  }

  const stripPx = Math.max(1, Math.min(seamHeal.stripPx, maxStrip));
  const data = Buffer.from(rawResult.data);

  // Blend opposite edge strips toward each other to reduce wrap seams.
  for (let y = 0; y < height; y += 1) {
    for (let offset = 0; offset < stripPx; offset += 1) {
      const falloff = 1 - offset / stripPx;
      const strength = seamHeal.strength * falloff;
      const leftIndex = (y * width + offset) * channels;
      const rightIndex = (y * width + (width - stripPx + offset)) * channels;
      blendPixelPair(data, leftIndex, rightIndex, channels, strength);
    }
  }

  for (let offset = 0; offset < stripPx; offset += 1) {
    const falloff = 1 - offset / stripPx;
    const strength = seamHeal.strength * falloff;
    for (let x = 0; x < width; x += 1) {
      const topIndex = (offset * width + x) * channels;
      const bottomIndex = ((height - stripPx + offset) * width + x) * channels;
      blendPixelPair(data, topIndex, bottomIndex, channels, strength);
    }
  }

  return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
}
