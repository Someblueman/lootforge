import { mkdtemp, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { scoreCandidateImages } from "../../src/checks/candidateScore.js";
import type { PlannedTarget } from "../../src/providers/types.js";

describe("candidate scoring", () => {
  it("prioritizes acceptance-compliant candidates", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lootforge-candidate-score-"));
    await mkdir(dir, { recursive: true });

    const transparentPath = path.join(dir, "candidate-transparent.png");
    const opaquePath = path.join(dir, "candidate-opaque.png");

    await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: { r: 20, g: 20, b: 20, alpha: 0 },
      },
    })
      .png()
      .toFile(transparentPath);

    await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: { r: 20, g: 20, b: 20, alpha: 1 },
      },
    })
      .png()
      .toFile(opaquePath);

    const target: PlannedTarget = {
      id: "target",
      kind: "sprite",
      out: "target.png",
      promptSpec: { primary: "test" },
      acceptance: {
        size: "64x64",
        alpha: true,
        maxFileSizeKB: 128,
      },
      runtimeSpec: {
        alphaRequired: true,
      },
      generationPolicy: {
        outputFormat: "png",
        background: "transparent",
      },
    };

    const result = await scoreCandidateImages(target, [opaquePath, transparentPath]);
    expect(result.bestPath).toBe(transparentPath);
    expect(result.scores[0].passedAcceptance).toBe(true);
  });
});
