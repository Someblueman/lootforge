import { createHash } from "node:crypto";

import { resolvePathWithinDir } from "../shared/paths.js";

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

export const PROVIDER_CAPABILITIES: Record<ProviderName, ProviderCapabilities> = {
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
}

export interface GenerationPolicy {
  size?: string;
  background?: "transparent" | "opaque" | string;
  outputFormat?: string;
  quality?: string;
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
  runEditJob?(job: ProviderEditJob, ctx: ProviderEditContext): Promise<ProviderRunResult>;
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

const DEFAULT_PROMPT_USE_CASE = "stylized-concept";
const DEFAULT_SIZE = "1024x1024";
const DEFAULT_QUALITY = "high";
const DEFAULT_BACKGROUND = "opaque";
const DEFAULT_OUTPUT_FORMAT: NormalizedOutputFormat = "png";
const DEFAULT_POST_PROCESS_ALGORITHM: PostProcessAlgorithm = "lanczos3";
const DEFAULT_CANDIDATE_COUNT = 1;
const DEFAULT_MAX_RETRIES = 1;
const DEFAULT_GENERATION_MODE: GenerationMode = "text";

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

export function normalizeOutputFormatAlias(value: string | undefined): NormalizedOutputFormat {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (normalized === "jpg") return "jpeg";
  if (normalized === "jpeg") return "jpeg";
  if (normalized === "webp") return "webp";
  return "png";
}

export function getProviderCapabilities(provider: ProviderName): ProviderCapabilities {
  return PROVIDER_CAPABILITIES[provider];
}

export function getTargetGenerationPolicy(target: PlannedTarget): NormalizedGenerationPolicy {
  const policy = target.generationPolicy ?? {};
  const normalizedHiresFix = normalizeHiresFixPolicy(policy.hiresFix);
  const candidatesRaw =
    typeof policy.candidates === "number" && Number.isFinite(policy.candidates)
      ? Math.round(policy.candidates)
      : DEFAULT_CANDIDATE_COUNT;
  const maxRetriesRaw =
    typeof policy.maxRetries === "number" && Number.isFinite(policy.maxRetries)
      ? Math.round(policy.maxRetries)
      : undefined;

  return {
    size: policy.size?.trim() || DEFAULT_SIZE,
    quality: policy.quality?.trim() || DEFAULT_QUALITY,
    background: policy.background?.trim() || DEFAULT_BACKGROUND,
    outputFormat: normalizeOutputFormatAlias(policy.outputFormat || DEFAULT_OUTPUT_FORMAT),
    ...(typeof policy.highQuality === "boolean" ? { highQuality: policy.highQuality } : {}),
    ...(normalizedHiresFix ? { hiresFix: normalizedHiresFix } : {}),
    candidates: Math.max(1, candidatesRaw),
    ...(typeof maxRetriesRaw === "number" ? { maxRetries: Math.max(0, maxRetriesRaw) } : {}),
    fallbackProviders: Array.isArray(policy.fallbackProviders)
      ? policy.fallbackProviders.filter((name): name is ProviderName => isProviderName(name))
      : [],
    providerConcurrency:
      typeof policy.providerConcurrency === "number" &&
      Number.isFinite(policy.providerConcurrency) &&
      policy.providerConcurrency > 0
        ? Math.round(policy.providerConcurrency)
        : undefined,
    rateLimitPerMinute:
      typeof policy.rateLimitPerMinute === "number" &&
      Number.isFinite(policy.rateLimitPerMinute) &&
      policy.rateLimitPerMinute > 0
        ? Math.round(policy.rateLimitPerMinute)
        : undefined,
    vlmGate: normalizeVlmGatePolicy(policy.vlmGate),
  };
}

function normalizeHiresFixPolicy(
  policy: GenerationPolicy["hiresFix"] | undefined,
): NormalizedGenerationPolicy["hiresFix"] {
  if (!policy) {
    return undefined;
  }

  const normalized: NonNullable<NormalizedGenerationPolicy["hiresFix"]> = {};

  if (typeof policy.enabled === "boolean") {
    normalized.enabled = policy.enabled;
  }
  if (typeof policy.upscale === "number" && Number.isFinite(policy.upscale)) {
    normalized.upscale = Math.max(1.01, Math.min(4, policy.upscale));
  }
  if (
    typeof policy.denoiseStrength === "number" &&
    Number.isFinite(policy.denoiseStrength)
  ) {
    normalized.denoiseStrength = Math.max(0, Math.min(1, policy.denoiseStrength));
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeVlmGatePolicy(policy: VlmGatePolicy | undefined): VlmGatePolicy | undefined {
  if (!policy) {
    return undefined;
  }

  const threshold =
    typeof policy.threshold === "number" && Number.isFinite(policy.threshold)
      ? policy.threshold
      : 4;
  const normalized: VlmGatePolicy = {
    threshold: Math.max(0, Math.min(5, threshold)),
  };

  if (typeof policy.rubric === "string" && policy.rubric.trim()) {
    normalized.rubric = policy.rubric.trim();
  }

  return normalized;
}

export function getTargetGenerationMode(target: PlannedTarget): GenerationMode {
  if (target.generationMode === "edit-first") {
    return "edit-first";
  }
  return DEFAULT_GENERATION_MODE;
}

export function normalizeGenerationPolicyForProvider(
  provider: ProviderName,
  rawPolicy: NormalizedGenerationPolicy,
): ProviderPolicyNormalizationResult {
  const capabilities = getProviderCapabilities(provider);
  const issues: PolicyNormalizationIssue[] = [];

  const policy: NormalizedGenerationPolicy = {
    ...rawPolicy,
    outputFormat: normalizeOutputFormatAlias(rawPolicy.outputFormat),
  };

  if (!capabilities.supportedOutputFormats.has(policy.outputFormat)) {
    issues.push({
      level: "error",
      code: "unsupported_output_format",
      message: `${provider} does not support output format \"${policy.outputFormat}\".`,
    });
  }

  if (policy.background === "transparent" && policy.outputFormat === "jpeg") {
    policy.outputFormat = "png";
    issues.push({
      level: "warning",
      code: "jpg_transparency_normalized",
      message:
        "Transparent background requested with JPEG output; outputFormat normalized to png.",
    });
  }

  if (policy.background === "transparent" && !capabilities.supportsTransparentBackground) {
    issues.push({
      level: "error",
      code: "transparent_background_unsupported",
      message: `${provider} does not support transparent backgrounds.`,
    });
  }

  if (policy.candidates > capabilities.maxCandidates) {
    issues.push({
      level: "warning",
      code: "candidate_count_clamped",
      message: `${provider} max candidates is ${capabilities.maxCandidates}; clamped requested value.`,
    });
    policy.candidates = capabilities.maxCandidates;
  }

  policy.fallbackProviders = policy.fallbackProviders.filter((name) => name !== provider);

  return { policy, issues };
}

export function getTargetPostProcessPolicy(target: PlannedTarget): PostProcessPolicy {
  const policy = target.postProcess ?? {};
  return {
    resizeTo: policy.resizeTo,
    algorithm: policy.algorithm ?? DEFAULT_POST_PROCESS_ALGORITHM,
    stripMetadata: policy.stripMetadata ?? true,
    pngPaletteColors: policy.pngPaletteColors,
    operations: policy.operations,
  };
}

export function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(",")}]`;
  }

  const objectValue = value as Record<string, unknown>;
  const keys = Object.keys(objectValue).sort();
  const body = keys
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(objectValue[key])}`)
    .join(",");
  return `{${body}}`;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export interface DeterministicJobIdParams {
  provider: ProviderName;
  targetId: string;
  targetOut: string;
  prompt: string;
  model: string;
  inputHash: string;
  size: string;
  quality: string;
  background: string;
  outputFormat: NormalizedOutputFormat;
  candidateCount: number;
}

export function createDeterministicJobId(params: DeterministicJobIdParams): string {
  const source = stableSerialize({
    provider: params.provider,
    targetId: params.targetId,
    targetOut: params.targetOut,
    prompt: params.prompt,
    model: params.model,
    inputHash: params.inputHash,
    size: params.size,
    quality: params.quality,
    background: params.background,
    outputFormat: params.outputFormat,
    candidateCount: params.candidateCount,
  });
  return sha256Hex(source);
}

export function createInputHash(
  target: PlannedTarget,
  policyOverride?: Partial<NormalizedGenerationPolicy>,
): string {
  const generationPolicy = {
    ...(target.generationPolicy ?? {}),
    ...(policyOverride ?? {}),
  };

  return sha256Hex(
    stableSerialize({
      ...target,
      generationPolicy,
    }),
  );
}

export function isProviderName(value: unknown): value is ProviderName {
  return typeof value === "string" && PROVIDER_NAMES.includes(value as ProviderName);
}

export function parseProviderSelection(value: string | undefined): ProviderSelection {
  if (!value || value === "auto") return "auto";
  if (isProviderName(value)) return value;
  throw new Error(`Unsupported provider \"${value}\". Use openai, nano, local, or auto.`);
}

export interface CreateJobParams {
  provider: ProviderName;
  target: PlannedTarget;
  model: string;
  imagesDir: string;
  defaults?: {
    maxRetries?: number;
  };
}

export function createProviderJob(params: CreateJobParams): ProviderJob {
  const prompt = buildStructuredPrompt(params.target.promptSpec);
  const basePolicy = getTargetGenerationPolicy(params.target);
  const normalized = normalizeGenerationPolicyForProvider(params.provider, basePolicy);
  const policyErrors = normalized.issues.filter((issue) => issue.level === "error");
  if (policyErrors.length > 0) {
    throw new Error(
      `Provider policy normalization failed for target \"${params.target.id}\": ${policyErrors
        .map((issue) => issue.message)
        .join(" ")}`,
    );
  }

  const inputHash = createInputHash(params.target, normalized.policy);
  const id = createDeterministicJobId({
    provider: params.provider,
    targetId: params.target.id,
    targetOut: params.target.out,
    prompt,
    model: params.model,
    inputHash,
    size: normalized.policy.size,
    quality: normalized.policy.quality,
    background: normalized.policy.background,
    outputFormat: normalized.policy.outputFormat,
    candidateCount: normalized.policy.candidates,
  });

  return {
    id,
    provider: params.provider,
    model: params.model,
    targetId: params.target.id,
    targetOut: params.target.out,
    prompt,
    outPath: resolvePathWithinDir(
      params.imagesDir,
      params.target.out,
      `provider output for target "${params.target.id}"`,
    ),
    inputHash,
    size: normalized.policy.size,
    quality: normalized.policy.quality,
    background: normalized.policy.background,
    outputFormat: normalized.policy.outputFormat,
    candidateCount: normalized.policy.candidates,
    maxRetries: firstNonNegativeInteger(
      normalized.policy.maxRetries,
      params.defaults?.maxRetries,
      DEFAULT_MAX_RETRIES,
    ),
    fallbackProviders: normalized.policy.fallbackProviders,
    providerConcurrency: normalized.policy.providerConcurrency,
    rateLimitPerMinute: normalized.policy.rateLimitPerMinute,
    target: params.target,
  };
}

function firstNonNegativeInteger(
  ...values: Array<number | undefined>
): number {
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      continue;
    }
    const rounded = Math.round(value);
    if (rounded >= 0) {
      return rounded;
    }
  }
  return DEFAULT_MAX_RETRIES;
}

export function nowIso(now?: () => Date): string {
  return (now ?? (() => new Date()))().toISOString();
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
