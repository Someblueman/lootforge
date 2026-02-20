import path from "node:path";

import type {
  PalettePolicy,
  PlannedTarget,
  PromptSpec,
  ProviderName,
  TargetKind,
  TargetScoreWeights,
} from "../providers/types.js";
import {
  buildStructuredPrompt,
  normalizeGenerationPolicyForProvider,
} from "../providers/types.js";
import {
  normalizeManifestAssetPath,
  normalizeTargetOutPath,
} from "../shared/paths.js";
import type {
  ManifestConsistencyGroup,
  ManifestEvaluationProfile,
  ManifestScoringProfile,
  ManifestTarget,
  ManifestV2,
  PlannedProviderJobSpec,
} from "./types.js";
import {
  normalizeSeamHealPolicy,
  normalizeWrapGridPolicy,
  resolveTargetPalettePolicy,
} from "./normalize-palette.js";
import {
  resolvePostProcess,
  toNormalizedGenerationPolicy,
} from "./normalize-policy.js";
import {
  DEFAULT_STYLE_USE_CASE,
  mergeStyleKitPrompt,
  normalizePromptSpec,
  normalizePromptSpecFromTarget,
} from "./normalize-prompt.js";

export const SCORE_WEIGHT_KEYS: Array<keyof TargetScoreWeights> = [
  "readability",
  "fileSize",
  "consistency",
  "clip",
  "lpips",
  "ssim",
];

export const DEFAULT_KIND_SCORE_WEIGHT_PRESETS: Record<
  TargetKind,
  TargetScoreWeights
> = {
  sprite: {
    readability: 1.15,
    fileSize: 0.85,
    consistency: 1.2,
    clip: 1.15,
    lpips: 1.05,
    ssim: 1.05,
  },
  tile: {
    readability: 0.95,
    fileSize: 0.95,
    consistency: 1.35,
    clip: 1.05,
    lpips: 1.2,
    ssim: 1.2,
  },
  background: {
    readability: 1.2,
    fileSize: 0.8,
    consistency: 0.9,
    clip: 1.1,
    lpips: 0.95,
    ssim: 0.95,
  },
  effect: {
    readability: 1.25,
    fileSize: 0.85,
    consistency: 0.85,
    clip: 1.1,
    lpips: 0.9,
    ssim: 0.9,
  },
  spritesheet: {
    readability: 1.1,
    fileSize: 0.9,
    consistency: 1.35,
    clip: 1.1,
    lpips: 1.2,
    ssim: 1.2,
  },
};

export function normalizeOptionalManifestAssetPath(
  value: string | undefined,
  label: string,
): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return normalizeManifestAssetPath(value);
  } catch (error) {
    throw new Error(
      `${label} has invalid asset path "${value}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export function normalizeManifestAssetPathList(
  values: string[],
  label: string,
): string[] {
  const normalized: string[] = [];
  for (const [index, value] of values.entries()) {
    const itemLabel = `${label}[${index}]`;
    const entry = normalizeOptionalManifestAssetPath(value, itemLabel);
    if (entry) {
      normalized.push(entry);
    }
  }
  return normalized;
}

export function normalizeTargetKindForScoring(
  kind: string,
): TargetKind | undefined {
  const normalizedKind = kind.trim().toLowerCase();
  if (
    normalizedKind === "sprite" ||
    normalizedKind === "tile" ||
    normalizedKind === "background" ||
    normalizedKind === "effect" ||
    normalizedKind === "spritesheet"
  ) {
    return normalizedKind;
  }
  return undefined;
}

export function mergeScoreWeights(
  scoreWeights: TargetScoreWeights,
  overrides: TargetScoreWeights | undefined,
): void {
  if (!overrides) {
    return;
  }

  for (const key of SCORE_WEIGHT_KEYS) {
    const value = overrides[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      scoreWeights[key] = value;
    }
  }
}

export function resolveTargetScoring(params: {
  target: ManifestTarget;
  evalProfile: ManifestEvaluationProfile;
  scoringProfileById: Map<string, ManifestScoringProfile>;
}): {
  profileId?: string;
  scoreWeights?: TargetScoreWeights;
} {
  const kind = normalizeTargetKindForScoring(params.target.kind);
  const profileId =
    params.target.scoringProfile ?? params.target.evaluationProfileId;
  const profile = profileId
    ? params.scoringProfileById.get(profileId)
    : undefined;
  const scoreWeights: TargetScoreWeights = {};

  if (kind) {
    mergeScoreWeights(scoreWeights, DEFAULT_KIND_SCORE_WEIGHT_PRESETS[kind]);
  }

  if (profile?.scoreWeights) {
    mergeScoreWeights(scoreWeights, profile.scoreWeights);
  }

  if (kind && profile?.kindScoreWeights?.[kind]) {
    mergeScoreWeights(scoreWeights, profile.kindScoreWeights[kind]);
  }

  if (!profile && params.evalProfile.scoreWeights) {
    mergeScoreWeights(scoreWeights, params.evalProfile.scoreWeights);
  }

  return {
    ...(profileId ? { profileId } : {}),
    ...(Object.keys(scoreWeights).length > 0 ? { scoreWeights } : {}),
  };
}

export function normalizeTargetForGeneration(params: {
  manifest: ManifestV2;
  target: ManifestTarget;
  defaultProvider: ProviderName;
  styleKit: ManifestV2["styleKits"][number];
  styleKitPaletteDefault?: PalettePolicy;
  consistencyGroup?: ManifestConsistencyGroup;
  evalProfile: ManifestEvaluationProfile;
  scoringProfileById: Map<string, ManifestScoringProfile>;
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
  const policyErrors = normalizedPolicy.issues.filter(
    (issue) => issue.level === "error",
  );
  if (policyErrors.length > 0) {
    throw new Error(
      `Invalid generation policy for target "${params.target.id}": ${policyErrors
        .map((issue) => issue.message)
        .join(" ")}`,
    );
  }

  const acceptance = {
    ...(params.target.acceptance?.size
      ? { size: params.target.acceptance.size.trim() }
      : {}),
    alpha:
      params.target.acceptance?.alpha ??
      params.evalProfile.hardGates?.requireAlpha ??
      false,
    maxFileSizeKB:
      params.target.acceptance?.maxFileSizeKB ??
      params.evalProfile.hardGates?.maxFileSizeKB,
  };
  const palette = resolveTargetPalettePolicy(
    params.target,
    params.styleKitPaletteDefault,
  );
  const seamHeal = normalizeSeamHealPolicy(params.target, params.evalProfile);
  const wrapGrid = normalizeWrapGridPolicy(params.target, params.evalProfile);
  const styleReferenceImages = normalizeManifestAssetPathList(
    params.styleKit.styleReferenceImages ?? [],
    `styleKit "${params.styleKit.id}" styleReferenceImages`,
  );
  const loraPath = normalizeOptionalManifestAssetPath(
    params.styleKit.loraPath,
    `styleKit "${params.styleKit.id}" loraPath`,
  );
  const controlImage = normalizeOptionalManifestAssetPath(
    params.target.controlImage,
    `target "${id}" controlImage`,
  );
  const scoring = resolveTargetScoring({
    target: params.target,
    evalProfile: params.evalProfile,
    scoringProfileById: params.scoringProfileById,
  });

  const normalized: PlannedTarget = {
    id,
    kind: params.target.kind.trim(),
    out,
    atlasGroup,
    styleKitId: params.target.styleKitId,
    ...(styleReferenceImages.length > 0 ? { styleReferenceImages } : {}),
    ...(loraPath ? { loraPath } : {}),
    ...(typeof params.styleKit.loraStrength === "number"
      ? { loraStrength: params.styleKit.loraStrength }
      : {}),
    consistencyGroup: params.target.consistencyGroup,
    generationMode: params.target.generationMode ?? "text",
    evaluationProfileId: params.target.evaluationProfileId,
    ...(scoring.profileId ? { scoringProfile: scoring.profileId } : {}),
    ...(controlImage ? { controlImage } : {}),
    ...(params.target.controlMode
      ? { controlMode: params.target.controlMode }
      : {}),
    ...(scoring.scoreWeights ? { scoreWeights: scoring.scoreWeights } : {}),
    tileable: params.target.tileable,
    seamThreshold:
      params.target.seamThreshold ??
      params.evalProfile.hardGates?.seamThreshold,
    seamStripPx:
      params.target.seamStripPx ?? params.evalProfile.hardGates?.seamStripPx,
    alphaHaloRiskMax: params.evalProfile.hardGates?.alphaHaloRiskMax,
    alphaStrayNoiseMax: params.evalProfile.hardGates?.alphaStrayNoiseMax,
    alphaEdgeSharpnessMin: params.evalProfile.hardGates?.alphaEdgeSharpnessMin,
    packTextureBudgetMB: params.evalProfile.hardGates?.packTextureBudgetMB,
    spritesheetSilhouetteDriftMax:
      params.evalProfile.hardGates?.spritesheetSilhouetteDriftMax,
    spritesheetAnchorDriftMax:
      params.evalProfile.hardGates?.spritesheetAnchorDriftMax,
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
    ...(params.target.auxiliaryMaps
      ? { auxiliaryMaps: params.target.auxiliaryMaps }
      : {}),
    ...(params.spritesheet ? { spritesheet: params.spritesheet } : {}),
    ...(params.generationDisabled ? { generationDisabled: true } : {}),
    ...(params.catalogDisabled ? { catalogDisabled: true } : {}),
  };

  if (model) {
    normalized.model = model;
  }

  return normalized;
}

export function expandSpritesheetTarget(params: {
  manifest: ManifestV2;
  target: ManifestTarget;
  defaultProvider: ProviderName;
  styleKit: ManifestV2["styleKits"][number];
  styleKitPaletteDefault?: PalettePolicy;
  consistencyGroup?: ManifestConsistencyGroup;
  evalProfile: ManifestEvaluationProfile;
  scoringProfileById: Map<string, ManifestScoringProfile>;
}): PlannedTarget[] {
  const normalizedSheetOut = normalizeTargetOutPath(params.target.out);
  const outExt = path.extname(normalizedSheetOut) || ".png";
  const outBase = path.basename(normalizedSheetOut, outExt);
  const frameTargets: PlannedTarget[] = [];
  const animations: NonNullable<PlannedTarget["spritesheet"]>["animations"] =
    [];

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
          scoringProfileById: params.scoringProfileById,
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
    scoringProfileById: params.scoringProfileById,
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

export function resolveTargetModel(
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

export function toProviderJobSpec(
  target: PlannedTarget,
  provider: ProviderName,
): PlannedProviderJobSpec {
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
