import {
  type AgenticRetryPolicy,
  type CoarseToFinePolicy,
  type GenerationMode,
  type GenerationPolicy,
  type NormalizedGenerationPolicy,
  type NormalizedOutputFormat,
  type PlannedTarget,
  type PolicyNormalizationIssue,
  type PostProcessAlgorithm,
  type PostProcessPolicy,
  type ProviderCapabilities,
  type ProviderName,
  type ProviderPolicyNormalizationResult,
  type VlmGatePolicy,
} from "./types-core.js";
import { PROVIDER_CAPABILITIES, PROVIDER_NAMES } from "./types-core.js";

const DEFAULT_SIZE = "1024x1024";
const DEFAULT_QUALITY = "high";
const DEFAULT_BACKGROUND = "opaque";
const DEFAULT_OUTPUT_FORMAT: NormalizedOutputFormat = "png";
const DEFAULT_POST_PROCESS_ALGORITHM: PostProcessAlgorithm = "lanczos3";
const DEFAULT_CANDIDATE_COUNT = 1;
const DEFAULT_GENERATION_MODE: GenerationMode = "text";

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

export function isProviderName(value: unknown): value is ProviderName {
  return typeof value === "string" && PROVIDER_NAMES.includes(value as ProviderName);
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
  const draftQuality = policy.draftQuality?.trim();
  const finalQuality = policy.finalQuality?.trim();

  return {
    size: policy.size?.trim() ?? DEFAULT_SIZE,
    quality: policy.quality?.trim() ?? DEFAULT_QUALITY,
    ...(draftQuality ? { draftQuality } : {}),
    ...(finalQuality ? { finalQuality } : {}),
    background: policy.background?.trim() ?? DEFAULT_BACKGROUND,
    outputFormat: normalizeOutputFormatAlias(policy.outputFormat ?? DEFAULT_OUTPUT_FORMAT),
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
    coarseToFine: normalizeCoarseToFinePolicy(policy.coarseToFine),
    agenticRetry: normalizeAgenticRetryPolicy(policy.agenticRetry),
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
  if (typeof policy.denoiseStrength === "number" && Number.isFinite(policy.denoiseStrength)) {
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

function normalizeCoarseToFinePolicy(
  policy: CoarseToFinePolicy | undefined,
): NormalizedGenerationPolicy["coarseToFine"] {
  if (!policy) {
    return undefined;
  }

  const promoteTopK =
    typeof policy.promoteTopK === "number" && Number.isFinite(policy.promoteTopK)
      ? Math.max(1, Math.round(policy.promoteTopK))
      : 1;
  const minDraftScore =
    typeof policy.minDraftScore === "number" && Number.isFinite(policy.minDraftScore)
      ? policy.minDraftScore
      : undefined;

  return {
    enabled: policy.enabled ?? true,
    promoteTopK,
    ...(typeof minDraftScore === "number" ? { minDraftScore } : {}),
    requireDraftAcceptance: policy.requireDraftAcceptance ?? true,
  };
}

function normalizeAgenticRetryPolicy(
  policy: AgenticRetryPolicy | undefined,
): NormalizedGenerationPolicy["agenticRetry"] {
  if (!policy) {
    return undefined;
  }

  const maxRetries =
    typeof policy.maxRetries === "number" && Number.isFinite(policy.maxRetries)
      ? Math.max(0, Math.round(policy.maxRetries))
      : 1;

  return {
    enabled: policy.enabled ?? true,
    maxRetries,
  };
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
      message: `${provider} does not support output format "${policy.outputFormat}".`,
    });
  }

  if (policy.background === "transparent" && policy.outputFormat === "jpeg") {
    policy.outputFormat = "png";
    issues.push({
      level: "warning",
      code: "jpg_transparency_normalized",
      message: "Transparent background requested with JPEG output; outputFormat normalized to png.",
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

  if (policy.coarseToFine && policy.coarseToFine.promoteTopK > policy.candidates) {
    issues.push({
      level: "warning",
      code: "coarse_to_fine_topk_clamped",
      message: `coarseToFine.promoteTopK exceeds candidates; clamped to ${policy.candidates}.`,
    });
    policy.coarseToFine.promoteTopK = policy.candidates;
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

export function nowIso(now?: () => Date): string {
  return (now ?? (() => new Date()))().toISOString();
}
