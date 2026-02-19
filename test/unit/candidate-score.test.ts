import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import { scoreCandidateImages } from "../../src/checks/candidateScore.js";
import type { PlannedTarget } from "../../src/providers/types.js";

const ADAPTER_ENV_KEYS = [
  "LOOTFORGE_ENABLE_CLIP_ADAPTER",
  "LOOTFORGE_CLIP_ADAPTER_CMD",
  "LOOTFORGE_CLIP_ADAPTER_URL",
  "LOOTFORGE_CLIP_ADAPTER_TIMEOUT_MS",
  "LOOTFORGE_VLM_GATE_CMD",
  "LOOTFORGE_VLM_GATE_URL",
  "LOOTFORGE_VLM_GATE_TIMEOUT_MS",
] as const;

const ORIGINAL_ENV = new Map<string, string | undefined>(
  ADAPTER_ENV_KEYS.map((key) => [key, process.env[key]]),
);

describe("candidate scoring", () => {
  afterEach(() => {
    for (const key of ADAPTER_ENV_KEYS) {
      const value = ORIGINAL_ENV.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

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

  it("applies weighted clip adapter scores during candidate selection", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lootforge-candidate-score-soft-"));
    await mkdir(dir, { recursive: true });

    const flatPath = path.join(dir, "candidate-flat.png");
    const noisyPath = path.join(dir, "candidate-noisy.png");
    const clipScriptPath = path.join(dir, "clip-adapter.js");

    await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: { r: 220, g: 50, b: 50, alpha: 120 },
      },
    })
      .png()
      .toFile(flatPath);

    const raw = Buffer.alloc(64 * 64 * 4);
    for (let y = 0; y < 64; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        const index = (y * 64 + x) * 4;
        const v = (x + y) % 2 === 0 ? 255 : 0;
        raw[index] = v;
        raw[index + 1] = 255 - v;
        raw[index + 2] = v;
        raw[index + 3] = 255;
      }
    }
    await sharp(raw, { raw: { width: 64, height: 64, channels: 4 } })
      .png()
      .toFile(noisyPath);

    await writeFile(
      clipScriptPath,
      [
        'const fs = require("node:fs");',
        'const payload = JSON.parse(fs.readFileSync(0, "utf8"));',
        'const favored = payload.imagePath.endsWith("candidate-flat.png");',
        "const score = favored ? 200 : 0;",
        'process.stdout.write(JSON.stringify({ metrics: { alignment: favored ? 0.9 : 0.1 }, score }));',
        "",
      ].join("\n"),
      "utf8",
    );

    process.env.LOOTFORGE_ENABLE_CLIP_ADAPTER = "1";
    process.env.LOOTFORGE_CLIP_ADAPTER_CMD = `${process.execPath} ${clipScriptPath}`;

    const baseTarget: PlannedTarget = {
      id: "weighted-target",
      kind: "sprite",
      out: "weighted-target.png",
      promptSpec: { primary: "weighted target" },
      acceptance: {
        size: "64x64",
        alpha: true,
        maxFileSizeKB: 256,
      },
      runtimeSpec: {
        alphaRequired: true,
      },
      generationPolicy: {
        outputFormat: "png",
        background: "transparent",
      },
    };

    const withoutClipWeight = await scoreCandidateImages(
      {
        ...baseTarget,
        scoreWeights: {
          clip: 0,
        },
      },
      [flatPath, noisyPath],
      { outDir: dir },
    );
    expect(withoutClipWeight.bestPath).toBe(noisyPath);

    const withClipWeight = await scoreCandidateImages(
      {
        ...baseTarget,
        scoreWeights: {
          clip: 3,
        },
      },
      [flatPath, noisyPath],
      { outDir: dir },
    );
    expect(withClipWeight.bestPath).toBe(flatPath);
  });

  it("rejects candidates below VLM gate threshold before final selection", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lootforge-candidate-score-vlm-"));
    await mkdir(dir, { recursive: true });

    const lowPath = path.join(dir, "a-candidate-low.png");
    const highPath = path.join(dir, "b-candidate-high.png");
    const vlmScriptPath = path.join(dir, "vlm-gate.js");

    await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: { r: 200, g: 60, b: 60, alpha: 0 },
      },
    })
      .png()
      .toFile(lowPath);

    await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: { r: 60, g: 200, b: 60, alpha: 0 },
      },
    })
      .png()
      .toFile(highPath);

    await writeFile(
      vlmScriptPath,
      [
        'const fs = require("node:fs");',
        'const payload = JSON.parse(fs.readFileSync(0, "utf8"));',
        'const isHigh = payload.imagePath.endsWith("b-candidate-high.png");',
        "const score = isHigh ? 4.6 : 3.2;",
        'const reason = isHigh ? "clean silhouette" : "cutoff frame";',
        "process.stdout.write(JSON.stringify({ score, reason }));",
        "",
      ].join("\n"),
      "utf8",
    );

    process.env.LOOTFORGE_VLM_GATE_CMD = `${process.execPath} ${vlmScriptPath}`;

    const target: PlannedTarget = {
      id: "vlm-target",
      kind: "sprite",
      out: "vlm-target.png",
      promptSpec: { primary: "vlm target" },
      acceptance: {
        size: "64x64",
        alpha: true,
        maxFileSizeKB: 256,
      },
      runtimeSpec: {
        alphaRequired: true,
      },
      generationPolicy: {
        outputFormat: "png",
        background: "transparent",
        vlmGate: {
          threshold: 4,
          rubric: "Score silhouette clarity and framing from 0 to 5.",
        },
      },
    };

    const result = await scoreCandidateImages(target, [lowPath, highPath], { outDir: dir });
    const low = result.scores.find((score) => score.outputPath === lowPath);
    const high = result.scores.find((score) => score.outputPath === highPath);

    expect(result.bestPath).toBe(highPath);
    expect(high?.selected).toBe(true);
    expect(low?.passedAcceptance).toBe(false);
    expect(low?.reasons).toContain("vlm_gate_below_threshold");
    expect(low?.vlm).toMatchObject({
      score: 3.2,
      threshold: 4,
      passed: false,
      reason: "cutoff frame",
      evaluator: "command",
    });
    expect(high?.vlm).toMatchObject({
      score: 4.6,
      threshold: 4,
      passed: true,
      reason: "clean silhouette",
      evaluator: "command",
    });
  });
});
