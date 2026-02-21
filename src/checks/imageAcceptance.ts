import { stat } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { computeBoundaryQualityMetrics } from "./boundaryMetrics.js";
import { runPackInvariantChecks } from "./packInvariants.js";
import { type PackInvariantSummary } from "./packInvariants.js";
import { type PlannedTarget } from "../providers/types.js";
import { normalizeOutputFormatAlias } from "../providers/types.js";
import { parseSize } from "../shared/image.js";
import { normalizeTargetOutPath, resolvePathWithinDir } from "../shared/paths.js";

const DEFAULT_PALETTE_COMPLIANCE_MIN = 0.98;

export interface ImageAcceptanceIssue {
  level: "error" | "warning";
  code: string;
  targetId: string;
  imagePath: string;
  message: string;
}

export interface ImageAcceptanceMetrics {
  seamScore?: number;
  seamStripPx?: number;
  wrapGridColumns?: number;
  wrapGridRows?: number;
  wrapGridSeamScore?: number;
  wrapGridSeamStripPx?: number;
  wrapGridTopologyComparisons?: number;
  wrapGridTopologyMismatchRatio?: number;
  wrapGridTopologyThreshold?: number;
  wrapGridTopologyColorTolerance?: number;
  styleLineContrast?: number;
  styleShadingBandCount?: number;
  styleUiRectilinearity?: number;
  mattingMaskCoverage?: number;
  mattingSemiTransparencyRatio?: number;
  mattingMaskConsistency?: number;
  mattingHiddenRgbLeak?: number;
  paletteCompliance?: number;
  distinctColors?: number;
  alphaBoundaryPixels?: number;
  alphaHaloRisk?: number;
  alphaStrayNoise?: number;
  alphaEdgeSharpness?: number;
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
  metrics?: ImageAcceptanceMetrics;
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
  packInvariants?: PackInvariantSummary;
}

interface InspectedImage {
  width: number;
  height: number;
  format: string;
  sizeBytes: number;
  hasAlphaChannel: boolean;
  hasTransparentPixels: boolean;
  raw: Buffer;
  channels: number;
}

type WrapGridTopologyMode = "self" | "one-to-one" | "many-to-many";

interface WrapGridTopologyResult {
  mode: WrapGridTopologyMode;
  comparisons: number;
  mismatchRatio: number;
}

interface VisualStyleMetrics {
  lineContrast: number;
  shadingBandCount: number;
  uiRectilinearity: number;
}

interface MattingQualityMetrics {
  maskCoverage: number;
  semiTransparencyRatio: number;
  maskConsistency: number;
  hiddenRgbLeak: number;
}

async function inspectImage(imagePath: string): Promise<InspectedImage> {
  const [metadata, rawResult] = await Promise.all([
    sharp(imagePath, { failOn: "none" }).metadata(),
    sharp(imagePath, { failOn: "none" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);

  if (
    typeof metadata.width !== "number" ||
    typeof metadata.height !== "number" ||
    metadata.width <= 0 ||
    metadata.height <= 0
  ) {
    throw new Error(`Unable to decode dimensions for ${imagePath}`);
  }

  const format = (metadata.format as string | undefined) ?? "unknown";
  const hasAlphaChannel = metadata.hasAlpha;
  const channels = rawResult.info.channels;
  const raw = rawResult.data;
  const hasTransparentPixels = channels >= 4 ? hasAnyTransparentPixels(raw, channels) : false;

  const sizeBytes =
    typeof metadata.size === "number" && metadata.size > 0
      ? metadata.size
      : (await stat(imagePath)).size;
  return {
    width: metadata.width,
    height: metadata.height,
    format,
    sizeBytes,
    hasAlphaChannel,
    hasTransparentPixels,
    raw,
    channels,
  };
}

function hasAnyTransparentPixels(raw: Buffer, channels: number): boolean {
  if (channels < 4) {
    return false;
  }

  for (let index = 3; index < raw.length; index += channels) {
    if (raw[index] < 255) {
      return true;
    }
  }

  return false;
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

function computeSeamScore(inspected: InspectedImage, stripPx: number): number {
  return computeSeamScoreForRegion(inspected, 0, 0, inspected.width, inspected.height, stripPx);
}

function computeSeamScoreForRegion(
  inspected: InspectedImage,
  startX: number,
  startY: number,
  regionWidth: number,
  regionHeight: number,
  stripPx: number,
): number {
  const channels = inspected.channels;
  const strip = Math.max(1, Math.min(stripPx, Math.floor(Math.min(regionWidth, regionHeight) / 2)));

  const mad = (a: number, b: number): number => Math.abs(a - b);
  let total = 0;
  let count = 0;

  // Left vs right strips.
  for (let y = 0; y < regionHeight; y += 1) {
    for (let x = 0; x < strip; x += 1) {
      const leftIndex = ((startY + y) * inspected.width + (startX + x)) * channels;
      const rightIndex =
        ((startY + y) * inspected.width + (startX + regionWidth - strip + x)) * channels;
      total += mad(inspected.raw[leftIndex], inspected.raw[rightIndex]);
      total += mad(inspected.raw[leftIndex + 1], inspected.raw[rightIndex + 1]);
      total += mad(inspected.raw[leftIndex + 2], inspected.raw[rightIndex + 2]);
      count += 3;
    }
  }

  // Top vs bottom strips.
  for (let y = 0; y < strip; y += 1) {
    for (let x = 0; x < regionWidth; x += 1) {
      const topIndex = ((startY + y) * inspected.width + (startX + x)) * channels;
      const bottomIndex =
        ((startY + regionHeight - strip + y) * inspected.width + (startX + x)) * channels;
      total += mad(inspected.raw[topIndex], inspected.raw[bottomIndex]);
      total += mad(inspected.raw[topIndex + 1], inspected.raw[bottomIndex + 1]);
      total += mad(inspected.raw[topIndex + 2], inspected.raw[bottomIndex + 2]);
      count += 3;
    }
  }

  if (count === 0) {
    return 0;
  }

  return total / count;
}

function computeWrapGridSeamScore(
  inspected: InspectedImage,
  columns: number,
  rows: number,
  stripPx: number,
): number | undefined {
  if (
    columns <= 0 ||
    rows <= 0 ||
    inspected.width % columns !== 0 ||
    inspected.height % rows !== 0
  ) {
    return undefined;
  }

  const cellWidth = inspected.width / columns;
  const cellHeight = inspected.height / rows;
  let total = 0;
  let count = 0;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      total += computeSeamScoreForRegion(
        inspected,
        column * cellWidth,
        row * cellHeight,
        cellWidth,
        cellHeight,
        stripPx,
      );
      count += 1;
    }
  }

  if (count === 0) {
    return 0;
  }

  return total / count;
}

function evaluateWrapGridTopology(params: {
  inspected: InspectedImage;
  columns: number;
  rows: number;
  mode: WrapGridTopologyMode;
  colorTolerance: number;
}): WrapGridTopologyResult | undefined {
  const { inspected, columns, rows } = params;
  if (
    columns <= 0 ||
    rows <= 0 ||
    inspected.width % columns !== 0 ||
    inspected.height % rows !== 0
  ) {
    return undefined;
  }

  const cellWidth = inspected.width / columns;
  const cellHeight = inspected.height / rows;
  const colorTolerance = Math.max(0, Math.min(255, Math.round(params.colorTolerance)));

  if (params.mode === "self") {
    let comparisons = 0;
    let mismatchTotal = 0;

    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const startX = column * cellWidth;
        const startY = row * cellHeight;
        mismatchTotal += compareEdgeMismatchRatio({
          inspected,
          startX,
          startY,
          cellWidth,
          cellHeight,
          leftEdge: "left",
          rightEdge: "right",
          colorTolerance,
        });
        mismatchTotal += compareEdgeMismatchRatio({
          inspected,
          startX,
          startY,
          cellWidth,
          cellHeight,
          leftEdge: "top",
          rightEdge: "bottom",
          colorTolerance,
        });
        comparisons += 2;
      }
    }

    return {
      mode: params.mode,
      comparisons,
      mismatchRatio: comparisons > 0 ? mismatchTotal / comparisons : 0,
    };
  }

  if (params.mode === "one-to-one") {
    let comparisons = 0;
    let mismatchTotal = 0;

    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const startX = column * cellWidth;
        const startY = row * cellHeight;

        if (column + 1 < columns) {
          mismatchTotal += compareEdgeMismatchRatio({
            inspected,
            startX,
            startY,
            cellWidth,
            cellHeight,
            leftEdge: "right",
            rightEdge: "left",
            rightStartX: (column + 1) * cellWidth,
            rightStartY: startY,
            colorTolerance,
          });
          comparisons += 1;
        }

        if (row + 1 < rows) {
          mismatchTotal += compareEdgeMismatchRatio({
            inspected,
            startX,
            startY,
            cellWidth,
            cellHeight,
            leftEdge: "bottom",
            rightEdge: "top",
            rightStartX: startX,
            rightStartY: (row + 1) * cellHeight,
            colorTolerance,
          });
          comparisons += 1;
        }
      }
    }

    return {
      mode: params.mode,
      comparisons,
      mismatchRatio: comparisons > 0 ? mismatchTotal / comparisons : 0,
    };
  }

  let comparisons = 0;
  let mismatched = 0;
  const leftEdgeKeys = new Set<string>();
  const topEdgeKeys = new Set<string>();
  const rightEdges: string[] = [];
  const bottomEdges: string[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const startX = column * cellWidth;
      const startY = row * cellHeight;
      leftEdgeKeys.add(
        createEdgeSignature({
          inspected,
          startX,
          startY,
          cellWidth,
          cellHeight,
          edge: "left",
          colorTolerance,
        }),
      );
      topEdgeKeys.add(
        createEdgeSignature({
          inspected,
          startX,
          startY,
          cellWidth,
          cellHeight,
          edge: "top",
          colorTolerance,
        }),
      );
      rightEdges.push(
        createEdgeSignature({
          inspected,
          startX,
          startY,
          cellWidth,
          cellHeight,
          edge: "right",
          colorTolerance,
        }),
      );
      bottomEdges.push(
        createEdgeSignature({
          inspected,
          startX,
          startY,
          cellWidth,
          cellHeight,
          edge: "bottom",
          colorTolerance,
        }),
      );
    }
  }

  for (const key of rightEdges) {
    comparisons += 1;
    if (!leftEdgeKeys.has(key)) {
      mismatched += 1;
    }
  }

  for (const key of bottomEdges) {
    comparisons += 1;
    if (!topEdgeKeys.has(key)) {
      mismatched += 1;
    }
  }

  return {
    mode: params.mode,
    comparisons,
    mismatchRatio: comparisons > 0 ? mismatched / comparisons : 0,
  };
}

function resolveWrapGridTopologyIssueCode(mode: WrapGridTopologyMode): string {
  if (mode === "self") {
    return "wrap_grid_topology_self_exceeded";
  }
  if (mode === "one-to-one") {
    return "wrap_grid_topology_pair_exceeded";
  }
  return "wrap_grid_topology_compatibility_exceeded";
}

function computeVisualStyleMetrics(inspected: InspectedImage): VisualStyleMetrics {
  const bins = 32;
  const histogram = new Array<number>(bins).fill(0);
  let visiblePixels = 0;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  let contrastTotal = 0;
  let contrastCount = 0;

  const lumaAt = (index: number): number =>
    0.2126 * inspected.raw[index] +
    0.7152 * inspected.raw[index + 1] +
    0.0722 * inspected.raw[index + 2];

  const alphaAt = (index: number): number =>
    inspected.channels >= 4 ? inspected.raw[index + 3] : 255;

  for (let y = 0; y < inspected.height; y += 1) {
    for (let x = 0; x < inspected.width; x += 1) {
      const index = (y * inspected.width + x) * inspected.channels;
      if (alphaAt(index) === 0) {
        continue;
      }

      visiblePixels += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;

      const luma = lumaAt(index);
      const bin = Math.max(0, Math.min(bins - 1, Math.floor((luma / 256) * bins)));
      histogram[bin] += 1;

      if (x + 1 < inspected.width) {
        const rightIndex = index + inspected.channels;
        if (alphaAt(rightIndex) > 0) {
          contrastTotal += Math.abs(luma - lumaAt(rightIndex));
          contrastCount += 1;
        }
      }

      if (y + 1 < inspected.height) {
        const bottomIndex = index + inspected.width * inspected.channels;
        if (alphaAt(bottomIndex) > 0) {
          contrastTotal += Math.abs(luma - lumaAt(bottomIndex));
          contrastCount += 1;
        }
      }
    }
  }

  const lineContrast = contrastCount > 0 ? contrastTotal / (contrastCount * 255) : 0;
  const shadingBandCount = histogram.filter((count) => count > 0).length;

  if (visiblePixels === 0) {
    return {
      lineContrast,
      shadingBandCount,
      uiRectilinearity: 0,
    };
  }

  const bboxArea = Math.max(1, (maxX - minX + 1) * (maxY - minY + 1));
  return {
    lineContrast,
    shadingBandCount,
    uiRectilinearity: visiblePixels / bboxArea,
  };
}

function computeMattingQualityMetrics(inspected: InspectedImage): MattingQualityMetrics {
  const totalPixels = Math.max(1, inspected.width * inspected.height);
  let visiblePixels = 0;
  let semiTransparentPixels = 0;
  let hiddenLeakSum = 0;
  let hiddenLeakCount = 0;
  let semiOnOpaqueBoundary = 0;

  const alphaAt = (x: number, y: number): number => {
    const index = (y * inspected.width + x) * inspected.channels;
    return inspected.channels >= 4 ? inspected.raw[index + 3] : 255;
  };

  for (let y = 0; y < inspected.height; y += 1) {
    for (let x = 0; x < inspected.width; x += 1) {
      const index = (y * inspected.width + x) * inspected.channels;
      const alpha = inspected.channels >= 4 ? inspected.raw[index + 3] : 255;
      if (alpha === 0) {
        hiddenLeakSum +=
          Math.max(inspected.raw[index], inspected.raw[index + 1], inspected.raw[index + 2]) / 255;
        hiddenLeakCount += 1;
        continue;
      }

      visiblePixels += 1;
      if (alpha < 255) {
        semiTransparentPixels += 1;
      }
    }
  }

  if (semiTransparentPixels > 0) {
    for (let y = 0; y < inspected.height; y += 1) {
      for (let x = 0; x < inspected.width; x += 1) {
        const alpha = alphaAt(x, y);
        if (alpha <= 0 || alpha >= 255) {
          continue;
        }

        let touchesOpaque = false;
        for (let dy = -1; dy <= 1 && !touchesOpaque; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) {
              continue;
            }
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= inspected.width || ny >= inspected.height) {
              continue;
            }
            if (alphaAt(nx, ny) === 255) {
              touchesOpaque = true;
              break;
            }
          }
        }

        if (touchesOpaque) {
          semiOnOpaqueBoundary += 1;
        }
      }
    }
  }

  return {
    maskCoverage: visiblePixels / totalPixels,
    semiTransparencyRatio:
      visiblePixels > 0 ? semiTransparentPixels / Math.max(1, visiblePixels) : 0,
    maskConsistency: semiTransparentPixels > 0 ? semiOnOpaqueBoundary / semiTransparentPixels : 1,
    hiddenRgbLeak: hiddenLeakCount > 0 ? hiddenLeakSum / hiddenLeakCount : 0,
  };
}

type Edge = "left" | "right" | "top" | "bottom";

function compareEdgeMismatchRatio(params: {
  inspected: InspectedImage;
  startX: number;
  startY: number;
  cellWidth: number;
  cellHeight: number;
  leftEdge: Edge;
  rightEdge: Edge;
  rightStartX?: number;
  rightStartY?: number;
  colorTolerance: number;
}): number {
  const leftLength = edgeLength(params.leftEdge, params.cellWidth, params.cellHeight);
  const rightLength = edgeLength(params.rightEdge, params.cellWidth, params.cellHeight);
  if (leftLength !== rightLength || leftLength <= 0) {
    return 1;
  }

  let mismatches = 0;
  const rightStartX = params.rightStartX ?? params.startX;
  const rightStartY = params.rightStartY ?? params.startY;
  const colorTolerance = Math.max(0, Math.min(255, Math.round(params.colorTolerance)));

  for (let offset = 0; offset < leftLength; offset += 1) {
    const leftIndex = resolveEdgePixelIndex({
      inspected: params.inspected,
      startX: params.startX,
      startY: params.startY,
      cellWidth: params.cellWidth,
      cellHeight: params.cellHeight,
      edge: params.leftEdge,
      offset,
    });
    const rightIndex = resolveEdgePixelIndex({
      inspected: params.inspected,
      startX: rightStartX,
      startY: rightStartY,
      cellWidth: params.cellWidth,
      cellHeight: params.cellHeight,
      edge: params.rightEdge,
      offset,
    });

    let mismatched = false;
    for (let channel = 0; channel < params.inspected.channels; channel += 1) {
      if (
        Math.abs(
          params.inspected.raw[leftIndex + channel] - params.inspected.raw[rightIndex + channel],
        ) > colorTolerance
      ) {
        mismatched = true;
        break;
      }
    }

    if (mismatched) {
      mismatches += 1;
    }
  }

  return mismatches / leftLength;
}

function createEdgeSignature(params: {
  inspected: InspectedImage;
  startX: number;
  startY: number;
  cellWidth: number;
  cellHeight: number;
  edge: Edge;
  colorTolerance: number;
}): string {
  const length = edgeLength(params.edge, params.cellWidth, params.cellHeight);
  const step = Math.max(1, Math.round(params.colorTolerance) + 1);
  const segments: string[] = [];

  for (let offset = 0; offset < length; offset += 1) {
    const index = resolveEdgePixelIndex({
      inspected: params.inspected,
      startX: params.startX,
      startY: params.startY,
      cellWidth: params.cellWidth,
      cellHeight: params.cellHeight,
      edge: params.edge,
      offset,
    });
    for (let channel = 0; channel < params.inspected.channels; channel += 1) {
      const quantized = Math.floor(params.inspected.raw[index + channel] / step);
      segments.push(quantized.toString(16).padStart(2, "0"));
    }
  }

  return segments.join("");
}

function edgeLength(edge: Edge, cellWidth: number, cellHeight: number): number {
  if (edge === "left" || edge === "right") {
    return cellHeight;
  }
  return cellWidth;
}

function resolveEdgePixelIndex(params: {
  inspected: InspectedImage;
  startX: number;
  startY: number;
  cellWidth: number;
  cellHeight: number;
  edge: Edge;
  offset: number;
}): number {
  const x =
    params.edge === "left"
      ? params.startX
      : params.edge === "right"
        ? params.startX + params.cellWidth - 1
        : params.startX + params.offset;
  const y =
    params.edge === "top"
      ? params.startY
      : params.edge === "bottom"
        ? params.startY + params.cellHeight - 1
        : params.startY + params.offset;
  return (y * params.inspected.width + x) * params.inspected.channels;
}

function collectDistinctColors(inspected: InspectedImage): Set<number> {
  const colors = new Set<number>();

  for (let i = 0; i < inspected.raw.length; i += inspected.channels) {
    const alpha = inspected.channels >= 4 ? inspected.raw[i + 3] : 255;
    if (alpha === 0) {
      continue;
    }
    const packed = (inspected.raw[i] << 16) | (inspected.raw[i + 1] << 8) | inspected.raw[i + 2];
    colors.add(packed >>> 0);
  }

  return colors;
}

function hexToPackedColor(input: string): number {
  const normalized = input.trim().replace(/^#/, "");
  const value = Number.parseInt(normalized, 16);
  if (!Number.isFinite(value)) {
    return 0;
  }
  return value >>> 0;
}

function computeExactPaletteCompliance(
  inspected: InspectedImage,
  allowedColors: Set<number>,
): { compliance: number; distinctColors: number } {
  if (allowedColors.size === 0) {
    return { compliance: 0, distinctColors: 0 };
  }

  let matches = 0;
  let counted = 0;
  const distinctColors = new Set<number>();

  for (let i = 0; i < inspected.raw.length; i += inspected.channels) {
    const alpha = inspected.channels >= 4 ? inspected.raw[i + 3] : 255;
    if (alpha === 0) {
      continue;
    }

    const packed = (inspected.raw[i] << 16) | (inspected.raw[i + 1] << 8) | inspected.raw[i + 2];
    distinctColors.add(packed >>> 0);
    counted += 1;
    if (allowedColors.has(packed >>> 0)) {
      matches += 1;
    }
  }

  if (counted === 0) {
    return { compliance: 1, distinctColors: 0 };
  }

  return {
    compliance: matches / counted,
    distinctColors: distinctColors.size,
  };
}

function requiredExactPaletteCompliance(target: PlannedTarget): number {
  if (target.palette?.mode === "exact" && target.palette.strict === true) {
    return 1;
  }
  return DEFAULT_PALETTE_COMPLIANCE_MIN;
}

export async function evaluateImageAcceptance(
  target: PlannedTarget,
  imagesDir: string,
): Promise<ImageAcceptanceItemReport> {
  const report: ImageAcceptanceItemReport = {
    targetId: target.id,
    out: target.out,
    imagePath: "",
    exists: false,
    issues: [],
    metrics: {},
  };

  let imagePath: string;
  try {
    const normalizedOut = normalizeTargetOutPath(target.out);
    report.out = normalizedOut;
    imagePath = resolvePathWithinDir(
      imagesDir,
      normalizedOut,
      `accepted image for target "${target.id}"`,
    );
    report.imagePath = imagePath;
  } catch (error) {
    report.issues.push({
      level: "error",
      code: "invalid_target_out_path",
      targetId: target.id,
      imagePath: path.join(imagesDir, target.out),
      message: error instanceof Error ? error.message : String(error),
    });
    return report;
  }

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
          : `Missing or unreadable image for target "${target.id}".`,
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

  const boundaryMetrics =
    inspected.hasAlphaChannel && inspected.hasTransparentPixels
      ? computeBoundaryQualityMetrics({
          raw: inspected.raw,
          channels: inspected.channels,
          width: inspected.width,
          height: inspected.height,
        })
      : undefined;
  if (boundaryMetrics) {
    report.metrics = {
      ...report.metrics,
      alphaBoundaryPixels: boundaryMetrics.edgePixelCount,
      alphaHaloRisk: boundaryMetrics.haloRisk,
      alphaStrayNoise: boundaryMetrics.strayNoiseRatio,
      alphaEdgeSharpness: boundaryMetrics.edgeSharpness,
    };
  }

  if (typeof target.alphaHaloRiskMax === "number" && boundaryMetrics) {
    if (boundaryMetrics.haloRisk > target.alphaHaloRiskMax) {
      report.issues.push({
        level: "error",
        code: "alpha_halo_risk_exceeded",
        targetId: target.id,
        imagePath,
        message: `Alpha halo risk ${boundaryMetrics.haloRisk.toFixed(4)} exceeds threshold ${target.alphaHaloRiskMax.toFixed(4)}.`,
      });
    }
  }

  if (typeof target.alphaStrayNoiseMax === "number" && boundaryMetrics) {
    if (boundaryMetrics.strayNoiseRatio > target.alphaStrayNoiseMax) {
      report.issues.push({
        level: "error",
        code: "alpha_stray_noise_exceeded",
        targetId: target.id,
        imagePath,
        message: `Alpha stray-noise ratio ${boundaryMetrics.strayNoiseRatio.toFixed(4)} exceeds threshold ${target.alphaStrayNoiseMax.toFixed(4)}.`,
      });
    }
  }

  if (typeof target.alphaEdgeSharpnessMin === "number" && boundaryMetrics) {
    if (boundaryMetrics.edgeSharpness < target.alphaEdgeSharpnessMin) {
      report.issues.push({
        level: "error",
        code: "alpha_edge_sharpness_too_low",
        targetId: target.id,
        imagePath,
        message: `Alpha edge sharpness ${boundaryMetrics.edgeSharpness.toFixed(4)} is below threshold ${target.alphaEdgeSharpnessMin.toFixed(4)}.`,
      });
    }
  }

  if (target.visualStylePolicy) {
    const visualStyleMetrics = computeVisualStyleMetrics(inspected);
    report.metrics = {
      ...report.metrics,
      styleLineContrast: visualStyleMetrics.lineContrast,
      styleShadingBandCount: visualStyleMetrics.shadingBandCount,
      styleUiRectilinearity: visualStyleMetrics.uiRectilinearity,
    };

    if (
      typeof target.visualStylePolicy.lineContrastMin === "number" &&
      visualStyleMetrics.lineContrast < target.visualStylePolicy.lineContrastMin
    ) {
      report.issues.push({
        level: "error",
        code: "style_policy_line_contrast_below_min",
        targetId: target.id,
        imagePath,
        message: `Line contrast ${visualStyleMetrics.lineContrast.toFixed(4)} is below style policy minimum ${target.visualStylePolicy.lineContrastMin.toFixed(4)}.`,
      });
    }

    if (
      typeof target.visualStylePolicy.shadingBandCountMax === "number" &&
      visualStyleMetrics.shadingBandCount > target.visualStylePolicy.shadingBandCountMax
    ) {
      report.issues.push({
        level: "error",
        code: "style_policy_shading_band_count_exceeded",
        targetId: target.id,
        imagePath,
        message: `Shading band count ${visualStyleMetrics.shadingBandCount} exceeds style policy maximum ${target.visualStylePolicy.shadingBandCountMax}.`,
      });
    }

    if (
      typeof target.visualStylePolicy.uiRectilinearityMin === "number" &&
      visualStyleMetrics.uiRectilinearity < target.visualStylePolicy.uiRectilinearityMin
    ) {
      report.issues.push({
        level: "error",
        code: "style_policy_ui_rectilinearity_below_min",
        targetId: target.id,
        imagePath,
        message: `UI rectilinearity ${visualStyleMetrics.uiRectilinearity.toFixed(4)} is below style policy minimum ${target.visualStylePolicy.uiRectilinearityMin.toFixed(4)}.`,
      });
    }
  }

  if (inspected.hasAlphaChannel) {
    const mattingMetrics = computeMattingQualityMetrics(inspected);
    report.metrics = {
      ...report.metrics,
      mattingMaskCoverage: mattingMetrics.maskCoverage,
      mattingSemiTransparencyRatio: mattingMetrics.semiTransparencyRatio,
      mattingMaskConsistency: mattingMetrics.maskConsistency,
      mattingHiddenRgbLeak: mattingMetrics.hiddenRgbLeak,
    };

    if (
      typeof target.mattingHiddenRgbLeakMax === "number" &&
      mattingMetrics.hiddenRgbLeak > target.mattingHiddenRgbLeakMax
    ) {
      report.issues.push({
        level: "error",
        code: "matting_hidden_rgb_leak_exceeded",
        targetId: target.id,
        imagePath,
        message: `Matting hidden RGB leak ${mattingMetrics.hiddenRgbLeak.toFixed(4)} exceeds threshold ${target.mattingHiddenRgbLeakMax.toFixed(4)}.`,
      });
    }

    if (
      typeof target.mattingMaskConsistencyMin === "number" &&
      mattingMetrics.maskConsistency < target.mattingMaskConsistencyMin
    ) {
      report.issues.push({
        level: "error",
        code: "matting_mask_consistency_too_low",
        targetId: target.id,
        imagePath,
        message: `Matting mask consistency ${mattingMetrics.maskConsistency.toFixed(4)} is below threshold ${target.mattingMaskConsistencyMin.toFixed(4)}.`,
      });
    }

    if (
      typeof target.mattingSemiTransparencyRatioMax === "number" &&
      mattingMetrics.semiTransparencyRatio > target.mattingSemiTransparencyRatioMax
    ) {
      report.issues.push({
        level: "error",
        code: "matting_semi_transparency_ratio_exceeded",
        targetId: target.id,
        imagePath,
        message: `Matting semi-transparency ratio ${mattingMetrics.semiTransparencyRatio.toFixed(
          4,
        )} exceeds threshold ${target.mattingSemiTransparencyRatioMax.toFixed(4)}.`,
      });
    }
  }

  if (target.tileable || typeof target.seamThreshold === "number") {
    const seamStripPx = target.seamStripPx ?? 4;
    const seamScore = computeSeamScore(inspected, seamStripPx);
    report.metrics = {
      ...report.metrics,
      seamScore,
      seamStripPx,
    };

    const threshold = target.seamThreshold ?? 12;
    if (seamScore > threshold) {
      report.issues.push({
        level: "error",
        code: "tile_seam_exceeded",
        targetId: target.id,
        imagePath,
        message: `Seam score ${seamScore.toFixed(2)} exceeds threshold ${threshold.toFixed(2)}.`,
      });
    }
  }

  if (target.wrapGrid) {
    const columns = target.wrapGrid.columns;
    const rows = target.wrapGrid.rows;
    report.metrics = {
      ...report.metrics,
      wrapGridColumns: columns,
      wrapGridRows: rows,
    };

    if (inspected.width % columns !== 0 || inspected.height % rows !== 0) {
      report.issues.push({
        level: "error",
        code: "wrap_grid_size_mismatch",
        targetId: target.id,
        imagePath,
        message: `Image size ${inspected.width}x${inspected.height} is not divisible by wrapGrid ${columns}x${rows}.`,
      });
    } else {
      const seamStripPx = target.wrapGrid.seamStripPx ?? target.seamStripPx ?? 4;
      const seamScore = computeWrapGridSeamScore(inspected, columns, rows, seamStripPx);
      if (typeof seamScore === "number") {
        report.metrics = {
          ...report.metrics,
          wrapGridSeamScore: seamScore,
          wrapGridSeamStripPx: seamStripPx,
        };
        const threshold = target.wrapGrid.seamThreshold ?? target.seamThreshold ?? 12;
        if (seamScore > threshold) {
          report.issues.push({
            level: "error",
            code: "wrap_grid_seam_exceeded",
            targetId: target.id,
            imagePath,
            message: `Wrap-grid seam score ${seamScore.toFixed(2)} exceeds threshold ${threshold.toFixed(2)}.`,
          });
        }
      }

      const topology = target.wrapGrid.topology;
      if (topology) {
        const threshold = topology.maxMismatchRatio ?? 0;
        const colorTolerance = topology.colorTolerance ?? 0;
        const topologyResult = evaluateWrapGridTopology({
          inspected,
          columns,
          rows,
          mode: topology.mode,
          colorTolerance,
        });
        if (topologyResult) {
          report.metrics = {
            ...report.metrics,
            wrapGridTopologyComparisons: topologyResult.comparisons,
            wrapGridTopologyMismatchRatio: topologyResult.mismatchRatio,
            wrapGridTopologyThreshold: threshold,
            wrapGridTopologyColorTolerance: colorTolerance,
          };

          if (topologyResult.mismatchRatio > threshold) {
            report.issues.push({
              level: "error",
              code: resolveWrapGridTopologyIssueCode(topologyResult.mode),
              targetId: target.id,
              imagePath,
              message: `Wrap-grid topology (${topologyResult.mode}) mismatch ratio ${topologyResult.mismatchRatio.toFixed(
                4,
              )} exceeds threshold ${threshold.toFixed(4)}.`,
            });
          }
        }
      }
    }
  }

  if (target.palette?.mode === "max-colors") {
    const colors = collectDistinctColors(inspected);
    report.metrics = {
      ...report.metrics,
      distinctColors: colors.size,
    };
    const maxColors = target.palette.maxColors ?? 256;
    if (colors.size > maxColors) {
      report.issues.push({
        level: "error",
        code: "palette_max_colors_exceeded",
        targetId: target.id,
        imagePath,
        message: `Distinct colors ${colors.size} exceeds max ${maxColors}.`,
      });
    }
  }

  if (target.palette?.mode === "exact") {
    const allowed = new Set((target.palette.colors ?? []).map((color) => hexToPackedColor(color)));
    const compliance = computeExactPaletteCompliance(inspected, allowed);
    const requiredCompliance = requiredExactPaletteCompliance(target);
    report.metrics = {
      ...report.metrics,
      paletteCompliance: compliance.compliance,
      distinctColors: compliance.distinctColors,
    };

    if (compliance.compliance < requiredCompliance) {
      if (target.palette.strict === true) {
        report.issues.push({
          level: "error",
          code: "palette_strict_noncompliant",
          targetId: target.id,
          imagePath,
          message: `Strict exact palette mode requires 100% compliance, but got ${(compliance.compliance * 100).toFixed(1)}%.`,
        });
      } else {
        report.issues.push({
          level: "error",
          code: "palette_compliance_too_low",
          targetId: target.id,
          imagePath,
          message: `Palette compliance ${(compliance.compliance * 100).toFixed(1)}% is below required ${(requiredCompliance * 100).toFixed(0)}%.`,
        });
      }
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
  const runtimeTargets = params.targets.filter((target) => !target.catalogDisabled);
  const items = await Promise.all(
    runtimeTargets.map((target) => evaluateImageAcceptance(target, params.imagesDir)),
  );

  const packInvariantResult = await runPackInvariantChecks({
    targets: params.targets,
    items,
    imagesDir: params.imagesDir,
  });

  const itemByTargetId = new Map(items.map((item) => [item.targetId, item]));
  for (const targetIssue of packInvariantResult.targetIssues) {
    const item = itemByTargetId.get(targetIssue.targetId);
    if (!item) {
      continue;
    }

    item.issues.push({
      level: targetIssue.level,
      code: targetIssue.code,
      targetId: targetIssue.targetId,
      imagePath: item.imagePath,
      message: targetIssue.message,
    });
  }

  const errors = items.reduce(
    (count, item) => count + item.issues.filter((issue) => issue.level === "error").length,
    0,
  );
  const warnings = items.reduce(
    (count, item) => count + item.issues.filter((issue) => issue.level === "warning").length,
    0,
  );

  const failed = items.filter((item) =>
    item.issues.some((issue) => issue.level === "error"),
  ).length;

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
    ...(packInvariantResult.summary ? { packInvariants: packInvariantResult.summary } : {}),
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

    throw new Error(`Image acceptance failed with ${report.errors} error(s). ${examples}`.trim());
  }
}
