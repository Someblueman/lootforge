import { stat } from "node:fs/promises";

import sharp from "sharp";

import type { PlannedTarget } from "../providers/types.js";
import type { CandidateScoreRecord } from "../providers/types.js";

const SIZE_PATTERN = /^(\d+)x(\d+)$/i;

interface CandidateInspection {
  width: number;
  height: number;
  sizeBytes: number;
  hasAlpha: boolean;
  hasTransparency: boolean;
  edgeStdev: number;
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

function targetNeedsAlpha(target: PlannedTarget): boolean {
  return target.runtimeSpec?.alphaRequired === true || target.acceptance?.alpha === true;
}

async function inspectCandidate(outputPath: string): Promise<CandidateInspection> {
  const image = sharp(outputPath, { failOn: "none" });
  const metadata = await image.metadata();

  if (
    typeof metadata.width !== "number" ||
    typeof metadata.height !== "number" ||
    metadata.width <= 0 ||
    metadata.height <= 0
  ) {
    throw new Error(`Unable to read candidate dimensions for ${outputPath}`);
  }

  const imageStats = await image.stats();
  const hasAlpha = metadata.hasAlpha === true;
  const alphaChannel = hasAlpha ? imageStats.channels[imageStats.channels.length - 1] : undefined;
  const hasTransparency = alphaChannel ? alphaChannel.min < 255 : false;
  const edgeStdev = imageStats.channels.slice(0, 3).reduce((sum, channel) => sum + channel.stdev, 0) / 3;

  const fileStat = await stat(outputPath);
  return {
    width: metadata.width,
    height: metadata.height,
    sizeBytes: fileStat.size,
    hasAlpha,
    hasTransparency,
    edgeStdev,
  };
}

export async function scoreCandidateImages(
  target: PlannedTarget,
  outputPaths: string[],
): Promise<{ bestPath: string; scores: CandidateScoreRecord[] }> {
  if (outputPaths.length === 0) {
    throw new Error(`No candidate outputs available for target \"${target.id}\".`);
  }

  const expectedSize = parseSize(target.acceptance?.size);
  const alphaRequired = targetNeedsAlpha(target);
  const maxBytes =
    typeof target.acceptance?.maxFileSizeKB === "number"
      ? Math.round(target.acceptance.maxFileSizeKB * 1024)
      : undefined;

  const scored: CandidateScoreRecord[] = [];

  for (const outputPath of outputPaths) {
    const inspection = await inspectCandidate(outputPath);
    const reasons: string[] = [];
    let score = 0;
    let passedAcceptance = true;

    if (expectedSize) {
      const widthDelta = Math.abs(expectedSize.width - inspection.width);
      const heightDelta = Math.abs(expectedSize.height - inspection.height);
      score -= widthDelta + heightDelta;
      if (widthDelta > 0 || heightDelta > 0) {
        reasons.push(`size_delta:${widthDelta}x${heightDelta}`);
      }
    }

    if (alphaRequired) {
      if (!inspection.hasAlpha) {
        passedAcceptance = false;
        score -= 1000;
        reasons.push("missing_alpha_channel");
      }
      if (!inspection.hasTransparency) {
        passedAcceptance = false;
        score -= 800;
        reasons.push("missing_transparent_pixels");
      }
    }

    if (typeof maxBytes === "number") {
      if (inspection.sizeBytes > maxBytes) {
        passedAcceptance = false;
        score -= 600;
        reasons.push("file_too_large");
      } else {
        // Prefer smaller assets when both pass constraints.
        score += Math.round((maxBytes - inspection.sizeBytes) / 2048);
      }
    }

    // Prefer images with stronger edge contrast for gameplay readability.
    score += Math.round(inspection.edgeStdev * 2);

    scored.push({
      outputPath,
      score,
      passedAcceptance,
      reasons,
    });
  }

  scored.sort((left, right) => {
    if (left.passedAcceptance !== right.passedAcceptance) {
      return left.passedAcceptance ? -1 : 1;
    }
    if (left.score !== right.score) {
      return right.score - left.score;
    }
    return left.outputPath.localeCompare(right.outputPath);
  });

  return {
    bestPath: scored[0].outputPath,
    scores: scored,
  };
}
