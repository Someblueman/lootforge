import type {
  AuxiliaryMapPolicy,
  ControlMode,
  GenerationMode,
  GenerationPolicy,
  PalettePolicy,
  PlannedTarget,
  PlannedTargetsIndex,
  PostProcessPolicy,
  PromptSpec,
  ProviderName,
  SeamHealPolicy,
  TargetEditSpec,
  WrapGridPolicy,
} from "../providers/types.js";

export type ManifestVersion = "next";

export interface ManifestPack {
  id: string;
  version: string;
  license?: string;
  author?: string;
}

export interface ManifestProviderConfig {
  model?: string;
  endpoint?: string;
  timeoutMs?: number;
  maxRetries?: number;
  minDelayMs?: number;
  defaultConcurrency?: number;
}

export interface ManifestLocalProviderConfig extends ManifestProviderConfig {
  baseUrl?: string;
}

export interface ManifestProviders {
  default?: ProviderName;
  openai?: ManifestProviderConfig;
  nano?: ManifestProviderConfig;
  local?: ManifestLocalProviderConfig;
}

export interface ManifestStyleKit {
  id: string;
  rulesPath: string;
  palettePath?: string;
  referenceImages: string[];
  styleReferenceImages?: string[];
  lightingModel: string;
  negativeRulesPath?: string;
  loraPath?: string;
  loraStrength?: number;
}

export interface ManifestConsistencyGroup {
  id: string;
  description?: string;
  styleKitId?: string;
  referenceImages: string[];
}

export interface ManifestEvaluationProfile {
  id: string;
  hardGates?: {
    requireAlpha?: boolean;
    maxFileSizeKB?: number;
    seamThreshold?: number;
    seamStripPx?: number;
    paletteComplianceMin?: number;
    alphaHaloRiskMax?: number;
    alphaStrayNoiseMax?: number;
    alphaEdgeSharpnessMin?: number;
    packTextureBudgetMB?: number;
    spritesheetSilhouetteDriftMax?: number;
    spritesheetAnchorDriftMax?: number;
  };
  scoreWeights?: {
    readability?: number;
    fileSize?: number;
    consistency?: number;
    clip?: number;
    lpips?: number;
    ssim?: number;
  };
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
  anchorX?: number;
  anchorY?: number;
}

export interface ManifestGenerationPolicy extends GenerationPolicy {
  draftQuality?: string;
  finalQuality?: string;
}

export interface ManifestPostProcessOperations {
  trim?: {
    enabled?: boolean;
    threshold?: number;
  };
  pad?: {
    pixels: number;
    extrude?: boolean;
    background?: string;
  };
  quantize?: {
    colors: number;
    dither?: number;
  };
  outline?: {
    size: number;
    color?: string;
  };
  resizeVariants?: Array<{
    name: string;
    size: string;
    algorithm?: string;
  }>;
}

export interface ManifestPostProcess {
  resizeTo?: string | number;
  algorithm?: string;
  stripMetadata?: boolean;
  pngPaletteColors?: number;
  operations?: ManifestPostProcessOperations;
}

export interface ManifestAtlasGroupOptions {
  padding?: number;
  trim?: boolean;
  bleed?: number;
  multipack?: boolean;
  maxWidth?: number;
  maxHeight?: number;
}

export interface ManifestAtlasOptions extends ManifestAtlasGroupOptions {
  groups?: Record<string, ManifestAtlasGroupOptions>;
}

export type ManifestPrompt = string | PromptSpec;

export interface ManifestSpriteAnimation {
  count: number;
  prompt: ManifestPrompt;
  fps?: number;
  loop?: boolean;
  pivot?: {
    x: number;
    y: number;
  };
}

export interface ManifestTarget {
  id: string;
  kind: string;
  out: string;
  atlasGroup?: string;
  styleKitId: string;
  consistencyGroup: string;
  evaluationProfileId: string;
  generationMode?: GenerationMode;
  scoringProfile?: string;
  tileable?: boolean;
  seamThreshold?: number;
  seamStripPx?: number;
  seamHeal?: SeamHealPolicy;
  wrapGrid?: WrapGridPolicy;
  palette?: PalettePolicy;
  prompt?: ManifestPrompt;
  promptSpec?: PromptSpec;
  generationPolicy?: ManifestGenerationPolicy;
  postProcess?: ManifestPostProcess;
  acceptance?: ManifestAcceptance;
  runtimeSpec?: ManifestRuntimeSpec;
  provider?: ProviderName;
  model?: string;
  controlImage?: string;
  controlMode?: ControlMode;
  edit?: TargetEditSpec;
  auxiliaryMaps?: AuxiliaryMapPolicy;
  animations?: Record<string, ManifestSpriteAnimation>;
}

export interface ManifestV2 {
  version: ManifestVersion;
  pack: ManifestPack;
  providers: ManifestProviders;
  styleKits: ManifestStyleKit[];
  consistencyGroups?: ManifestConsistencyGroup[];
  evaluationProfiles: ManifestEvaluationProfile[];
  atlas?: ManifestAtlasOptions;
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
  postProcess?: PostProcessPolicy;
  styleKitId?: string;
  consistencyGroup?: string;
  evaluationProfileId?: string;
}

export interface PlanArtifacts {
  targets: PlannedTarget[];
  targetsIndex: PlannedTargetsIndex;
  openaiJobs: PlannedProviderJobSpec[];
  nanoJobs: PlannedProviderJobSpec[];
  localJobs: PlannedProviderJobSpec[];
}
