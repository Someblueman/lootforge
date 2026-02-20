import {
  nowIso,
  parseProviderSelection,
  PlannedTarget,
  ProviderName,
} from "../providers/types.js";
import { safeParseManifestV2 } from "./schema.js";
import { resolveStyleKitPaletteDefaults } from "./normalize-palette.js";
import {
  expandSpritesheetTarget,
  normalizeTargetForGeneration,
  toProviderJobSpec,
} from "./normalize-target.js";
import {
  collectSemanticIssues,
  toSchemaValidationIssue,
} from "./semantic-validation.js";
import type {
  ManifestSource,
  ManifestV2,
  ManifestValidationResult,
  PlanArtifacts,
  PlannedProviderJobSpec,
  ValidationIssue,
} from "./types.js";

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
  const scoringProfileById = new Map(
    (manifest.scoringProfiles ?? []).map((profile) => [profile.id, profile]),
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

    if (
      target.scoringProfile &&
      !scoringProfileById.has(target.scoringProfile)
    ) {
      throw new Error(
        `Target "${target.id}" references missing scoringProfile "${target.scoringProfile}".`,
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
        scoringProfileById,
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
        scoringProfileById,
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

export function parseManifestProviderFlag(
  value: string | undefined,
): ProviderName | "auto" {
  return parseProviderSelection(value);
}
