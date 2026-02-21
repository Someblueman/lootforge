import type { KnownStylePreset, PromptSpec } from "./types-core.js";

const DEFAULT_PROMPT_USE_CASE = "stylized-concept";

const STYLE_PRESET_LINES: Record<KnownStylePreset, string[]> = {
  "pixel-art-16bit": [
    "Visual direction: classic 16-bit top-down RPG spritework.",
    "Pixel treatment: strict pixel grid, no anti-aliasing, no sub-pixel rendering.",
    "Shading: flat cel shading with limited color palette and clean dark outlines.",
    "Composition constraints: centered subject, gameplay-ready silhouette, minimal empty margins.",
  ],
  "topdown-painterly-sci-fi": [
    "Visual direction: stylized painterly top-down sci-fi game asset.",
    "Readability: clear silhouette and value separation at gameplay scale.",
    "Detail level: medium detail, avoid noisy microtexture.",
  ],
};

export function normalizePromptSpec(spec: PromptSpec): PromptSpec {
  return {
    primary: spec.primary?.trim() ?? "",
    useCase: spec.useCase?.trim() || DEFAULT_PROMPT_USE_CASE,
    stylePreset: spec.stylePreset?.trim() || "",
    scene: spec.scene?.trim() || "",
    subject: spec.subject?.trim() || "",
    style: spec.style?.trim() || "",
    composition: spec.composition?.trim() || "",
    lighting: spec.lighting?.trim() || "",
    palette: spec.palette?.trim() || "",
    materials: spec.materials?.trim() || "",
    constraints: spec.constraints?.trim() || "",
    negative: spec.negative?.trim() || "",
  };
}

export function buildStructuredPrompt(promptSpec: PromptSpec): string {
  const prompt = normalizePromptSpec(promptSpec);
  if (!prompt.primary) {
    throw new Error("promptSpec.primary is required for generation");
  }

  const presetLines = getStylePresetLines(prompt.stylePreset);
  const lines = [
    `Use case: ${prompt.useCase}`,
    `Primary request: ${prompt.primary}`,
    prompt.stylePreset ? `Style preset: ${prompt.stylePreset}` : "",
    ...presetLines,
    prompt.scene ? `Scene: ${prompt.scene}` : "",
    prompt.subject ? `Subject: ${prompt.subject}` : "",
    prompt.style ? `Style: ${prompt.style}` : "",
    prompt.composition ? `Composition: ${prompt.composition}` : "",
    prompt.lighting ? `Lighting: ${prompt.lighting}` : "",
    prompt.palette ? `Palette: ${prompt.palette}` : "",
    prompt.materials ? `Materials: ${prompt.materials}` : "",
    prompt.constraints ? `Constraints: ${prompt.constraints}` : "",
    prompt.negative ? `Avoid: ${prompt.negative}` : "",
  ];

  return lines.filter(Boolean).join("\n");
}

function getStylePresetLines(stylePreset: string | undefined): string[] {
  if (!stylePreset) {
    return [];
  }

  if (stylePreset in STYLE_PRESET_LINES) {
    return STYLE_PRESET_LINES[stylePreset as KnownStylePreset];
  }

  return [];
}
