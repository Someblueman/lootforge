import path from "node:path";

import { ZodIssue } from "zod";

import {
  buildStructuredPrompt,
  getProviderCapabilities,
  getTargetGenerationPolicy,
  nowIso,
  normalizeGenerationPolicyForProvider,
  normalizeOutputFormatAlias,
  POST_PROCESS_ALGORITHMS,
} from "../providers/types.js";
import type {
  PostProcessAlgorithm,
  PostProcessPolicy,
  PlannedTarget,
  PromptSpec,
  ProviderName,
  ResizeVariant,
} from "../providers/types.js";
import { safeParseManifestV2 } from "./schema.js";
import type {
  ManifestAtlasGroupOptions,
  ManifestPostProcess,
  ManifestTarget,
  ManifestV2,
  ManifestValidationResult,
  PlanArtifacts,
  PlannedProviderJobSpec,
  ValidationIssue,
  ManifestSource,
} from "./types.js";

const SIZE_PATTERN = /^\d+x\d+$/i;
const SUPPORTED_POST_PROCESS_ALGORITHMS = new Set(POST_PROCESS_ALGORITHMS);

export interface ValidateManifestOptions {
  now?: () => Date;
}

export function validateManifestSource(
  source: ManifestSource,
  options: ValidateManifestOptions = {},
): ManifestValidationResult {
  const issues: ValidationIssue[] = [];
  const parsed = safeParseManifestV2(source.data);
  let manifest: ManifestV2 | undefined;

  if (!parsed.success) {
    issues.push(...parsed.error.issues.map(toSchemaValidationIssue));
  } else {
    manifest = parsed.data as ManifestV2;
    issues.push(...collectSemanticIssues(manifest));
  }

  const errors = issues.filter((issue) => issue.level === "error").length;
  const warnings = issues.filter((issue) => issue.level === "warning").length;

  return {
    manifest,
    report: {
      manifestPath: source.manifestPath,
      generatedAt: nowIso(options.now),
      ok: errors === 0,
      errors,
      warnings,
      targetCount: manifest?.targets.length ?? 0,
      issues,
    },
  };
}

export function normalizeManifestTargets(manifest: ManifestV2): PlannedTarget[] {
  const defaultProvider = manifest.providers?.default ?? "openai";

  return manifest.targets.map((target) =>
    normalizeTargetForGeneration(manifest, target, defaultProvider),
  );
}

export function createPlanArtifacts(
  manifest: ManifestV2,
  manifestPath: string,
  now?: () => Date,
): PlanArtifacts {
  const targets = normalizeManifestTargets(manifest);
  const openaiJobs: PlannedProviderJobSpec[] = [];
  const nanoJobs: PlannedProviderJobSpec[] = [];
  const localJobs: PlannedProviderJobSpec[] = [];

  for (const target of targets) {
    const provider = target.provider ?? "openai";
    const row = toProviderJobSpec(target, provider);
    if (provider === "openai") {
      openaiJobs.push(row);
    } else if (provider === "nano") {
      nanoJobs.push(row);
    } else {
      localJobs.push(row);
    }
  }

  return {
    targets,
    targetsIndex: {
      generatedAt: nowIso(now),
      manifestPath,
      targets,
    },
    openaiJobs,
    nanoJobs,
    localJobs,
  };
}

function collectSemanticIssues(manifest: ManifestV2): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seenIds = new Set<string>();
  const seenOutPaths = new Set<string>();
  const defaultProvider = manifest.providers?.default ?? "openai";

  validateAtlasOptions(manifest.atlas, issues);

  manifest.targets.forEach((target, index) => {
    const id = target.id.trim();
    const out = target.out.trim();

    if (seenIds.has(id)) {
      issues.push({
        level: "error",
        code: "duplicate_target_id",
        path: `targets[${index}].id`,
        message: `Duplicate target id \"${id}\".`,
      });
    } else {
      seenIds.add(id);
    }

    if (seenOutPaths.has(out)) {
      issues.push({
        level: "error",
        code: "duplicate_target_out",
        path: `targets[${index}].out`,
        message: `Duplicate output path \"${out}\".`,
      });
    } else {
      seenOutPaths.add(out);
    }

    const policySize = target.generationPolicy?.size ?? target.acceptance?.size;
    if (policySize && !SIZE_PATTERN.test(policySize)) {
      issues.push({
        level: "error",
        code: "invalid_size",
        path: `targets[${index}].generationPolicy.size`,
        message: `Size \"${policySize}\" must match WIDTHxHEIGHT.`,
      });
    }

    if (typeof target.postProcess?.resizeTo === "string") {
      if (!SIZE_PATTERN.test(target.postProcess.resizeTo)) {
        issues.push({
          level: "error",
          code: "invalid_postprocess_resize",
          path: `targets[${index}].postProcess.resizeTo`,
          message: `postProcess.resizeTo \"${target.postProcess.resizeTo}\" must match WIDTHxHEIGHT.`,
        });
      }
    }

    for (const [variantIndex, variant] of (target.postProcess?.operations?.resizeVariants ?? []).entries()) {
      if (!SIZE_PATTERN.test(variant.size)) {
        issues.push({
          level: "error",
          code: "invalid_resize_variant_size",
          path: `targets[${index}].postProcess.operations.resizeVariants[${variantIndex}].size`,
          message: `resize variant size \"${variant.size}\" must match WIDTHxHEIGHT.`,
        });
      }
    }

    const algorithm = target.postProcess?.algorithm?.trim().toLowerCase();
    if (algorithm && !SUPPORTED_POST_PROCESS_ALGORITHMS.has(algorithm as PostProcessAlgorithm)) {
      issues.push({
        level: "warning",
        code: "unusual_postprocess_algorithm",
        path: `targets[${index}].postProcess.algorithm`,
        message: `postProcess.algorithm \"${target.postProcess?.algorithm}\" is not officially supported. Use nearest or lanczos3.`,
      });
    }

    const provider = target.provider ?? defaultProvider;
    const normalized = normalizeGenerationPolicyForProvider(
      provider,
      toNormalizedGenerationPolicy(target),
    );

    for (const issue of normalized.issues) {
      issues.push({
        level: issue.level,
        code: issue.code,
        path: `targets[${index}].generationPolicy`,
        message: issue.message,
      });
    }

    const alphaRequired =
      target.runtimeSpec?.alphaRequired === true || target.acceptance?.alpha === true;
    const capabilities = getProviderCapabilities(provider);
    if (alphaRequired && !capabilities.supportsTransparentBackground) {
      issues.push({
        level: "error",
        code: "provider_alpha_incompatible",
        path: `targets[${index}].provider`,
        message: `Target requires alpha, but provider \"${provider}\" does not guarantee transparent output.`,
      });
    }

    const outputFormat = normalizeOutputFormatAlias(
      target.generationPolicy?.outputFormat ?? path.extname(target.out).replace(".", ""),
    );
    if (alphaRequired && outputFormat === "jpeg") {
      issues.push({
        level: "error",
        code: "alpha_requires_png_or_webp",
        path: `targets[${index}].generationPolicy.outputFormat`,
        message: "Alpha-required targets must use png or webp output formats.",
      });
    }
  });

  return issues;
}

function normalizeTargetForGeneration(
  manifest: ManifestV2,
  target: ManifestTarget,
  defaultProvider: ProviderName,
): PlannedTarget {
  const provider = target.provider ?? defaultProvider;
  const model = resolveTargetModel(manifest, target, provider);
  const atlasGroup = target.atlasGroup?.trim() || null;
  const defaultStylePreset = resolveManifestStylePreset(manifest);

  const promptSpec = normalizePromptSpec(target, defaultStylePreset);
  const rawPolicy = toNormalizedGenerationPolicy(target);
  const normalizedPolicy = normalizeGenerationPolicyForProvider(provider, rawPolicy);
  const policyErrors = normalizedPolicy.issues.filter((issue) => issue.level === "error");

  if (policyErrors.length > 0) {
    throw new Error(
      `Invalid generation policy for target \"${target.id}\": ${policyErrors
        .map((issue) => issue.message)
        .join(" ")}`,
    );
  }

  const normalized: PlannedTarget = {
    id: target.id.trim(),
    kind: target.kind.trim(),
    out: target.out.trim(),
    atlasGroup,
    acceptance: {
      ...(target.acceptance?.size ? { size: target.acceptance.size.trim() } : {}),
      ...(typeof target.acceptance?.alpha === "boolean"
        ? { alpha: target.acceptance.alpha }
        : {}),
      ...(typeof target.acceptance?.maxFileSizeKB === "number"
        ? { maxFileSizeKB: target.acceptance.maxFileSizeKB }
        : {}),
    },
    runtimeSpec: {
      ...(typeof target.runtimeSpec?.alphaRequired === "boolean"
        ? { alphaRequired: target.runtimeSpec.alphaRequired }
        : {}),
      ...(typeof target.runtimeSpec?.previewWidth === "number"
        ? { previewWidth: target.runtimeSpec.previewWidth }
        : {}),
      ...(typeof target.runtimeSpec?.previewHeight === "number"
        ? { previewHeight: target.runtimeSpec.previewHeight }
        : {}),
    },
    provider,
    promptSpec,
    generationPolicy: normalizedPolicy.policy,
    postProcess: resolvePostProcess(target),
    ...(target.edit ? { edit: target.edit } : {}),
    ...(target.auxiliaryMaps ? { auxiliaryMaps: target.auxiliaryMaps } : {}),
  };

  if (model) {
    normalized.model = model;
  }

  return normalized;
}

function normalizePromptSpec(
  target: ManifestTarget,
  defaultStylePreset: string | undefined,
): PromptSpec {
  if (target.promptSpec) {
    return trimPromptSpec(target.promptSpec, defaultStylePreset);
  }

  if (typeof target.prompt === "string") {
    return {
      primary: target.prompt.trim(),
      ...(defaultStylePreset ? { stylePreset: defaultStylePreset } : {}),
    };
  }

  if (target.prompt && typeof target.prompt === "object") {
    return trimPromptSpec(target.prompt, defaultStylePreset);
  }

  throw new Error(`Target \"${target.id}\" has no prompt content.`);
}

function trimPromptSpec(
  promptSpec: PromptSpec,
  defaultStylePreset: string | undefined,
): PromptSpec {
  return {
    primary: promptSpec.primary.trim(),
    ...(promptSpec.useCase ? { useCase: promptSpec.useCase.trim() } : {}),
    ...(promptSpec.stylePreset
      ? { stylePreset: promptSpec.stylePreset.trim() }
      : defaultStylePreset
        ? { stylePreset: defaultStylePreset }
        : {}),
    ...(promptSpec.scene ? { scene: promptSpec.scene.trim() } : {}),
    ...(promptSpec.subject ? { subject: promptSpec.subject.trim() } : {}),
    ...(promptSpec.style ? { style: promptSpec.style.trim() } : {}),
    ...(promptSpec.composition ? { composition: promptSpec.composition.trim() } : {}),
    ...(promptSpec.lighting ? { lighting: promptSpec.lighting.trim() } : {}),
    ...(promptSpec.palette ? { palette: promptSpec.palette.trim() } : {}),
    ...(promptSpec.materials ? { materials: promptSpec.materials.trim() } : {}),
    ...(promptSpec.constraints ? { constraints: promptSpec.constraints.trim() } : {}),
    ...(promptSpec.negative ? { negative: promptSpec.negative.trim() } : {}),
  };
}

function resolveManifestStylePreset(manifest: ManifestV2): string | undefined {
  const rawPreset = manifest.styleGuide?.preset;
  if (typeof rawPreset !== "string") {
    return undefined;
  }
  const trimmed = rawPreset.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolvePostProcess(target: ManifestTarget): PostProcessPolicy {
  const explicitResize = normalizePostProcessResize(target.postProcess?.resizeTo);
  const runtimeResize = deriveResizeFromRuntimeSpec(target);
  const resizeTo = explicitResize ?? runtimeResize;
  const algorithm = resolvePostProcessAlgorithm(target.postProcess?.algorithm, target);
  const stripMetadata =
    typeof target.postProcess?.stripMetadata === "boolean"
      ? target.postProcess.stripMetadata
      : true;
  const pngPaletteColors =
    typeof target.postProcess?.pngPaletteColors === "number"
      ? target.postProcess.pngPaletteColors
      : undefined;

  const operations = normalizePostProcessOperations(target.postProcess);

  return {
    ...(resizeTo ? { resizeTo } : {}),
    algorithm,
    stripMetadata,
    ...(typeof pngPaletteColors === "number" ? { pngPaletteColors } : {}),
    ...(operations ? { operations } : {}),
  };
}

function normalizePostProcessOperations(
  postProcess: ManifestPostProcess | undefined,
): PostProcessPolicy["operations"] | undefined {
  if (!postProcess?.operations && !postProcess?.pngPaletteColors) {
    return undefined;
  }

  const operations: NonNullable<PostProcessPolicy["operations"]> = {};

  if (postProcess.operations?.trim) {
    operations.trim = {
      enabled: postProcess.operations.trim.enabled,
      threshold: postProcess.operations.trim.threshold,
    };
  }

  if (postProcess.operations?.pad) {
    operations.pad = {
      pixels: Math.max(0, Math.round(postProcess.operations.pad.pixels)),
      extrude: postProcess.operations.pad.extrude,
      background: postProcess.operations.pad.background,
    };
  }

  const quantizeColors =
    postProcess.operations?.quantize?.colors ?? postProcess.pngPaletteColors;
  if (typeof quantizeColors === "number") {
    operations.quantize = {
      colors: Math.max(2, Math.min(256, Math.round(quantizeColors))),
      dither: postProcess.operations?.quantize?.dither,
    };
  }

  if (postProcess.operations?.outline) {
    operations.outline = {
      size: Math.max(1, Math.round(postProcess.operations.outline.size)),
      color: postProcess.operations.outline.color,
    };
  }

  const resizeVariants = (postProcess.operations?.resizeVariants ?? [])
    .map(toResizeVariant)
    .filter((variant): variant is ResizeVariant => variant !== undefined);
  if (resizeVariants.length > 0) {
    operations.resizeVariants = { variants: resizeVariants };
  }

  if (Object.keys(operations).length === 0) {
    return undefined;
  }

  return operations;
}

function toResizeVariant(variant: { name: string; size: string; algorithm?: string }): ResizeVariant | undefined {
  const parsedSize = parseSizeLiteral(variant.size);
  if (!parsedSize) {
    return undefined;
  }

  return {
    name: variant.name.trim(),
    width: parsedSize.width,
    height: parsedSize.height,
    algorithm: resolveResizeVariantAlgorithm(variant.algorithm),
  };
}

function resolveResizeVariantAlgorithm(value: string | undefined): PostProcessAlgorithm {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized &&
    SUPPORTED_POST_PROCESS_ALGORITHMS.has(normalized as PostProcessAlgorithm)
  ) {
    return normalized as PostProcessAlgorithm;
  }
  return "lanczos3";
}

function resolvePostProcessAlgorithm(
  value: string | undefined,
  target: ManifestTarget,
): PostProcessAlgorithm {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized &&
    SUPPORTED_POST_PROCESS_ALGORITHMS.has(normalized as PostProcessAlgorithm)
  ) {
    return normalized as PostProcessAlgorithm;
  }

  if (resolvePromptStylePreset(target) === "pixel-art-16bit") {
    return "nearest";
  }

  return "lanczos3";
}

function resolvePromptStylePreset(target: ManifestTarget): string | undefined {
  if (target.promptSpec?.stylePreset?.trim()) {
    return target.promptSpec.stylePreset.trim();
  }

  if (target.prompt && typeof target.prompt === "object") {
    const prompt = target.prompt as PromptSpec;
    if (prompt.stylePreset?.trim()) {
      return prompt.stylePreset.trim();
    }
  }

  return undefined;
}

function normalizePostProcessResize(
  value: string | number | undefined,
): { width: number; height: number } | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const edge = Math.round(value);
    return { width: edge, height: edge };
  }

  if (typeof value === "string") {
    return parseSizeLiteral(value);
  }

  return undefined;
}

function deriveResizeFromRuntimeSpec(
  target: ManifestTarget,
): { width: number; height: number } | undefined {
  const previewWidth = target.runtimeSpec?.previewWidth;
  const previewHeight = target.runtimeSpec?.previewHeight;
  if (
    typeof previewWidth !== "number" ||
    typeof previewHeight !== "number" ||
    !Number.isFinite(previewWidth) ||
    !Number.isFinite(previewHeight)
  ) {
    return undefined;
  }

  const acceptance = parseSizeLiteral(target.acceptance?.size);
  if (!acceptance) {
    return undefined;
  }

  const derivedWidth = Math.min(acceptance.width, Math.round(previewWidth * 2));
  const derivedHeight = Math.min(acceptance.height, Math.round(previewHeight * 2));

  if (
    derivedWidth <= 0 ||
    derivedHeight <= 0 ||
    (derivedWidth === acceptance.width && derivedHeight === acceptance.height)
  ) {
    return undefined;
  }

  return { width: derivedWidth, height: derivedHeight };
}

function parseSizeLiteral(
  value: string | undefined,
): { width: number; height: number } | undefined {
  if (!value) {
    return undefined;
  }
  const match = /^(\d+)x(\d+)$/i.exec(value.trim());
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

function toNormalizedGenerationPolicy(target: ManifestTarget) {
  return {
    size: resolveSize(target),
    quality: resolveQuality(target),
    background: resolveBackground(target),
    outputFormat: normalizeOutputFormatAlias(resolveOutputFormat(target)),
    candidates:
      typeof target.generationPolicy?.candidates === "number"
        ? target.generationPolicy.candidates
        : 1,
    maxRetries:
      typeof target.generationPolicy?.maxRetries === "number"
        ? target.generationPolicy.maxRetries
        : 1,
    fallbackProviders: target.generationPolicy?.fallbackProviders ?? [],
    providerConcurrency: target.generationPolicy?.providerConcurrency,
    rateLimitPerMinute: target.generationPolicy?.rateLimitPerMinute,
  };
}

function resolveSize(target: ManifestTarget): string {
  return firstNonEmpty(
    target.generationPolicy?.size,
    target.acceptance?.size,
    "1024x1024",
  );
}

function resolveQuality(target: ManifestTarget): string {
  return firstNonEmpty(
    target.generationPolicy?.quality,
    target.generationPolicy?.finalQuality,
    "high",
  );
}

function resolveBackground(target: ManifestTarget): string {
  const policyBackground = target.generationPolicy?.background?.trim();
  if (policyBackground) {
    return policyBackground;
  }

  if (target.acceptance?.alpha === true || target.runtimeSpec?.alphaRequired === true) {
    return "transparent";
  }

  return "opaque";
}

function resolveOutputFormat(target: ManifestTarget): string {
  const policyFormat = target.generationPolicy?.outputFormat?.trim();
  if (policyFormat) {
    return policyFormat.toLowerCase();
  }

  const ext = path.extname(target.out).replace(".", "").trim().toLowerCase();
  return ext || "png";
}

function resolveTargetModel(
  manifest: ManifestV2,
  target: ManifestTarget,
  provider: ProviderName,
): string | undefined {
  if (target.model && target.model.trim()) {
    return target.model.trim();
  }

  if (provider === "openai") {
    return manifest.providers?.openai?.model?.trim() || undefined;
  }
  if (provider === "nano") {
    return manifest.providers?.nano?.model?.trim() || undefined;
  }

  return manifest.providers?.local?.model?.trim() || undefined;
}

function toProviderJobSpec(
  target: PlannedTarget,
  provider: ProviderName,
): PlannedProviderJobSpec {
  const row: PlannedProviderJobSpec = {
    targetId: target.id,
    out: target.out,
    provider,
    prompt: buildStructuredPrompt(target.promptSpec),
    promptSpec: target.promptSpec,
    generationPolicy: getTargetGenerationPolicy(target),
    ...(target.postProcess ? { postProcess: target.postProcess } : {}),
  };

  if (target.model) {
    row.model = target.model;
  }

  return row;
}

function toSchemaValidationIssue(issue: ZodIssue): ValidationIssue {
  return {
    level: "error",
    code: `schema_${issue.code}`,
    path: formatIssuePath(issue.path),
    message: issue.message,
  };
}

function validateAtlasOptions(
  atlas: ManifestV2["atlas"],
  issues: ValidationIssue[],
): void {
  if (!atlas) {
    return;
  }

  validateAtlasGroupOptions("atlas", atlas, issues);

  for (const [groupId, groupOptions] of Object.entries(atlas.groups ?? {})) {
    validateAtlasGroupOptions(`atlas.groups.${groupId}`, groupOptions, issues);
  }
}

function validateAtlasGroupOptions(
  pathPrefix: string,
  options: ManifestAtlasGroupOptions,
  issues: ValidationIssue[],
): void {
  if (typeof options.padding === "number" && options.padding < 0) {
    issues.push({
      level: "error",
      code: "invalid_atlas_padding",
      path: `${pathPrefix}.padding`,
      message: "atlas padding must be >= 0",
    });
  }

  if (typeof options.bleed === "number" && options.bleed < 0) {
    issues.push({
      level: "error",
      code: "invalid_atlas_bleed",
      path: `${pathPrefix}.bleed`,
      message: "atlas bleed must be >= 0",
    });
  }
}

function formatIssuePath(pathItems: Array<string | number>): string {
  if (pathItems.length === 0) {
    return "$";
  }

  return pathItems
    .map((item, index) => {
      if (typeof item === "number") {
        return `[${item}]`;
      }
      return index === 0 ? item : `.${item}`;
    })
    .join("");
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (value && value.trim()) {
      return value.trim();
    }
  }

  return "";
}
