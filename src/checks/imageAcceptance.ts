import { stat } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import type { PlannedTarget } from "../providers/types.js";
import { normalizeOutputFormatAlias } from "../providers/types.js";

const SIZE_PATTERN = /^(\d+)x(\d+)$/i;

export interface ImageAcceptanceIssue {
  level: "error" | "warning";
  code: string;
  targetId: string;
  imagePath: string;
  message: string;
}

export interface ImageAcceptanceItemReport {
  targetId: string;
  out: string;
  imagePath: string;
  exists: boolean;
  width?: number;
  height?: number;
  format?: string;
  sizeBytes?: number;
  hasAlphaChannel?: boolean;
  hasTransparentPixels?: boolean;
  issues: ImageAcceptanceIssue[];
}

export interface ImageAcceptanceReport {
  generatedAt: string;
  imagesDir: string;
  strict: boolean;
  total: number;
  passed: number;
  failed: number;
  errors: number;
  warnings: number;
  items: ImageAcceptanceItemReport[];
}

interface InspectedImage {
  width: number;
  height: number;
  format: string;
  sizeBytes: number;
  hasAlphaChannel: boolean;
  hasTransparentPixels: boolean;
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

async function inspectImage(imagePath: string): Promise<InspectedImage> {
  const image = sharp(imagePath, { failOn: "none" });
  const metadata = await image.metadata();

  if (
    typeof metadata.width !== "number" ||
    typeof metadata.height !== "number" ||
    metadata.width <= 0 ||
    metadata.height <= 0
  ) {
    throw new Error(`Unable to decode dimensions for ${imagePath}`);
  }

  const format = metadata.format ?? "unknown";
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
    format,
    sizeBytes: fileStat.size,
    hasAlphaChannel,
    hasTransparentPixels,
  };
}

function targetRequiresAlpha(target: PlannedTarget): boolean {
  if (target.runtimeSpec?.alphaRequired === true) {
    return true;
  }
  return target.acceptance?.alpha === true;
}

function outputFormatSupportsAlpha(format: string): boolean {
  return format === "png" || format === "webp";
}

export async function evaluateImageAcceptance(
  target: PlannedTarget,
  imagesDir: string,
): Promise<ImageAcceptanceItemReport> {
  const imagePath = path.join(imagesDir, target.out);
  const report: ImageAcceptanceItemReport = {
    targetId: target.id,
    out: target.out,
    imagePath,
    exists: false,
    issues: [],
  };

  let inspected: InspectedImage;
  try {
    inspected = await inspectImage(imagePath);
    report.exists = true;
  } catch (error) {
    report.issues.push({
      level: "error",
      code: "missing_or_invalid_image",
      targetId: target.id,
      imagePath,
      message:
        error instanceof Error
          ? error.message
          : `Missing or unreadable image for target \"${target.id}\".`,
    });
    return report;
  }

  report.width = inspected.width;
  report.height = inspected.height;
  report.format = inspected.format;
  report.sizeBytes = inspected.sizeBytes;
  report.hasAlphaChannel = inspected.hasAlphaChannel;
  report.hasTransparentPixels = inspected.hasTransparentPixels;

  const expectedSize = parseSize(target.acceptance?.size);
  if (
    expectedSize &&
    (inspected.width !== expectedSize.width || inspected.height !== expectedSize.height)
  ) {
    report.issues.push({
      level: "error",
      code: "size_mismatch",
      targetId: target.id,
      imagePath,
      message: `Expected ${expectedSize.width}x${expectedSize.height} but got ${inspected.width}x${inspected.height}.`,
    });
  }

  const requestedOutputFormat = normalizeOutputFormatAlias(target.generationPolicy?.outputFormat);
  const actualOutputFormat = normalizeOutputFormatAlias(inspected.format);
  if (actualOutputFormat !== requestedOutputFormat) {
    report.issues.push({
      level: "error",
      code: "output_format_mismatch",
      targetId: target.id,
      imagePath,
      message: `Expected ${requestedOutputFormat} but got ${actualOutputFormat}.`,
    });
  }

  if (targetRequiresAlpha(target)) {
    if (!inspected.hasAlphaChannel || !outputFormatSupportsAlpha(actualOutputFormat)) {
      report.issues.push({
        level: "error",
        code: "alpha_channel_missing",
        targetId: target.id,
        imagePath,
        message: "Target requires alpha but output format/channel is not alpha-capable.",
      });
    }
    if (!inspected.hasTransparentPixels) {
      report.issues.push({
        level: "error",
        code: "alpha_pixels_missing",
        targetId: target.id,
        imagePath,
        message: "Target requires transparency but all pixels are fully opaque.",
      });
    }
  }

  const maxFileSizeKB = target.acceptance?.maxFileSizeKB;
  if (typeof maxFileSizeKB === "number") {
    const maxBytes = Math.round(maxFileSizeKB * 1024);
    if (inspected.sizeBytes > maxBytes) {
      report.issues.push({
        level: "error",
        code: "file_size_exceeded",
        targetId: target.id,
        imagePath,
        message: `File size ${(inspected.sizeBytes / 1024).toFixed(1)}KB exceeds max ${maxFileSizeKB}KB.`,
      });
    }
  }

  return report;
}

export async function runImageAcceptanceChecks(params: {
  targets: PlannedTarget[];
  imagesDir: string;
  strict?: boolean;
}): Promise<ImageAcceptanceReport> {
  const strict = params.strict ?? true;
  const items = await Promise.all(
    params.targets.map((target) => evaluateImageAcceptance(target, params.imagesDir)),
  );

  const errors = items.reduce(
    (count, item) => count + item.issues.filter((issue) => issue.level === "error").length,
    0,
  );
  const warnings = items.reduce(
    (count, item) => count + item.issues.filter((issue) => issue.level === "warning").length,
    0,
  );

  const failed = items.filter((item) => item.issues.some((issue) => issue.level === "error"))
    .length;

  return {
    generatedAt: new Date().toISOString(),
    imagesDir: params.imagesDir,
    strict,
    total: items.length,
    passed: items.length - failed,
    failed,
    errors,
    warnings,
    items,
  };
}

export function assertImageAcceptanceReport(report: ImageAcceptanceReport): void {
  if (report.strict && report.errors > 0) {
    const examples = report.items
      .flatMap((item) => item.issues)
      .filter((issue) => issue.level === "error")
      .slice(0, 5)
      .map((issue) => `${issue.targetId}: ${issue.code}`)
      .join(", ");

    throw new Error(
      `Image acceptance failed with ${report.errors} error(s). ${examples}`.trim(),
    );
  }
}
