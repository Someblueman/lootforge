import { type ManifestPostProcess, type ManifestTarget } from "./types.js";
import {
  type NormalizedGenerationPolicy,
  type PalettePolicy,
  type PostProcessPolicy,
  type ResizeVariant,
} from "../providers/types.js";
import { normalizeOutputFormatAlias, POST_PROCESS_ALGORITHMS } from "../providers/types.js";
import { parseSize } from "../shared/image.js";

export const SUPPORTED_POST_PROCESS_ALGORITHMS = new Set(POST_PROCESS_ALGORITHMS);

export function toNormalizedGenerationPolicy(target: ManifestTarget): NormalizedGenerationPolicy {
  const outputFormat = normalizeOutputFormatAlias(target.generationPolicy?.outputFormat);
  const normalizedHiresFix = normalizeHiresFixPolicy(target.generationPolicy?.hiresFix);
  const candidates =
    typeof target.generationPolicy?.candidates === "number"
      ? Math.max(1, Math.round(target.generationPolicy.candidates))
      : 1;
  const maxRetries =
    typeof target.generationPolicy?.maxRetries === "number"
      ? Math.max(0, Math.round(target.generationPolicy.maxRetries))
      : undefined;

  return {
    size: target.generationPolicy?.size?.trim() ?? target.acceptance?.size ?? "1024x1024",
    quality: target.generationPolicy?.quality?.trim() ?? "high",
    draftQuality: target.generationPolicy?.draftQuality?.trim() ?? undefined,
    finalQuality: target.generationPolicy?.finalQuality?.trim() ?? undefined,
    background: target.generationPolicy?.background?.trim() ?? "opaque",
    outputFormat,
    ...(typeof target.generationPolicy?.highQuality === "boolean"
      ? { highQuality: target.generationPolicy.highQuality }
      : {}),
    ...(normalizedHiresFix ? { hiresFix: normalizedHiresFix } : {}),
    candidates,
    ...(typeof maxRetries === "number" ? { maxRetries } : {}),
    fallbackProviders: target.generationPolicy?.fallbackProviders ?? [],
    providerConcurrency: target.generationPolicy?.providerConcurrency,
    rateLimitPerMinute: target.generationPolicy?.rateLimitPerMinute,
    vlmGate: normalizeVlmGatePolicy(target.generationPolicy?.vlmGate),
    coarseToFine: normalizeCoarseToFinePolicy(target.generationPolicy?.coarseToFine),
    agenticRetry: normalizeAgenticRetryPolicy(target.generationPolicy?.agenticRetry),
  };
}

export function normalizeHiresFixPolicy(
  policy: NonNullable<ManifestTarget["generationPolicy"]>["hiresFix"] | undefined,
): NonNullable<NormalizedGenerationPolicy["hiresFix"]> | undefined {
  if (!policy) {
    return undefined;
  }

  const normalized: NonNullable<NormalizedGenerationPolicy["hiresFix"]> = {};

  if (typeof policy.enabled === "boolean") {
    normalized.enabled = policy.enabled;
  }
  if (typeof policy.upscale === "number" && Number.isFinite(policy.upscale)) {
    normalized.upscale = Math.max(1.01, Math.min(4, policy.upscale));
  }
  if (typeof policy.denoiseStrength === "number" && Number.isFinite(policy.denoiseStrength)) {
    normalized.denoiseStrength = Math.max(0, Math.min(1, policy.denoiseStrength));
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function normalizeVlmGatePolicy(
  policy: NonNullable<ManifestTarget["generationPolicy"]>["vlmGate"] | undefined,
): NormalizedGenerationPolicy["vlmGate"] {
  if (!policy) {
    return undefined;
  }

  const threshold =
    typeof policy.threshold === "number" && Number.isFinite(policy.threshold)
      ? Math.max(0, Math.min(5, policy.threshold))
      : 4;
  const normalized = {
    threshold,
  } as NonNullable<NormalizedGenerationPolicy["vlmGate"]>;

  if (typeof policy.rubric === "string" && policy.rubric.trim()) {
    normalized.rubric = policy.rubric.trim();
  }

  return normalized;
}

export function normalizeCoarseToFinePolicy(
  policy: NonNullable<ManifestTarget["generationPolicy"]>["coarseToFine"] | undefined,
): NormalizedGenerationPolicy["coarseToFine"] {
  if (!policy) {
    return undefined;
  }

  const promoteTopK =
    typeof policy.promoteTopK === "number" && Number.isFinite(policy.promoteTopK)
      ? Math.max(1, Math.round(policy.promoteTopK))
      : 1;
  const minDraftScore =
    typeof policy.minDraftScore === "number" && Number.isFinite(policy.minDraftScore)
      ? policy.minDraftScore
      : undefined;

  return {
    enabled: policy.enabled ?? true,
    promoteTopK,
    ...(typeof minDraftScore === "number" ? { minDraftScore } : {}),
    requireDraftAcceptance: policy.requireDraftAcceptance ?? true,
  };
}

export function normalizeAgenticRetryPolicy(
  policy: NonNullable<ManifestTarget["generationPolicy"]>["agenticRetry"] | undefined,
): NormalizedGenerationPolicy["agenticRetry"] {
  if (!policy) {
    return undefined;
  }

  const maxRetries =
    typeof policy.maxRetries === "number" && Number.isFinite(policy.maxRetries)
      ? Math.max(0, Math.round(policy.maxRetries))
      : 1;

  return {
    enabled: policy.enabled ?? true,
    maxRetries,
  };
}

export function resolvePostProcess(
  target: ManifestTarget,
  paletteOverride?: PalettePolicy,
): PostProcessPolicy | undefined {
  const postProcess = target.postProcess;
  if (!postProcess) {
    return undefined;
  }

  const resizeTo = parseResizeTo(postProcess.resizeTo, target.acceptance?.size);
  const operations = {
    ...(postProcess.operations?.trim ? { trim: postProcess.operations.trim } : {}),
    ...(postProcess.operations?.pad ? { pad: postProcess.operations.pad } : {}),
    ...(postProcess.operations?.outline ? { outline: postProcess.operations.outline } : {}),
    ...(postProcess.operations?.quantize ? { quantize: postProcess.operations.quantize } : {}),
    ...(postProcess.operations?.resizeVariants
      ? {
          resizeVariants: {
            variants: postProcess.operations.resizeVariants
              .map((variant) => parseResizeVariant(variant))
              .filter((variant): variant is ResizeVariant => variant !== null),
          },
        }
      : {}),
    ...(postProcess.operations?.pixelPerfect
      ? {
          pixelPerfect: normalizePixelPerfectOperation(postProcess.operations.pixelPerfect),
        }
      : {}),
    ...(postProcess.operations?.smartCrop
      ? {
          smartCrop: normalizeSmartCropOperation(postProcess.operations.smartCrop),
        }
      : {}),
    ...(postProcess.operations?.emitVariants
      ? {
          emitVariants: normalizeEmitVariantsOperation(postProcess.operations.emitVariants),
        }
      : {}),
  };

  const normalizedPalette = paletteOverride ?? normalizePalettePolicyFromTarget(target);
  const paletteColors =
    normalizedPalette?.mode === "max-colors"
      ? normalizedPalette.maxColors
      : normalizedPalette?.mode === "exact"
        ? normalizedPalette.colors?.length
        : undefined;

  if (typeof paletteColors === "number" && !operations.quantize) {
    operations.quantize = {
      colors: Math.max(2, Math.min(256, Math.round(paletteColors))),
      dither: normalizedPalette?.dither,
    };
  }

  return {
    ...(resizeTo ? { resizeTo } : {}),
    algorithm: resolvePostProcessAlgorithm(postProcess.algorithm),
    stripMetadata: postProcess.stripMetadata ?? true,
    pngPaletteColors: postProcess.pngPaletteColors,
    ...(Object.keys(operations).length > 0 ? { operations } : {}),
  };
}

export function resolvePostProcessAlgorithm(value: string | undefined): "nearest" | "lanczos3" {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "nearest") {
    return "nearest";
  }
  return "lanczos3";
}

export function normalizePixelPerfectOperation(operation: { enabled?: boolean; scale?: number }): {
  enabled?: boolean;
  scale?: number;
} {
  return {
    enabled: operation.enabled ?? true,
    ...(typeof operation.scale === "number" && Number.isFinite(operation.scale)
      ? { scale: Math.max(1, Math.round(operation.scale)) }
      : {}),
  };
}

export function normalizeSmartCropOperation(operation: {
  enabled?: boolean;
  mode?: "alpha-bounds" | "center";
  padding?: number;
}): {
  enabled?: boolean;
  mode?: "alpha-bounds" | "center";
  padding?: number;
} {
  return {
    enabled: operation.enabled ?? true,
    mode: operation.mode ?? "alpha-bounds",
    ...(typeof operation.padding === "number" && Number.isFinite(operation.padding)
      ? { padding: Math.max(0, Math.round(operation.padding)) }
      : {}),
  };
}

export function normalizeEmitVariantsOperation(operation: {
  raw?: boolean;
  pixel?: boolean;
  styleRef?: boolean;
  layerColor?: boolean;
  layerMatte?: boolean;
}): {
  raw?: boolean;
  pixel?: boolean;
  styleRef?: boolean;
  layerColor?: boolean;
  layerMatte?: boolean;
} {
  return {
    ...(typeof operation.raw === "boolean" ? { raw: operation.raw } : {}),
    ...(typeof operation.pixel === "boolean" ? { pixel: operation.pixel } : {}),
    ...(typeof operation.styleRef === "boolean" ? { styleRef: operation.styleRef } : {}),
    ...(typeof operation.layerColor === "boolean" ? { layerColor: operation.layerColor } : {}),
    ...(typeof operation.layerMatte === "boolean" ? { layerMatte: operation.layerMatte } : {}),
  };
}

export function parseResizeVariant(variant: {
  name: string;
  size: string;
  algorithm?: string;
}): ResizeVariant | null {
  const parsedSize = parseSize(variant.size);
  if (!parsedSize) {
    return null;
  }

  return {
    name: variant.name.trim(),
    width: parsedSize.width,
    height: parsedSize.height,
    algorithm: resolvePostProcessAlgorithm(variant.algorithm),
  };
}

export function parseResizeTo(
  resizeTo: ManifestPostProcess["resizeTo"],
  fallbackSize?: string,
): { width: number; height: number } | undefined {
  if (typeof resizeTo === "number" && Number.isFinite(resizeTo) && resizeTo > 0) {
    const rounded = Math.max(1, Math.round(resizeTo));
    return { width: rounded, height: rounded };
  }

  if (typeof resizeTo === "string") {
    const parsed = parseSize(resizeTo);
    if (parsed) {
      return parsed;
    }
  }

  if (fallbackSize) {
    return parseSize(fallbackSize);
  }

  return undefined;
}

// Internal helper used only by resolvePostProcess to avoid circular dependency
// with normalize-palette.ts. The full normalizePalettePolicy lives in normalize-palette.ts.
function normalizePalettePolicyFromTarget(target: ManifestTarget): PalettePolicy | undefined {
  const palette = target.palette;
  if (!palette) {
    return undefined;
  }

  if (palette.mode === "exact") {
    return {
      mode: "exact",
      colors: (palette.colors ?? []).map((color) => normalizeHexColorInline(color)),
      dither: palette.dither,
      strict: palette.strict,
    };
  }

  return {
    mode: "max-colors",
    maxColors: palette.maxColors,
    dither: palette.dither,
  };
}

function normalizeHexColorInline(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith("#")) {
    return trimmed.toLowerCase();
  }
  return `#${trimmed.toLowerCase()}`;
}
