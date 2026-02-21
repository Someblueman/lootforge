import { DEFAULT_LOCAL_MODEL } from "../providers/localDiffusion.js";
import { DEFAULT_NANO_MODEL } from "../providers/nano.js";
import { DEFAULT_OPENAI_MODEL } from "../providers/openai.js";
import { createProviderRegistry, type ProviderRegistryOptions } from "../providers/registry.js";
import { buildProviderRegistryOptions } from "../providers/runtimeConfig.js";
import { type ProviderCapabilities, type ProviderName } from "../providers/types.js";

const PROVIDER_CAPABILITY_CONTRACT_VERSION = "v1";
const PROVIDER_CAPABILITY_ENDPOINT = "/v1/providers/capabilities";

type CapabilitySupportMode = "native" | "post-process" | "edit-input" | "scaffold-only" | "none";

export interface CapabilityDirectiveSupport {
  supported: boolean;
  mode: CapabilitySupportMode;
  notes: string;
}

export interface ServiceProviderCapabilityDescriptor {
  provider: ProviderName;
  model: string;
  providerFeatures: {
    transparentBackground: boolean;
    imageEdits: boolean;
    controlNet: boolean;
    multiCandidate: boolean;
    maxCandidates: number;
    supportedOutputFormats: string[];
    defaultConcurrency: number;
    minDelayMs: number;
  };
  directives: {
    pixel: CapabilityDirectiveSupport;
    highRes: CapabilityDirectiveSupport;
    references: CapabilityDirectiveSupport;
  };
}

export interface ServiceProviderCapabilityContract {
  version: string;
  endpoint: string;
  query: Record<string, string>;
  fields: Record<string, string>;
}

export interface ResolveProviderCapabilityOptions {
  provider?: ProviderName;
  model?: string;
  env?: NodeJS.ProcessEnv;
}

const PROVIDER_NAMES: ProviderName[] = ["openai", "nano", "local"];

export function getProviderCapabilitiesContract(): ServiceProviderCapabilityContract {
  return {
    version: PROVIDER_CAPABILITY_CONTRACT_VERSION,
    endpoint: PROVIDER_CAPABILITY_ENDPOINT,
    query: {
      provider:
        "Optional provider filter (`openai|nano|local`). Required when `model` is provided.",
      model:
        "Optional model override for capability introspection (applies to selected provider only).",
    },
    fields: {
      provider: "Provider identifier.",
      model: "Effective model used for capability introspection.",
      providerFeatures:
        "Core runtime capability claims (transparency, edits, controlnet, candidate limits, formats, concurrency, delay).",
      directives:
        "Feature-gating signals for `pixel`, `highRes`, and `references` with support mode + notes.",
    },
  };
}

export function resolveProviderCapabilityDescriptors(
  options: ResolveProviderCapabilityOptions = {},
): ServiceProviderCapabilityDescriptor[] {
  const baseOptions = buildProviderRegistryOptions(undefined, options.env);
  const registryOptions = withModelOverride(baseOptions, options.provider, options.model);
  const registry = createProviderRegistry(registryOptions);
  const selectedProviders = options.provider ? [options.provider] : PROVIDER_NAMES;

  return selectedProviders.map((provider) =>
    toCapabilityDescriptor({
      provider,
      capabilities: registry[provider].capabilities,
      model: resolveEffectiveModel(provider, registryOptions),
    }),
  );
}

function withModelOverride(
  options: ProviderRegistryOptions,
  provider: ProviderName | undefined,
  model: string | undefined,
): ProviderRegistryOptions {
  if (!provider || !model) {
    return options;
  }

  if (provider === "openai") {
    return {
      ...options,
      openai: {
        ...(options.openai ?? {}),
        model,
      },
    };
  }

  if (provider === "nano") {
    return {
      ...options,
      nano: {
        ...(options.nano ?? {}),
        model,
      },
    };
  }

  return {
    ...options,
    local: {
      ...(options.local ?? {}),
      model,
    },
  };
}

function resolveEffectiveModel(provider: ProviderName, options: ProviderRegistryOptions): string {
  if (provider === "openai") {
    return options.openai?.model ?? DEFAULT_OPENAI_MODEL;
  }
  if (provider === "nano") {
    return options.nano?.model ?? DEFAULT_NANO_MODEL;
  }
  return options.local?.model ?? DEFAULT_LOCAL_MODEL;
}

function toCapabilityDescriptor(params: {
  provider: ProviderName;
  model: string;
  capabilities: ProviderCapabilities;
}): ServiceProviderCapabilityDescriptor {
  return {
    provider: params.provider,
    model: params.model,
    providerFeatures: {
      transparentBackground: params.capabilities.supportsTransparentBackground,
      imageEdits: params.capabilities.supportsEdits,
      controlNet: params.capabilities.supportsControlNet,
      multiCandidate: params.capabilities.maxCandidates > 1,
      maxCandidates: params.capabilities.maxCandidates,
      supportedOutputFormats: Array.from(params.capabilities.supportedOutputFormats).sort(),
      defaultConcurrency: params.capabilities.defaultConcurrency,
      minDelayMs: params.capabilities.minDelayMs,
    },
    directives: {
      pixel: {
        supported: true,
        mode: "post-process",
        notes:
          "Pixel policy is enforced in LootForge process-stage transforms (pixelPerfect/quantize), independent of provider-native features.",
      },
      highRes: {
        supported: false,
        mode: "scaffold-only",
        notes:
          "highQuality/hiresFix are currently manifest/planner scaffolds without provider-native refinement execution in 0.3.",
      },
      references: params.capabilities.supportsEdits
        ? {
            supported: true,
            mode: "edit-input",
            notes:
              "Reference/base/mask image inputs are supported through edit-first provider flows.",
          }
        : {
            supported: false,
            mode: "none",
            notes: "Provider does not support reference image inputs for edit-first requests.",
          },
    },
  };
}
