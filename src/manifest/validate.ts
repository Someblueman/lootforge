import { resolveStyleKitPaletteDefaults } from "./normalize-palette.js";
import {
  expandSpritesheetTarget,
  normalizeTargetForGeneration,
  toProviderJobSpec,
} from "./normalize-target.js";
import { safeParseManifestV2 } from "./schema.js";
import { collectSemanticIssues, toSchemaValidationIssue } from "./semantic-validation.js";
import {
  type ManifestSource,
  type ManifestV2,
  type ManifestValidationResult,
  type PlanArtifacts,
  type PlannedProviderJobSpec,
  type ValidationIssue,
} from "./types.js";
import {
  nowIso,
  parseProviderSelection,
  type PlannedTarget,
  type ProviderName,
} from "../providers/types.js";

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
  const defaultProvider = manifest.providers.default ?? "openai";
  const targetTemplateById = new Map(
    (manifest.targetTemplates ?? []).map((template) => [template.id, template]),
  );
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
    const template = target.templateId ? targetTemplateById.get(target.templateId) : undefined;
    const styleKit = styleKitById.get(target.styleKitId);
    const consistencyGroup = consistencyGroupById.get(target.consistencyGroup);
    const evalProfile = evaluationById.get(target.evaluationProfileId);
    const styleKitPaletteDefault = styleKit ? styleKitPaletteDefaults.get(styleKit.id) : undefined;

    if (!styleKit) {
      throw new Error(
        `Target "${target.id}" references missing styleKitId "${target.styleKitId}".`,
      );
    }

    if (target.templateId && !template) {
      throw new Error(
        `Target "${target.id}" references missing template "${target.templateId}".`,
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

    if (consistencyGroup?.styleKitId && consistencyGroup.styleKitId !== target.styleKitId) {
      throw new Error(
        `Target "${target.id}" uses styleKitId "${target.styleKitId}" but consistency group "${consistencyGroup.id}" is bound to "${consistencyGroup.styleKitId}".`,
      );
    }

    if (target.scoringProfile && !scoringProfileById.has(target.scoringProfile)) {
      throw new Error(
        `Target "${target.id}" references missing scoringProfile "${target.scoringProfile}".`,
      );
    }

    if (target.kind === "spritesheet") {
      const expanded = expandSpritesheetTarget({
        manifest,
        target,
        template,
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
        template,
        defaultProvider,
        styleKit,
        styleKitPaletteDefault,
        consistencyGroup,
        evalProfile,
        scoringProfileById,
      }),
    );
  }

  validatePlannedTargetOrchestration(targets);

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

export function parseManifestProviderFlag(value: string | undefined): ProviderName | "auto" {
  return parseProviderSelection(value);
}

function validatePlannedTargetOrchestration(targets: PlannedTarget[]): void {
  const targetsById = new Map(targets.map((target) => [target.id, target]));

  for (const target of targets) {
    for (const dependencyId of target.dependsOn ?? []) {
      const dependencyTarget = targetsById.get(dependencyId);
      if (!dependencyTarget) {
        throw new Error(
          `Target "${target.id}" depends on missing planned target "${dependencyId}".`,
        );
      }
      if (dependencyId === target.id) {
        throw new Error(`Target "${target.id}" cannot depend on itself.`);
      }
      if (dependencyTarget.generationDisabled === true) {
        throw new Error(
          `Target "${target.id}" depends on "${dependencyId}", but that target is generationDisabled.`,
        );
      }
    }

    for (const styleSourceTargetId of target.styleReferenceFrom ?? []) {
      const styleSourceTarget = targetsById.get(styleSourceTargetId);
      if (!styleSourceTarget) {
        throw new Error(
          `Target "${target.id}" chains style references from missing target "${styleSourceTargetId}".`,
        );
      }
      if (styleSourceTargetId === target.id) {
        throw new Error(`Target "${target.id}" cannot chain style references from itself.`);
      }
      if (styleSourceTarget.generationDisabled === true) {
        throw new Error(
          `Target "${target.id}" chains style references from "${styleSourceTargetId}", but that target is generationDisabled.`,
        );
      }
    }
  }

  const generationEnabledTargets = targets.filter((target) => target.generationDisabled !== true);
  const enabledIds = new Set(generationEnabledTargets.map((target) => target.id));
  const adjacency = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const target of generationEnabledTargets) {
    inDegree.set(target.id, 0);
    adjacency.set(target.id, []);
  }

  for (const target of generationEnabledTargets) {
    const dependencies = dedupeTargetIdList(target.dependsOn ?? []);
    for (const dependencyId of dependencies) {
      if (!enabledIds.has(dependencyId)) {
        throw new Error(
          `Target "${target.id}" depends on "${dependencyId}", but it is not in the generation-enabled target set.`,
        );
      }
      adjacency.get(dependencyId)?.push(target.id);
      inDegree.set(target.id, (inDegree.get(target.id) ?? 0) + 1);
    }
  }

  let queue = generationEnabledTargets
    .map((target) => target.id)
    .filter((targetId) => (inDegree.get(targetId) ?? 0) === 0)
    .sort((left, right) => left.localeCompare(right));
  let visited = 0;

  while (queue.length > 0) {
    const currentId = queue[0];
    queue = queue.slice(1);
    visited += 1;

    const dependents = adjacency.get(currentId) ?? [];
    for (const dependentId of dependents) {
      const nextDegree = (inDegree.get(dependentId) ?? 0) - 1;
      inDegree.set(dependentId, nextDegree);
      if (nextDegree === 0) {
        queue.push(dependentId);
      }
    }
    queue.sort((left, right) => left.localeCompare(right));
  }

  if (visited !== generationEnabledTargets.length) {
    const blockedTargetIds = generationEnabledTargets
      .map((target) => target.id)
      .filter((targetId) => (inDegree.get(targetId) ?? 0) > 0)
      .sort((left, right) => left.localeCompare(right));
    throw new Error(
      `Dependency cycle detected across generation-enabled targets: ${blockedTargetIds.join(", ")}.`,
    );
  }
}

function dedupeTargetIdList(targetIds: string[]): string[] {
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const targetId of targetIds) {
    if (seen.has(targetId)) {
      continue;
    }
    seen.add(targetId);
    deduped.push(targetId);
  }
  return deduped;
}
