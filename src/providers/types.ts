import { createHash } from "node:crypto";
import path from "node:path";

export const PROVIDER_NAMES = ["openai", "nano"] as const;
export const KNOWN_STYLE_PRESETS = [
  "pixel-art-16bit",
  "topdown-painterly-sci-fi",
] as const;
export const POST_PROCESS_ALGORITHMS = ["nearest", "lanczos3"] as const;

export type ProviderName = (typeof PROVIDER_NAMES)[number];
export type ProviderSelection = ProviderName | "auto";
export type ProviderFeature = "image-generation" | "transparent-background";
export type KnownStylePreset = (typeof KNOWN_STYLE_PRESETS)[number];
export type PostProcessAlgorithm = (typeof POST_PROCESS_ALGORITHMS)[number];

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

export interface GenerationPolicy {
  size?: string;
  background?: "transparent" | "opaque" | string;
  outputFormat?: string;
  quality?: string;
}

export interface PostProcessPolicy {
  resizeTo?: {
    width: number;
    height: number;
  };
  algorithm?: PostProcessAlgorithm;
  stripMetadata?: boolean;
  pngPaletteColors?: number;
}

export interface PlannedTarget {
  id: string;
  kind?: string;
  out: string;
  atlasGroup?: string | null;
  acceptance?: {
    size?: string;
    alpha?: boolean;
    maxFileSizeKB?: number;
  };
  runtimeSpec?: {
    alphaRequired?: boolean;
    previewWidth?: number;
    previewHeight?: number;
  };
  promptSpec: PromptSpec;
  generationPolicy?: GenerationPolicy;
  postProcess?: PostProcessPolicy;
  provider?: ProviderName;
  model?: string;
}

export interface PlannedTargetsIndex {
  targets: PlannedTarget[];
  generatedAt?: string;
  manifestPath?: string;
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
  outputFormat: string;
  target: PlannedTarget;
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
}

export interface ProviderPrepareContext {
  outDir: string;
  imagesDir: string;
  now?: () => Date;
}

export interface ProviderRunContext extends ProviderPrepareContext {
  fetchImpl?: typeof fetch;
}

export interface GenerationProvider {
  readonly name: ProviderName;
  prepareJobs(
    targets: PlannedTarget[],
    ctx: ProviderPrepareContext,
  ): ProviderJob[] | Promise<ProviderJob[]>;
  runJob(job: ProviderJob, ctx: ProviderRunContext): Promise<ProviderRunResult>;
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
const DEFAULT_OUTPUT_FORMAT = "png";
const DEFAULT_POST_PROCESS_ALGORITHM: PostProcessAlgorithm = "lanczos3";

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

export function getTargetGenerationPolicy(target: PlannedTarget) {
  const policy = target.generationPolicy ?? {};
  return {
    size: policy.size?.trim() || DEFAULT_SIZE,
    quality: policy.quality?.trim() || DEFAULT_QUALITY,
    background: policy.background?.trim() || DEFAULT_BACKGROUND,
    outputFormat: policy.outputFormat?.trim() || DEFAULT_OUTPUT_FORMAT,
  };
}

export function getTargetPostProcessPolicy(target: PlannedTarget): PostProcessPolicy {
  const policy = target.postProcess ?? {};
  return {
    resizeTo: policy.resizeTo,
    algorithm: policy.algorithm ?? DEFAULT_POST_PROCESS_ALGORITHM,
    stripMetadata: policy.stripMetadata ?? true,
    pngPaletteColors: policy.pngPaletteColors,
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
}

export function createDeterministicJobId(params: DeterministicJobIdParams): string {
  const source = stableSerialize({
    provider: params.provider,
    targetId: params.targetId,
    targetOut: params.targetOut,
    prompt: params.prompt,
    model: params.model,
  });
  return sha256Hex(source);
}

export function createInputHash(target: PlannedTarget): string {
  return sha256Hex(stableSerialize(target));
}

export function isProviderName(value: unknown): value is ProviderName {
  return typeof value === "string" && PROVIDER_NAMES.includes(value as ProviderName);
}

export function parseProviderSelection(value: string | undefined): ProviderSelection {
  if (!value || value === "auto") return "auto";
  if (isProviderName(value)) return value;
  throw new Error(`Unsupported provider "${value}". Use openai, nano, or auto.`);
}

export interface CreateJobParams {
  provider: ProviderName;
  target: PlannedTarget;
  model: string;
  imagesDir: string;
}

export function createProviderJob(params: CreateJobParams): ProviderJob {
  const prompt = buildStructuredPrompt(params.target.promptSpec);
  const policy = getTargetGenerationPolicy(params.target);
  const id = createDeterministicJobId({
    provider: params.provider,
    targetId: params.target.id,
    targetOut: params.target.out,
    prompt,
    model: params.model,
  });

  return {
    id,
    provider: params.provider,
    model: params.model,
    targetId: params.target.id,
    targetOut: params.target.out,
    prompt,
    outPath: path.join(params.imagesDir, params.target.out),
    inputHash: createInputHash(params.target),
    size: policy.size,
    quality: policy.quality,
    background: policy.background,
    outputFormat: policy.outputFormat,
    target: params.target,
  };
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
