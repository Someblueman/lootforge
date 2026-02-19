import { readFile } from "node:fs/promises";

import sharp from "sharp";

import { computeBoundaryQualityMetrics } from "./boundaryMetrics.js";
import { runEnabledSoftAdapters } from "./softAdapters.js";
import { runCandidateVlmGate, targetHasVlmGate } from "./vlmGate.js";
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
  alphaBoundaryPixels?: number;
  alphaHaloRisk?: number;
  alphaStrayNoise?: number;
  alphaEdgeSharpness?: number;
  distinctColors?: number;
  paletteCompliance?: number;
  histogram: number[];
}

interface NormalizedScoreWeights {
  readability: number;
  fileSize: number;
  consistency: number;
  clip: number;
  lpips: number;
  ssim: number;
}

export interface ScoreCandidateImagesOptions {
  outDir?: string;
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

function analyzeRawCandidate(
  raw: Buffer,
  channels: number,
  target: PlannedTarget,
  bins = 16,
): {
  edgeStdev: number;
  hasTransparency: boolean;
  distinctColors?: number;
  paletteCompliance?: number;
  histogram: number[];
} {
  const histogram = new Array<number>(bins).fill(0);
  const sums = [0, 0, 0];
  const sumsSq = [0, 0, 0];
  const colors = target.palette ? new Set<number>() : undefined;
  const exactPalette =
    target.palette?.mode === "exact"
      ? new Set(
          (target.palette.colors ?? []).map(
            (color) => Number.parseInt(color.replace(/^#/, ""), 16) >>> 0,
          ),
        )
      : undefined;

  let visiblePixelCount = 0;
  let colorMatchCount = 0;
  let colorCounted = 0;
  let totalPixelCount = 0;
  let hasTransparency = false;

  for (let i = 0; i < raw.length; i += channels) {
    const r = raw[i];
    const g = raw[i + 1];
    const b = raw[i + 2];
    const alpha = channels >= 4 ? raw[i + 3] : 255;

    sums[0] += r;
    sums[1] += g;
    sums[2] += b;
    sumsSq[0] += r * r;
    sumsSq[1] += g * g;
    sumsSq[2] += b * b;
    totalPixelCount += 1;

    if (alpha < 255) {
      hasTransparency = true;
    }
    if (alpha === 0) {
      continue;
    }

    const packed = ((r << 16) | (g << 8) | b) >>> 0;
    colors?.add(packed);

    if (exactPalette) {
      colorCounted += 1;
      if (exactPalette.has(packed)) {
        colorMatchCount += 1;
      }
    }

    const luma = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    const bin = Math.max(0, Math.min(bins - 1, Math.floor((luma / 256) * bins)));
    histogram[bin] += 1;
    visiblePixelCount += 1;
  }

  const normalizeStdev = (channelIndex: number): number => {
    if (totalPixelCount === 0) {
      return 0;
    }
    const mean = sums[channelIndex] / totalPixelCount;
    const meanSq = sumsSq[channelIndex] / totalPixelCount;
    const variance = Math.max(0, meanSq - mean * mean);
    return Math.sqrt(variance);
  };

  const edgeStdev =
    (normalizeStdev(0) + normalizeStdev(1) + normalizeStdev(2)) / 3;
  const normalizedHistogram =
    visiblePixelCount === 0
      ? histogram
      : histogram.map((value) => value / visiblePixelCount);

  if (exactPalette) {
    return {
      edgeStdev,
      hasTransparency,
      distinctColors: colors?.size,
      paletteCompliance: colorCounted > 0 ? colorMatchCount / colorCounted : 1,
      histogram: normalizedHistogram,
    };
  }

  return {
    edgeStdev,
    hasTransparency,
    ...(colors ? { distinctColors: colors.size } : {}),
    histogram: normalizedHistogram,
  };
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
  const imageBytes = await readFile(outputPath);
  const image = sharp(imageBytes, { failOn: "none" });
  const metadata = await image.metadata();

  if (
    typeof metadata.width !== "number" ||
    typeof metadata.height !== "number" ||
    metadata.width <= 0 ||
    metadata.height <= 0
  ) {
    throw new Error(`Unable to read candidate dimensions for ${outputPath}`);
  }

  const rawResult = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const raw = rawResult.data;
  const channels = rawResult.info.channels;

  const hasAlpha = metadata.hasAlpha === true;
  const derivedMetrics = analyzeRawCandidate(raw, channels, target);
  const hasTransparency = hasAlpha ? derivedMetrics.hasTransparency : false;
  const boundaryMetrics = hasTransparency
    ? computeBoundaryQualityMetrics({
        raw,
        channels,
        width: metadata.width,
        height: metadata.height,
      })
    : undefined;

  const seamScore =
    target.tileable || typeof target.seamThreshold === "number"
      ? computeSeamScore(raw, metadata.width, metadata.height, channels, target.seamStripPx ?? 4)
      : undefined;
  return {
    outputPath,
    width: metadata.width,
    height: metadata.height,
    sizeBytes: imageBytes.byteLength,
    hasAlpha,
    hasTransparency,
    edgeStdev: derivedMetrics.edgeStdev,
    seamScore,
    alphaBoundaryPixels: boundaryMetrics?.edgePixelCount,
    alphaHaloRisk: boundaryMetrics?.haloRisk,
    alphaStrayNoise: boundaryMetrics?.strayNoiseRatio,
    alphaEdgeSharpness: boundaryMetrics?.edgeSharpness,
    distinctColors: derivedMetrics.distinctColors,
    paletteCompliance: derivedMetrics.paletteCompliance,
    histogram: derivedMetrics.histogram,
  };
}

export async function scoreCandidateImages(
  target: PlannedTarget,
  outputPaths: string[],
  options: ScoreCandidateImagesOptions = {},
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
  const scoreWeights = resolveScoreWeights(target);
  const outDir = options.outDir;
  const softAdapterByOutputPath = new Map<
    string,
    Awaited<ReturnType<typeof runEnabledSoftAdapters>>
  >();
  const vlmByOutputPath = new Map<
    string,
    NonNullable<CandidateScoreRecord["vlm"]>
  >();

  if (outDir) {
    const softResults = await Promise.all(
      inspections.map(async (inspection) => ({
        outputPath: inspection.outputPath,
        result: await runEnabledSoftAdapters({
          target,
          imagePath: inspection.outputPath,
          outDir,
        }),
      })),
    );
    for (const row of softResults) {
      softAdapterByOutputPath.set(row.outputPath, row.result);
    }
  }

  if (targetHasVlmGate(target)) {
    if (!outDir) {
      throw new Error(
        `Target "${target.id}" configured generationPolicy.vlmGate, but candidate scoring did not receive outDir.`,
      );
    }

    const vlmResults = await Promise.all(
      inspections.map(async (inspection) => ({
        outputPath: inspection.outputPath,
        result: await runCandidateVlmGate({
          target,
          imagePath: inspection.outputPath,
          outDir,
        }),
      })),
    );

    for (const row of vlmResults) {
      if (row.result) {
        vlmByOutputPath.set(row.outputPath, row.result);
      }
    }
  }

  const scored: CandidateScoreRecord[] = [];

  for (const inspection of inspections) {
    const reasons: string[] = [];
    const components: Record<string, number> = {};
    const metrics: Record<string, number> = {};
    const warnings: string[] = [];
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
        const penaltyBase = 600 + Math.round((inspection.sizeBytes - maxBytes) / 2048);
        const penalty = Math.round(penaltyBase * scoreWeights.fileSize);
        components.fileSizePenalty = -penalty;
        score -= penalty;
        reasons.push("file_too_large");
      } else {
        const rewardBase = Math.round((maxBytes - inspection.sizeBytes) / 2048);
        const reward = Math.round(rewardBase * scoreWeights.fileSize);
        components.fileSizeReward = reward;
        score += reward;
      }
    }

    const readabilityReward = Math.round(inspection.edgeStdev * 2 * scoreWeights.readability);
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
        const reward = Math.round(
          (threshold - inspection.seamScore) * 2 * scoreWeights.consistency,
        );
        components.seamReward = reward;
        score += reward;
      }
    }

    if (typeof inspection.alphaBoundaryPixels === "number") {
      metrics.alphaBoundaryPixels = inspection.alphaBoundaryPixels;
    }
    if (typeof inspection.alphaHaloRisk === "number") {
      metrics.alphaHaloRisk = inspection.alphaHaloRisk;
      if (
        typeof target.alphaHaloRiskMax === "number" &&
        inspection.alphaHaloRisk > target.alphaHaloRiskMax
      ) {
        passedAcceptance = false;
        const penalty = 450 + Math.round((inspection.alphaHaloRisk - target.alphaHaloRiskMax) * 1000);
        components.alphaHaloRiskPenalty = -penalty;
        score -= penalty;
        reasons.push("alpha_halo_risk_exceeded");
      }
    }
    if (typeof inspection.alphaStrayNoise === "number") {
      metrics.alphaStrayNoise = inspection.alphaStrayNoise;
      if (
        typeof target.alphaStrayNoiseMax === "number" &&
        inspection.alphaStrayNoise > target.alphaStrayNoiseMax
      ) {
        passedAcceptance = false;
        const penalty = 350 + Math.round((inspection.alphaStrayNoise - target.alphaStrayNoiseMax) * 1500);
        components.alphaStrayNoisePenalty = -penalty;
        score -= penalty;
        reasons.push("alpha_stray_noise_exceeded");
      }
    }
    if (typeof inspection.alphaEdgeSharpness === "number") {
      metrics.alphaEdgeSharpness = inspection.alphaEdgeSharpness;
      if (
        typeof target.alphaEdgeSharpnessMin === "number" &&
        inspection.alphaEdgeSharpness < target.alphaEdgeSharpnessMin
      ) {
        passedAcceptance = false;
        const penalty = 450 + Math.round((target.alphaEdgeSharpnessMin - inspection.alphaEdgeSharpness) * 1200);
        components.alphaEdgeSharpnessPenalty = -penalty;
        score -= penalty;
        reasons.push("alpha_edge_sharpness_too_low");
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
    const consistencyReward = Math.round(
      (1 - Math.min(1, consistencyDistance)) * 40 * scoreWeights.consistency,
    );
    components.consistencyReward = consistencyReward;
    score += consistencyReward;

    const vlm = vlmByOutputPath.get(inspection.outputPath);
    if (vlm) {
      metrics.vlmScore = vlm.score;
      metrics.vlmThreshold = vlm.threshold;
      metrics.vlmMaxScore = vlm.maxScore;

      if (!vlm.passed) {
        passedAcceptance = false;
        const penalty = 500 + Math.round((vlm.threshold - vlm.score) * 200);
        components.vlmGatePenalty = -penalty;
        score -= penalty;
        reasons.push("vlm_gate_below_threshold");
      }
    }

    const softAdapterResult = softAdapterByOutputPath.get(inspection.outputPath);
    if (softAdapterResult) {
      for (const adapterName of softAdapterResult.adapterNames) {
        const adapterMetrics = softAdapterResult.adapterMetrics[adapterName];
        if (adapterMetrics) {
          for (const [metricName, metricValue] of Object.entries(adapterMetrics)) {
            metrics[`${adapterName}.${metricName}`] = metricValue;
          }
        }

        const rawAdapterScore = softAdapterResult.adapterScores[adapterName];
        if (typeof rawAdapterScore === "number" && Number.isFinite(rawAdapterScore)) {
          const weightedAdapterScore = Math.round(
            rawAdapterScore * resolveAdapterWeight(scoreWeights, adapterName),
          );
          components[`${adapterName}AdapterScore`] = weightedAdapterScore;
          metrics[`${adapterName}.rawScore`] = rawAdapterScore;
          score += weightedAdapterScore;
        }
      }

      warnings.push(...softAdapterResult.warnings);
    }

    scored.push({
      outputPath: inspection.outputPath,
      score,
      passedAcceptance,
      reasons,
      components,
      metrics,
      ...(vlm ? { vlm } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
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

function resolveScoreWeights(target: PlannedTarget): NormalizedScoreWeights {
  return {
    readability: normalizeWeight(target.scoreWeights?.readability),
    fileSize: normalizeWeight(target.scoreWeights?.fileSize),
    consistency: normalizeWeight(target.scoreWeights?.consistency),
    clip: normalizeWeight(target.scoreWeights?.clip),
    lpips: normalizeWeight(target.scoreWeights?.lpips),
    ssim: normalizeWeight(target.scoreWeights?.ssim),
  };
}

function resolveAdapterWeight(
  scoreWeights: NormalizedScoreWeights,
  adapterName: "clip" | "lpips" | "ssim",
): number {
  if (adapterName === "clip") {
    return scoreWeights.clip;
  }
  if (adapterName === "lpips") {
    return scoreWeights.lpips;
  }
  return scoreWeights.ssim;
}

function normalizeWeight(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 1;
  }
  if (value < 0) {
    return 0;
  }
  return value;
}
