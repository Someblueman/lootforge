import { describe, expect, it } from "vitest";

import {
  buildStructuredPrompt,
  createDeterministicJobId,
  getTargetPostProcessPolicy,
  normalizeGenerationPolicyForProvider,
  parseProviderSelection,
  type PlannedTarget,
} from "../../src/providers/types.ts";
import {
  resolveTargetProviderName,
  resolveTargetProviderRoute,
} from "../../src/providers/registry.ts";

const baseTarget: PlannedTarget = {
  id: "target-1",
  out: "assets/target-1.png",
  promptSpec: {
    primary: "A stylized robot hero",
  },
};

describe("providers helpers", () => {
  it("createDeterministicJobId is stable for same inputs", () => {
    const params = {
      provider: "openai" as const,
      targetId: "target-1",
      targetOut: "assets/target-1.png",
      prompt: "A stylized robot hero",
      model: "gpt-image-1",
      inputHash: "hash",
      size: "1024x1024",
      quality: "high",
      background: "transparent",
      outputFormat: "png" as const,
      candidateCount: 2,
    };

    const first = createDeterministicJobId(params);
    const second = createDeterministicJobId({ ...params });

    expect(first).toBe(second);
  });

  it("createDeterministicJobId changes when generation policy changes", () => {
    const baseParams = {
      provider: "openai" as const,
      targetId: "target-1",
      targetOut: "assets/target-1.png",
      prompt: "A stylized robot hero",
      model: "gpt-image-1",
      inputHash: "hash",
      quality: "high",
      background: "transparent",
      outputFormat: "png" as const,
      candidateCount: 1,
    };

    const baseline = createDeterministicJobId({
      ...baseParams,
      size: "1024x1024",
    });

    expect(
      createDeterministicJobId({
        ...baseParams,
        size: "512x512",
      }),
    ).not.toBe(baseline);

    expect(
      createDeterministicJobId({
        ...baseParams,
        size: "1024x1024",
        quality: "low",
      }),
    ).not.toBe(baseline);

    expect(
      createDeterministicJobId({
        ...baseParams,
        size: "1024x1024",
        background: "opaque",
      }),
    ).not.toBe(baseline);

    expect(
      createDeterministicJobId({
        ...baseParams,
        size: "1024x1024",
        outputFormat: "jpeg",
      }),
    ).not.toBe(baseline);
  });

  it("parseProviderSelection handles openai/nano/local/auto and rejects invalid", () => {
    expect(parseProviderSelection("openai")).toBe("openai");
    expect(parseProviderSelection("nano")).toBe("nano");
    expect(parseProviderSelection("local")).toBe("local");
    expect(parseProviderSelection("auto")).toBe("auto");
    expect(parseProviderSelection(undefined)).toBe("auto");

    expect(() => parseProviderSelection("invalid-provider")).toThrow(
      /Unsupported provider \"invalid-provider\"/,
    );
  });

  it("resolveTargetProviderName respects explicit provider and route fallbacks", () => {
    const withOverride: PlannedTarget = {
      ...baseTarget,
      provider: "nano",
      generationPolicy: {
        fallbackProviders: ["openai"],
      },
    };

    expect(resolveTargetProviderName(withOverride, "openai")).toBe("nano");
    expect(resolveTargetProviderName(withOverride, "auto")).toBe("nano");

    const route = resolveTargetProviderRoute(withOverride, "auto");
    expect(route.primary).toBe("nano");
    expect(route.fallbacks).toEqual(["openai"]);
  });

  it("auto routing picks openai for alpha-required targets", () => {
    const alphaTarget: PlannedTarget = {
      ...baseTarget,
      acceptance: {
        alpha: true,
      },
    };

    const route = resolveTargetProviderRoute(alphaTarget, "auto");
    expect(route.primary).toBe("openai");
    expect(route.fallbacks.length).toBeGreaterThan(0);
  });

  it("buildStructuredPrompt injects known style preset instructions", () => {
    const prompt = buildStructuredPrompt({
      primary: "A farmer character sprite",
      stylePreset: "pixel-art-16bit",
    });

    expect(prompt).toContain("Style preset: pixel-art-16bit");
    expect(prompt).toContain("strict pixel grid");
    expect(prompt).toContain("no anti-aliasing");
  });

  it("getTargetPostProcessPolicy applies safe defaults", () => {
    const policy = getTargetPostProcessPolicy({
      ...baseTarget,
    });

    expect(policy.algorithm).toBe("lanczos3");
    expect(policy.stripMetadata).toBe(true);
  });

  it("normalizeGenerationPolicyForProvider canonicalizes jpg alias and transparent jpeg", () => {
    const result = normalizeGenerationPolicyForProvider("openai", {
      size: "1024x1024",
      quality: "high",
      background: "transparent",
      outputFormat: "jpeg",
      candidates: 1,
      maxRetries: 1,
      fallbackProviders: [],
    });

    expect(result.policy.outputFormat).toBe("png");
    expect(result.issues.some((issue) => issue.code === "jpg_transparency_normalized")).toBe(
      true,
    );
  });
});
