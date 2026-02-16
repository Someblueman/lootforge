import { describe, expect, it } from "vitest";

import {
  buildStructuredPrompt,
  createDeterministicJobId,
  getTargetPostProcessPolicy,
  parseProviderSelection,
  type PlannedTarget,
} from "../../src/providers/types.ts";
import { resolveTargetProviderName } from "../../src/providers/registry.ts";

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
    };

    const first = createDeterministicJobId(params);
    const second = createDeterministicJobId({ ...params });

    expect(first).toBe(second);
  });

  it("createDeterministicJobId changes when prompt changes", () => {
    const baseParams = {
      provider: "openai" as const,
      targetId: "target-1",
      targetOut: "assets/target-1.png",
      model: "gpt-image-1",
    };

    const first = createDeterministicJobId({
      ...baseParams,
      prompt: "A stylized robot hero",
    });
    const second = createDeterministicJobId({
      ...baseParams,
      prompt: "A stylized robot villain",
    });

    expect(first).not.toBe(second);
  });

  it("parseProviderSelection handles openai/nano/auto and rejects invalid", () => {
    expect(parseProviderSelection("openai")).toBe("openai");
    expect(parseProviderSelection("nano")).toBe("nano");
    expect(parseProviderSelection("auto")).toBe("auto");
    expect(parseProviderSelection(undefined)).toBe("auto");

    expect(() => parseProviderSelection("invalid-provider")).toThrow(
      /Unsupported provider "invalid-provider"/,
    );
  });

  it("resolveTargetProviderName respects target.provider override and requested provider", () => {
    const withOverride: PlannedTarget = {
      ...baseTarget,
      provider: "nano",
    };
    expect(resolveTargetProviderName(withOverride, "openai")).toBe("nano");
    expect(resolveTargetProviderName(withOverride, "auto")).toBe("nano");

    const withoutOverride: PlannedTarget = { ...baseTarget };
    expect(resolveTargetProviderName(withoutOverride, "openai")).toBe("openai");
    expect(resolveTargetProviderName(withoutOverride, "nano")).toBe("nano");
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
});
