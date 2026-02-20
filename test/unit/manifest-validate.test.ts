import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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
  consistencyGroups: [
    {
      id: "hero-family",
      description: "Shared playable hero line with matching silhouette language.",
      styleKitId: "default-kit",
      referenceImages: ["style/default/hero-ref.png"],
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
        anchorX: 0.25,
        anchorY: 0.75,
      },
    },
  ],
};

describe("manifest normalization", () => {
  it("injects style-kit constraints into the normalized prompt", () => {
    const artifacts = createPlanArtifacts(BASE_MANIFEST, "/tmp/manifest.json");
    expect(artifacts.targets[0].promptSpec.style).toContain("default-kit");
    expect(artifacts.targets[0].promptSpec.constraints).toContain("Consistency group: hero-family");
    expect(artifacts.targets[0].promptSpec.constraints).toContain("Consistency notes:");
    expect(artifacts.targets[0].scoreWeights?.readability).toBe(1);
    expect(artifacts.targets[0].runtimeSpec?.anchorX).toBe(0.25);
    expect(artifacts.targets[0].runtimeSpec?.anchorY).toBe(0.75);
  });

  it("defaults generationPolicy.vlmGate threshold to 4", () => {
    const manifest: ManifestV2 = {
      ...BASE_MANIFEST,
      targets: [
        {
          ...BASE_MANIFEST.targets[0],
          generationPolicy: {
            ...BASE_MANIFEST.targets[0].generationPolicy,
            vlmGate: {
              rubric: "Grade silhouette clarity and framing quality from 0 to 5.",
            },
          },
        },
      ],
    };

    const artifacts = createPlanArtifacts(manifest, "/tmp/manifest.json");
    expect(artifacts.targets[0].generationPolicy?.vlmGate).toEqual({
      threshold: 4,
      rubric: "Grade silhouette clarity and framing quality from 0 to 5.",
    });
  });

  it("defaults target palette from style-kit palette files when target palette is unset", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lootforge-style-kit-palette-"));
    const styleDir = path.join(tempRoot, "style", "default");
    await mkdir(styleDir, { recursive: true });
    await writeFile(
      path.join(styleDir, "palette.txt"),
      [
        "#112233",
        "44AA55",
        "255, 0, 170",
        "GIMP Palette",
        "Name: ignored",
        "Columns: 4",
      ].join("\n"),
      "utf8",
    );

    const manifestPath = path.join(tempRoot, "manifest.json");
    const artifacts = createPlanArtifacts(BASE_MANIFEST, manifestPath);

    expect(artifacts.targets[0].palette).toEqual({
      mode: "exact",
      colors: ["#112233", "#44aa55", "#ff00aa"],
      dither: undefined,
    });
  });

  it("preserves strict exact palette policy during normalization", () => {
    const manifest: ManifestV2 = {
      ...BASE_MANIFEST,
      targets: [
        {
          ...BASE_MANIFEST.targets[0],
          palette: {
            mode: "exact",
            colors: ["112233", "#445566"],
            strict: true,
          },
        },
      ],
    };

    const artifacts = createPlanArtifacts(manifest, "/tmp/manifest.json");
    expect(artifacts.targets[0].palette).toEqual({
      mode: "exact",
      colors: ["#112233", "#445566"],
      dither: undefined,
      strict: true,
    });
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

  it("normalizes seam-heal and wrap-grid target policies", () => {
    const manifest: ManifestV2 = {
      ...BASE_MANIFEST,
      targets: [
        {
          ...BASE_MANIFEST.targets[0],
          kind: "tile",
          tileable: true,
          seamThreshold: 10,
          seamStripPx: 3,
          seamHeal: {
            strength: 0.8,
          },
          wrapGrid: {
            columns: 4,
            rows: 2,
          },
          acceptance: {
            ...BASE_MANIFEST.targets[0].acceptance,
            size: "64x32",
          },
        },
      ],
    };

    const artifacts = createPlanArtifacts(manifest, "/tmp/manifest.json");
    expect(artifacts.targets[0].seamHeal).toEqual({
      enabled: true,
      stripPx: 3,
      strength: 0.8,
    });
    expect(artifacts.targets[0].wrapGrid).toEqual({
      columns: 4,
      rows: 2,
      seamThreshold: 10,
      seamStripPx: 3,
    });
  });

  it("applies boundary hard-gate thresholds from evaluation profiles", () => {
    const manifest: ManifestV2 = {
      ...BASE_MANIFEST,
      evaluationProfiles: [
        {
          ...BASE_MANIFEST.evaluationProfiles[0],
          hardGates: {
            ...BASE_MANIFEST.evaluationProfiles[0].hardGates,
            alphaHaloRiskMax: 0.05,
            alphaStrayNoiseMax: 0.01,
            alphaEdgeSharpnessMin: 0.8,
            packTextureBudgetMB: 32,
            spritesheetSilhouetteDriftMax: 0.2,
            spritesheetAnchorDriftMax: 0.15,
          },
        },
      ],
    };

    const artifacts = createPlanArtifacts(manifest, "/tmp/manifest.json");
    expect(artifacts.targets[0].alphaHaloRiskMax).toBe(0.05);
    expect(artifacts.targets[0].alphaStrayNoiseMax).toBe(0.01);
    expect(artifacts.targets[0].alphaEdgeSharpnessMin).toBe(0.8);
    expect(artifacts.targets[0].packTextureBudgetMB).toBe(32);
    expect(artifacts.targets[0].spritesheetSilhouetteDriftMax).toBe(0.2);
    expect(artifacts.targets[0].spritesheetAnchorDriftMax).toBe(0.15);
  });

  it("rejects invalid pack-level hard-gate values", () => {
    const manifest: ManifestV2 = {
      ...BASE_MANIFEST,
      evaluationProfiles: [
        {
          ...BASE_MANIFEST.evaluationProfiles[0],
          hardGates: {
            ...BASE_MANIFEST.evaluationProfiles[0].hardGates,
            packTextureBudgetMB: -1,
            spritesheetSilhouetteDriftMax: 1.2,
            spritesheetAnchorDriftMax: -0.1,
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
      validation.report.issues.some(
        (issue) =>
          issue.path === "evaluationProfiles[0].hardGates.packTextureBudgetMB" ||
          issue.path === "evaluationProfiles[0].hardGates.spritesheetSilhouetteDriftMax" ||
          issue.path === "evaluationProfiles[0].hardGates.spritesheetAnchorDriftMax",
      ),
    ).toBe(true);
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

  it("rejects strict palette mode for non-exact palettes", () => {
    const manifest: ManifestV2 = {
      ...BASE_MANIFEST,
      targets: [
        {
          ...BASE_MANIFEST.targets[0],
          palette: {
            mode: "max-colors",
            maxColors: 16,
            strict: true,
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
      validation.report.issues.some(
        (issue) =>
          issue.path === "targets[0].palette.strict" &&
          issue.message === "Palette strict mode is only supported for exact palettes.",
      ),
    ).toBe(true);
  });

  it("reports wrap-grid size mismatch when target dimensions do not divide evenly", () => {
    const manifest: ManifestV2 = {
      ...BASE_MANIFEST,
      targets: [
        {
          ...BASE_MANIFEST.targets[0],
          kind: "tile",
          tileable: true,
          wrapGrid: {
            columns: 4,
            rows: 3,
          },
          acceptance: {
            ...BASE_MANIFEST.targets[0].acceptance,
            size: "64x32",
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
      validation.report.issues.some((issue) => issue.code === "wrap_grid_size_mismatch"),
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

  it("rejects unknown consistency groups when consistency groups are declared", () => {
    const manifest: ManifestV2 = {
      ...BASE_MANIFEST,
      targets: [
        {
          ...BASE_MANIFEST.targets[0],
          consistencyGroup: "missing-group",
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
      validation.report.issues.some((issue) => issue.code === "missing_consistency_group"),
    ).toBe(true);
  });

  it("rejects consistency group style-kit mismatches", () => {
    const manifest: ManifestV2 = {
      ...BASE_MANIFEST,
      styleKits: [
        ...BASE_MANIFEST.styleKits,
        {
          id: "alt-kit",
          rulesPath: "style/alt/style.md",
          palettePath: "style/alt/palette.txt",
          referenceImages: [],
          lightingModel: "studio top light",
        },
      ],
      consistencyGroups: [
        {
          id: "hero-family",
          description: "Locked group",
          styleKitId: "alt-kit",
          referenceImages: [],
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
      validation.report.issues.some(
        (issue) => issue.code === "consistency_group_style_kit_mismatch",
      ),
    ).toBe(true);
  });

  it("reports unsafe manifest asset paths", () => {
    const manifest: ManifestV2 = {
      ...BASE_MANIFEST,
      styleKits: [
        {
          ...BASE_MANIFEST.styleKits[0],
          rulesPath: "../escape.md",
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
      validation.report.issues.some((issue) => issue.code === "invalid_manifest_asset_path"),
    ).toBe(true);
  });

  it("warns when manifest-referenced style assets are missing", () => {
    const validation = validateManifestSource({
      manifestPath: "/tmp/manifest.json",
      raw: JSON.stringify(BASE_MANIFEST),
      data: BASE_MANIFEST,
    });

    expect(
      validation.report.issues.some((issue) => issue.code === "missing_manifest_asset"),
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
