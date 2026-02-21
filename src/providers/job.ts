import { createHash } from "node:crypto";

import {
  getTargetGenerationPolicy,
  isProviderName,
  normalizeGenerationPolicyForProvider,
} from "./policy.js";
import { buildStructuredPrompt } from "./prompt.js";
import {
  type NormalizedGenerationPolicy,
  type NormalizedOutputFormat,
  type PlannedTarget,
  type ProviderJob,
  type ProviderName,
  type ProviderSelection,
} from "./types-core.js";
import { resolvePathWithinDir } from "../shared/paths.js";

const DEFAULT_MAX_RETRIES = 1;

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

export function parseProviderSelection(value: string | undefined): ProviderSelection {
  if (!value || value === "auto") return "auto";
  if (isProviderName(value)) return value;
  throw new Error(`Unsupported provider "${value}". Use openai, nano, local, or auto.`);
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
      `Provider policy normalization failed for target "${params.target.id}": ${policyErrors
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

function firstNonNegativeInteger(...values: (number | undefined)[]): number {
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
