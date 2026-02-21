import { z } from "zod";

import { TARGET_KINDS, WRAP_GRID_TOPOLOGY_MODES } from "../providers/types.js";
import {
  AcceptanceSchema,
  AgenticRetryBaseSchema,
  AuxiliaryMapsSchema,
  CoarseToFineBaseSchema,
  ControlModeSchema,
  EditInputSchema,
  EditSchema,
  GenerationModeSchema,
  HiresFixSchema,
  nonEmptyString,
  PalettePolicyBaseSchema,
  PromptSpecBaseShape,
  ProviderNameSchema,
  RuntimeSpecBaseSchema,
  ScoreWeightsSchema,
  VlmGateSchema,
} from "../shared/schemas.js";

export { ProviderNameSchema };

export const PromptSpecSchema = z.object({
  ...PromptSpecBaseShape,
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

export const ManifestGenerationModeSchema = GenerationModeSchema;
export const ManifestControlModeSchema = ControlModeSchema;
export const ManifestTargetKindSchema = z.enum(TARGET_KINDS);
export const ManifestTargetReferenceListSchema = z.array(nonEmptyString);

export const ManifestVlmGateSchema = VlmGateSchema;

export const ManifestCoarseToFineSchema = CoarseToFineBaseSchema;
export const ManifestAgenticRetrySchema = AgenticRetryBaseSchema;

export const ManifestGenerationPolicySchema = z.object({
  size: nonEmptyString.optional(),
  background: nonEmptyString.optional(),
  outputFormat: nonEmptyString.optional(),
  quality: nonEmptyString.optional(),
  highQuality: z.boolean().optional(),
  hiresFix: HiresFixSchema.optional(),
  draftQuality: nonEmptyString.optional(),
  finalQuality: nonEmptyString.optional(),
  candidates: z.number().int().min(1).optional(),
  maxRetries: z.number().int().min(0).optional(),
  fallbackProviders: z.array(ProviderNameSchema).optional(),
  providerConcurrency: z.number().int().positive().optional(),
  rateLimitPerMinute: z.number().int().positive().optional(),
  vlmGate: ManifestVlmGateSchema.optional(),
  coarseToFine: ManifestCoarseToFineSchema.optional(),
  agenticRetry: ManifestAgenticRetrySchema.optional(),
});

export const ManifestAcceptanceSchema = AcceptanceSchema;

export const ManifestRuntimeSpecSchema = RuntimeSpecBaseSchema.extend({
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

export const ManifestPostProcessOperationPixelPerfectSchema = z.object({
  enabled: z.boolean().optional(),
  scale: z.number().int().min(1).max(16).optional(),
});

export const ManifestPostProcessOperationSmartCropSchema = z.object({
  enabled: z.boolean().optional(),
  mode: z.enum(["alpha-bounds", "center"]).optional(),
  padding: z.number().int().min(0).max(256).optional(),
});

export const ManifestPostProcessOperationEmitVariantsSchema = z.object({
  raw: z.boolean().optional(),
  pixel: z.boolean().optional(),
  styleRef: z.boolean().optional(),
  layerColor: z.boolean().optional(),
  layerMatte: z.boolean().optional(),
});

export const ManifestPostProcessOperationsSchema = z.object({
  trim: ManifestPostProcessOperationTrimSchema.optional(),
  pad: ManifestPostProcessOperationPadSchema.optional(),
  quantize: ManifestPostProcessOperationQuantizeSchema.optional(),
  outline: ManifestPostProcessOperationOutlineSchema.optional(),
  resizeVariants: z.array(ManifestPostProcessResizeVariantSchema).optional(),
  pixelPerfect: ManifestPostProcessOperationPixelPerfectSchema.optional(),
  smartCrop: ManifestPostProcessOperationSmartCropSchema.optional(),
  emitVariants: ManifestPostProcessOperationEmitVariantsSchema.optional(),
});

export const ManifestPostProcessSchema = z.object({
  resizeTo: z.union([nonEmptyString, z.number().int().positive()]).optional(),
  algorithm: nonEmptyString.optional(),
  stripMetadata: z.boolean().optional(),
  pngPaletteColors: z.number().int().min(2).max(256).optional(),
  operations: ManifestPostProcessOperationsSchema.optional(),
});

export const ManifestEditInputSchema = EditInputSchema;

export const ManifestEditSchema = EditSchema;

export const ManifestAuxiliaryMapsSchema = AuxiliaryMapsSchema;

export const ManifestPalettePolicySchema = PalettePolicyBaseSchema.superRefine((palette, ctx) => {
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

  if (palette.mode !== "exact" && palette.strict !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["strict"],
      message: "Palette strict mode is only supported for exact palettes.",
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
  topology: z
    .object({
      mode: z.enum(WRAP_GRID_TOPOLOGY_MODES),
      maxMismatchRatio: z.number().min(0).max(1).optional(),
      colorTolerance: z.number().int().min(0).max(255).optional(),
    })
    .optional(),
});

export const ManifestTargetSchema = z
  .object({
    id: nonEmptyString,
    kind: nonEmptyString,
    out: nonEmptyString,
    templateId: nonEmptyString.optional(),
    dependsOn: ManifestTargetReferenceListSchema.optional(),
    styleReferenceFrom: ManifestTargetReferenceListSchema.optional(),
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
    controlImage: nonEmptyString.optional(),
    controlMode: ManifestControlModeSchema.optional(),
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

    if (target.controlImage && !target.controlMode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["controlMode"],
        message: "controlMode is required when controlImage is set.",
      });
    }
    if (target.controlMode && !target.controlImage) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["controlImage"],
        message: "controlImage is required when controlMode is set.",
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
  local: ManifestProviderConfigSchema.extend({
    baseUrl: nonEmptyString.optional(),
  }).optional(),
});

export const ManifestStyleKitSchema = z
  .object({
    id: nonEmptyString,
    rulesPath: nonEmptyString,
    palettePath: nonEmptyString.optional(),
    referenceImages: z.array(nonEmptyString).default([]),
    styleReferenceImages: z.array(nonEmptyString).default([]),
    lightingModel: nonEmptyString,
    negativeRulesPath: nonEmptyString.optional(),
    loraPath: nonEmptyString.optional(),
    loraStrength: z.number().min(0).max(2).optional(),
    visualPolicy: z
      .object({
        lineContrastMin: z.number().min(0).max(1).optional(),
        shadingBandCountMax: z.number().int().min(1).max(256).optional(),
        uiRectilinearityMin: z.number().min(0).max(1).optional(),
      })
      .optional(),
  })
  .superRefine((styleKit, ctx) => {
    if (typeof styleKit.loraStrength === "number" && !styleKit.loraPath) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["loraPath"],
        message: "loraPath is required when loraStrength is provided.",
      });
    }

    if (
      styleKit.visualPolicy &&
      styleKit.visualPolicy.lineContrastMin === undefined &&
      styleKit.visualPolicy.shadingBandCountMax === undefined &&
      styleKit.visualPolicy.uiRectilinearityMin === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["visualPolicy"],
        message: "visualPolicy must define at least one constraint.",
      });
    }
  });

export const ManifestConsistencyGroupSchema = z.object({
  id: nonEmptyString,
  description: nonEmptyString.optional(),
  styleKitId: nonEmptyString.optional(),
  referenceImages: z.array(nonEmptyString).default([]),
});

export const ManifestTargetTemplateSchema = z.object({
  id: nonEmptyString,
  dependsOn: ManifestTargetReferenceListSchema.optional(),
  styleReferenceFrom: ManifestTargetReferenceListSchema.optional(),
});

export const ManifestScoreWeightsSchema = ScoreWeightsSchema;

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
      mattingHiddenRgbLeakMax: z.number().min(0).max(1).optional(),
      mattingMaskConsistencyMin: z.number().min(0).max(1).optional(),
      mattingSemiTransparencyRatioMax: z.number().min(0).max(1).optional(),
      packTextureBudgetMB: z.number().positive().optional(),
      spritesheetSilhouetteDriftMax: z.number().min(0).max(1).optional(),
      spritesheetAnchorDriftMax: z.number().min(0).max(1).optional(),
      spritesheetIdentityDriftMax: z.number().min(0).max(1).optional(),
      spritesheetPoseDriftMax: z.number().min(0).max(1).optional(),
    })
    .optional(),
  consistencyGroupScoring: z
    .object({
      warningThreshold: z.number().positive().optional(),
      penaltyThreshold: z.number().positive().optional(),
      penaltyWeight: z.number().min(0).optional(),
    })
    .optional(),
  scoreWeights: ManifestScoreWeightsSchema.optional(),
});

export const ManifestKindScoreWeightsSchema = z.object({
  sprite: ManifestScoreWeightsSchema.optional(),
  tile: ManifestScoreWeightsSchema.optional(),
  background: ManifestScoreWeightsSchema.optional(),
  effect: ManifestScoreWeightsSchema.optional(),
  spritesheet: ManifestScoreWeightsSchema.optional(),
});

export const ManifestScoringProfileSchema = z.object({
  id: nonEmptyString,
  scoreWeights: ManifestScoreWeightsSchema.optional(),
  kindScoreWeights: ManifestKindScoreWeightsSchema.optional(),
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
  targetTemplates: z.array(ManifestTargetTemplateSchema).optional(),
  consistencyGroups: z.array(ManifestConsistencyGroupSchema).optional(),
  evaluationProfiles: z.array(ManifestEvaluationProfileSchema).min(1),
  scoringProfiles: z.array(ManifestScoringProfileSchema).optional(),
  atlas: ManifestAtlasSchema.optional(),
  targets: z.array(ManifestTargetSchema).min(1),
});

export function safeParseManifestV2(input: unknown) {
  return ManifestV2Schema.safeParse(input);
}
