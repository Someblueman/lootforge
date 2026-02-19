import { mkdtemp, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  runImageAcceptanceChecks,
  evaluateImageAcceptance,
} from "../../src/checks/imageAcceptance.js";
import type { PlannedTarget } from "../../src/providers/types.js";

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

async function writeWrapGridSample(
  filePath: string,
  width: number,
  height: number,
): Promise<void> {
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
    expect(item.issues.some((issue) => issue.code === "alpha_edge_sharpness_too_low")).toBe(
      true,
    );
  });
});
