import { describe, expect, it } from "vitest";

import { createPlanArtifacts, validateManifestSource } from "../../src/manifest/validate.ts";
import type { ManifestV2 } from "../../src/manifest/types.ts";

const BASE_MANIFEST: ManifestV2 = {
  version: "2",
  pack: {
    id: "test-pack",
    version: "0.1.0",
    license: "UNLICENSED",
    author: "tester",
  },
  providers: {
    default: "openai",
    openai: {
      model: "gpt-image-1",
    },
  },
  targets: [
    {
      id: "hero",
      kind: "sprite",
      out: "hero.png",
      prompt: "Top-down hero sprite",
      generationPolicy: {
        size: "1024x1024",
        outputFormat: "png",
      },
      acceptance: {
        size: "512x512",
        alpha: true,
        maxFileSizeKB: 256,
      },
      runtimeSpec: {
        alphaRequired: true,
        previewWidth: 256,
        previewHeight: 256,
      },
    },
  ],
};

describe("manifest normalization", () => {
  it("applies styleGuide preset when target prompt does not define one", () => {
    const manifest: ManifestV2 = {
      ...BASE_MANIFEST,
      styleGuide: {
        preset: "topdown-painterly-sci-fi",
      },
    };

    const artifacts = createPlanArtifacts(manifest, "/tmp/manifest.json");
    expect(artifacts.targets[0].promptSpec.stylePreset).toBe("topdown-painterly-sci-fi");
  });

  it("normalizes numeric postProcess resize and defaults pixel-art algorithm", () => {
    const manifest: ManifestV2 = {
      ...BASE_MANIFEST,
      targets: [
        {
          ...BASE_MANIFEST.targets[0],
          prompt: {
            primary: "16-bit hero sprite",
            stylePreset: "pixel-art-16bit",
          },
          postProcess: {
            resizeTo: 128,
          },
        },
      ],
    };

    const artifacts = createPlanArtifacts(manifest, "/tmp/manifest.json");
    expect(artifacts.targets[0].postProcess).toEqual({
      resizeTo: { width: 128, height: 128 },
      algorithm: "nearest",
      stripMetadata: true,
    });
  });

  it("reports invalid postProcess resize literals", () => {
    const manifest: ManifestV2 = {
      ...BASE_MANIFEST,
      targets: [
        {
          ...BASE_MANIFEST.targets[0],
          postProcess: {
            resizeTo: "abc",
          },
        },
      ],
    };

    const validation = validateManifestSource({
      manifestPath: "/tmp/manifest.json",
      raw: JSON.stringify(manifest),
      data: manifest,
    });

    expect(validation.report.errors).toBeGreaterThan(0);
    expect(
      validation.report.issues.some((issue) => issue.code === "invalid_postprocess_resize"),
    ).toBe(true);
  });
});
