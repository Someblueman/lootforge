export const PROVIDER_NAMES = ["openai", "nano", "local"] as const;
export const KNOWN_STYLE_PRESETS = [
  "pixel-art-16bit",
  "topdown-painterly-sci-fi",
] as const;
export const POST_PROCESS_ALGORITHMS = ["nearest", "lanczos3"] as const;
export const TARGET_KINDS = [
  "sprite",
  "tile",
  "background",
  "effect",
  "spritesheet",
] as const;
export const CONTROL_MODES = ["canny", "depth", "openpose"] as const;

export type ProviderName = (typeof PROVIDER_NAMES)[number];
export type ProviderSelection = ProviderName | "auto";
export type ProviderFeature =
  | "image-generation"
  | "transparent-background"
  | "image-edits"
  | "multi-candidate"
  | "controlnet";
export type KnownStylePreset = (typeof KNOWN_STYLE_PRESETS)[number];
export type PostProcessAlgorithm = (typeof POST_PROCESS_ALGORITHMS)[number];
export type NormalizedOutputFormat = "png" | "jpeg" | "webp";
export type TargetKind = (typeof TARGET_KINDS)[number];
export type ControlMode = (typeof CONTROL_MODES)[number];
export type GenerationMode = "text" | "edit-first";
export type PaletteMode = "exact" | "max-colors";

export interface ProviderCapabilities {
  readonly name: ProviderName;
  readonly defaultOutputFormat: NormalizedOutputFormat;
  readonly supportedOutputFormats: ReadonlySet<NormalizedOutputFormat>;
  readonly supportsTransparentBackground: boolean;
  readonly supportsEdits: boolean;
  readonly supportsControlNet: boolean;
  readonly maxCandidates: number;
  readonly defaultConcurrency: number;
  readonly minDelayMs: number;
}

const SUPPORTED_FORMATS: ReadonlySet<NormalizedOutputFormat> = new Set([
  "png",
  "jpeg",
  "webp",
]);

export const PROVIDER_CAPABILITIES: Record<ProviderName, ProviderCapabilities> =
  {
    openai: {
      name: "openai",
      defaultOutputFormat: "png",
      supportedOutputFormats: SUPPORTED_FORMATS,
      supportsTransparentBackground: true,
      supportsEdits: true,
      supportsControlNet: false,
      maxCandidates: 8,
      defaultConcurrency: 2,
      minDelayMs: 250,
    },
    nano: {
      name: "nano",
      defaultOutputFormat: "png",
      supportedOutputFormats: SUPPORTED_FORMATS,
      supportsTransparentBackground: false,
      supportsEdits: true,
      supportsControlNet: false,
      maxCandidates: 4,
      defaultConcurrency: 2,
      minDelayMs: 350,
    },
    local: {
      name: "local",
      defaultOutputFormat: "png",
      supportedOutputFormats: SUPPORTED_FORMATS,
      supportsTransparentBackground: true,
      supportsEdits: true,
      supportsControlNet: true,
      maxCandidates: 8,
      defaultConcurrency: 2,
      minDelayMs: 100,
    },
  };

export interface PromptSpec {
  primary: string;
  useCase?: string;
  stylePreset?: string;
  scene?: string;
  subject?: string;
  style?: string;
  composition?: string;
  lighting?: string;
  palette?: string;
  materials?: string;
  constraints?: string;
  negative?: string;
}

export interface PalettePolicy {
  mode: PaletteMode;
  colors?: string[];
  maxColors?: number;
  dither?: number;
  strict?: boolean;
}

export interface CoarseToFinePolicy {
  enabled?: boolean;
  promoteTopK?: number;
  minDraftScore?: number;
  requireDraftAcceptance?: boolean;
}

export interface GenerationPolicy {
  size?: string;
  background?: "transparent" | "opaque" | string;
  outputFormat?: string;
  quality?: string;
  draftQuality?: string;
  finalQuality?: string;
  highQuality?: boolean;
  hiresFix?: {
    enabled?: boolean;
    upscale?: number;
    denoiseStrength?: number;
  };
  candidates?: number;
  maxRetries?: number;
  fallbackProviders?: ProviderName[];
  providerConcurrency?: number;
  rateLimitPerMinute?: number;
  vlmGate?: VlmGatePolicy;
  coarseToFine?: CoarseToFinePolicy;
}

export interface VlmGatePolicy {
  threshold?: number;
  rubric?: string;
}

export interface TrimOperation {
  enabled?: boolean;
  threshold?: number;
}

export interface PadOperation {
  pixels: number;
  extrude?: boolean;
  background?: string;
}

export interface QuantizeOperation {
  colors: number;
  dither?: number;
}

export interface OutlineOperation {
  size: number;
  color?: string;
}

export interface ResizeVariant {
  name: string;
  width: number;
  height: number;
  algorithm?: PostProcessAlgorithm;
}

export interface ResizeVariantsOperation {
  variants: ResizeVariant[];
}

export interface PixelPerfectOperation {
  enabled?: boolean;
  scale?: number;
}

export interface SmartCropOperation {
  enabled?: boolean;
  mode?: "alpha-bounds" | "center";
  padding?: number;
}

export interface VariantOutputsOperation {
  raw?: boolean;
  pixel?: boolean;
  styleRef?: boolean;
}

export interface PostProcessOperations {
  trim?: TrimOperation;
  pad?: PadOperation;
  quantize?: QuantizeOperation;
  outline?: OutlineOperation;
  resizeVariants?: ResizeVariantsOperation;
  pixelPerfect?: PixelPerfectOperation;
  smartCrop?: SmartCropOperation;
  emitVariants?: VariantOutputsOperation;
}

export interface PostProcessPolicy {
  resizeTo?: {
    width: number;
    height: number;
  };
  algorithm?: PostProcessAlgorithm;
  stripMetadata?: boolean;
  pngPaletteColors?: number;
  operations?: PostProcessOperations;
}

export interface TargetEditInput {
  path: string;
  role?: "base" | "mask" | "reference";
  fidelity?: "low" | "medium" | "high";
}

export interface TargetEditSpec {
  mode?: "edit" | "iterate";
  instruction?: string;
  inputs?: TargetEditInput[];
  preserveComposition?: boolean;
}

export interface RegenerationSource {
  mode: "selection-lock" | "selection-lock-edit";
  selectionLockPath: string;
  selectionLockGeneratedAt?: string;
  lockInputHash: string;
  lockSelectedOutputPath: string;
}

export interface AuxiliaryMapPolicy {
  normalFromHeight?: boolean;
  specularFromLuma?: boolean;
  aoFromLuma?: boolean;
}

export interface TargetScoreWeights {
  readability?: number;
  fileSize?: number;
  consistency?: number;
  clip?: number;
  lpips?: number;
  ssim?: number;
}

export interface SeamHealPolicy {
  enabled?: boolean;
  stripPx?: number;
  strength?: number;
}

export interface WrapGridPolicy {
  columns: number;
  rows: number;
  seamThreshold?: number;
  seamStripPx?: number;
}

export interface PlannedTarget {
  id: string;
  kind?: string;
  out: string;
  atlasGroup?: string | null;
  styleKitId?: string;
  styleReferenceImages?: string[];
  loraPath?: string;
  loraStrength?: number;
  consistencyGroup?: string;
  generationMode?: GenerationMode;
  evaluationProfileId?: string;
  scoringProfile?: string;
  controlImage?: string;
  controlMode?: ControlMode;
  scoreWeights?: TargetScoreWeights;
  tileable?: boolean;
  seamThreshold?: number;
  seamStripPx?: number;
  alphaHaloRiskMax?: number;
  alphaStrayNoiseMax?: number;
  alphaEdgeSharpnessMin?: number;
  packTextureBudgetMB?: number;
  spritesheetSilhouetteDriftMax?: number;
  spritesheetAnchorDriftMax?: number;
  seamHeal?: SeamHealPolicy;
  wrapGrid?: WrapGridPolicy;
  palette?: PalettePolicy;
  generationDisabled?: boolean;
  catalogDisabled?: boolean;
  spritesheet?: {
    sheetTargetId: string;
    isSheet?: boolean;
    animations?: Array<{
      name: string;
      count: number;
      fps?: number;
      loop?: boolean;
      pivot?: {
        x: number;
        y: number;
      };
    }>;
    animationName?: string;
    frameIndex?: number;
    frameCount?: number;
    fps?: number;
    loop?: boolean;
    pivot?: {
      x: number;
      y: number;
    };
  };
  acceptance?: {
    size?: string;
    alpha?: boolean;
    maxFileSizeKB?: number;
  };
  runtimeSpec?: {
    alphaRequired?: boolean;
    previewWidth?: number;
    previewHeight?: number;
    anchorX?: number;
    anchorY?: number;
  };
  promptSpec: PromptSpec;
  generationPolicy?: GenerationPolicy;
  postProcess?: PostProcessPolicy;
  provider?: ProviderName;
  model?: string;
  edit?: TargetEditSpec;
  regenerationSource?: RegenerationSource;
  auxiliaryMaps?: AuxiliaryMapPolicy;
}

export interface PlannedTargetsIndex {
  targets: PlannedTarget[];
  generatedAt?: string;
  manifestPath?: string;
}

export interface NormalizedGenerationPolicy {
  size: string;
  quality: string;
  draftQuality?: string;
  finalQuality?: string;
  background: "transparent" | "opaque" | string;
  outputFormat: NormalizedOutputFormat;
  highQuality?: boolean;
  hiresFix?: {
    enabled?: boolean;
    upscale?: number;
    denoiseStrength?: number;
  };
  candidates: number;
  maxRetries?: number;
  fallbackProviders: ProviderName[];
  providerConcurrency?: number;
  rateLimitPerMinute?: number;
  vlmGate?: VlmGatePolicy;
  coarseToFine?: {
    enabled: boolean;
    promoteTopK: number;
    minDraftScore?: number;
    requireDraftAcceptance: boolean;
  };
}

export interface PolicyNormalizationIssue {
  level: "warning" | "error";
  code: string;
  message: string;
}

export interface ProviderPolicyNormalizationResult {
  policy: NormalizedGenerationPolicy;
  issues: PolicyNormalizationIssue[];
}

export interface ProviderJob {
  id: string;
  provider: ProviderName;
  model: string;
  targetId: string;
  targetOut: string;
  prompt: string;
  outPath: string;
  inputHash: string;
  size: string;
  quality: string;
  background: string;
  outputFormat: NormalizedOutputFormat;
  candidateCount: number;
  maxRetries: number;
  fallbackProviders: ProviderName[];
  providerConcurrency?: number;
  rateLimitPerMinute?: number;
  target: PlannedTarget;
}

export interface ProviderCandidateOutput {
  outputPath: string;
  bytesWritten: number;
}

export interface CandidateScoreRecord {
  outputPath: string;
  score: number;
  passedAcceptance: boolean;
  reasons: string[];
  stage?: "draft" | "refine";
  promoted?: boolean;
  sourceOutputPath?: string;
  components?: Record<string, number>;
  metrics?: Record<string, number>;
  vlm?: CandidateVlmScore;
  warnings?: string[];
  selected?: boolean;
}

export interface CandidateVlmScore {
  score: number;
  threshold: number;
  maxScore: number;
  passed: boolean;
  reason: string;
  rubric?: string;
  evaluator: "command" | "http";
}

export interface ProviderRunResult {
  jobId: string;
  provider: ProviderName;
  model: string;
  targetId: string;
  outputPath: string;
  bytesWritten: number;
  inputHash: string;
  startedAt: string;
  finishedAt: string;
  skipped?: boolean;
  candidateOutputs?: ProviderCandidateOutput[];
  candidateScores?: CandidateScoreRecord[];
  coarseToFine?: {
    enabled: boolean;
    draftQuality: string;
    finalQuality: string;
    promoteTopK: number;
    minDraftScore?: number;
    requireDraftAcceptance: boolean;
    draftCandidateCount: number;
    promoted: Array<{
      outputPath: string;
      score: number;
      passedAcceptance: boolean;
      refinedOutputPath?: string;
    }>;
    discarded: Array<{
      outputPath: string;
      score: number;
      passedAcceptance: boolean;
      reason: string;
    }>;
    skippedReason?: string;
    warnings?: string[];
  };
  generationMode?: GenerationMode;
  edit?: TargetEditSpec;
  regenerationSource?: RegenerationSource;
  warnings?: string[];
}

export interface ProviderPrepareContext {
  outDir: string;
  imagesDir: string;
  now?: () => Date;
}

export interface ProviderRunContext extends ProviderPrepareContext {
  fetchImpl?: typeof fetch;
}

export interface ProviderEditJob {
  id: string;
  provider: ProviderName;
  model: string;
  targetId: string;
  instruction: string;
  inputs: TargetEditInput[];
  outPath: string;
  inputHash: string;
}

export interface ProviderEditContext extends ProviderRunContext {}

export interface GenerationProvider {
  readonly name: ProviderName;
  readonly capabilities: ProviderCapabilities;
  prepareJobs(
    targets: PlannedTarget[],
    ctx: ProviderPrepareContext,
  ): ProviderJob[] | Promise<ProviderJob[]>;
  runJob(job: ProviderJob, ctx: ProviderRunContext): Promise<ProviderRunResult>;
  runEditJob?(
    job: ProviderEditJob,
    ctx: ProviderEditContext,
  ): Promise<ProviderRunResult>;
  supports(feature: ProviderFeature): boolean;
  normalizeError(error: unknown): ProviderError;
}

export interface ProviderErrorInit {
  provider: ProviderName;
  code: string;
  message: string;
  cause?: unknown;
  actionable?: string;
  status?: number;
}

export class ProviderError extends Error {
  readonly provider: ProviderName;
  readonly code: string;
  readonly actionable?: string;
  readonly status?: number;
  declare readonly cause?: unknown;

  constructor(init: ProviderErrorInit) {
    super(init.message);
    this.name = "ProviderError";
    this.provider = init.provider;
    this.code = init.code;
    this.actionable = init.actionable;
    this.status = init.status;
    this.cause = init.cause;
  }
}
