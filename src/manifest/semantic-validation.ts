import { existsSync } from "node:fs";
import path from "node:path";

import { type ZodIssue } from "zod";

import { HEX_COLOR_PATTERN } from "./normalize-palette.js";
import {
  SUPPORTED_POST_PROCESS_ALGORITHMS,
  parseResizeTo,
  toNormalizedGenerationPolicy,
} from "./normalize-policy.js";
import {
  type ManifestConsistencyGroup,
  type ManifestTarget,
  type ManifestTargetTemplate,
  type ManifestV2,
  type ValidationIssue,
} from "./types.js";
import {
  normalizeGenerationPolicyForProvider,
  normalizeOutputFormatAlias,
} from "../providers/types.js";
import { SIZE_PATTERN } from "../shared/image.js";
import { normalizeManifestAssetPath, normalizeTargetOutPath } from "../shared/paths.js";
import { formatIssuePath } from "../shared/zod.js";

export function collectSemanticIssues(
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

    for (const [referenceIndex, referencePath] of (kit.styleReferenceImages ?? []).entries()) {
      checkManifestAssetPath({
        issues,
        manifestDir,
        value: referencePath,
        issuePath: `styleKits[${index}].styleReferenceImages[${referenceIndex}]`,
        label: `styleKits[${index}] styleReferenceImages[${referenceIndex}]`,
      });
    }

    if (kit.loraPath) {
      checkManifestAssetPath({
        issues,
        manifestDir,
        value: kit.loraPath,
        issuePath: `styleKits[${index}].loraPath`,
        label: `styleKits[${index}] loraPath`,
      });
    }
  });

  const consistencyGroups = manifest.consistencyGroups ?? [];
  const targetTemplates = manifest.targetTemplates ?? [];
  const targetTemplateIds = new Set<string>();
  const targetTemplateById = new Map<string, ManifestTargetTemplate>();
  const consistencyGroupIds = new Set<string>();
  const consistencyGroupById = new Map<string, ManifestConsistencyGroup>();
  const seenConsistencyGroups = new Set<string>();

  targetTemplates.forEach((template, index) => {
    if (targetTemplateIds.has(template.id)) {
      issues.push({
        level: "error",
        code: "duplicate_target_template_id",
        path: `targetTemplates[${index}].id`,
        message: `Duplicate target template id "${template.id}".`,
      });
      return;
    }
    targetTemplateIds.add(template.id);
    targetTemplateById.set(template.id, template);
  });

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
  const scoringProfiles = manifest.scoringProfiles ?? [];
  const scoringProfileIds = new Set<string>();
  scoringProfiles.forEach((profile, index) => {
    if (scoringProfileIds.has(profile.id)) {
      issues.push({
        level: "error",
        code: "duplicate_scoring_profile_id",
        path: `scoringProfiles[${index}].id`,
        message: `Duplicate scoring profile id "${profile.id}".`,
      });
    } else {
      scoringProfileIds.add(profile.id);
    }
  });

  const defaultProvider = manifest.providers.default ?? "openai";

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

    if (target.templateId && !targetTemplateIds.has(target.templateId)) {
      issues.push({
        level: "error",
        code: "missing_target_template",
        path: `targets[${index}].templateId`,
        message: `Unknown target template "${target.templateId}".`,
      });
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

    if (target.scoringProfile && !scoringProfileIds.has(target.scoringProfile)) {
      issues.push({
        level: "error",
        code: "missing_scoring_profile",
        path: `targets[${index}].scoringProfile`,
        message: `Unknown scoring profile "${target.scoringProfile}".`,
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
        if (consistencyGroup.styleKitId && consistencyGroup.styleKitId !== target.styleKitId) {
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

    if (
      typeof target.postProcess?.resizeTo === "string" &&
      !SIZE_PATTERN.test(target.postProcess.resizeTo)
    ) {
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

    if (target.generationMode === "edit-first" && !target.edit?.inputs?.length) {
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

    if (target.controlImage) {
      checkManifestAssetPath({
        issues,
        manifestDir,
        value: target.controlImage,
        issuePath: `targets[${index}].controlImage`,
        label: `targets[${index}] controlImage`,
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
    const alphaRequired =
      target.runtimeSpec?.alphaRequired === true || target.acceptance?.alpha === true;
    if (alphaRequired && outputFormat === "jpeg") {
      issues.push({
        level: "error",
        code: "alpha_requires_png_or_webp",
        path: `targets[${index}].generationPolicy.outputFormat`,
        message: "Alpha-required targets must use png or webp output formats.",
      });
    }
  });

  manifest.targets.forEach((target, index) => {
    const template = target.templateId ? targetTemplateById.get(target.templateId) : undefined;
    const dependsOn = mergeTargetReferenceLists(template?.dependsOn, target.dependsOn);
    const explicitStyleReferenceFrom = mergeTargetReferenceLists(
      template?.styleReferenceFrom,
      target.styleReferenceFrom,
    );

    for (const dependencyId of dependsOn) {
      if (!seenTargetIds.has(dependencyId)) {
        issues.push({
          level: "error",
          code: "missing_dependency_target",
          path: `targets[${index}].dependsOn`,
          message: `Target "${target.id}" depends on unknown target "${dependencyId}".`,
        });
      } else if (dependencyId === target.id) {
        issues.push({
          level: "error",
          code: "self_dependency",
          path: `targets[${index}].dependsOn`,
          message: `Target "${target.id}" cannot depend on itself.`,
        });
      }
    }

    for (const sourceTargetId of explicitStyleReferenceFrom) {
      if (!seenTargetIds.has(sourceTargetId)) {
        issues.push({
          level: "error",
          code: "missing_style_reference_target",
          path: `targets[${index}].styleReferenceFrom`,
          message: `Target "${target.id}" chains style references from unknown target "${sourceTargetId}".`,
        });
      } else if (sourceTargetId === target.id) {
        issues.push({
          level: "error",
          code: "self_style_reference",
          path: `targets[${index}].styleReferenceFrom`,
          message: `Target "${target.id}" cannot chain style references from itself.`,
        });
      }
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

  const resolvedPath = path.resolve(params.manifestDir, normalized.split("/").join(path.sep));
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

function resolveWrapGridValidationSize(
  target: ManifestTarget,
): { width: number; height: number } | undefined {
  return parseResizeTo(
    target.postProcess?.resizeTo,
    target.acceptance?.size ?? target.generationPolicy?.size,
  );
}

function mergeTargetReferenceLists(primary?: string[], secondary?: string[]): string[] {
  const merged = [
    ...normalizeTargetReferenceList(primary),
    ...normalizeTargetReferenceList(secondary),
  ];
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const targetId of merged) {
    if (seen.has(targetId)) {
      continue;
    }
    seen.add(targetId);
    deduped.push(targetId);
  }
  return deduped;
}

function normalizeTargetReferenceList(values?: string[]): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.map((value) => value.trim()).filter(Boolean);
}

export function toSchemaValidationIssue(issue: ZodIssue): ValidationIssue {
  return {
    level: "error",
    code: `schema_${issue.code}`,
    path: formatIssuePath(issue.path),
    message: issue.message,
  };
}
