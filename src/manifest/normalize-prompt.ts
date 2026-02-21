import { type ManifestConsistencyGroup, type ManifestTarget, type ManifestV2 } from "./types.js";
import { type PromptSpec } from "../providers/types.js";

export const DEFAULT_STYLE_USE_CASE = "game-asset";

export function normalizePromptSpecFromTarget(target: ManifestTarget): PromptSpec {
  if (target.promptSpec) {
    return normalizePromptSpec(target.promptSpec);
  }
  return normalizePromptSpec(target.prompt);
}

export function normalizePromptSpec(prompt: ManifestTarget["prompt"]): PromptSpec {
  if (typeof prompt === "string") {
    return {
      primary: prompt.trim(),
      useCase: DEFAULT_STYLE_USE_CASE,
    };
  }

  if (prompt && typeof prompt === "object") {
    return {
      primary: prompt.primary.trim(),
      useCase: prompt.useCase?.trim() ?? DEFAULT_STYLE_USE_CASE,
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

export function mergeStyleKitPrompt(params: {
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
