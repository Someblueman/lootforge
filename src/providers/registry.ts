import { createNanoProvider, NanoProviderOptions } from "./nano.js";
import { createOpenAIProvider, OpenAIProviderOptions } from "./openai.js";
import {
  GenerationProvider,
  isProviderName,
  parseProviderSelection,
  PlannedTarget,
  ProviderName,
  ProviderSelection,
} from "./types.js";

export interface ProviderRegistryOptions {
  openai?: OpenAIProviderOptions;
  nano?: NanoProviderOptions;
}

export interface ProviderRegistry {
  openai: GenerationProvider;
  nano: GenerationProvider;
}

export function createProviderRegistry(
  options: ProviderRegistryOptions = {},
): ProviderRegistry {
  return {
    openai: createOpenAIProvider(options.openai),
    nano: createNanoProvider(options.nano),
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
        `Target "${target.id}" has unsupported provider "${target.provider}".`,
      );
    }
    return target.provider;
  }

  if (requestedProvider !== "auto") {
    return requestedProvider;
  }

  return autoSelectProvider(target);
}

function autoSelectProvider(target: PlannedTarget): ProviderName {
  if (target.generationPolicy?.background === "transparent") {
    return "openai";
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

