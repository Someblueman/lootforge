import { describe, expect, it } from "vitest";

import { createPlanArtifacts, validateManifestSource } from "../../src/manifest/validate.ts";
import type { ManifestV2 } from "../../src/manifest/types.ts";

const BASE_MANIFEST: ManifestV2 = {
  version: "next",
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
  styleKits: [
    {
      id: "default-kit",
      rulesPath: "style/default/style.md",
      palettePath: "style/default/palette.txt",
      referenceImages: ["style/default/ref-1.png"],
      lightingModel: "top-left key with soft ambient fill",
    },
  ],
  evaluationProfiles: [
    {
      id: "sprite-quality",
      hardGates: {
        requireAlpha: true,
        maxFileSizeKB: 256,
      },
      scoreWeights: {
        readability: 1,
      },
    },
  ],
  targets: [
    {
      id: "hero",
      kind: "sprite",
      out: "hero.png",
      styleKitId: "default-kit",
      consistencyGroup: "hero-family",
      evaluationProfileId: "sprite-quality",
      generationMode: "text",
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
  it("injects style-kit constraints into the normalized prompt", () => {
    const artifacts = createPlanArtifacts(BASE_MANIFEST, "/tmp/manifest.json");
    expect(artifacts.targets[0].promptSpec.style).toContain("default-kit");
    expect(artifacts.targets[0].promptSpec.constraints).toContain("Consistency group: hero-family");
  });

  it("normalizes numeric postProcess resize with default lanczos3 algorithm", () => {
    const manifest: ManifestV2 = {
      ...BASE_MANIFEST,
      targets: [
        {
          ...BASE_MANIFEST.targets[0],
          postProcess: {
            resizeTo: 128,
          },
        },
      ],
    };

    const artifacts = createPlanArtifacts(manifest, "/tmp/manifest.json");
    expect(artifacts.targets[0].postProcess).toEqual({
      resizeTo: { width: 128, height: 128 },
      algorithm: "lanczos3",
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

  it("rejects unsafe target output paths that escape the output root", () => {
    const manifest: ManifestV2 = {
      ...BASE_MANIFEST,
      targets: [
        {
          ...BASE_MANIFEST.targets[0],
          out: "../../outside.png",
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
      validation.report.issues.some((issue) => issue.code === "invalid_target_out_path"),
    ).toBe(true);
  });

  it("treats normalized case-insensitive output path collisions as duplicates", () => {
    const manifest: ManifestV2 = {
      ...BASE_MANIFEST,
      targets: [
        {
          ...BASE_MANIFEST.targets[0],
          id: "hero-upper",
          out: "Sprites/Hero.png",
        },
        {
          ...BASE_MANIFEST.targets[0],
          id: "hero-lower",
          out: "sprites\\hero.png",
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
      validation.report.issues.some((issue) => issue.code === "duplicate_target_out"),
    ).toBe(true);
  });

  it("expands spritesheet targets into frame jobs plus assemble target", () => {
    const manifest: ManifestV2 = {
      ...BASE_MANIFEST,
      targets: [
        {
          ...BASE_MANIFEST.targets[0],
          id: "hero.sheet",
          kind: "spritesheet",
          out: "hero_sheet.png",
          prompt: undefined,
          promptSpec: undefined,
          animations: {
            walk: {
              count: 2,
              prompt: "Top-down hero walk animation frame",
              fps: 10,
              loop: true,
              pivot: { x: 0.5, y: 0.85 },
            },
          },
        },
      ],
    };

    const artifacts = createPlanArtifacts(manifest, "/tmp/manifest.json");
    expect(artifacts.targets.some((target) => target.id === "hero.sheet")).toBe(true);
    expect(
      artifacts.targets.some(
        (target) =>
          target.id === "hero.sheet.walk.0" &&
          target.catalogDisabled === true &&
          target.generationDisabled !== true,
      ),
    ).toBe(true);
    expect(artifacts.openaiJobs.every((job) => !job.targetId.endsWith(".sheet"))).toBe(true);
  });
});
