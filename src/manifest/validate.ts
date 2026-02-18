import { existsSync, readFileSync } from "node:fs";
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
import { normalizeManifestAssetPath, normalizeTargetOutPath } from "../shared/paths.js";
import { safeParseManifestV2 } from "./schema.js";
import type {
  ManifestConsistencyGroup,
  ManifestEvaluationProfile,
  ManifestPostProcess,
  ManifestSource,
  ManifestStyleKit,
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

export interface NormalizeManifestTargetsOptions {
  manifestPath?: string;
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
    issues.push(...collectSemanticIssues(manifest, source.manifestPath));
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

export function normalizeManifestTargets(
  manifest: ManifestV2,
  options: NormalizeManifestTargetsOptions = {},
): PlannedTarget[] {
  const defaultProvider = manifest.providers?.default ?? "openai";
  const styleKitById = new Map(manifest.styleKits.map((kit) => [kit.id, kit]));
  const styleKitPaletteDefaults = resolveStyleKitPaletteDefaults(
    manifest.styleKits,
    options.manifestPath,
  );
  const consistencyGroupById = new Map(
    (manifest.consistencyGroups ?? []).map((group) => [group.id, group]),
  );
  const hasConsistencyGroups = consistencyGroupById.size > 0;
  const evaluationById = new Map(
    manifest.evaluationProfiles.map((profile) => [profile.id, profile]),
  );

  const targets: PlannedTarget[] = [];

  for (const target of manifest.targets) {
    const styleKit = styleKitById.get(target.styleKitId);
    const consistencyGroup = consistencyGroupById.get(target.consistencyGroup);
    const evalProfile = evaluationById.get(target.evaluationProfileId);
    const styleKitPaletteDefault = styleKit
      ? styleKitPaletteDefaults.get(styleKit.id)
      : undefined;

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

    if (hasConsistencyGroups && !consistencyGroup) {
      throw new Error(
        `Target "${target.id}" references missing consistencyGroup "${target.consistencyGroup}".`,
      );
    }

    if (
      consistencyGroup?.styleKitId &&
      consistencyGroup.styleKitId !== target.styleKitId
    ) {
      throw new Error(
        `Target "${target.id}" uses styleKitId "${target.styleKitId}" but consistency group "${consistencyGroup.id}" is bound to "${consistencyGroup.styleKitId}".`,
      );
    }

    if (target.kind === "spritesheet") {
      const expanded = expandSpritesheetTarget({
        manifest,
        target,
        defaultProvider,
        styleKit,
        styleKitPaletteDefault,
        consistencyGroup,
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
        styleKitPaletteDefault,
        consistencyGroup,
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
  const targets = normalizeManifestTargets(manifest, { manifestPath });
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

function collectSemanticIssues(
  manifest: ManifestV2,
  manifestPath: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const manifestDir = path.dirname(path.resolve(manifestPath));
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

    checkManifestAssetPath({
      issues,
      manifestDir,
      value: kit.rulesPath,
      issuePath: `styleKits[${index}].rulesPath`,
      label: `styleKits[${index}] rulesPath`,
    });

    if (kit.palettePath) {
      checkManifestAssetPath({
        issues,
        manifestDir,
        value: kit.palettePath,
        issuePath: `styleKits[${index}].palettePath`,
        label: `styleKits[${index}] palettePath`,
      });
    }

    if (kit.negativeRulesPath) {
      checkManifestAssetPath({
        issues,
        manifestDir,
        value: kit.negativeRulesPath,
        issuePath: `styleKits[${index}].negativeRulesPath`,
        label: `styleKits[${index}] negativeRulesPath`,
      });
    }

    for (const [referenceIndex, referencePath] of kit.referenceImages.entries()) {
      checkManifestAssetPath({
        issues,
        manifestDir,
        value: referencePath,
        issuePath: `styleKits[${index}].referenceImages[${referenceIndex}]`,
        label: `styleKits[${index}] referenceImages[${referenceIndex}]`,
      });
    }
  });

  const consistencyGroups = manifest.consistencyGroups ?? [];
  const consistencyGroupIds = new Set<string>();
  const consistencyGroupById = new Map<string, ManifestConsistencyGroup>();
  const seenConsistencyGroups = new Set<string>();

  consistencyGroups.forEach((group, index) => {
    if (consistencyGroupIds.has(group.id)) {
      issues.push({
        level: "error",
        code: "duplicate_consistency_group_id",
        path: `consistencyGroups[${index}].id`,
        message: `Duplicate consistency group id "${group.id}".`,
      });
    } else {
      consistencyGroupIds.add(group.id);
      consistencyGroupById.set(group.id, group);
    }

    if (group.styleKitId && !styleKitIds.has(group.styleKitId)) {
      issues.push({
        level: "error",
        code: "missing_style_kit",
        path: `consistencyGroups[${index}].styleKitId`,
        message: `Consistency group "${group.id}" references unknown style kit "${group.styleKitId}".`,
      });
    }

    for (const [referenceIndex, referencePath] of group.referenceImages.entries()) {
      checkManifestAssetPath({
        issues,
        manifestDir,
        value: referencePath,
        issuePath: `consistencyGroups[${index}].referenceImages[${referenceIndex}]`,
        label: `consistencyGroups[${index}] referenceImages[${referenceIndex}]`,
      });
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
    let normalizedOut: string | undefined;
    try {
      normalizedOut = normalizeTargetOutPath(target.out);
    } catch (error) {
      issues.push({
        level: "error",
        code: "invalid_target_out_path",
        path: `targets[${index}].out`,
        message: error instanceof Error ? error.message : String(error),
      });
    }

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

    if (normalizedOut) {
      const outDedupeKey = normalizedOut.toLowerCase();
      if (seenOutPaths.has(outDedupeKey)) {
        issues.push({
          level: "error",
          code: "duplicate_target_out",
          path: `targets[${index}].out`,
          message: `Duplicate output path "${normalizedOut}" (case-insensitive normalized match).`,
        });
      } else {
        seenOutPaths.add(outDedupeKey);
      }
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

    if (consistencyGroups.length > 0) {
      const consistencyGroup = consistencyGroupById.get(target.consistencyGroup);
      if (!consistencyGroup) {
        issues.push({
          level: "error",
          code: "missing_consistency_group",
          path: `targets[${index}].consistencyGroup`,
          message: `Unknown consistency group "${target.consistencyGroup}".`,
        });
      } else {
        seenConsistencyGroups.add(consistencyGroup.id);
        if (
          consistencyGroup.styleKitId &&
          consistencyGroup.styleKitId !== target.styleKitId
        ) {
          issues.push({
            level: "error",
            code: "consistency_group_style_kit_mismatch",
            path: `targets[${index}].styleKitId`,
            message: `Target "${target.id}" uses style kit "${target.styleKitId}" but consistency group "${consistencyGroup.id}" is bound to "${consistencyGroup.styleKitId}".`,
          });
        }
      }
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

    if (target.seamHeal && target.tileable !== true) {
      issues.push({
        level: "warning",
        code: "seam_heal_without_tileable",
        path: `targets[${index}].seamHeal`,
        message: "seamHeal is configured but target.tileable is not enabled.",
      });
    }

    if (target.wrapGrid) {
      if (target.tileable !== true) {
        issues.push({
          level: "warning",
          code: "wrap_grid_without_tileable",
          path: `targets[${index}].wrapGrid`,
          message: "wrapGrid is configured but target.tileable is not enabled.",
        });
      }

      const validationSize = resolveWrapGridValidationSize(target);
      if (!validationSize) {
        issues.push({
          level: "warning",
          code: "wrap_grid_size_unresolved",
          path: `targets[${index}].wrapGrid`,
          message:
            "wrapGrid checks require acceptance.size, generationPolicy.size, or postProcess.resizeTo to resolve final dimensions.",
        });
      } else if (
        validationSize.width % target.wrapGrid.columns !== 0 ||
        validationSize.height % target.wrapGrid.rows !== 0
      ) {
        issues.push({
          level: "error",
          code: "wrap_grid_size_mismatch",
          path: `targets[${index}].wrapGrid`,
          message: `Resolved size ${validationSize.width}x${validationSize.height} is not divisible by wrapGrid ${target.wrapGrid.columns}x${target.wrapGrid.rows}.`,
        });
      }
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
      target.generationPolicy?.outputFormat ??
        path.extname(normalizedOut ?? target.out).replace(".", ""),
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

  for (const [index, group] of consistencyGroups.entries()) {
    if (!seenConsistencyGroups.has(group.id)) {
      issues.push({
        level: "warning",
        code: "unused_consistency_group",
        path: `consistencyGroups[${index}].id`,
        message: `Consistency group "${group.id}" is defined but not referenced by any target.`,
      });
    }
  }

  return issues;
}

function checkManifestAssetPath(params: {
  issues: ValidationIssue[];
  manifestDir: string;
  value: string;
  issuePath: string;
  label: string;
}): string | undefined {
  let normalized: string;
  try {
    normalized = normalizeManifestAssetPath(params.value);
  } catch (error) {
    params.issues.push({
      level: "error",
      code: "invalid_manifest_asset_path",
      path: params.issuePath,
      message: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }

  const resolvedPath = path.resolve(
    params.manifestDir,
    normalized.split("/").join(path.sep),
  );
  if (!existsSync(resolvedPath)) {
    params.issues.push({
      level: "warning",
      code: "missing_manifest_asset",
      path: params.issuePath,
      message: `${params.label} points to "${normalized}", but no file exists at "${resolvedPath}".`,
    });
  }

  return normalized;
}

function normalizeTargetForGeneration(params: {
  manifest: ManifestV2;
  target: ManifestTarget;
  defaultProvider: ProviderName;
  styleKit: ManifestV2["styleKits"][number];
  styleKitPaletteDefault?: PalettePolicy;
  consistencyGroup?: ManifestConsistencyGroup;
  evalProfile: ManifestEvaluationProfile;
  promptOverride?: PromptSpec;
  idOverride?: string;
  outOverride?: string;
  spritesheet?: PlannedTarget["spritesheet"];
  generationDisabled?: boolean;
  catalogDisabled?: boolean;
}): PlannedTarget {
  const id = params.idOverride ?? params.target.id.trim();
  const rawOut = params.outOverride ?? params.target.out;
  let out: string;
  try {
    out = normalizeTargetOutPath(rawOut);
  } catch (error) {
    throw new Error(
      `Target "${id}" has invalid output path "${rawOut}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const provider = params.target.provider ?? params.defaultProvider;
  const model = resolveTargetModel(params.manifest, params.target, provider);
  const atlasGroup = params.target.atlasGroup?.trim() || null;
  const promptSpec =
    params.promptOverride ??
    mergeStyleKitPrompt({
      promptSpec: normalizePromptSpecFromTarget(params.target),
      styleKit: params.styleKit,
      consistencyGroupId: params.target.consistencyGroup,
      consistencyGroup: params.consistencyGroup,
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
  const palette = resolveTargetPalettePolicy(params.target, params.styleKitPaletteDefault);
  const seamHeal = normalizeSeamHealPolicy(params.target, params.evalProfile);
  const wrapGrid = normalizeWrapGridPolicy(params.target, params.evalProfile);

  const normalized: PlannedTarget = {
    id,
    kind: params.target.kind.trim(),
    out,
    atlasGroup,
    styleKitId: params.target.styleKitId,
    consistencyGroup: params.target.consistencyGroup,
    generationMode: params.target.generationMode ?? "text",
    evaluationProfileId: params.target.evaluationProfileId,
    scoringProfile: params.target.scoringProfile ?? params.target.evaluationProfileId,
    ...(params.evalProfile.scoreWeights ? { scoreWeights: params.evalProfile.scoreWeights } : {}),
    tileable: params.target.tileable,
    seamThreshold:
      params.target.seamThreshold ?? params.evalProfile.hardGates?.seamThreshold,
    seamStripPx: params.target.seamStripPx ?? params.evalProfile.hardGates?.seamStripPx,
    ...(seamHeal ? { seamHeal } : {}),
    ...(wrapGrid ? { wrapGrid } : {}),
    ...(palette ? { palette } : {}),
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
      ...(typeof params.target.runtimeSpec?.anchorX === "number"
        ? { anchorX: params.target.runtimeSpec.anchorX }
        : {}),
      ...(typeof params.target.runtimeSpec?.anchorY === "number"
        ? { anchorY: params.target.runtimeSpec.anchorY }
        : {}),
    },
    provider,
    promptSpec,
    generationPolicy: normalizedPolicy.policy,
    postProcess: resolvePostProcess(params.target, palette),
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
  styleKitPaletteDefault?: PalettePolicy;
  consistencyGroup?: ManifestConsistencyGroup;
  evalProfile: ManifestEvaluationProfile;
}): PlannedTarget[] {
  const normalizedSheetOut = normalizeTargetOutPath(params.target.out);
  const outExt = path.extname(normalizedSheetOut) || ".png";
  const outBase = path.basename(normalizedSheetOut, outExt);
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
    consistencyGroupId: params.target.consistencyGroup,
    consistencyGroup: params.consistencyGroup,
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
      const frameOut = path.posix.join(
        "__frames",
        params.target.id,
        `${outBase}__${animationName}_${String(frameIndex).padStart(2, "0")}${outExt}`,
      );
      const framePrompt = mergeStyleKitPrompt({
        promptSpec: normalizePromptSpec(animation.prompt),
        styleKit: params.styleKit,
        consistencyGroupId: params.target.consistencyGroup,
        consistencyGroup: params.consistencyGroup,
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
          styleKitPaletteDefault: params.styleKitPaletteDefault,
          consistencyGroup: params.consistencyGroup,
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
    styleKitPaletteDefault: params.styleKitPaletteDefault,
    consistencyGroup: params.consistencyGroup,
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
  consistencyGroupId: string;
  consistencyGroup?: ManifestConsistencyGroup;
}): PromptSpec {
  const references = params.styleKit.referenceImages.length
    ? `Reference images: ${params.styleKit.referenceImages.join(", ")}.`
    : "";
  const consistencyDescription = params.consistencyGroup?.description
    ? `Consistency notes: ${params.consistencyGroup.description}.`
    : "";
  const consistencyReferences = params.consistencyGroup?.referenceImages.length
    ? `Consistency references: ${params.consistencyGroup.referenceImages.join(", ")}.`
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
      `Consistency group: ${params.consistencyGroupId}.`,
      consistencyDescription,
      consistencyReferences,
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

function resolvePostProcess(
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
  };

  const normalizedPalette = paletteOverride ?? normalizePalettePolicy(target);
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

function normalizeSeamHealPolicy(
  target: ManifestTarget,
  evalProfile: ManifestEvaluationProfile,
): PlannedTarget["seamHeal"] | undefined {
  const seamHeal = target.seamHeal;
  if (!seamHeal) {
    return undefined;
  }

  const stripPx = seamHeal.stripPx ?? target.seamStripPx ?? evalProfile.hardGates?.seamStripPx;
  return {
    enabled: seamHeal.enabled ?? true,
    ...(typeof stripPx === "number" ? { stripPx: Math.max(1, Math.round(stripPx)) } : {}),
    ...(typeof seamHeal.strength === "number"
      ? { strength: Math.max(0, Math.min(1, seamHeal.strength)) }
      : {}),
  };
}

function normalizeWrapGridPolicy(
  target: ManifestTarget,
  evalProfile: ManifestEvaluationProfile,
): PlannedTarget["wrapGrid"] | undefined {
  const wrapGrid = target.wrapGrid;
  if (!wrapGrid) {
    return undefined;
  }

  const seamThreshold =
    wrapGrid.seamThreshold ?? target.seamThreshold ?? evalProfile.hardGates?.seamThreshold;
  const seamStripPx =
    wrapGrid.seamStripPx ?? target.seamStripPx ?? evalProfile.hardGates?.seamStripPx;

  return {
    columns: Math.max(1, Math.round(wrapGrid.columns)),
    rows: Math.max(1, Math.round(wrapGrid.rows)),
    ...(typeof seamThreshold === "number" ? { seamThreshold } : {}),
    ...(typeof seamStripPx === "number" ? { seamStripPx: Math.max(1, Math.round(seamStripPx)) } : {}),
  };
}

function resolveTargetPalettePolicy(
  target: ManifestTarget,
  styleKitPaletteDefault?: PalettePolicy,
): PalettePolicy | undefined {
  const targetPalette = normalizePalettePolicy(target);
  if (targetPalette) {
    return targetPalette;
  }

  if (!styleKitPaletteDefault) {
    return undefined;
  }

  if (styleKitPaletteDefault.mode === "exact") {
    return {
      mode: "exact",
      colors: [...(styleKitPaletteDefault.colors ?? [])],
      dither: styleKitPaletteDefault.dither,
    };
  }

  return { ...styleKitPaletteDefault };
}

function resolveStyleKitPaletteDefaults(
  styleKits: ManifestStyleKit[],
  manifestPath?: string,
): Map<string, PalettePolicy> {
  const defaults = new Map<string, PalettePolicy>();
  if (!manifestPath) {
    return defaults;
  }

  const manifestDir = path.dirname(path.resolve(manifestPath));
  for (const styleKit of styleKits) {
    const palette = loadStyleKitPalettePolicy(styleKit, manifestDir);
    if (palette) {
      defaults.set(styleKit.id, palette);
    }
  }

  return defaults;
}

function loadStyleKitPalettePolicy(
  styleKit: ManifestStyleKit,
  manifestDir: string,
): PalettePolicy | undefined {
  if (!styleKit.palettePath) {
    return undefined;
  }

  let normalizedPalettePath: string;
  try {
    normalizedPalettePath = normalizeManifestAssetPath(styleKit.palettePath);
  } catch {
    return undefined;
  }

  const paletteFilePath = path.resolve(
    manifestDir,
    normalizedPalettePath.split("/").join(path.sep),
  );
  if (!existsSync(paletteFilePath)) {
    return undefined;
  }

  let rawPalette = "";
  try {
    rawPalette = readFileSync(paletteFilePath, "utf8");
  } catch {
    return undefined;
  }

  const colors = parsePaletteFileColors(rawPalette);
  if (colors.length === 0) {
    return undefined;
  }

  return {
    mode: "exact",
    colors,
  };
}

function parsePaletteFileColors(rawPalette: string): string[] {
  const colors: string[] = [];
  const seen = new Set<string>();

  const append = (color: string): void => {
    if (seen.has(color)) {
      return;
    }
    seen.add(color);
    colors.push(color);
  };

  for (const line of rawPalette.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    if (/^(gimp\s+palette|name:|columns:)/iu.test(trimmed)) {
      continue;
    }

    const directHex = /^#?[0-9a-fA-F]{6}$/u.exec(trimmed);
    if (directHex) {
      append(normalizeHexColor(directHex[0]));
      continue;
    }

    if (trimmed.startsWith("//") || trimmed.startsWith(";")) {
      continue;
    }

    const rgbTriple =
      /^\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s+.*)?$/u.exec(trimmed) ??
      /^\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(?:\s+.*)?$/u.exec(trimmed);
    if (rgbTriple) {
      const r = Number.parseInt(rgbTriple[1], 10);
      const g = Number.parseInt(rgbTriple[2], 10);
      const b = Number.parseInt(rgbTriple[3], 10);
      if (
        Number.isFinite(r) &&
        Number.isFinite(g) &&
        Number.isFinite(b) &&
        r >= 0 &&
        r <= 255 &&
        g >= 0 &&
        g <= 255 &&
        b >= 0 &&
        b <= 255
      ) {
        append(rgbToHex(r, g, b));
      }
      continue;
    }

    const embeddedHex = /#?[0-9a-fA-F]{6}\b/u.exec(trimmed);
    if (embeddedHex) {
      append(normalizeHexColor(embeddedHex[0]));
    }
  }

  return colors;
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${r.toString(16).padStart(2, "0")}${g
    .toString(16)
    .padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
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

function resolveWrapGridValidationSize(
  target: ManifestTarget,
): { width: number; height: number } | undefined {
  return parseResizeTo(
    target.postProcess?.resizeTo,
    target.acceptance?.size ?? target.generationPolicy?.size,
  );
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
