import path from "node:path";

import { ZodIssue } from "zod";

import {
  buildStructuredPrompt,
  normalizeGenerationPolicyForProvider,
  normalizeOutputFormatAlias,
  nowIso,
  parseProviderSelection,
  PlannedTarget,
  PostProcessPolicy,
  POST_PROCESS_ALGORITHMS,
  PromptSpec,
  ProviderName,
} from "../providers/types.js";
import type {
  NormalizedGenerationPolicy,
  PalettePolicy,
  ResizeVariant,
} from "../providers/types.js";
import { safeParseManifestV2 } from "./schema.js";
import type {
  ManifestEvaluationProfile,
  ManifestPostProcess,
  ManifestSource,
  ManifestTarget,
  ManifestV2,
  ManifestValidationResult,
  PlanArtifacts,
  PlannedProviderJobSpec,
  ValidationIssue,
} from "./types.js";

const SIZE_PATTERN = /^(\d+)x(\d+)$/i;
const HEX_COLOR_PATTERN = /^#?[0-9a-fA-F]{6}$/;
const SUPPORTED_POST_PROCESS_ALGORITHMS = new Set(POST_PROCESS_ALGORITHMS);
const DEFAULT_STYLE_USE_CASE = "game-asset";

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
  const styleKitById = new Map(manifest.styleKits.map((kit) => [kit.id, kit]));
  const evaluationById = new Map(
    manifest.evaluationProfiles.map((profile) => [profile.id, profile]),
  );

  const targets: PlannedTarget[] = [];

  for (const target of manifest.targets) {
    const styleKit = styleKitById.get(target.styleKitId);
    const evalProfile = evaluationById.get(target.evaluationProfileId);

    if (!styleKit) {
      throw new Error(
        `Target "${target.id}" references missing styleKitId "${target.styleKitId}".`,
      );
    }

    if (!evalProfile) {
      throw new Error(
        `Target "${target.id}" references missing evaluationProfileId "${target.evaluationProfileId}".`,
      );
    }

    if (target.kind === "spritesheet") {
      const expanded = expandSpritesheetTarget({
        manifest,
        target,
        defaultProvider,
        styleKit,
        evalProfile,
      });
      targets.push(...expanded);
      continue;
    }

    targets.push(
      normalizeTargetForGeneration({
        manifest,
        target,
        defaultProvider,
        styleKit,
        evalProfile,
      }),
    );
  }

  return targets;
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
    if (target.generationDisabled) {
      continue;
    }

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
  const seenTargetIds = new Set<string>();
  const seenOutPaths = new Set<string>();

  const styleKitIds = new Set<string>();
  manifest.styleKits.forEach((kit, index) => {
    if (styleKitIds.has(kit.id)) {
      issues.push({
        level: "error",
        code: "duplicate_style_kit_id",
        path: `styleKits[${index}].id`,
        message: `Duplicate style kit id "${kit.id}".`,
      });
    } else {
      styleKitIds.add(kit.id);
    }
  });

  const evaluationProfileIds = new Set<string>();
  manifest.evaluationProfiles.forEach((profile, index) => {
    if (evaluationProfileIds.has(profile.id)) {
      issues.push({
        level: "error",
        code: "duplicate_evaluation_profile_id",
        path: `evaluationProfiles[${index}].id`,
        message: `Duplicate evaluation profile id "${profile.id}".`,
      });
    } else {
      evaluationProfileIds.add(profile.id);
    }
  });

  const defaultProvider = manifest.providers?.default ?? "openai";

  manifest.targets.forEach((target, index) => {
    const id = target.id.trim();
    const out = target.out.trim();

    if (seenTargetIds.has(id)) {
      issues.push({
        level: "error",
        code: "duplicate_target_id",
        path: `targets[${index}].id`,
        message: `Duplicate target id "${id}".`,
      });
    } else {
      seenTargetIds.add(id);
    }

    if (seenOutPaths.has(out)) {
      issues.push({
        level: "error",
        code: "duplicate_target_out",
        path: `targets[${index}].out`,
        message: `Duplicate output path "${out}".`,
      });
    } else {
      seenOutPaths.add(out);
    }

    if (!styleKitIds.has(target.styleKitId)) {
      issues.push({
        level: "error",
        code: "missing_style_kit",
        path: `targets[${index}].styleKitId`,
        message: `Unknown style kit "${target.styleKitId}".`,
      });
    }

    if (!evaluationProfileIds.has(target.evaluationProfileId)) {
      issues.push({
        level: "error",
        code: "missing_evaluation_profile",
        path: `targets[${index}].evaluationProfileId`,
        message: `Unknown evaluation profile "${target.evaluationProfileId}".`,
      });
    }

    const policySize = target.generationPolicy?.size ?? target.acceptance?.size;
    if (policySize && !SIZE_PATTERN.test(policySize)) {
      issues.push({
        level: "error",
        code: "invalid_size",
        path: `targets[${index}].generationPolicy.size`,
        message: `Size "${policySize}" must match WIDTHxHEIGHT.`,
      });
    }

    if (typeof target.postProcess?.resizeTo === "string" && !SIZE_PATTERN.test(target.postProcess.resizeTo)) {
      issues.push({
        level: "error",
        code: "invalid_postprocess_resize",
        path: `targets[${index}].postProcess.resizeTo`,
        message: `postProcess.resizeTo "${target.postProcess.resizeTo}" must match WIDTHxHEIGHT.`,
      });
    }

    for (const [variantIndex, variant] of (
      target.postProcess?.operations?.resizeVariants ?? []
    ).entries()) {
      if (!SIZE_PATTERN.test(variant.size)) {
        issues.push({
          level: "error",
          code: "invalid_resize_variant_size",
          path: `targets[${index}].postProcess.operations.resizeVariants[${variantIndex}].size`,
          message: `resize variant size "${variant.size}" must match WIDTHxHEIGHT.`,
        });
      }
    }

    const algorithm = target.postProcess?.algorithm?.trim().toLowerCase();
    if (algorithm && !SUPPORTED_POST_PROCESS_ALGORITHMS.has(algorithm as "nearest" | "lanczos3")) {
      issues.push({
        level: "warning",
        code: "unusual_postprocess_algorithm",
        path: `targets[${index}].postProcess.algorithm`,
        message: `postProcess.algorithm "${target.postProcess?.algorithm}" is not officially supported. Use nearest or lanczos3.`,
      });
    }

    if (target.palette?.mode === "exact") {
      for (const [colorIndex, color] of (target.palette.colors ?? []).entries()) {
        if (!HEX_COLOR_PATTERN.test(color.trim())) {
          issues.push({
            level: "error",
            code: "invalid_palette_color",
            path: `targets[${index}].palette.colors[${colorIndex}]`,
            message: `Palette color "${color}" must be a 6-digit hex string.`,
          });
        }
      }
    }

    if (target.tileable && typeof target.seamThreshold !== "number") {
      issues.push({
        level: "warning",
        code: "tile_without_seam_threshold",
        path: `targets[${index}].seamThreshold`,
        message: "Tileable targets should define seamThreshold for deterministic acceptance.",
      });
    }

    if (target.generationMode === "edit-first" && (!target.edit || !target.edit.inputs?.length)) {
      issues.push({
        level: "warning",
        code: "edit_mode_without_inputs",
        path: `targets[${index}].edit`,
        message: "generationMode=edit-first should include edit inputs for reliable consistency.",
      });
    }

    if (target.kind === "spritesheet") {
      const animationEntries = Object.entries(target.animations ?? {});
      if (animationEntries.length === 0) {
        issues.push({
          level: "error",
          code: "spritesheet_missing_animations",
          path: `targets[${index}].animations`,
          message: "spritesheet targets require animations.",
        });
      }
      for (const [animationName, animation] of animationEntries) {
        if (!animation.prompt) {
          issues.push({
            level: "error",
            code: "spritesheet_animation_missing_prompt",
            path: `targets[${index}].animations.${animationName}.prompt`,
            message: "Each spritesheet animation requires a prompt.",
          });
        }
      }
    } else if (target.prompt === undefined && target.promptSpec === undefined) {
      issues.push({
        level: "error",
        code: "missing_prompt",
        path: `targets[${index}].prompt`,
        message: "Each non-spritesheet target requires prompt or promptSpec.",
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

    const outputFormat = normalizeOutputFormatAlias(
      target.generationPolicy?.outputFormat ?? path.extname(target.out).replace(".", ""),
    );
    const alphaRequired = target.runtimeSpec?.alphaRequired === true || target.acceptance?.alpha === true;
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

function normalizeTargetForGeneration(params: {
  manifest: ManifestV2;
  target: ManifestTarget;
  defaultProvider: ProviderName;
  styleKit: ManifestV2["styleKits"][number];
  evalProfile: ManifestEvaluationProfile;
  promptOverride?: PromptSpec;
  idOverride?: string;
  outOverride?: string;
  spritesheet?: PlannedTarget["spritesheet"];
  generationDisabled?: boolean;
  catalogDisabled?: boolean;
}): PlannedTarget {
  const provider = params.target.provider ?? params.defaultProvider;
  const model = resolveTargetModel(params.manifest, params.target, provider);
  const atlasGroup = params.target.atlasGroup?.trim() || null;
  const promptSpec =
    params.promptOverride ??
    mergeStyleKitPrompt({
      promptSpec: normalizePromptSpecFromTarget(params.target),
      styleKit: params.styleKit,
      consistencyGroup: params.target.consistencyGroup,
    });

  const normalizedPolicy = normalizeGenerationPolicyForProvider(
    provider,
    toNormalizedGenerationPolicy(params.target),
  );
  const policyErrors = normalizedPolicy.issues.filter((issue) => issue.level === "error");
  if (policyErrors.length > 0) {
    throw new Error(
      `Invalid generation policy for target "${params.target.id}": ${policyErrors
        .map((issue) => issue.message)
        .join(" ")}`,
    );
  }

  const acceptance = {
    ...(params.target.acceptance?.size ? { size: params.target.acceptance.size.trim() } : {}),
    alpha:
      params.target.acceptance?.alpha ?? params.evalProfile.hardGates?.requireAlpha ?? false,
    maxFileSizeKB:
      params.target.acceptance?.maxFileSizeKB ?? params.evalProfile.hardGates?.maxFileSizeKB,
  };

  const normalized: PlannedTarget = {
    id: params.idOverride ?? params.target.id.trim(),
    kind: params.target.kind.trim(),
    out: params.outOverride ?? params.target.out.trim(),
    atlasGroup,
    styleKitId: params.target.styleKitId,
    consistencyGroup: params.target.consistencyGroup,
    generationMode: params.target.generationMode ?? "text",
    evaluationProfileId: params.target.evaluationProfileId,
    scoringProfile: params.target.scoringProfile ?? params.target.evaluationProfileId,
    tileable: params.target.tileable,
    seamThreshold:
      params.target.seamThreshold ?? params.evalProfile.hardGates?.seamThreshold,
    seamStripPx: params.target.seamStripPx ?? params.evalProfile.hardGates?.seamStripPx,
    palette: normalizePalettePolicy(params.target),
    acceptance,
    runtimeSpec: {
      ...(typeof params.target.runtimeSpec?.alphaRequired === "boolean"
        ? { alphaRequired: params.target.runtimeSpec.alphaRequired }
        : {}),
      ...(typeof params.target.runtimeSpec?.previewWidth === "number"
        ? { previewWidth: params.target.runtimeSpec.previewWidth }
        : {}),
      ...(typeof params.target.runtimeSpec?.previewHeight === "number"
        ? { previewHeight: params.target.runtimeSpec.previewHeight }
        : {}),
    },
    provider,
    promptSpec,
    generationPolicy: normalizedPolicy.policy,
    postProcess: resolvePostProcess(params.target),
    ...(params.target.edit ? { edit: params.target.edit } : {}),
    ...(params.target.auxiliaryMaps ? { auxiliaryMaps: params.target.auxiliaryMaps } : {}),
    ...(params.spritesheet ? { spritesheet: params.spritesheet } : {}),
    ...(params.generationDisabled ? { generationDisabled: true } : {}),
    ...(params.catalogDisabled ? { catalogDisabled: true } : {}),
  };

  if (model) {
    normalized.model = model;
  }

  return normalized;
}

function expandSpritesheetTarget(params: {
  manifest: ManifestV2;
  target: ManifestTarget;
  defaultProvider: ProviderName;
  styleKit: ManifestV2["styleKits"][number];
  evalProfile: ManifestEvaluationProfile;
}): PlannedTarget[] {
  const outExt = path.extname(params.target.out) || ".png";
  const outBase = path.basename(params.target.out, outExt);
  const frameTargets: PlannedTarget[] = [];
  const animations: NonNullable<PlannedTarget["spritesheet"]>["animations"] = [];

  const entries = Object.entries(params.target.animations ?? {}).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  const defaultSheetPrompt = mergeStyleKitPrompt({
    promptSpec:
      entries.length > 0
        ? normalizePromptSpec(entries[0][1].prompt)
        : {
            primary: `Spritesheet base for ${params.target.id}`,
            useCase: DEFAULT_STYLE_USE_CASE,
          },
    styleKit: params.styleKit,
    consistencyGroup: params.target.consistencyGroup,
  });

  for (const [animationName, animation] of entries) {
    animations?.push({
      name: animationName,
      count: animation.count,
      fps: animation.fps,
      loop: animation.loop,
      pivot: animation.pivot,
    });

    for (let frameIndex = 0; frameIndex < animation.count; frameIndex += 1) {
      const frameId = `${params.target.id}.${animationName}.${frameIndex}`;
      const frameOut = path.join(
        "__frames",
        params.target.id,
        `${outBase}__${animationName}_${String(frameIndex).padStart(2, "0")}${outExt}`,
      );
      const framePrompt = mergeStyleKitPrompt({
        promptSpec: normalizePromptSpec(animation.prompt),
        styleKit: params.styleKit,
        consistencyGroup: params.target.consistencyGroup,
      });
      framePrompt.primary = [
        framePrompt.primary,
        `Animation frame ${frameIndex + 1} of ${animation.count} for ${animationName}.`,
        "Maintain identical character proportions, camera angle, and lighting across all frames.",
      ].join(" ");

      frameTargets.push(
        normalizeTargetForGeneration({
          manifest: params.manifest,
          target: params.target,
          defaultProvider: params.defaultProvider,
          styleKit: params.styleKit,
          evalProfile: params.evalProfile,
          promptOverride: framePrompt,
          idOverride: frameId,
          outOverride: frameOut,
          spritesheet: {
            sheetTargetId: params.target.id,
            animationName,
            frameIndex,
            frameCount: animation.count,
            fps: animation.fps,
            loop: animation.loop,
            pivot: animation.pivot,
          },
          catalogDisabled: true,
        }),
      );
    }
  }

  const sheetTarget = normalizeTargetForGeneration({
    manifest: params.manifest,
    target: params.target,
    defaultProvider: params.defaultProvider,
    styleKit: params.styleKit,
    evalProfile: params.evalProfile,
    promptOverride: defaultSheetPrompt,
    generationDisabled: true,
    spritesheet: {
      sheetTargetId: params.target.id,
      isSheet: true,
      animations: animations ?? [],
    },
  });

  return [...frameTargets, sheetTarget];
}

function normalizePromptSpecFromTarget(target: ManifestTarget): PromptSpec {
  if (target.promptSpec) {
    return normalizePromptSpec(target.promptSpec);
  }
  return normalizePromptSpec(target.prompt);
}

function normalizePromptSpec(prompt: ManifestTarget["prompt"]): PromptSpec {
  if (typeof prompt === "string") {
    return {
      primary: prompt.trim(),
      useCase: DEFAULT_STYLE_USE_CASE,
    };
  }

  if (prompt && typeof prompt === "object") {
    return {
      primary: prompt.primary.trim(),
      useCase: prompt.useCase?.trim() || DEFAULT_STYLE_USE_CASE,
      ...(prompt.stylePreset ? { stylePreset: prompt.stylePreset.trim() } : {}),
      ...(prompt.scene ? { scene: prompt.scene.trim() } : {}),
      ...(prompt.subject ? { subject: prompt.subject.trim() } : {}),
      ...(prompt.style ? { style: prompt.style.trim() } : {}),
      ...(prompt.composition ? { composition: prompt.composition.trim() } : {}),
      ...(prompt.lighting ? { lighting: prompt.lighting.trim() } : {}),
      ...(prompt.palette ? { palette: prompt.palette.trim() } : {}),
      ...(prompt.materials ? { materials: prompt.materials.trim() } : {}),
      ...(prompt.constraints ? { constraints: prompt.constraints.trim() } : {}),
      ...(prompt.negative ? { negative: prompt.negative.trim() } : {}),
    };
  }

  throw new Error("Prompt is required.");
}

function mergeStyleKitPrompt(params: {
  promptSpec: PromptSpec;
  styleKit: ManifestV2["styleKits"][number];
  consistencyGroup: string;
}): PromptSpec {
  const references = params.styleKit.referenceImages.length
    ? `Reference images: ${params.styleKit.referenceImages.join(", ")}.`
    : "";
  const styleHint = `Apply style kit (${params.styleKit.id}) rules from ${params.styleKit.rulesPath}.`;
  const lightingHint = `Lighting model: ${params.styleKit.lightingModel}.`;
  const paletteHint = params.styleKit.palettePath
    ? `Palette file: ${params.styleKit.palettePath}.`
    : "";

  return {
    ...params.promptSpec,
    style: [params.promptSpec.style, styleHint].filter(Boolean).join(" "),
    lighting: [params.promptSpec.lighting, lightingHint].filter(Boolean).join(" "),
    constraints: [
      params.promptSpec.constraints,
      `Consistency group: ${params.consistencyGroup}.`,
      references,
      paletteHint,
    ]
      .filter(Boolean)
      .join(" "),
    negative: [
      params.promptSpec.negative,
      params.styleKit.negativeRulesPath
        ? `Negative rules file: ${params.styleKit.negativeRulesPath}.`
        : "",
    ]
      .filter(Boolean)
      .join(" "),
  };
}

function toNormalizedGenerationPolicy(target: ManifestTarget): NormalizedGenerationPolicy {
  const outputFormat = normalizeOutputFormatAlias(target.generationPolicy?.outputFormat);
  const candidates =
    typeof target.generationPolicy?.candidates === "number"
      ? Math.max(1, Math.round(target.generationPolicy.candidates))
      : 1;
  const maxRetries =
    typeof target.generationPolicy?.maxRetries === "number"
      ? Math.max(0, Math.round(target.generationPolicy.maxRetries))
      : 1;

  return {
    size: target.generationPolicy?.size?.trim() || target.acceptance?.size || "1024x1024",
    quality: target.generationPolicy?.quality?.trim() || "high",
    background: target.generationPolicy?.background?.trim() || "opaque",
    outputFormat,
    candidates,
    maxRetries,
    fallbackProviders: target.generationPolicy?.fallbackProviders ?? [],
    providerConcurrency: target.generationPolicy?.providerConcurrency,
    rateLimitPerMinute: target.generationPolicy?.rateLimitPerMinute,
  };
}

function resolvePostProcess(target: ManifestTarget): PostProcessPolicy | undefined {
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
  };

  const normalizedPalette = normalizePalettePolicy(target);
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

function normalizePalettePolicy(target: ManifestTarget): PalettePolicy | undefined {
  const palette = target.palette;
  if (!palette) {
    return undefined;
  }

  if (palette.mode === "exact") {
    return {
      mode: "exact",
      colors: (palette.colors ?? []).map((color) => normalizeHexColor(color)),
      dither: palette.dither,
    };
  }

  return {
    mode: "max-colors",
    maxColors: palette.maxColors,
    dither: palette.dither,
  };
}

function resolveTargetModel(
  manifest: ManifestV2,
  target: ManifestTarget,
  provider: ProviderName,
): string | undefined {
  if (target.model?.trim()) {
    return target.model.trim();
  }

  if (provider === "openai") {
    return manifest.providers.openai?.model?.trim();
  }
  if (provider === "nano") {
    return manifest.providers.nano?.model?.trim();
  }
  return manifest.providers.local?.model?.trim();
}

function resolvePostProcessAlgorithm(value: string | undefined): "nearest" | "lanczos3" {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "nearest") {
    return "nearest";
  }
  return "lanczos3";
}

function parseResizeVariant(variant: {
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

function parseResizeTo(
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

function toProviderJobSpec(target: PlannedTarget, provider: ProviderName): PlannedProviderJobSpec {
  return {
    targetId: target.id,
    out: target.out,
    provider,
    model: target.model,
    prompt: buildStructuredPrompt(target.promptSpec),
    promptSpec: target.promptSpec,
    generationPolicy: target.generationPolicy ?? {},
    postProcess: target.postProcess,
    styleKitId: target.styleKitId,
    consistencyGroup: target.consistencyGroup,
    evaluationProfileId: target.evaluationProfileId,
  };
}

function toSchemaValidationIssue(issue: ZodIssue): ValidationIssue {
  return {
    level: "error",
    code: `schema_${issue.code}`,
    path: formatIssuePath(issue.path),
    message: issue.message,
  };
}

function formatIssuePath(pathItems: Array<string | number>): string {
  if (!pathItems.length) {
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

function normalizeHexColor(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith("#")) {
    return trimmed.toLowerCase();
  }
  return `#${trimmed.toLowerCase()}`;
}

export function parseManifestProviderFlag(value: string | undefined): ProviderName | "auto" {
  return parseProviderSelection(value);
}
