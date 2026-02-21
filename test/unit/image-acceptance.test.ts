import { mkdtemp, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  runImageAcceptanceChecks,
  evaluateImageAcceptance,
} from "../../src/checks/imageAcceptance.js";
import { type PlannedTarget } from "../../src/providers/types.js";

function makeTarget(overrides: Partial<PlannedTarget> = {}): PlannedTarget {
  return {
    id: "hero",
    kind: "sprite",
    out: "hero.png",
    promptSpec: { primary: "hero" },
    generationPolicy: {
      outputFormat: "png",
      background: "transparent",
    },
    acceptance: {
      size: "64x64",
      alpha: true,
      maxFileSizeKB: 64,
    },
    runtimeSpec: {
      alphaRequired: true,
    },
    ...overrides,
  };
}

async function writeWrapGridSample(filePath: string, width: number, height: number): Promise<void> {
  const channels = 4;
  const raw = Buffer.alloc(width * height * channels, 0);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * channels;
      const localX = x % Math.max(1, Math.floor(width / 2));
      raw[index] = localX === 0 ? 255 : 16;
      raw[index + 1] = 0;
      raw[index + 2] = localX === Math.max(1, Math.floor(width / 2)) - 1 ? 255 : 16;
      raw[index + 3] = 255;
    }
  }

  await sharp(raw, { raw: { width, height, channels } }).png().toFile(filePath);
}

async function writeUniformWrapGridSample(
  filePath: string,
  width: number,
  height: number,
  color: [number, number, number] = [120, 120, 120],
): Promise<void> {
  const channels = 4;
  const raw = Buffer.alloc(width * height * channels, 0);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * channels;
      raw[index] = color[0];
      raw[index + 1] = color[1];
      raw[index + 2] = color[2];
      raw[index + 3] = 255;
    }
  }
  await sharp(raw, { raw: { width, height, channels } }).png().toFile(filePath);
}

async function writeBoundaryArtifactSample(filePath: string): Promise<void> {
  const width = 64;
  const height = 64;
  const channels = 4;
  const raw = Buffer.alloc(width * height * channels, 0);

  for (let y = 16; y <= 47; y += 1) {
    for (let x = 16; x <= 47; x += 1) {
      const index = (y * width + x) * channels;
      raw[index] = 220;
      raw[index + 1] = 30;
      raw[index + 2] = 30;
      raw[index + 3] = 255;
    }
  }

  for (let y = 15; y <= 48; y += 1) {
    for (let x = 15; x <= 48; x += 1) {
      if (x !== 15 && x !== 48 && y !== 15 && y !== 48) {
        continue;
      }
      const index = (y * width + x) * channels;
      raw[index] = 255;
      raw[index + 1] = 255;
      raw[index + 2] = 255;
      raw[index + 3] = 120;
    }
  }

  const strayIndex = (4 * width + 4) * channels;
  raw[strayIndex] = 255;
  raw[strayIndex + 1] = 255;
  raw[strayIndex + 2] = 255;
  raw[strayIndex + 3] = 255;

  await sharp(raw, { raw: { width, height, channels } }).png().toFile(filePath);
}

async function writeLowContrastStyleSample(filePath: string): Promise<void> {
  const width = 64;
  const height = 64;
  const channels = 4;
  const raw = Buffer.alloc(width * height * channels, 0);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * channels;
      raw[index] = 120;
      raw[index + 1] = 120;
      raw[index + 2] = 120;
      raw[index + 3] = 255;
    }
  }

  await sharp(raw, { raw: { width, height, channels } }).png().toFile(filePath);
}

async function writeShadingGradientSample(filePath: string): Promise<void> {
  const width = 64;
  const height = 64;
  const channels = 4;
  const raw = Buffer.alloc(width * height * channels, 0);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = Math.floor((x / (width - 1)) * 255);
      const index = (y * width + x) * channels;
      raw[index] = value;
      raw[index + 1] = value;
      raw[index + 2] = value;
      raw[index + 3] = 255;
    }
  }

  await sharp(raw, { raw: { width, height, channels } }).png().toFile(filePath);
}

async function writeRoundUiSample(filePath: string): Promise<void> {
  const width = 64;
  const height = 64;
  const channels = 4;
  const raw = Buffer.alloc(width * height * channels, 0);
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = 18;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      if (dx * dx + dy * dy > radius * radius) {
        continue;
      }
      const index = (y * width + x) * channels;
      raw[index] = 40;
      raw[index + 1] = 180;
      raw[index + 2] = 220;
      raw[index + 3] = 255;
    }
  }

  await sharp(raw, { raw: { width, height, channels } }).png().toFile(filePath);
}

async function writeMattingArtifactSample(filePath: string): Promise<void> {
  const width = 64;
  const height = 64;
  const channels = 4;
  const raw = Buffer.alloc(width * height * channels, 0);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * channels;
      raw[index] = 120;
      raw[index + 1] = 120;
      raw[index + 2] = 120;
      raw[index + 3] = 0;
    }
  }

  for (let y = 20; y < 44; y += 1) {
    for (let x = 20; x < 44; x += 1) {
      const index = (y * width + x) * channels;
      raw[index] = 240;
      raw[index + 1] = 80;
      raw[index + 2] = 40;
      raw[index + 3] = 255;
    }
  }

  // Isolated semi-transparent pixels away from opaque edges reduce mask consistency.
  for (const [x, y] of [
    [5, 5],
    [58, 5],
    [5, 58],
    [58, 58],
    [10, 50],
    [50, 10],
  ] as const) {
    const index = (y * width + x) * channels;
    raw[index] = 255;
    raw[index + 1] = 255;
    raw[index + 2] = 255;
    raw[index + 3] = 128;
  }

  await sharp(raw, { raw: { width, height, channels } }).png().toFile(filePath);
}

async function writeSpriteFrameSample(params: {
  filePath: string;
  offsetX?: number;
  offsetY?: number;
  rectWidth?: number;
  rectHeight?: number;
  color?: [number, number, number];
}): Promise<void> {
  const width = 64;
  const height = 64;
  const channels = 4;
  const raw = Buffer.alloc(width * height * channels, 0);
  const startX = 18 + (params.offsetX ?? 0);
  const startY = 18 + (params.offsetY ?? 0);
  const endX = Math.min(width - 1, startX + (params.rectWidth ?? 20));
  const endY = Math.min(height - 1, startY + (params.rectHeight ?? 20));
  const color = params.color ?? [220, 220, 220];

  for (let y = Math.max(0, startY); y < endY; y += 1) {
    for (let x = Math.max(0, startX); x < endX; x += 1) {
      const index = (y * width + x) * channels;
      raw[index] = color[0];
      raw[index + 1] = color[1];
      raw[index + 2] = color[2];
      raw[index + 3] = 255;
    }
  }

  await sharp(raw, { raw: { width, height, channels } }).png().toFile(params.filePath);
}

describe("image acceptance", () => {
  it("passes a valid transparent png", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "lootforge-acceptance-pass-"));
    await mkdir(tempDir, { recursive: true });

    await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toFile(path.join(tempDir, "hero.png"));

    const report = await runImageAcceptanceChecks({
      targets: [makeTarget()],
      imagesDir: tempDir,
      strict: true,
    });

    expect(report.errors).toBe(0);
    expect(report.failed).toBe(0);
  });

  it("fails alpha-required image when output is opaque", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "lootforge-acceptance-fail-"));
    await mkdir(tempDir, { recursive: true });

    await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .jpeg()
      .toFile(path.join(tempDir, "hero.jpg"));

    const target = makeTarget({
      out: "hero.jpg",
      generationPolicy: {
        outputFormat: "png",
        background: "transparent",
      },
    });

    const item = await evaluateImageAcceptance(target, tempDir);
    expect(item.issues.some((issue) => issue.code === "output_format_mismatch")).toBe(true);
    expect(item.issues.some((issue) => issue.code === "alpha_channel_missing")).toBe(true);
  });

  it("enforces 100% compliance in strict exact palette mode", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "lootforge-acceptance-palette-strict-"));
    await mkdir(tempDir, { recursive: true });

    const width = 4;
    const height = 1;
    const channels = 4;
    const raw = Buffer.alloc(width * height * channels, 0);
    const setPixel = (x: number, rgba: [number, number, number, number]): void => {
      const index = (x * channels) >>> 0;
      raw[index] = rgba[0];
      raw[index + 1] = rgba[1];
      raw[index + 2] = rgba[2];
      raw[index + 3] = rgba[3];
    };

    setPixel(0, [255, 0, 0, 255]);
    setPixel(1, [0, 255, 0, 255]);
    setPixel(2, [0, 0, 255, 255]); // outside strict palette
    setPixel(3, [255, 255, 255, 0]); // ignored transparent pixel

    await sharp(raw, { raw: { width, height, channels } })
      .png()
      .toFile(path.join(tempDir, "hero.png"));

    const item = await evaluateImageAcceptance(
      makeTarget({
        acceptance: {
          size: "4x1",
          alpha: false,
          maxFileSizeKB: 64,
        },
        runtimeSpec: {
          alphaRequired: false,
        },
        palette: {
          mode: "exact",
          colors: ["#ff0000", "#00ff00"],
          strict: true,
        },
      }),
      tempDir,
    );

    expect(item.metrics?.paletteCompliance).toBeCloseTo(2 / 3, 5);
    expect(item.issues.some((issue) => issue.code === "palette_strict_noncompliant")).toBe(true);
  });

  it("reports wrap-grid seam violations when per-cell seams exceed threshold", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "lootforge-wrap-grid-seam-"));
    await mkdir(tempDir, { recursive: true });
    const imagePath = path.join(tempDir, "hero.png");
    await writeWrapGridSample(imagePath, 8, 4);

    const item = await evaluateImageAcceptance(
      makeTarget({
        acceptance: {
          size: "8x4",
          alpha: false,
          maxFileSizeKB: 64,
        },
        runtimeSpec: {
          alphaRequired: false,
        },
        wrapGrid: {
          columns: 2,
          rows: 1,
          seamThreshold: 8,
          seamStripPx: 1,
        },
      }),
      tempDir,
    );

    expect(item.issues.some((issue) => issue.code === "wrap_grid_seam_exceeded")).toBe(true);
  });

  it("reports wrap-grid self-topology mismatches separately from seam metrics", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "lootforge-wrap-grid-topology-self-"));
    await mkdir(tempDir, { recursive: true });
    const imagePath = path.join(tempDir, "hero.png");
    await writeWrapGridSample(imagePath, 8, 4);

    const item = await evaluateImageAcceptance(
      makeTarget({
        acceptance: {
          size: "8x4",
          alpha: false,
          maxFileSizeKB: 64,
        },
        runtimeSpec: {
          alphaRequired: false,
        },
        wrapGrid: {
          columns: 2,
          rows: 1,
          topology: {
            mode: "self",
            maxMismatchRatio: 0.1,
          },
        },
      }),
      tempDir,
    );

    expect(item.metrics?.wrapGridTopologyComparisons).toBeGreaterThan(0);
    expect(item.issues.some((issue) => issue.code === "wrap_grid_topology_self_exceeded")).toBe(
      true,
    );
  });

  it("reports wrap-grid one-to-one topology mismatches", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "lootforge-wrap-grid-topology-pairs-"));
    await mkdir(tempDir, { recursive: true });
    const imagePath = path.join(tempDir, "hero.png");
    await writeWrapGridSample(imagePath, 8, 4);

    const item = await evaluateImageAcceptance(
      makeTarget({
        acceptance: {
          size: "8x4",
          alpha: false,
          maxFileSizeKB: 64,
        },
        runtimeSpec: {
          alphaRequired: false,
        },
        wrapGrid: {
          columns: 2,
          rows: 1,
          topology: {
            mode: "one-to-one",
            maxMismatchRatio: 0.1,
          },
        },
      }),
      tempDir,
    );

    expect(item.issues.some((issue) => issue.code === "wrap_grid_topology_pair_exceeded")).toBe(
      true,
    );
  });

  it("reports wrap-grid many-to-many topology compatibility mismatches", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "lootforge-wrap-grid-topology-compatibility-"),
    );
    await mkdir(tempDir, { recursive: true });
    const imagePath = path.join(tempDir, "hero.png");
    await writeWrapGridSample(imagePath, 8, 4);

    const item = await evaluateImageAcceptance(
      makeTarget({
        acceptance: {
          size: "8x4",
          alpha: false,
          maxFileSizeKB: 64,
        },
        runtimeSpec: {
          alphaRequired: false,
        },
        wrapGrid: {
          columns: 2,
          rows: 1,
          topology: {
            mode: "many-to-many",
            maxMismatchRatio: 0.1,
          },
        },
      }),
      tempDir,
    );

    expect(
      item.issues.some((issue) => issue.code === "wrap_grid_topology_compatibility_exceeded"),
    ).toBe(true);
  });

  it("passes wrap-grid topology checks when mismatch ratio stays under threshold", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "lootforge-wrap-grid-topology-pass-"));
    await mkdir(tempDir, { recursive: true });
    const imagePath = path.join(tempDir, "hero.png");
    await writeUniformWrapGridSample(imagePath, 8, 4);

    const item = await evaluateImageAcceptance(
      makeTarget({
        acceptance: {
          size: "8x4",
          alpha: false,
          maxFileSizeKB: 64,
        },
        runtimeSpec: {
          alphaRequired: false,
        },
        wrapGrid: {
          columns: 2,
          rows: 1,
          topology: {
            mode: "many-to-many",
            maxMismatchRatio: 0,
          },
        },
      }),
      tempDir,
    );

    expect(
      item.issues.some((issue) => issue.code === "wrap_grid_topology_compatibility_exceeded"),
    ).toBe(false);
  });

  it("reports wrap-grid size mismatches", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "lootforge-wrap-grid-size-"));
    await mkdir(tempDir, { recursive: true });
    await sharp({
      create: {
        width: 7,
        height: 4,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      },
    })
      .png()
      .toFile(path.join(tempDir, "hero.png"));

    const item = await evaluateImageAcceptance(
      makeTarget({
        acceptance: {
          size: "7x4",
          alpha: false,
          maxFileSizeKB: 64,
        },
        runtimeSpec: {
          alphaRequired: false,
        },
        wrapGrid: {
          columns: 2,
          rows: 1,
        },
      }),
      tempDir,
    );

    expect(item.issues.some((issue) => issue.code === "wrap_grid_size_mismatch")).toBe(true);
  });

  it("reports boundary artifact metrics and hard-gate violations", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "lootforge-boundary-metrics-"));
    await mkdir(tempDir, { recursive: true });
    const imagePath = path.join(tempDir, "hero.png");
    await writeBoundaryArtifactSample(imagePath);

    const item = await evaluateImageAcceptance(
      makeTarget({
        alphaHaloRiskMax: 0.02,
        alphaStrayNoiseMax: 0,
        alphaEdgeSharpnessMin: 0.9,
      }),
      tempDir,
    );

    expect(item.metrics?.alphaBoundaryPixels).toBeGreaterThan(0);
    expect(item.metrics?.alphaHaloRisk).toBeGreaterThan(0);
    expect(item.metrics?.alphaStrayNoise).toBeGreaterThan(0);
    expect(item.metrics?.alphaEdgeSharpness).toBeLessThan(1);
    expect(item.issues.some((issue) => issue.code === "alpha_halo_risk_exceeded")).toBe(true);
    expect(item.issues.some((issue) => issue.code === "alpha_stray_noise_exceeded")).toBe(true);
    expect(item.issues.some((issue) => issue.code === "alpha_edge_sharpness_too_low")).toBe(true);
  });

  it("reports matting metrics and hard-gate violations", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "lootforge-matting-metrics-"));
    await mkdir(tempDir, { recursive: true });
    const imagePath = path.join(tempDir, "hero.png");
    await writeMattingArtifactSample(imagePath);

    const item = await evaluateImageAcceptance(
      makeTarget({
        mattingHiddenRgbLeakMax: 0.05,
        mattingMaskConsistencyMin: 0.8,
        mattingSemiTransparencyRatioMax: 0.01,
      }),
      tempDir,
    );

    expect(item.metrics?.mattingMaskCoverage).toBeGreaterThan(0);
    expect(item.metrics?.mattingSemiTransparencyRatio).toBeGreaterThan(0);
    expect(item.metrics?.mattingMaskConsistency).toBeLessThan(0.8);
    expect(item.metrics?.mattingHiddenRgbLeak).toBeGreaterThan(0.05);
    expect(item.issues.some((issue) => issue.code === "matting_hidden_rgb_leak_exceeded")).toBe(
      true,
    );
    expect(item.issues.some((issue) => issue.code === "matting_mask_consistency_too_low")).toBe(
      true,
    );
    expect(
      item.issues.some((issue) => issue.code === "matting_semi_transparency_ratio_exceeded"),
    ).toBe(true);
  });

  it("reports style-policy line contrast violations", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "lootforge-style-policy-line-"));
    await mkdir(tempDir, { recursive: true });
    const imagePath = path.join(tempDir, "hero.png");
    await writeLowContrastStyleSample(imagePath);

    const item = await evaluateImageAcceptance(
      makeTarget({
        acceptance: {
          size: "64x64",
          alpha: false,
          maxFileSizeKB: 64,
        },
        runtimeSpec: {
          alphaRequired: false,
        },
        visualStylePolicy: {
          lineContrastMin: 0.05,
        },
      }),
      tempDir,
    );

    expect(item.metrics?.styleLineContrast).toBeDefined();
    expect(item.issues.some((issue) => issue.code === "style_policy_line_contrast_below_min")).toBe(
      true,
    );
  });

  it("reports style-policy shading band violations", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "lootforge-style-policy-shading-"));
    await mkdir(tempDir, { recursive: true });
    const imagePath = path.join(tempDir, "hero.png");
    await writeShadingGradientSample(imagePath);

    const item = await evaluateImageAcceptance(
      makeTarget({
        acceptance: {
          size: "64x64",
          alpha: false,
          maxFileSizeKB: 64,
        },
        runtimeSpec: {
          alphaRequired: false,
        },
        visualStylePolicy: {
          shadingBandCountMax: 4,
        },
      }),
      tempDir,
    );

    expect(item.metrics?.styleShadingBandCount).toBeGreaterThan(4);
    expect(
      item.issues.some((issue) => issue.code === "style_policy_shading_band_count_exceeded"),
    ).toBe(true);
  });

  it("reports style-policy UI rectilinearity violations", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "lootforge-style-policy-ui-"));
    await mkdir(tempDir, { recursive: true });
    const imagePath = path.join(tempDir, "hero.png");
    await writeRoundUiSample(imagePath);

    const item = await evaluateImageAcceptance(
      makeTarget({
        acceptance: {
          size: "64x64",
          alpha: false,
          maxFileSizeKB: 64,
        },
        runtimeSpec: {
          alphaRequired: false,
        },
        visualStylePolicy: {
          uiRectilinearityMin: 0.9,
        },
      }),
      tempDir,
    );

    expect(item.metrics?.styleUiRectilinearity).toBeLessThan(0.9);
    expect(
      item.issues.some((issue) => issue.code === "style_policy_ui_rectilinearity_below_min"),
    ).toBe(true);
  });

  it("passes style-policy checks when constraints are satisfied", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "lootforge-style-policy-pass-"));
    await mkdir(tempDir, { recursive: true });
    const imagePath = path.join(tempDir, "hero.png");
    await writeUniformWrapGridSample(imagePath, 64, 64);

    const item = await evaluateImageAcceptance(
      makeTarget({
        acceptance: {
          size: "64x64",
          alpha: false,
          maxFileSizeKB: 64,
        },
        runtimeSpec: {
          alphaRequired: false,
        },
        visualStylePolicy: {
          lineContrastMin: 0,
          shadingBandCountMax: 2,
          uiRectilinearityMin: 0.99,
        },
      }),
      tempDir,
    );

    expect(item.issues.some((issue) => issue.code.startsWith("style_policy_"))).toBe(false);
  });

  it("reports duplicate runtime output collisions at pack level", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "lootforge-pack-dup-out-"));
    await mkdir(path.join(tempDir, "sprites"), { recursive: true });

    await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 0 },
      },
    })
      .png()
      .toFile(path.join(tempDir, "sprites", "hero.png"));

    const report = await runImageAcceptanceChecks({
      targets: [
        makeTarget({ id: "hero-a", out: "sprites/hero.png" }),
        makeTarget({ id: "hero-b", out: "sprites\\\\hero.png" }),
      ],
      imagesDir: tempDir,
      strict: false,
    });

    expect(
      report.packInvariants?.issues.some((issue) => issue.code === "pack_duplicate_runtime_out"),
    ).toBe(true);
    expect(
      report.items[0]?.issues.some((issue) => issue.code === "pack_duplicate_runtime_out"),
    ).toBe(true);
    expect(
      report.items[1]?.issues.some((issue) => issue.code === "pack_duplicate_runtime_out"),
    ).toBe(true);
  });

  it("reports spritesheet atlas-group mismatches", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "lootforge-pack-group-mismatch-"));
    await mkdir(path.join(tempDir, "__frames"), { recursive: true });

    await writeSpriteFrameSample({ filePath: path.join(tempDir, "__frames", "hero_walk_00.png") });
    await writeSpriteFrameSample({
      filePath: path.join(tempDir, "__frames", "hero_walk_01.png"),
      offsetX: 2,
    });
    await writeSpriteFrameSample({ filePath: path.join(tempDir, "hero-sheet.png") });

    const report = await runImageAcceptanceChecks({
      targets: [
        makeTarget({
          id: "hero.walk.0",
          out: "__frames/hero_walk_00.png",
          atlasGroup: "mismatch",
          catalogDisabled: true,
          spritesheet: {
            sheetTargetId: "hero.sheet",
            animationName: "walk",
            frameIndex: 0,
            frameCount: 2,
          },
        }),
        makeTarget({
          id: "hero.walk.1",
          out: "__frames/hero_walk_01.png",
          atlasGroup: "actors",
          catalogDisabled: true,
          spritesheet: {
            sheetTargetId: "hero.sheet",
            animationName: "walk",
            frameIndex: 1,
            frameCount: 2,
          },
        }),
        makeTarget({
          id: "hero.sheet",
          out: "hero-sheet.png",
          atlasGroup: "actors",
          generationDisabled: true,
          spritesheet: {
            sheetTargetId: "hero.sheet",
            isSheet: true,
            animations: [{ name: "walk", count: 2 }],
          },
        }),
      ],
      imagesDir: tempDir,
      strict: false,
    });

    expect(
      report.packInvariants?.issues.some(
        (issue) => issue.code === "spritesheet_atlas_group_mismatch",
      ),
    ).toBe(true);
    expect(
      report.items[0]?.issues.some((issue) => issue.code === "spritesheet_atlas_group_mismatch"),
    ).toBe(true);
  });

  it("reports spritesheet frame/sheet relationship mismatches", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "lootforge-pack-sheet-missing-"));
    await mkdir(path.join(tempDir, "__frames"), { recursive: true });

    await writeSpriteFrameSample({ filePath: path.join(tempDir, "__frames", "hero_walk_00.png") });

    const report = await runImageAcceptanceChecks({
      targets: [
        makeTarget({
          id: "hero.walk.0",
          out: "__frames/hero_walk_00.png",
          atlasGroup: "actors",
          spritesheet: {
            sheetTargetId: "missing.sheet",
            animationName: "walk",
            frameIndex: 0,
            frameCount: 1,
          },
        }),
      ],
      imagesDir: tempDir,
      strict: false,
    });

    expect(
      report.packInvariants?.issues.some(
        (issue) => issue.code === "spritesheet_missing_sheet_target",
      ),
    ).toBe(true);
    expect(
      report.items[0]?.issues.some((issue) => issue.code === "spritesheet_missing_sheet_target"),
    ).toBe(true);
  });

  it("reports spritesheet continuity drift and texture budget violations", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "lootforge-pack-continuity-"));
    await mkdir(path.join(tempDir, "__frames"), { recursive: true });

    await writeSpriteFrameSample({ filePath: path.join(tempDir, "__frames", "hero_walk_00.png") });
    await writeSpriteFrameSample({
      filePath: path.join(tempDir, "__frames", "hero_walk_01.png"),
      offsetX: 14,
    });
    await writeSpriteFrameSample({ filePath: path.join(tempDir, "hero-sheet.png") });

    const report = await runImageAcceptanceChecks({
      targets: [
        makeTarget({
          id: "hero.walk.0",
          out: "__frames/hero_walk_00.png",
          atlasGroup: "actors",
          catalogDisabled: true,
          evaluationProfileId: "sprite-quality",
          packTextureBudgetMB: 0.01,
          spritesheetSilhouetteDriftMax: 0.01,
          spritesheetAnchorDriftMax: 0.01,
          spritesheet: {
            sheetTargetId: "hero.sheet",
            animationName: "walk",
            frameIndex: 0,
            frameCount: 2,
            pivot: { x: 0.5, y: 0.8 },
          },
        }),
        makeTarget({
          id: "hero.walk.1",
          out: "__frames/hero_walk_01.png",
          atlasGroup: "actors",
          catalogDisabled: true,
          evaluationProfileId: "sprite-quality",
          packTextureBudgetMB: 0.01,
          spritesheetSilhouetteDriftMax: 0.01,
          spritesheetAnchorDriftMax: 0.01,
          spritesheet: {
            sheetTargetId: "hero.sheet",
            animationName: "walk",
            frameIndex: 1,
            frameCount: 2,
            pivot: { x: 0.5, y: 0.8 },
          },
        }),
        makeTarget({
          id: "hero.sheet",
          out: "hero-sheet.png",
          atlasGroup: "actors",
          evaluationProfileId: "sprite-quality",
          packTextureBudgetMB: 0.01,
          spritesheetSilhouetteDriftMax: 0.01,
          spritesheetAnchorDriftMax: 0.01,
          generationDisabled: true,
          spritesheet: {
            sheetTargetId: "hero.sheet",
            isSheet: true,
            animations: [{ name: "walk", count: 2, pivot: { x: 0.5, y: 0.8 } }],
          },
        }),
      ],
      imagesDir: tempDir,
      strict: false,
    });

    expect(
      report.packInvariants?.issues.some(
        (issue) => issue.code === "spritesheet_silhouette_drift_exceeded",
      ),
    ).toBe(true);
    expect(
      report.packInvariants?.issues.some(
        (issue) => issue.code === "spritesheet_anchor_drift_exceeded",
      ),
    ).toBe(true);
    expect(
      report.packInvariants?.issues.some((issue) => issue.code === "pack_texture_budget_exceeded"),
    ).toBe(true);
    expect(
      report.packInvariants?.metrics?.spritesheetContinuityByAnimation?.["hero.sheet:walk"]
        ?.comparisons,
    ).toBe(1);
    expect(
      report.items[0]?.issues.some((issue) => issue.code === "pack_texture_budget_exceeded"),
    ).toBe(true);
  });

  it("reports spritesheet identity and pose drift violations", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "lootforge-pack-identity-pose-"));
    await mkdir(path.join(tempDir, "__frames"), { recursive: true });

    await writeSpriteFrameSample({
      filePath: path.join(tempDir, "__frames", "hero_walk_00.png"),
      color: [220, 40, 40],
      rectWidth: 24,
      rectHeight: 10,
    });
    await writeSpriteFrameSample({
      filePath: path.join(tempDir, "__frames", "hero_walk_01.png"),
      color: [40, 220, 40],
      rectWidth: 10,
      rectHeight: 24,
    });
    await writeSpriteFrameSample({ filePath: path.join(tempDir, "hero-sheet.png") });

    const report = await runImageAcceptanceChecks({
      targets: [
        makeTarget({
          id: "hero.walk.0",
          out: "__frames/hero_walk_00.png",
          atlasGroup: "actors",
          catalogDisabled: true,
          evaluationProfileId: "sprite-quality",
          spritesheetSilhouetteDriftMax: 1,
          spritesheetAnchorDriftMax: 1,
          spritesheetIdentityDriftMax: 0.05,
          spritesheetPoseDriftMax: 0.2,
          spritesheet: {
            sheetTargetId: "hero.sheet",
            animationName: "walk",
            frameIndex: 0,
            frameCount: 2,
            pivot: { x: 0.5, y: 0.5 },
          },
        }),
        makeTarget({
          id: "hero.walk.1",
          out: "__frames/hero_walk_01.png",
          atlasGroup: "actors",
          catalogDisabled: true,
          evaluationProfileId: "sprite-quality",
          spritesheetSilhouetteDriftMax: 1,
          spritesheetAnchorDriftMax: 1,
          spritesheetIdentityDriftMax: 0.05,
          spritesheetPoseDriftMax: 0.2,
          spritesheet: {
            sheetTargetId: "hero.sheet",
            animationName: "walk",
            frameIndex: 1,
            frameCount: 2,
            pivot: { x: 0.5, y: 0.5 },
          },
        }),
        makeTarget({
          id: "hero.sheet",
          out: "hero-sheet.png",
          atlasGroup: "actors",
          evaluationProfileId: "sprite-quality",
          spritesheetSilhouetteDriftMax: 1,
          spritesheetAnchorDriftMax: 1,
          spritesheetIdentityDriftMax: 0.05,
          spritesheetPoseDriftMax: 0.2,
          generationDisabled: true,
          spritesheet: {
            sheetTargetId: "hero.sheet",
            isSheet: true,
            animations: [{ name: "walk", count: 2, pivot: { x: 0.5, y: 0.5 } }],
          },
        }),
      ],
      imagesDir: tempDir,
      strict: false,
    });

    expect(
      report.packInvariants?.issues.some(
        (issue) => issue.code === "spritesheet_identity_drift_exceeded",
      ),
    ).toBe(true);
    expect(
      report.packInvariants?.issues.some(
        (issue) => issue.code === "spritesheet_pose_drift_exceeded",
      ),
    ).toBe(true);
    expect(
      report.packInvariants?.metrics?.spritesheetContinuityByAnimation?.["hero.sheet:walk"]
        ?.maxIdentityDrift,
    ).toBeGreaterThan(0);
    expect(
      report.packInvariants?.metrics?.spritesheetContinuityByAnimation?.["hero.sheet:walk"]
        ?.maxPoseDrift,
    ).toBeGreaterThan(0);
  });
});
