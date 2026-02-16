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
});
