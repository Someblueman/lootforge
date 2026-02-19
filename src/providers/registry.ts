import { createLocalDiffusionProvider, LocalDiffusionProviderOptions } from "./localDiffusion.js";
import { createNanoProvider, NanoProviderOptions } from "./nano.js";
import { createOpenAIProvider, OpenAIProviderOptions } from "./openai.js";
import {
  GenerationProvider,
  getProviderCapabilities,
  isProviderName,
  parseProviderSelection,
  PlannedTarget,
  ProviderFeature,
  ProviderName,
  ProviderSelection,
} from "./types.js";

export interface ProviderRegistryOptions {
  openai?: OpenAIProviderOptions;
  nano?: NanoProviderOptions;
  local?: LocalDiffusionProviderOptions;
}

export interface ProviderRegistry {
  openai: GenerationProvider;
  nano: GenerationProvider;
  local: GenerationProvider;
}

export interface ProviderRoute {
  primary: ProviderName;
  fallbacks: ProviderName[];
}

export function createProviderRegistry(
  options: ProviderRegistryOptions = {},
): ProviderRegistry {
  const registry: ProviderRegistry = {
    openai: createOpenAIProvider(options.openai),
    nano: createNanoProvider(options.nano),
    local: createLocalDiffusionProvider(options.local),
  };

  assertProviderCapabilityParity(registry.openai);
  assertProviderCapabilityParity(registry.nano);
  assertProviderCapabilityParity(registry.local);

  return registry;
}

export function getProvider(
  registry: ProviderRegistry,
  providerName: ProviderName,
): GenerationProvider {
  return registry[providerName];
}

export function resolveTargetProviderName(
  target: PlannedTarget,
  requestedProvider: ProviderSelection,
): ProviderName {
  if (target.provider !== undefined) {
    if (!isProviderName(target.provider)) {
      throw new Error(
        `Target \"${target.id}\" has unsupported provider \"${target.provider}\".`,
      );
    }
    return target.provider;
  }

  if (requestedProvider !== "auto") {
    return requestedProvider;
  }

  return autoSelectProvider(target);
}

export function resolveTargetProviderRoute(
  target: PlannedTarget,
  requestedProvider: ProviderSelection,
): ProviderRoute {
  const primary = resolveTargetProviderName(target, requestedProvider);
  const explicitProvider = target.provider !== undefined || requestedProvider !== "auto";

  if (explicitProvider) {
    const configuredFallbacks = (target.generationPolicy?.fallbackProviders ?? []).filter(
      (provider): provider is ProviderName => isProviderName(provider) && provider !== primary,
    );
    return {
      primary,
      fallbacks: configuredFallbacks,
    };
  }

  const autoFallbacks: ProviderName[] = [];
  for (const candidate of ["openai", "nano", "local"] as const) {
    if (candidate === primary) continue;
    const capabilities = getProviderCapabilities(candidate);
    if (!capabilities) continue;
    autoFallbacks.push(candidate);
  }

  return {
    primary,
    fallbacks: autoFallbacks,
  };
}

function autoSelectProvider(target: PlannedTarget): ProviderName {
  if (target.edit) {
    return "local";
  }

  const background = target.generationPolicy?.background;
  const alphaRequired =
    target.runtimeSpec?.alphaRequired === true || target.acceptance?.alpha === true;

  if (background === "transparent" || alphaRequired) {
    return "openai";
  }

  const requestedFormat = target.generationPolicy?.outputFormat?.toLowerCase();
  if (requestedFormat === "jpeg" || requestedFormat === "jpg") {
    return "nano";
  }

  return "openai";
}

export function resolveTargetProvider(
  registry: ProviderRegistry,
  target: PlannedTarget,
  requestedProvider: ProviderSelection,
): GenerationProvider {
  const providerName = resolveTargetProviderName(target, requestedProvider);
  return getProvider(registry, providerName);
}

export function parseProviderFlag(flagValue: string | undefined): ProviderSelection {
  return parseProviderSelection(flagValue);
}

function assertProviderCapabilityParity(provider: GenerationProvider): void {
  if (provider.capabilities.name !== provider.name) {
    throw new Error(
      `Provider capability mismatch: capabilities.name="${provider.capabilities.name}" does not match provider "${provider.name}".`,
    );
  }

  const checks: Array<[ProviderFeature, boolean]> = [
    ["image-generation", true],
    ["transparent-background", provider.capabilities.supportsTransparentBackground],
    ["image-edits", provider.capabilities.supportsEdits],
    ["multi-candidate", provider.capabilities.maxCandidates > 1],
    ["controlnet", provider.capabilities.supportsControlNet],
  ];

  for (const [feature, expected] of checks) {
    const actual = provider.supports(feature);
    if (actual !== expected) {
      throw new Error(
        `Provider capability mismatch for "${provider.name}": supports("${feature}")=${String(actual)} but capabilities declare ${String(expected)}.`,
      );
    }
  }
}
