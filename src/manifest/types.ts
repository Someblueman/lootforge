import type {
  GenerationPolicy,
  PlannedTarget,
  PlannedTargetsIndex,
  PromptSpec,
  ProviderName,
} from "../providers/types.js";

export interface ManifestPack {
  id: string;
  version: string;
  license?: string;
  author?: string;
}

export interface ManifestProviderConfig {
  model?: string;
}

export interface ManifestProviders {
  default?: ProviderName;
  openai?: ManifestProviderConfig;
  nano?: ManifestProviderConfig;
}

export interface ManifestAcceptance {
  size?: string;
  alpha?: boolean;
  maxFileSizeKB?: number;
}

export interface ManifestRuntimeSpec {
  alphaRequired?: boolean;
  previewWidth?: number;
  previewHeight?: number;
}

export interface ManifestGenerationPolicy {
  size?: string;
  background?: string;
  outputFormat?: string;
  quality?: string;
  draftQuality?: string;
  finalQuality?: string;
}

export type ManifestPrompt = string | PromptSpec;

export interface ManifestTarget {
  id: string;
  kind: string;
  out: string;
  atlasGroup?: string;
  prompt?: ManifestPrompt;
  promptSpec?: PromptSpec;
  generationPolicy?: ManifestGenerationPolicy;
  acceptance?: ManifestAcceptance;
  runtimeSpec?: ManifestRuntimeSpec;
  provider?: ProviderName;
  model?: string;
}

export interface ManifestV2 {
  version?: string | number;
  pack: ManifestPack;
  providers: ManifestProviders;
  styleGuide?: Record<string, unknown>;
  targets: ManifestTarget[];
}

export interface ManifestSource {
  manifestPath: string;
  raw: string;
  data: unknown;
}

export interface LoadedManifest extends ManifestSource {
  manifest: ManifestV2;
}

export type ValidationIssueLevel = "error" | "warning";

export interface ValidationIssue {
  level: ValidationIssueLevel;
  code: string;
  path: string;
  message: string;
}

export interface ValidationReport {
  manifestPath: string;
  generatedAt: string;
  ok: boolean;
  errors: number;
  warnings: number;
  targetCount: number;
  issues: ValidationIssue[];
}

export interface ManifestValidationResult {
  report: ValidationReport;
  manifest?: ManifestV2;
}

export interface PlannedProviderJobSpec {
  targetId: string;
  out: string;
  provider: ProviderName;
  model?: string;
  prompt: string;
  promptSpec: PromptSpec;
  generationPolicy: GenerationPolicy;
}

export interface PlanArtifacts {
  targets: PlannedTarget[];
  targetsIndex: PlannedTargetsIndex;
  openaiJobs: PlannedProviderJobSpec[];
  nanoJobs: PlannedProviderJobSpec[];
}
