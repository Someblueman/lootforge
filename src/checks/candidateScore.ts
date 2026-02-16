import { stat } from "node:fs/promises";

import sharp from "sharp";

import type { CandidateScoreRecord, PlannedTarget } from "../providers/types.js";

const SIZE_PATTERN = /^(\d+)x(\d+)$/i;
const DEFAULT_EXACT_PALETTE_COMPLIANCE = 0.98;

interface CandidateInspection {
  outputPath: string;
  width: number;
  height: number;
  sizeBytes: number;
  hasAlpha: boolean;
  hasTransparency: boolean;
  edgeStdev: number;
  seamScore?: number;
  distinctColors?: number;
  paletteCompliance?: number;
  histogram: number[];
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

function computeSeamScore(raw: Buffer, width: number, height: number, channels: number, strip: number): number {
  const stripPx = Math.max(1, Math.min(strip, Math.floor(Math.min(width, height) / 2)));
  let total = 0;
  let count = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < stripPx; x += 1) {
      const left = (y * width + x) * channels;
      const right = (y * width + (width - stripPx + x)) * channels;
      total += Math.abs(raw[left] - raw[right]);
      total += Math.abs(raw[left + 1] - raw[right + 1]);
      total += Math.abs(raw[left + 2] - raw[right + 2]);
      count += 3;
    }
  }

  for (let y = 0; y < stripPx; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const top = (y * width + x) * channels;
      const bottom = ((height - stripPx + y) * width + x) * channels;
      total += Math.abs(raw[top] - raw[bottom]);
      total += Math.abs(raw[top + 1] - raw[bottom + 1]);
      total += Math.abs(raw[top + 2] - raw[bottom + 2]);
      count += 3;
    }
  }

  return count > 0 ? total / count : 0;
}

function collectColorMetrics(raw: Buffer, channels: number, target: PlannedTarget): {
  distinctColors?: number;
  paletteCompliance?: number;
} {
  if (!target.palette) {
    return {};
  }

  const colors = new Set<number>();
  let counted = 0;
  let matches = 0;
  const exactPalette =
    target.palette.mode === "exact"
      ? new Set((target.palette.colors ?? []).map((c) => Number.parseInt(c.replace(/^#/, ""), 16) >>> 0))
      : undefined;

  for (let i = 0; i < raw.length; i += channels) {
    const alpha = channels >= 4 ? raw[i + 3] : 255;
    if (alpha === 0) {
      continue;
    }
    const packed = (raw[i] << 16) | (raw[i + 1] << 8) | raw[i + 2];
    colors.add(packed >>> 0);

    if (exactPalette) {
      counted += 1;
      if (exactPalette.has(packed >>> 0)) {
        matches += 1;
      }
    }
  }

  if (exactPalette) {
    return {
      distinctColors: colors.size,
      paletteCompliance: counted > 0 ? matches / counted : 1,
    };
  }

  return { distinctColors: colors.size };
}

function computeLumaHistogram(raw: Buffer, channels: number, bins = 16): number[] {
  const hist = new Array<number>(bins).fill(0);
  let counted = 0;

  for (let i = 0; i < raw.length; i += channels) {
    const alpha = channels >= 4 ? raw[i + 3] : 255;
    if (alpha === 0) {
      continue;
    }
    const luma = Math.round(0.2126 * raw[i] + 0.7152 * raw[i + 1] + 0.0722 * raw[i + 2]);
    const bin = Math.max(0, Math.min(bins - 1, Math.floor((luma / 256) * bins)));
    hist[bin] += 1;
    counted += 1;
  }

  if (counted === 0) {
    return hist;
  }

  return hist.map((value) => value / counted);
}

function histogramDistance(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < len; i += 1) {
    sum += Math.abs(a[i] - b[i]);
  }
  return sum;
}

function centroidHistogram(histograms: number[][]): number[] {
  if (histograms.length === 0) {
    return [];
  }

  const bins = histograms[0].length;
  const centroid = new Array<number>(bins).fill(0);

  for (const histogram of histograms) {
    for (let i = 0; i < bins; i += 1) {
      centroid[i] += histogram[i] ?? 0;
    }
  }

  return centroid.map((value) => value / histograms.length);
}

async function inspectCandidate(target: PlannedTarget, outputPath: string): Promise<CandidateInspection> {
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
  const rawResult = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const raw = rawResult.data;
  const channels = rawResult.info.channels;

  const hasAlpha = metadata.hasAlpha === true;
  const alphaChannel = hasAlpha ? imageStats.channels[imageStats.channels.length - 1] : undefined;
  const hasTransparency = alphaChannel ? alphaChannel.min < 255 : false;
  const edgeStdev = imageStats.channels.slice(0, 3).reduce((sum, channel) => sum + channel.stdev, 0) / 3;

  const seamScore =
    target.tileable || typeof target.seamThreshold === "number"
      ? computeSeamScore(raw, metadata.width, metadata.height, channels, target.seamStripPx ?? 4)
      : undefined;

  const colorMetrics = collectColorMetrics(raw, channels, target);

  const fileStat = await stat(outputPath);
  return {
    outputPath,
    width: metadata.width,
    height: metadata.height,
    sizeBytes: fileStat.size,
    hasAlpha,
    hasTransparency,
    edgeStdev,
    seamScore,
    distinctColors: colorMetrics.distinctColors,
    paletteCompliance: colorMetrics.paletteCompliance,
    histogram: computeLumaHistogram(raw, channels),
  };
}

export async function scoreCandidateImages(
  target: PlannedTarget,
  outputPaths: string[],
): Promise<{ bestPath: string; scores: CandidateScoreRecord[] }> {
  if (outputPaths.length === 0) {
    throw new Error(`No candidate outputs available for target "${target.id}".`);
  }

  const inspections = await Promise.all(outputPaths.map((outputPath) => inspectCandidate(target, outputPath)));
  const expectedSize = parseSize(target.acceptance?.size);
  const alphaRequired = targetNeedsAlpha(target);
  const maxBytes =
    typeof target.acceptance?.maxFileSizeKB === "number"
      ? Math.round(target.acceptance.maxFileSizeKB * 1024)
      : undefined;

  const center = centroidHistogram(inspections.map((inspection) => inspection.histogram));

  const scored: CandidateScoreRecord[] = [];

  for (const inspection of inspections) {
    const reasons: string[] = [];
    const components: Record<string, number> = {};
    const metrics: Record<string, number> = {};
    let score = 0;
    let passedAcceptance = true;

    if (expectedSize) {
      const widthDelta = Math.abs(expectedSize.width - inspection.width);
      const heightDelta = Math.abs(expectedSize.height - inspection.height);
      const penalty = widthDelta + heightDelta;
      components.sizePenalty = -penalty;
      score -= penalty;
      if (penalty > 0) {
        reasons.push(`size_delta:${widthDelta}x${heightDelta}`);
      }
    }

    if (alphaRequired) {
      if (!inspection.hasAlpha) {
        passedAcceptance = false;
        components.alphaPenalty = -1000;
        score -= 1000;
        reasons.push("missing_alpha_channel");
      }
      if (!inspection.hasTransparency) {
        passedAcceptance = false;
        components.transparencyPenalty = -800;
        score -= 800;
        reasons.push("missing_transparent_pixels");
      }
    }

    if (typeof maxBytes === "number") {
      if (inspection.sizeBytes > maxBytes) {
        passedAcceptance = false;
        const penalty = 600 + Math.round((inspection.sizeBytes - maxBytes) / 2048);
        components.fileSizePenalty = -penalty;
        score -= penalty;
        reasons.push("file_too_large");
      } else {
        const reward = Math.round((maxBytes - inspection.sizeBytes) / 2048);
        components.fileSizeReward = reward;
        score += reward;
      }
    }

    const readabilityReward = Math.round(inspection.edgeStdev * 2);
    components.readabilityReward = readabilityReward;
    score += readabilityReward;
    metrics.edgeStdev = inspection.edgeStdev;

    if (typeof inspection.seamScore === "number") {
      metrics.seamScore = inspection.seamScore;
      const threshold = target.seamThreshold ?? 12;
      if (inspection.seamScore > threshold) {
        passedAcceptance = false;
        const penalty = Math.round((inspection.seamScore - threshold) * 20) + 500;
        components.seamPenalty = -penalty;
        score -= penalty;
        reasons.push("tile_seam_exceeded");
      } else {
        const reward = Math.round((threshold - inspection.seamScore) * 2);
        components.seamReward = reward;
        score += reward;
      }
    }

    if (target.palette?.mode === "max-colors" && typeof inspection.distinctColors === "number") {
      metrics.distinctColors = inspection.distinctColors;
      const maxColors = target.palette.maxColors ?? 256;
      if (inspection.distinctColors > maxColors) {
        passedAcceptance = false;
        const penalty = 400 + (inspection.distinctColors - maxColors) * 4;
        components.palettePenalty = -penalty;
        score -= penalty;
        reasons.push("palette_max_colors_exceeded");
      } else {
        const reward = Math.round((maxColors - inspection.distinctColors) / 2);
        components.paletteReward = reward;
        score += reward;
      }
    }

    if (target.palette?.mode === "exact" && typeof inspection.paletteCompliance === "number") {
      metrics.paletteCompliance = inspection.paletteCompliance;
      if (inspection.paletteCompliance < DEFAULT_EXACT_PALETTE_COMPLIANCE) {
        passedAcceptance = false;
        const penalty = Math.round((DEFAULT_EXACT_PALETTE_COMPLIANCE - inspection.paletteCompliance) * 2000);
        components.paletteCompliancePenalty = -penalty;
        score -= penalty;
        reasons.push("palette_compliance_too_low");
      } else {
        const reward = Math.round(inspection.paletteCompliance * 100);
        components.paletteComplianceReward = reward;
        score += reward;
      }
    }

    const consistencyDistance = histogramDistance(inspection.histogram, center);
    metrics.consistencyDistance = consistencyDistance;
    const consistencyReward = Math.round((1 - Math.min(1, consistencyDistance)) * 40);
    components.consistencyReward = consistencyReward;
    score += consistencyReward;

    scored.push({
      outputPath: inspection.outputPath,
      score,
      passedAcceptance,
      reasons,
      components,
      metrics,
      selected: false,
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

  scored[0].selected = true;

  return {
    bestPath: scored[0].outputPath,
    scores: scored,
  };
}
