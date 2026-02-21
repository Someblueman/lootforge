import { z } from "zod";

import {
  CONTROL_MODES,
  GENERATION_MODES,
  PROVIDER_NAMES,
} from "../providers/types-core.js";

// ---------- Primitives ----------

export const nonEmptyString = z.string().trim().min(1);

// ---------- Enum schemas ----------

export const ProviderNameSchema = z.enum(PROVIDER_NAMES);
export const GenerationModeSchema = z.enum(GENERATION_MODES);
export const ControlModeSchema = z.enum(CONTROL_MODES);

// ---------- Exact-duplicate schemas ----------

export const EditInputSchema = z.object({
  path: nonEmptyString,
  role: z.enum(["base", "mask", "reference"]).optional(),
  fidelity: z.enum(["low", "medium", "high"]).optional(),
});

export const EditSchema = z.object({
  mode: z.enum(["edit", "iterate"]).optional(),
  instruction: nonEmptyString.optional(),
  inputs: z.array(EditInputSchema).optional(),
  preserveComposition: z.boolean().optional(),
});

export const AuxiliaryMapsSchema = z.object({
  normalFromHeight: z.boolean().optional(),
  specularFromLuma: z.boolean().optional(),
  aoFromLuma: z.boolean().optional(),
});

export const ScoreWeightsSchema = z.object({
  readability: z.number().optional(),
  fileSize: z.number().optional(),
  consistency: z.number().optional(),
  clip: z.number().optional(),
  lpips: z.number().optional(),
  ssim: z.number().optional(),
});

export const AcceptanceSchema = z.object({
  size: nonEmptyString.optional(),
  alpha: z.boolean().optional(),
  maxFileSizeKB: z.number().int().positive().optional(),
});

export const VlmGateSchema = z.object({
  threshold: z.number().min(0).max(5).optional(),
  rubric: nonEmptyString.optional(),
});

export const HiresFixSchema = z.object({
  enabled: z.boolean().optional(),
  upscale: z.number().min(1.01).max(4).optional(),
  denoiseStrength: z.number().min(0).max(1).optional(),
});

// ---------- Near-duplicate base shapes ----------

/** Base shape for PromptSpec. Manifest overrides optional fields to nonEmptyString. */
export const PromptSpecBaseShape = {
  primary: nonEmptyString,
  useCase: z.string().optional(),
  stylePreset: z.string().optional(),
  scene: z.string().optional(),
  subject: z.string().optional(),
  style: z.string().optional(),
  composition: z.string().optional(),
  lighting: z.string().optional(),
  palette: z.string().optional(),
  materials: z.string().optional(),
  constraints: z.string().optional(),
  negative: z.string().optional(),
};

/** Base CoarseToFine schema with all fields optional. Contracts makes some required. */
export const CoarseToFineBaseSchema = z.object({
  enabled: z.boolean().optional(),
  promoteTopK: z.number().int().min(1).optional(),
  minDraftScore: z.number().optional(),
  requireDraftAcceptance: z.boolean().optional(),
});

/** Base RuntimeSpec schema without bounds on anchorX/Y. Manifest adds .min(0).max(1). */
export const RuntimeSpecBaseSchema = z.object({
  alphaRequired: z.boolean().optional(),
  previewWidth: z.number().int().positive().optional(),
  previewHeight: z.number().int().positive().optional(),
  anchorX: z.number().optional(),
  anchorY: z.number().optional(),
});

/** Base PalettePolicy schema without superRefine. Manifest adds mode-specific validation. */
export const PalettePolicyBaseSchema = z.object({
  mode: z.enum(["exact", "max-colors"]),
  colors: z.array(nonEmptyString).optional(),
  maxColors: z.number().int().min(2).max(256).optional(),
  dither: z.number().min(0).max(1).optional(),
  strict: z.boolean().optional(),
});
