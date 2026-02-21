import { readFile } from "node:fs/promises";

import { z } from "zod";

import {
  AcceptanceSchema,
  AuxiliaryMapsSchema,
  CoarseToFineBaseSchema,
  ControlModeSchema,
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
import { formatIssuePath as formatPathBase } from "../shared/zod.js";

const promptSpecSchema = z.object(PromptSpecBaseShape);

const generationPolicySchema = z.object({
  size: nonEmptyString,
  quality: nonEmptyString,
  draftQuality: nonEmptyString.optional(),
  finalQuality: nonEmptyString.optional(),
  background: nonEmptyString,
  outputFormat: z.enum(["png", "jpeg", "webp"]),
  highQuality: z.boolean().optional(),
  hiresFix: HiresFixSchema.optional(),
  candidates: z.number().int().min(1),
  maxRetries: z.number().int().min(0),
  fallbackProviders: z.array(ProviderNameSchema),
  providerConcurrency: z.number().int().positive().optional(),
  rateLimitPerMinute: z.number().int().positive().optional(),
  vlmGate: VlmGateSchema.optional(),
  coarseToFine: CoarseToFineBaseSchema.extend({
    enabled: z.boolean(),
    promoteTopK: z.number().int().min(1),
    requireDraftAcceptance: z.boolean(),
  }).optional(),
});

const resizeVariantSchema = z.object({
  name: nonEmptyString,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  algorithm: z.enum(["nearest", "lanczos3"]).optional(),
});

const postProcessSchema = z.object({
  resizeTo: z
    .object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
    .optional(),
  algorithm: z.enum(["nearest", "lanczos3"]).optional(),
  stripMetadata: z.boolean().optional(),
  pngPaletteColors: z.number().int().min(2).max(256).optional(),
  operations: z
    .object({
      trim: z
        .object({
          enabled: z.boolean().optional(),
          threshold: z.number().min(0).max(255).optional(),
        })
        .optional(),
      pad: z
        .object({
          pixels: z.number().int().min(0),
          extrude: z.boolean().optional(),
          background: nonEmptyString.optional(),
        })
        .optional(),
      quantize: z
        .object({
          colors: z.number().int().min(2).max(256),
          dither: z.number().min(0).max(1).optional(),
        })
        .optional(),
      outline: z
        .object({
          size: z.number().int().min(1).max(64),
          color: nonEmptyString.optional(),
        })
        .optional(),
      resizeVariants: z
        .object({
          variants: z.array(resizeVariantSchema),
        })
        .optional(),
      pixelPerfect: z
        .object({
          enabled: z.boolean().optional(),
          scale: z.number().int().min(1).max(16).optional(),
        })
        .optional(),
      smartCrop: z
        .object({
          enabled: z.boolean().optional(),
          mode: z.enum(["alpha-bounds", "center"]).optional(),
          padding: z.number().int().min(0).max(256).optional(),
        })
        .optional(),
      emitVariants: z
        .object({
          raw: z.boolean().optional(),
          pixel: z.boolean().optional(),
          styleRef: z.boolean().optional(),
        })
        .optional(),
    })
    .optional(),
});

const regenerationSourceSchema = z.object({
  mode: z.enum(["selection-lock", "selection-lock-edit"]),
  selectionLockPath: nonEmptyString,
  selectionLockGeneratedAt: nonEmptyString.optional(),
  lockInputHash: nonEmptyString,
  lockSelectedOutputPath: nonEmptyString,
});

const plannedTargetSchema = z.object({
  id: nonEmptyString,
  kind: nonEmptyString.optional(),
  out: nonEmptyString,
  templateId: nonEmptyString.optional(),
  dependsOn: z.array(nonEmptyString).optional(),
  styleReferenceFrom: z.array(nonEmptyString).optional(),
  atlasGroup: z.union([nonEmptyString, z.null()]).optional(),
  styleKitId: nonEmptyString.optional(),
  styleReferenceImages: z.array(nonEmptyString).optional(),
  loraPath: nonEmptyString.optional(),
  loraStrength: z.number().min(0).max(2).optional(),
  consistencyGroup: nonEmptyString.optional(),
  generationMode: GenerationModeSchema.optional(),
  evaluationProfileId: nonEmptyString.optional(),
  scoringProfile: nonEmptyString.optional(),
  controlImage: nonEmptyString.optional(),
  controlMode: ControlModeSchema.optional(),
  scoreWeights: ScoreWeightsSchema.optional(),
  tileable: z.boolean().optional(),
  seamThreshold: z.number().optional(),
  seamStripPx: z.number().int().positive().optional(),
  alphaHaloRiskMax: z.number().min(0).max(1).optional(),
  alphaStrayNoiseMax: z.number().min(0).max(1).optional(),
  alphaEdgeSharpnessMin: z.number().min(0).max(1).optional(),
  packTextureBudgetMB: z.number().positive().optional(),
  spritesheetSilhouetteDriftMax: z.number().min(0).max(1).optional(),
  spritesheetAnchorDriftMax: z.number().min(0).max(1).optional(),
  seamHeal: z
    .object({
      enabled: z.boolean().optional(),
      stripPx: z.number().int().positive().optional(),
      strength: z.number().min(0).max(1).optional(),
    })
    .optional(),
  wrapGrid: z
    .object({
      columns: z.number().int().positive(),
      rows: z.number().int().positive(),
      seamThreshold: z.number().optional(),
      seamStripPx: z.number().int().positive().optional(),
    })
    .optional(),
  palette: PalettePolicyBaseSchema.optional(),
  generationDisabled: z.boolean().optional(),
  catalogDisabled: z.boolean().optional(),
  spritesheet: z
    .object({
      sheetTargetId: nonEmptyString,
      isSheet: z.boolean().optional(),
      animations: z
        .array(
          z.object({
            name: nonEmptyString,
            count: z.number().int().positive(),
            fps: z.number().optional(),
            loop: z.boolean().optional(),
            pivot: z
              .object({
                x: z.number(),
                y: z.number(),
              })
              .optional(),
          }),
        )
        .optional(),
      animationName: nonEmptyString.optional(),
      frameIndex: z.number().int().min(0).optional(),
      frameCount: z.number().int().positive().optional(),
      fps: z.number().optional(),
      loop: z.boolean().optional(),
      pivot: z
        .object({
          x: z.number(),
          y: z.number(),
        })
        .optional(),
    })
    .optional(),
  acceptance: AcceptanceSchema.optional(),
  runtimeSpec: RuntimeSpecBaseSchema.optional(),
  promptSpec: promptSpecSchema,
  generationPolicy: generationPolicySchema.optional(),
  postProcess: postProcessSchema.optional(),
  provider: ProviderNameSchema.optional(),
  model: nonEmptyString.optional(),
  edit: EditSchema.optional(),
  regenerationSource: regenerationSourceSchema.optional(),
  auxiliaryMaps: AuxiliaryMapsSchema.optional(),
});

const candidateScoreSchema = z.object({
  outputPath: nonEmptyString,
  score: z.number(),
  passedAcceptance: z.boolean(),
  reasons: z.array(nonEmptyString),
  stage: z.enum(["draft", "refine"]).optional(),
  promoted: z.boolean().optional(),
  sourceOutputPath: nonEmptyString.optional(),
  components: z.record(z.number()).optional(),
  metrics: z.record(z.number()).optional(),
  vlm: z
    .object({
      score: z.number().min(0).max(5),
      threshold: z.number().min(0).max(5),
      maxScore: z.number().min(1),
      passed: z.boolean(),
      reason: nonEmptyString,
      rubric: nonEmptyString.optional(),
      evaluator: z.enum(["command", "http"]),
    })
    .optional(),
  warnings: z.array(nonEmptyString).optional(),
  selected: z.boolean().optional(),
});

const packInvariantIssueSchema = z.object({
  level: z.enum(["error", "warning"]),
  code: nonEmptyString,
  message: nonEmptyString,
  targetIds: z.array(nonEmptyString).min(1),
  evaluationProfileId: nonEmptyString.optional(),
  metrics: z.record(z.number()).optional(),
});

const packInvariantSummarySchema = z.object({
  errors: z.number().int().min(0),
  warnings: z.number().int().min(0),
  issues: z.array(packInvariantIssueSchema),
  metrics: z
    .object({
      textureBudgetMBByProfile: z
        .record(
          z.object({
            estimatedMB: z.number(),
            budgetMB: z.number().optional(),
            targetCount: z.number().int().min(0),
          }),
        )
        .optional(),
      spritesheetContinuityByAnimation: z
        .record(
          z.object({
            comparisons: z.number().int().min(0),
            maxSilhouetteDrift: z.number(),
            maxAnchorDrift: z.number(),
          }),
        )
        .optional(),
    })
    .optional(),
});

const stageArtifactSchemas = {
  "targets-index": z.object({
    generatedAt: nonEmptyString.optional(),
    manifestPath: nonEmptyString.optional(),
    targets: z.array(plannedTargetSchema).min(1),
  }),
  "provenance-run": z.object({
    runId: nonEmptyString,
    inputHash: nonEmptyString,
    startedAt: nonEmptyString,
    finishedAt: nonEmptyString,
    generatedAt: nonEmptyString,
    jobs: z.array(
      z.object({
        jobId: nonEmptyString,
        provider: ProviderNameSchema,
        model: nonEmptyString,
        targetId: nonEmptyString,
        inputHash: nonEmptyString,
        startedAt: nonEmptyString,
        finishedAt: nonEmptyString,
        outputPath: nonEmptyString,
        bytesWritten: z.number().int().min(0).optional(),
        skipped: z.boolean().optional(),
        candidateOutputs: z
          .array(
            z.object({
              outputPath: nonEmptyString,
              bytesWritten: z.number().int().min(0),
            }),
          )
          .optional(),
        candidateScores: z.array(candidateScoreSchema).optional(),
        coarseToFine: z
          .object({
            enabled: z.boolean(),
            draftQuality: nonEmptyString,
            finalQuality: nonEmptyString,
            promoteTopK: z.number().int().min(1),
            minDraftScore: z.number().optional(),
            requireDraftAcceptance: z.boolean(),
            draftCandidateCount: z.number().int().min(0),
            promoted: z.array(
              z.object({
                outputPath: nonEmptyString,
                score: z.number(),
                passedAcceptance: z.boolean(),
                refinedOutputPath: nonEmptyString.optional(),
              }),
            ),
            discarded: z.array(
              z.object({
                outputPath: nonEmptyString,
                score: z.number(),
                passedAcceptance: z.boolean(),
                reason: nonEmptyString,
              }),
            ),
            skippedReason: nonEmptyString.optional(),
            warnings: z.array(nonEmptyString).optional(),
          })
          .optional(),
        styleReferenceLineage: z
          .array(
            z.object({
              source: z.enum(["style-kit", "target-output"]),
              reference: nonEmptyString,
              sourceTargetId: nonEmptyString.optional(),
              resolvedPath: nonEmptyString.optional(),
            }),
          )
          .optional(),
        generationMode: GenerationModeSchema.optional(),
        edit: EditSchema.optional(),
        regenerationSource: regenerationSourceSchema.optional(),
        warnings: z.array(nonEmptyString).optional(),
      }),
    ),
    failures: z
      .array(
        z.object({
          targetId: nonEmptyString,
          provider: ProviderNameSchema,
          attemptedProviders: z.array(ProviderNameSchema),
          message: nonEmptyString,
        }),
      )
      .optional(),
  }),
  "acceptance-report": z.object({
    generatedAt: nonEmptyString,
    imagesDir: nonEmptyString,
    strict: z.boolean(),
    total: z.number().int().min(0),
    passed: z.number().int().min(0),
    failed: z.number().int().min(0),
    errors: z.number().int().min(0),
    warnings: z.number().int().min(0),
    packInvariants: packInvariantSummarySchema.optional(),
    items: z.array(
      z.object({
        targetId: nonEmptyString,
        out: nonEmptyString,
        imagePath: nonEmptyString,
        exists: z.boolean(),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
        format: nonEmptyString.optional(),
        sizeBytes: z.number().int().min(0).optional(),
        hasAlphaChannel: z.boolean().optional(),
        hasTransparentPixels: z.boolean().optional(),
        metrics: z
          .object({
            seamScore: z.number().optional(),
            seamStripPx: z.number().optional(),
            wrapGridColumns: z.number().optional(),
            wrapGridRows: z.number().optional(),
            wrapGridSeamScore: z.number().optional(),
            wrapGridSeamStripPx: z.number().optional(),
            paletteCompliance: z.number().optional(),
            distinctColors: z.number().optional(),
            alphaBoundaryPixels: z.number().optional(),
            alphaHaloRisk: z.number().optional(),
            alphaStrayNoise: z.number().optional(),
            alphaEdgeSharpness: z.number().optional(),
          })
          .optional(),
        issues: z.array(
          z.object({
            level: z.enum(["error", "warning"]),
            code: nonEmptyString,
            targetId: nonEmptyString,
            imagePath: nonEmptyString,
            message: nonEmptyString,
          }),
        ),
      }),
    ),
  }),
  "eval-report": z.object({
    generatedAt: nonEmptyString,
    strict: z.boolean(),
    imagesDir: nonEmptyString,
    targetCount: z.number().int().min(0),
    passed: z.number().int().min(0),
    failed: z.number().int().min(0),
    hardErrors: z.number().int().min(0),
    adaptersUsed: z.array(z.enum(["clip", "lpips", "ssim"])),
    adapterHealth: z.object({
      configured: z.array(z.enum(["clip", "lpips", "ssim"])),
      active: z.array(z.enum(["clip", "lpips", "ssim"])),
      failed: z.array(z.enum(["clip", "lpips", "ssim"])),
      adapters: z.array(
        z.object({
          name: z.enum(["clip", "lpips", "ssim"]),
          mode: z.enum(["command", "http", "unconfigured"]),
          configured: z.boolean(),
          active: z.boolean(),
          failed: z.boolean(),
          attemptedTargets: z.number().int().min(0),
          successfulTargets: z.number().int().min(0),
          failedTargets: z.number().int().min(0),
          warningCount: z.number().int().min(0),
          warnings: z.array(nonEmptyString),
        }),
      ),
    }),
    adapterWarnings: z.array(nonEmptyString),
    consistencyGroupSummary: z
      .array(
        z.object({
          consistencyGroup: nonEmptyString,
          targetCount: z.number().int().min(0),
          evaluatedTargetCount: z.number().int().min(0),
          outlierTargetIds: z.array(nonEmptyString),
          metricMedians: z.record(z.number()),
        }),
      )
      .optional(),
    packInvariants: packInvariantSummarySchema.optional(),
    targets: z.array(
      z.object({
        targetId: nonEmptyString,
        out: nonEmptyString,
        consistencyGroup: nonEmptyString.optional(),
        passedHardGates: z.boolean(),
        hardGateErrors: z.array(nonEmptyString),
        hardGateWarnings: z.array(nonEmptyString),
        acceptanceMetrics: z.record(z.number()).optional(),
        candidateScore: z.number().optional(),
        candidateReasons: z.array(nonEmptyString).optional(),
        candidateMetrics: z.record(z.number()).optional(),
        candidateVlm: z
          .object({
            score: z.number().min(0).max(5),
            threshold: z.number().min(0).max(5),
            maxScore: z.number().min(1),
            passed: z.boolean(),
            reason: nonEmptyString,
            rubric: nonEmptyString.optional(),
            evaluator: z.enum(["command", "http"]),
          })
          .optional(),
        candidateVlmGrades: z
          .array(
            z.object({
              outputPath: nonEmptyString,
              selected: z.boolean(),
              score: z.number().min(0).max(5),
              threshold: z.number().min(0).max(5),
              maxScore: z.number().min(1),
              passed: z.boolean(),
              reason: nonEmptyString,
              rubric: nonEmptyString.optional(),
              evaluator: z.enum(["command", "http"]),
            }),
          )
          .optional(),
        adapterMetrics: z.record(z.number()).optional(),
        adapterScore: z.number().optional(),
        adapterScoreComponents: z.record(z.number()).optional(),
        adapterWarnings: z.array(nonEmptyString).optional(),
        consistencyGroupOutlier: z
          .object({
            score: z.number(),
            threshold: z.number(),
            penalty: z.number().int().min(0),
            reasons: z.array(nonEmptyString),
            metricDeltas: z.record(z.number()),
          })
          .optional(),
        finalScore: z.number(),
      }),
    ),
  }),
  "selection-lock": z.object({
    generatedAt: nonEmptyString,
    evalReportPath: nonEmptyString,
    provenancePath: nonEmptyString,
    targets: z.array(
      z.object({
        targetId: nonEmptyString,
        approved: z.boolean(),
        inputHash: nonEmptyString,
        selectedOutputPath: nonEmptyString,
        provider: ProviderNameSchema.optional(),
        model: nonEmptyString.optional(),
        score: z.number().optional(),
      }),
    ),
  }),
} as const;

export type StageArtifactKind = keyof typeof stageArtifactSchemas;
export type StageArtifactShape<K extends StageArtifactKind> = z.infer<
  (typeof stageArtifactSchemas)[K]
>;

export const STAGE_ARTIFACT_CONTRACT_VERSION = "0.3.0-stage-contract-v1";

export interface StageArtifactDiagnostic {
  path: string;
  code: string;
  message: string;
}

type StageArtifactContractErrorCode =
  | "stage_artifact_json_invalid"
  | "stage_artifact_contract_invalid";

interface StageArtifactContractErrorInit {
  code: StageArtifactContractErrorCode;
  kind: StageArtifactKind;
  artifactPath: string;
  diagnostics: StageArtifactDiagnostic[];
  cause?: unknown;
}

export class StageArtifactContractError extends Error {
  readonly code: StageArtifactContractErrorCode;
  readonly kind: StageArtifactKind;
  readonly artifactPath: string;
  readonly diagnostics: StageArtifactDiagnostic[];
  declare readonly cause?: unknown;

  constructor(init: StageArtifactContractErrorInit) {
    const first = init.diagnostics[0] as StageArtifactDiagnostic | undefined;
    super(
      first
        ? `[${init.code}] ${init.kind} failed at ${first.path}: ${first.message}`
        : `[${init.code}] ${init.kind} validation failed.`,
    );
    this.name = "StageArtifactContractError";
    this.code = init.code;
    this.kind = init.kind;
    this.artifactPath = init.artifactPath;
    this.diagnostics = init.diagnostics;
    this.cause = init.cause;
  }
}

export function validateStageArtifact<K extends StageArtifactKind>(
  kind: K,
  value: unknown,
  artifactPath: string,
): StageArtifactShape<K> {
  const schema = stageArtifactSchemas[kind];
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new StageArtifactContractError({
      code: "stage_artifact_contract_invalid",
      kind,
      artifactPath,
      diagnostics: parsed.error.issues.map((issue) => ({
        path: formatIssuePath(issue.path),
        code: issue.code,
        message: issue.message,
      })),
    });
  }

  return parsed.data as StageArtifactShape<K>;
}

export async function readAndValidateStageArtifact<K extends StageArtifactKind>(
  kind: K,
  artifactPath: string,
): Promise<StageArtifactShape<K>> {
  let raw: string;
  try {
    raw = await readFile(artifactPath, "utf8");
  } catch (error) {
    throw new StageArtifactContractError({
      code: "stage_artifact_json_invalid",
      kind,
      artifactPath,
      diagnostics: [
        {
          path: "$",
          code: "read_error",
          message:
            error instanceof Error
              ? error.message
              : `Unable to read artifact file: ${String(error)}`,
        },
      ],
      cause: error,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new StageArtifactContractError({
      code: "stage_artifact_json_invalid",
      kind,
      artifactPath,
      diagnostics: [
        {
          path: "$",
          code: "invalid_json",
          message:
            error instanceof Error ? error.message : `Unable to parse JSON: ${String(error)}`,
        },
      ],
      cause: error,
    });
  }

  return validateStageArtifact(kind, parsed, artifactPath);
}

function formatIssuePath(pathItems: (string | number)[]): string {
  if (pathItems.length === 0) {
    return "$";
  }
  const base = formatPathBase(pathItems);
  if (typeof pathItems[0] === "string") {
    return base.startsWith("[") ? `$${base}` : `$.${base}`;
  }
  return base;
}
