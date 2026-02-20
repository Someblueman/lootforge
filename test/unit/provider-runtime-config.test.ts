import { describe, expect, it } from "vitest";

import { buildProviderRegistryOptions } from "../../src/providers/runtimeConfig.ts";

describe("provider runtime config", () => {
  it("maps manifest provider runtime fields into registry options", () => {
    const options = buildProviderRegistryOptions(
      {
        openai: {
          endpoint: "https://openai.example/v1/images/generations",
          timeoutMs: 12_000,
          maxRetries: 3,
          minDelayMs: 180,
          defaultConcurrency: 4,
        },
        nano: {
          endpoint: "https://gemini.example/v1beta/models",
          timeoutMs: 9_000,
          maxRetries: 2,
          minDelayMs: 250,
          defaultConcurrency: 3,
        },
        local: {
          baseUrl: "http://127.0.0.1:9000",
          timeoutMs: 4_000,
          maxRetries: 1,
          minDelayMs: 50,
          defaultConcurrency: 2,
        },
      },
      {},
    );

    expect(options.openai).toMatchObject({
      endpoint: "https://openai.example/v1/images/generations",
      editsEndpoint: "https://openai.example/v1/images/edits",
      timeoutMs: 12_000,
      maxRetries: 3,
      minDelayMs: 180,
      defaultConcurrency: 4,
    });
    expect(options.nano).toMatchObject({
      apiBase: "https://gemini.example/v1beta/models",
      timeoutMs: 9_000,
      maxRetries: 2,
      minDelayMs: 250,
      defaultConcurrency: 3,
    });
    expect(options.local).toMatchObject({
      baseUrl: "http://127.0.0.1:9000",
      timeoutMs: 4_000,
      maxRetries: 1,
      minDelayMs: 50,
      defaultConcurrency: 2,
    });
  });

  it("lets environment overrides win over manifest runtime settings", () => {
    const options = buildProviderRegistryOptions(
      {
        openai: {
          endpoint: "https://manifest.example/v1/images/generations",
          timeoutMs: 10_000,
          maxRetries: 2,
        },
      },
      {
        LOOTFORGE_OPENAI_ENDPOINT: "https://env.example/v1/images/generations",
        LOOTFORGE_OPENAI_TIMEOUT_MS: "25000",
        LOOTFORGE_OPENAI_MAX_RETRIES: "5",
      },
    );

    expect(options.openai).toMatchObject({
      endpoint: "https://env.example/v1/images/generations",
      editsEndpoint: "https://env.example/v1/images/edits",
      timeoutMs: 25_000,
      maxRetries: 5,
    });
  });

  it("uses local endpoint aliases for backward compatibility", () => {
    const options = buildProviderRegistryOptions(undefined, {
      LOCAL_DIFFUSION_BASE_URL: "http://127.0.0.1:8189",
      LOCAL_DIFFUSION_TIMEOUT_MS: "7000",
    });

    expect(options.local).toMatchObject({
      baseUrl: "http://127.0.0.1:8189",
      timeoutMs: 7000,
    });
  });
});
