import { z } from "zod";

const nonEmptyString = z.string().trim().min(1);

export const ProviderNameSchema = z.enum(["openai", "nano", "local"]);

export const PromptSpecSchema = z.object({
  primary: nonEmptyString,
  useCase: nonEmptyString.optional(),
  stylePreset: nonEmptyString.optional(),
  scene: nonEmptyString.optional(),
  subject: nonEmptyString.optional(),
  style: nonEmptyString.optional(),
  composition: nonEmptyString.optional(),
  lighting: nonEmptyString.optional(),
  palette: nonEmptyString.optional(),
  materials: nonEmptyString.optional(),
  constraints: nonEmptyString.optional(),
  negative: nonEmptyString.optional(),
});

export const ManifestGenerationModeSchema = z.enum(["text", "edit-first"]);

export const ManifestVlmGateSchema = z.object({
  threshold: z.number().min(0).max(5).optional(),
  rubric: nonEmptyString.optional(),
});

export const ManifestGenerationPolicySchema = z.object({
  size: nonEmptyString.optional(),
  background: nonEmptyString.optional(),
  outputFormat: nonEmptyString.optional(),
  quality: nonEmptyString.optional(),
  draftQuality: nonEmptyString.optional(),
  finalQuality: nonEmptyString.optional(),
  candidates: z.number().int().min(1).optional(),
  maxRetries: z.number().int().min(0).optional(),
  fallbackProviders: z.array(ProviderNameSchema).optional(),
  providerConcurrency: z.number().int().positive().optional(),
  rateLimitPerMinute: z.number().int().positive().optional(),
  vlmGate: ManifestVlmGateSchema.optional(),
});

export const ManifestAcceptanceSchema = z.object({
  size: nonEmptyString.optional(),
  alpha: z.boolean().optional(),
  maxFileSizeKB: z.number().int().positive().optional(),
});

export const ManifestRuntimeSpecSchema = z.object({
  alphaRequired: z.boolean().optional(),
  previewWidth: z.number().int().positive().optional(),
  previewHeight: z.number().int().positive().optional(),
  anchorX: z.number().min(0).max(1).optional(),
  anchorY: z.number().min(0).max(1).optional(),
});

export const ManifestPostProcessOperationTrimSchema = z.object({
  enabled: z.boolean().optional(),
  threshold: z.number().min(0).max(255).optional(),
});

export const ManifestPostProcessOperationPadSchema = z.object({
  pixels: z.number().int().min(0),
  extrude: z.boolean().optional(),
  background: nonEmptyString.optional(),
});

export const ManifestPostProcessOperationQuantizeSchema = z.object({
  colors: z.number().int().min(2).max(256),
  dither: z.number().min(0).max(1).optional(),
});

export const ManifestPostProcessOperationOutlineSchema = z.object({
  size: z.number().int().min(1).max(64),
  color: nonEmptyString.optional(),
});

export const ManifestPostProcessResizeVariantSchema = z.object({
  name: nonEmptyString,
  size: nonEmptyString,
  algorithm: nonEmptyString.optional(),
});

export const ManifestPostProcessOperationsSchema = z.object({
  trim: ManifestPostProcessOperationTrimSchema.optional(),
  pad: ManifestPostProcessOperationPadSchema.optional(),
  quantize: ManifestPostProcessOperationQuantizeSchema.optional(),
  outline: ManifestPostProcessOperationOutlineSchema.optional(),
  resizeVariants: z.array(ManifestPostProcessResizeVariantSchema).optional(),
});

export const ManifestPostProcessSchema = z.object({
  resizeTo: z.union([nonEmptyString, z.number().int().positive()]).optional(),
  algorithm: nonEmptyString.optional(),
  stripMetadata: z.boolean().optional(),
  pngPaletteColors: z.number().int().min(2).max(256).optional(),
  operations: ManifestPostProcessOperationsSchema.optional(),
});

export const ManifestEditInputSchema = z.object({
  path: nonEmptyString,
  role: z.enum(["base", "mask", "reference"]).optional(),
  fidelity: z.enum(["low", "medium", "high"]).optional(),
});

export const ManifestEditSchema = z.object({
  mode: z.enum(["edit", "iterate"]).optional(),
  instruction: nonEmptyString.optional(),
  inputs: z.array(ManifestEditInputSchema).optional(),
  preserveComposition: z.boolean().optional(),
});

export const ManifestAuxiliaryMapsSchema = z.object({
  normalFromHeight: z.boolean().optional(),
  specularFromLuma: z.boolean().optional(),
  aoFromLuma: z.boolean().optional(),
});

export const ManifestPalettePolicySchema = z
  .object({
    mode: z.enum(["exact", "max-colors"]),
    colors: z.array(nonEmptyString).optional(),
    maxColors: z.number().int().min(2).max(256).optional(),
    dither: z.number().min(0).max(1).optional(),
  })
  .superRefine((palette, ctx) => {
    if (palette.mode === "exact" && (!palette.colors || palette.colors.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["colors"],
        message: "Exact palette mode requires at least one color.",
      });
    }

    if (palette.mode === "max-colors" && typeof palette.maxColors !== "number") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxColors"],
        message: "max-colors mode requires maxColors.",
      });
    }
  });

const animationPivotSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

export const ManifestSpriteAnimationSchema = z.object({
  count: z.number().int().min(1).max(64),
  prompt: z.union([nonEmptyString, PromptSpecSchema]),
  fps: z.number().min(1).max(60).optional(),
  loop: z.boolean().optional(),
  pivot: animationPivotSchema.optional(),
});

export const ManifestSeamHealSchema = z.object({
  enabled: z.boolean().optional(),
  stripPx: z.number().int().min(1).max(64).optional(),
  strength: z.number().min(0).max(1).optional(),
});

export const ManifestWrapGridSchema = z.object({
  columns: z.number().int().min(1).max(128),
  rows: z.number().int().min(1).max(128),
  seamThreshold: z.number().min(0).max(255).optional(),
  seamStripPx: z.number().int().min(1).max(64).optional(),
});

export const ManifestTargetSchema = z
  .object({
    id: nonEmptyString,
    kind: nonEmptyString,
    out: nonEmptyString,
    atlasGroup: nonEmptyString.optional(),
    styleKitId: nonEmptyString,
    consistencyGroup: nonEmptyString,
    evaluationProfileId: nonEmptyString,
    generationMode: ManifestGenerationModeSchema.optional(),
    scoringProfile: nonEmptyString.optional(),
    tileable: z.boolean().optional(),
    seamThreshold: z.number().min(0).max(255).optional(),
    seamStripPx: z.number().int().min(1).max(64).optional(),
    seamHeal: ManifestSeamHealSchema.optional(),
    wrapGrid: ManifestWrapGridSchema.optional(),
    palette: ManifestPalettePolicySchema.optional(),
    prompt: z.union([nonEmptyString, PromptSpecSchema]).optional(),
    promptSpec: PromptSpecSchema.optional(),
    generationPolicy: ManifestGenerationPolicySchema.optional(),
    postProcess: ManifestPostProcessSchema.optional(),
    acceptance: ManifestAcceptanceSchema.optional(),
    runtimeSpec: ManifestRuntimeSpecSchema.optional(),
    provider: ProviderNameSchema.optional(),
    model: nonEmptyString.optional(),
    edit: ManifestEditSchema.optional(),
    auxiliaryMaps: ManifestAuxiliaryMapsSchema.optional(),
    animations: z.record(ManifestSpriteAnimationSchema).optional(),
  })
  .superRefine((target, ctx) => {
    if (target.kind === "spritesheet") {
      if (!target.animations || Object.keys(target.animations).length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["animations"],
          message: "spritesheet targets require at least one animation.",
        });
      }
      return;
    }

    if (target.prompt === undefined && target.promptSpec === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["prompt"],
        message: "Each non-spritesheet target requires `prompt` or `promptSpec`.",
      });
    }
  });

export const ManifestPackSchema = z.object({
  id: nonEmptyString,
  version: nonEmptyString,
  license: nonEmptyString.optional(),
  author: nonEmptyString.optional(),
});

export const ManifestProviderConfigSchema = z.object({
  model: nonEmptyString.optional(),
  endpoint: nonEmptyString.optional(),
  timeoutMs: z.number().int().positive().optional(),
  maxRetries: z.number().int().min(0).optional(),
  minDelayMs: z.number().int().min(0).optional(),
  defaultConcurrency: z.number().int().positive().optional(),
});

export const ManifestProvidersSchema = z.object({
  default: ProviderNameSchema.default("openai"),
  openai: ManifestProviderConfigSchema.optional(),
  nano: ManifestProviderConfigSchema.optional(),
  local: ManifestProviderConfigSchema
    .extend({
      baseUrl: nonEmptyString.optional(),
    })
    .optional(),
});

export const ManifestStyleKitSchema = z.object({
  id: nonEmptyString,
  rulesPath: nonEmptyString,
  palettePath: nonEmptyString.optional(),
  referenceImages: z.array(nonEmptyString).default([]),
  lightingModel: nonEmptyString,
  negativeRulesPath: nonEmptyString.optional(),
});

export const ManifestConsistencyGroupSchema = z.object({
  id: nonEmptyString,
  description: nonEmptyString.optional(),
  styleKitId: nonEmptyString.optional(),
  referenceImages: z.array(nonEmptyString).default([]),
});

export const ManifestEvaluationProfileSchema = z.object({
  id: nonEmptyString,
  hardGates: z
    .object({
      requireAlpha: z.boolean().optional(),
      maxFileSizeKB: z.number().int().positive().optional(),
      seamThreshold: z.number().min(0).max(255).optional(),
      seamStripPx: z.number().int().min(1).max(64).optional(),
      paletteComplianceMin: z.number().min(0).max(1).optional(),
      alphaHaloRiskMax: z.number().min(0).max(1).optional(),
      alphaStrayNoiseMax: z.number().min(0).max(1).optional(),
      alphaEdgeSharpnessMin: z.number().min(0).max(1).optional(),
      packTextureBudgetMB: z.number().positive().optional(),
      spritesheetSilhouetteDriftMax: z.number().min(0).max(1).optional(),
      spritesheetAnchorDriftMax: z.number().min(0).max(1).optional(),
    })
    .optional(),
  scoreWeights: z
    .object({
      readability: z.number().optional(),
      fileSize: z.number().optional(),
      consistency: z.number().optional(),
      clip: z.number().optional(),
      lpips: z.number().optional(),
      ssim: z.number().optional(),
    })
    .optional(),
});

export const ManifestAtlasGroupSchema = z.object({
  padding: z.number().int().min(0).optional(),
  trim: z.boolean().optional(),
  bleed: z.number().int().min(0).optional(),
  multipack: z.boolean().optional(),
  maxWidth: z.number().int().positive().optional(),
  maxHeight: z.number().int().positive().optional(),
});

export const ManifestAtlasSchema = ManifestAtlasGroupSchema.extend({
  groups: z.record(ManifestAtlasGroupSchema).optional(),
});

export const ManifestV2Schema = z.object({
  version: z.literal("next"),
  pack: ManifestPackSchema,
  providers: ManifestProvidersSchema,
  styleKits: z.array(ManifestStyleKitSchema).min(1),
  consistencyGroups: z.array(ManifestConsistencyGroupSchema).optional(),
  evaluationProfiles: z.array(ManifestEvaluationProfileSchema).min(1),
  atlas: ManifestAtlasSchema.optional(),
  targets: z.array(ManifestTargetSchema).min(1),
});

export function safeParseManifestV2(input: unknown) {
  return ManifestV2Schema.safeParse(input);
}
