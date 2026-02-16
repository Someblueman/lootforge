import { createLocalDiffusionProvider, LocalDiffusionProviderOptions } from "./localDiffusion.js";
import { createNanoProvider, NanoProviderOptions } from "./nano.js";
import { createOpenAIProvider, OpenAIProviderOptions } from "./openai.js";
import {
  GenerationProvider,
  getProviderCapabilities,
  isProviderName,
  parseProviderSelection,
  PlannedTarget,
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
  return {
    openai: createOpenAIProvider(options.openai),
    nano: createNanoProvider(options.nano),
    local: createLocalDiffusionProvider(options.local),
  };
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
