import { readFile } from "node:fs/promises";

import { type ProviderRegistryOptions } from "./registry.js";
import { toOptionalNonNegativeInteger, toOptionalPositiveInteger } from "./runtime.js";

interface RuntimeProviderConfig {
  model?: unknown;
  endpoint?: unknown;
  timeoutMs?: unknown;
  maxRetries?: unknown;
  minDelayMs?: unknown;
  defaultConcurrency?: unknown;
}

interface RuntimeLocalProviderConfig extends RuntimeProviderConfig {
  baseUrl?: unknown;
}

interface RuntimeManifestProviders {
  openai?: RuntimeProviderConfig;
  nano?: RuntimeProviderConfig;
  local?: RuntimeLocalProviderConfig;
}

interface RuntimeManifestShape {
  providers?: RuntimeManifestProviders;
}

export async function resolveProviderRegistryOptions(
  manifestPath?: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProviderRegistryOptions> {
  const providers = await readManifestProviders(manifestPath);
  return buildProviderRegistryOptions(providers, env);
}

export function buildProviderRegistryOptions(
  providers: RuntimeManifestProviders | undefined,
  env: NodeJS.ProcessEnv = process.env,
): ProviderRegistryOptions {
  const openaiEndpoint = firstDefinedString(
    env.LOOTFORGE_OPENAI_ENDPOINT,
    env.OPENAI_IMAGES_ENDPOINT,
    toNonEmptyString(providers?.openai?.endpoint),
  );
  const openaiEditsEndpoint = firstDefinedString(
    env.LOOTFORGE_OPENAI_EDITS_ENDPOINT,
    env.OPENAI_EDITS_ENDPOINT,
    deriveOpenAIEditsEndpoint(openaiEndpoint),
  );

  const openai = pickDefinedObject({
    model: firstDefinedString(
      env.LOOTFORGE_OPENAI_MODEL,
      toNonEmptyString(providers?.openai?.model),
    ),
    endpoint: openaiEndpoint,
    editsEndpoint: openaiEditsEndpoint,
    timeoutMs: firstDefinedPositiveInteger(
      toOptionalPositiveInteger(parseIntegerEnv(env.LOOTFORGE_OPENAI_TIMEOUT_MS)),
      toOptionalPositiveInteger(parseIntegerEnv(env.OPENAI_TIMEOUT_MS)),
      toOptionalPositiveInteger(toNumber(providers?.openai?.timeoutMs)),
    ),
    maxRetries: firstDefinedNonNegativeInteger(
      toOptionalNonNegativeInteger(parseIntegerEnv(env.LOOTFORGE_OPENAI_MAX_RETRIES)),
      toOptionalNonNegativeInteger(parseIntegerEnv(env.OPENAI_MAX_RETRIES)),
      toOptionalNonNegativeInteger(toNumber(providers?.openai?.maxRetries)),
    ),
    minDelayMs: firstDefinedNonNegativeInteger(
      toOptionalNonNegativeInteger(parseIntegerEnv(env.LOOTFORGE_OPENAI_MIN_DELAY_MS)),
      toOptionalNonNegativeInteger(parseIntegerEnv(env.OPENAI_MIN_DELAY_MS)),
      toOptionalNonNegativeInteger(toNumber(providers?.openai?.minDelayMs)),
    ),
    defaultConcurrency: firstDefinedPositiveInteger(
      toOptionalPositiveInteger(parseIntegerEnv(env.LOOTFORGE_OPENAI_DEFAULT_CONCURRENCY)),
      toOptionalPositiveInteger(parseIntegerEnv(env.OPENAI_DEFAULT_CONCURRENCY)),
      toOptionalPositiveInteger(toNumber(providers?.openai?.defaultConcurrency)),
    ),
  });

  const nano = pickDefinedObject({
    model: firstDefinedString(env.LOOTFORGE_NANO_MODEL, toNonEmptyString(providers?.nano?.model)),
    apiBase: firstDefinedString(
      env.LOOTFORGE_NANO_ENDPOINT,
      env.GEMINI_API_BASE,
      toNonEmptyString(providers?.nano?.endpoint),
    ),
    timeoutMs: firstDefinedPositiveInteger(
      toOptionalPositiveInteger(parseIntegerEnv(env.LOOTFORGE_NANO_TIMEOUT_MS)),
      toOptionalPositiveInteger(parseIntegerEnv(env.GEMINI_TIMEOUT_MS)),
      toOptionalPositiveInteger(toNumber(providers?.nano?.timeoutMs)),
    ),
    maxRetries: firstDefinedNonNegativeInteger(
      toOptionalNonNegativeInteger(parseIntegerEnv(env.LOOTFORGE_NANO_MAX_RETRIES)),
      toOptionalNonNegativeInteger(parseIntegerEnv(env.GEMINI_MAX_RETRIES)),
      toOptionalNonNegativeInteger(toNumber(providers?.nano?.maxRetries)),
    ),
    minDelayMs: firstDefinedNonNegativeInteger(
      toOptionalNonNegativeInteger(parseIntegerEnv(env.LOOTFORGE_NANO_MIN_DELAY_MS)),
      toOptionalNonNegativeInteger(parseIntegerEnv(env.GEMINI_MIN_DELAY_MS)),
      toOptionalNonNegativeInteger(toNumber(providers?.nano?.minDelayMs)),
    ),
    defaultConcurrency: firstDefinedPositiveInteger(
      toOptionalPositiveInteger(parseIntegerEnv(env.LOOTFORGE_NANO_DEFAULT_CONCURRENCY)),
      toOptionalPositiveInteger(parseIntegerEnv(env.GEMINI_DEFAULT_CONCURRENCY)),
      toOptionalPositiveInteger(toNumber(providers?.nano?.defaultConcurrency)),
    ),
  });

  const local = pickDefinedObject({
    model: firstDefinedString(env.LOOTFORGE_LOCAL_MODEL, toNonEmptyString(providers?.local?.model)),
    baseUrl: firstDefinedString(
      env.LOOTFORGE_LOCAL_ENDPOINT,
      env.LOCAL_DIFFUSION_BASE_URL,
      toNonEmptyString(providers?.local?.baseUrl),
      toNonEmptyString(providers?.local?.endpoint),
    ),
    timeoutMs: firstDefinedPositiveInteger(
      toOptionalPositiveInteger(parseIntegerEnv(env.LOOTFORGE_LOCAL_TIMEOUT_MS)),
      toOptionalPositiveInteger(parseIntegerEnv(env.LOCAL_DIFFUSION_TIMEOUT_MS)),
      toOptionalPositiveInteger(toNumber(providers?.local?.timeoutMs)),
    ),
    maxRetries: firstDefinedNonNegativeInteger(
      toOptionalNonNegativeInteger(parseIntegerEnv(env.LOOTFORGE_LOCAL_MAX_RETRIES)),
      toOptionalNonNegativeInteger(parseIntegerEnv(env.LOCAL_DIFFUSION_MAX_RETRIES)),
      toOptionalNonNegativeInteger(toNumber(providers?.local?.maxRetries)),
    ),
    minDelayMs: firstDefinedNonNegativeInteger(
      toOptionalNonNegativeInteger(parseIntegerEnv(env.LOOTFORGE_LOCAL_MIN_DELAY_MS)),
      toOptionalNonNegativeInteger(parseIntegerEnv(env.LOCAL_DIFFUSION_MIN_DELAY_MS)),
      toOptionalNonNegativeInteger(toNumber(providers?.local?.minDelayMs)),
    ),
    defaultConcurrency: firstDefinedPositiveInteger(
      toOptionalPositiveInteger(parseIntegerEnv(env.LOOTFORGE_LOCAL_DEFAULT_CONCURRENCY)),
      toOptionalPositiveInteger(parseIntegerEnv(env.LOCAL_DIFFUSION_DEFAULT_CONCURRENCY)),
      toOptionalPositiveInteger(toNumber(providers?.local?.defaultConcurrency)),
    ),
  });

  return pickDefinedObject({
    openai,
    nano,
    local,
  });
}

async function readManifestProviders(
  manifestPath: string | undefined,
): Promise<RuntimeManifestProviders | undefined> {
  if (!manifestPath) {
    return undefined;
  }

  try {
    const raw = await readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw) as RuntimeManifestShape;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!parsed || typeof parsed !== "object") {
      return undefined;
    }
    return parsed.providers;
  } catch {
    return undefined;
  }
}

function deriveOpenAIEditsEndpoint(endpoint: string | undefined): string | undefined {
  if (!endpoint) {
    return undefined;
  }

  if (/\/images\/edits\/?$/u.test(endpoint)) {
    return endpoint.replace(/\/$/u, "");
  }
  if (/\/images\/generations\/?$/u.test(endpoint)) {
    return endpoint.replace(/\/images\/generations\/?$/u, "/images/edits");
  }
  if (/\/images\/?$/u.test(endpoint)) {
    return `${endpoint.replace(/\/$/u, "")}/edits`;
  }

  return undefined;
}

function parseIntegerEnv(value: string | undefined): number | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    return undefined;
  }
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }
  return Math.round(numeric);
}

function toNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
}

function firstDefinedString(...values: (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return undefined;
}

function firstDefinedPositiveInteger(...values: (number | undefined)[]): number | undefined {
  for (const value of values) {
    const normalized = toOptionalPositiveInteger(value);
    if (typeof normalized === "number") {
      return normalized;
    }
  }
  return undefined;
}

function firstDefinedNonNegativeInteger(...values: (number | undefined)[]): number | undefined {
  for (const value of values) {
    const normalized = toOptionalNonNegativeInteger(value);
    if (typeof normalized === "number") {
      return normalized;
    }
  }
  return undefined;
}

function pickDefinedObject<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) {
      continue;
    }
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0
    ) {
      continue;
    }
    out[key] = value;
  }
  return out as Partial<T>;
}
