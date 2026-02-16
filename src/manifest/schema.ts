import { z } from "zod";

const nonEmptyString = z.string().trim().min(1);

export const ProviderNameSchema = z.enum(["openai", "nano"]);

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

export const ManifestGenerationPolicySchema = z.object({
  size: nonEmptyString.optional(),
  background: nonEmptyString.optional(),
  outputFormat: nonEmptyString.optional(),
  quality: nonEmptyString.optional(),
  draftQuality: nonEmptyString.optional(),
  finalQuality: nonEmptyString.optional(),
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
});

export const ManifestPostProcessSchema = z.object({
  resizeTo: z.union([nonEmptyString, z.number().int().positive()]).optional(),
  algorithm: nonEmptyString.optional(),
  stripMetadata: z.boolean().optional(),
  pngPaletteColors: z.number().int().min(2).max(256).optional(),
});

export const ManifestTargetSchema = z
  .object({
    id: nonEmptyString,
    kind: nonEmptyString,
    out: nonEmptyString,
    atlasGroup: nonEmptyString.optional(),
    prompt: z.union([nonEmptyString, PromptSpecSchema]).optional(),
    promptSpec: PromptSpecSchema.optional(),
    generationPolicy: ManifestGenerationPolicySchema.optional(),
    postProcess: ManifestPostProcessSchema.optional(),
    acceptance: ManifestAcceptanceSchema.optional(),
    runtimeSpec: ManifestRuntimeSpecSchema.optional(),
    provider: ProviderNameSchema.optional(),
    model: nonEmptyString.optional(),
  })
  .superRefine((target, ctx) => {
    if (target.prompt === undefined && target.promptSpec === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["prompt"],
        message: "Each target requires `prompt` or `promptSpec`.",
      });
    }
  });

export const ManifestPackSchema = z.object({
  id: nonEmptyString,
  version: nonEmptyString,
  license: nonEmptyString.optional(),
  author: nonEmptyString.optional(),
});

export const ManifestProvidersSchema = z.object({
  default: ProviderNameSchema.default("openai"),
  openai: z
    .object({
      model: nonEmptyString.optional(),
    })
    .optional(),
  nano: z
    .object({
      model: nonEmptyString.optional(),
    })
    .optional(),
});

export const ManifestV2Schema = z.object({
  version: z
    .union([
      z.literal(2),
      z.literal("2"),
      z.literal("2.0"),
      z.literal("2.0.0"),
      z.literal("v2"),
    ])
    .optional(),
  pack: ManifestPackSchema,
  providers: ManifestProvidersSchema,
  styleGuide: z.record(z.unknown()).optional(),
  targets: z.array(ManifestTargetSchema).min(1),
});

export function safeParseManifestV2(input: unknown) {
  return ManifestV2Schema.safeParse(input);
}
