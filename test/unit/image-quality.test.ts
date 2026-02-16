import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { type PlannedTarget } from "../../src/providers/types.ts";
import {
  assertTargetAcceptance,
  inspectImage,
  postProcessGeneratedImage,
} from "../../src/shared/image.ts";

function makeTarget(overrides: Partial<PlannedTarget> = {}): PlannedTarget {
  return {
    id: "target-1",
    out: "target.png",
    promptSpec: {
      primary: "test target",
    },
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
    postProcess: {
      resizeTo: { width: 64, height: 64 },
      algorithm: "nearest",
      stripMetadata: true,
    },
    ...overrides,
  };
}

describe("image quality helpers", () => {
  it("postProcessGeneratedImage resizes assets and preserves transparency", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "lootforge-image-test-"));
    const filePath = path.join(tempDir, "sprite.png");

    await sharp({
      create: {
        width: 256,
        height: 256,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toFile(filePath);

    const target = makeTarget();
    const inspection = await postProcessGeneratedImage(target, filePath);

    expect(inspection.width).toBe(64);
    expect(inspection.height).toBe(64);
    expect(inspection.hasAlphaChannel).toBe(true);
    expect(inspection.hasTransparentPixels).toBe(true);

    expect(() => assertTargetAcceptance(target, inspection)).not.toThrow();
  });

  it("assertTargetAcceptance fails when file size exceeds acceptance cap", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "lootforge-image-test-"));
    const filePath = path.join(tempDir, "big.png");

    await sharp({
      create: {
        width: 2048,
        height: 2048,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .png()
      .toFile(filePath);

    const target = makeTarget({
      acceptance: {
        size: "2048x2048",
        alpha: false,
        maxFileSizeKB: 1,
      },
      postProcess: {
        stripMetadata: false,
      },
    });

    const inspection = await inspectImage(filePath);
    expect(() => assertTargetAcceptance(target, inspection)).toThrow(
      /exceeds acceptance.maxFileSizeKB/,
    );
  });
});
