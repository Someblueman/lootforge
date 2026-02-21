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

async function writeSpriteFrameSample(params: {
  filePath: string;
  offsetX?: number;
  offsetY?: number;
}): Promise<void> {
  const width = 64;
  const height = 64;
  const channels = 4;
  const raw = Buffer.alloc(width * height * channels, 0);
  const startX = 18 + (params.offsetX ?? 0);
  const startY = 18 + (params.offsetY ?? 0);
  const endX = Math.min(width - 1, startX + 20);
  const endY = Math.min(height - 1, startY + 20);

  for (let y = Math.max(0, startY); y < endY; y += 1) {
    for (let x = Math.max(0, startX); x < endX; x += 1) {
      const index = (y * width + x) * channels;
      raw[index] = 220;
      raw[index + 1] = 220;
      raw[index + 2] = 220;
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
});
