import { stat, writeFile } from "node:fs/promises";

import sharp from "sharp";

import {
  getTargetGenerationPolicy,
  getTargetPostProcessPolicy,
  PlannedTarget,
} from "../providers/types.js";

const SIZE_PATTERN = /^(\d+)x(\d+)$/i;

export interface ImageInspection {
  width: number;
  height: number;
  sizeBytes: number;
  hasAlphaChannel: boolean;
  hasTransparentPixels: boolean;
}

export async function postProcessGeneratedImage(
  target: PlannedTarget,
  imagePath: string,
): Promise<ImageInspection> {
  const postProcess = getTargetPostProcessPolicy(target);
  const generationPolicy = getTargetGenerationPolicy(target);
  const outputFormat = generationPolicy.outputFormat.toLowerCase();
  const shouldResize = Boolean(postProcess.resizeTo);
  const shouldStrip = postProcess.stripMetadata === true;
  const shouldPaletteQuantize =
    outputFormat === "png" && typeof postProcess.pngPaletteColors === "number";

  if (!shouldResize && !shouldStrip && !shouldPaletteQuantize) {
    return inspectImage(imagePath);
  }

  let pipeline = sharp(imagePath, { failOn: "none" });
  if (postProcess.resizeTo) {
    const alphaRequired = requiresAlpha(target);
    pipeline = pipeline.resize(postProcess.resizeTo.width, postProcess.resizeTo.height, {
      fit: "contain",
      background: alphaRequired
        ? { r: 0, g: 0, b: 0, alpha: 0 }
        : { r: 0, g: 0, b: 0, alpha: 1 },
      kernel: toSharpKernel(postProcess.algorithm),
      withoutEnlargement: true,
    });
  }

  const encodedBuffer = await encodeOutputBuffer(
    pipeline,
    outputFormat,
    postProcess.pngPaletteColors,
  );
  await writeFile(imagePath, encodedBuffer);

  return inspectImage(imagePath);
}

export async function inspectImage(imagePath: string): Promise<ImageInspection> {
  const image = sharp(imagePath, { failOn: "none" });
  const metadata = await image.metadata();
  if (
    typeof metadata.width !== "number" ||
    typeof metadata.height !== "number" ||
    metadata.width <= 0 ||
    metadata.height <= 0
  ) {
    throw new Error(`Unable to read image dimensions for ${imagePath}`);
  }

  const hasAlphaChannel = metadata.hasAlpha === true;
  let hasTransparentPixels = false;
  if (hasAlphaChannel) {
    const stats = await image.stats();
    const alphaChannel = stats.channels[stats.channels.length - 1];
    hasTransparentPixels = alphaChannel.min < 255;
  }

  const fileStat = await stat(imagePath);
  return {
    width: metadata.width,
    height: metadata.height,
    sizeBytes: fileStat.size,
    hasAlphaChannel,
    hasTransparentPixels,
  };
}

export function assertTargetAcceptance(
  target: PlannedTarget,
  inspection: ImageInspection,
): void {
  const acceptanceSize = parseSize(target.acceptance?.size);
  if (
    acceptanceSize &&
    (inspection.width > acceptanceSize.width || inspection.height > acceptanceSize.height)
  ) {
    throw new Error(
      [
        `Target "${target.id}" exceeds acceptance.size ${acceptanceSize.width}x${acceptanceSize.height}.`,
        `Got ${inspection.width}x${inspection.height}.`,
      ].join(" "),
    );
  }

  if (target.acceptance?.alpha === true) {
    if (!inspection.hasAlphaChannel) {
      throw new Error(`Target "${target.id}" requires alpha but image has no alpha channel.`);
    }
    if (!inspection.hasTransparentPixels) {
      throw new Error(`Target "${target.id}" requires transparency but image is fully opaque.`);
    }
  }

  const maxFileSizeKB = target.acceptance?.maxFileSizeKB;
  if (typeof maxFileSizeKB === "number") {
    const maxBytes = Math.round(maxFileSizeKB * 1024);
    if (inspection.sizeBytes > maxBytes) {
      throw new Error(
        [
          `Target "${target.id}" exceeds acceptance.maxFileSizeKB (${maxFileSizeKB} KB).`,
          `Got ${(inspection.sizeBytes / 1024).toFixed(1)} KB.`,
        ].join(" "),
      );
    }
  }
}

function parseSize(size: string | undefined): { width: number; height: number } | undefined {
  if (!size) {
    return undefined;
  }

  const match = SIZE_PATTERN.exec(size.trim());
  if (!match) {
    return undefined;
  }

  const width = Number.parseInt(match[1], 10);
  const height = Number.parseInt(match[2], 10);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined;
  }

  return { width, height };
}

function requiresAlpha(target: PlannedTarget): boolean {
  if (target.runtimeSpec?.alphaRequired === true) {
    return true;
  }
  if (target.acceptance?.alpha === true) {
    return true;
  }
  if (target.generationPolicy?.background === "transparent") {
    return true;
  }
  return false;
}

function toSharpKernel(
  algorithm: "nearest" | "lanczos3" | undefined,
): keyof sharp.KernelEnum {
  if (algorithm === "nearest") {
    return "nearest";
  }
  return "lanczos3";
}

async function encodeOutputBuffer(
  pipeline: sharp.Sharp,
  outputFormat: string,
  pngPaletteColors: number | undefined,
): Promise<Buffer> {
  if (outputFormat === "jpg" || outputFormat === "jpeg") {
    return pipeline.jpeg({ quality: 95, mozjpeg: true }).toBuffer();
  }

  if (outputFormat === "webp") {
    return pipeline.webp({ quality: 90 }).toBuffer();
  }

  return pipeline
    .png({
      compressionLevel: 9,
      adaptiveFiltering: true,
      palette: typeof pngPaletteColors === "number",
      colours: pngPaletteColors,
      effort: 8,
    })
    .toBuffer();
}
