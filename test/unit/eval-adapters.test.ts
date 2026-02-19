import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import { runEvalPipeline } from "../../src/pipeline/eval.ts";

const ADAPTER_ENV_KEYS = [
  "LOOTFORGE_ENABLE_CLIP_ADAPTER",
  "LOOTFORGE_CLIP_ADAPTER_CMD",
  "LOOTFORGE_CLIP_ADAPTER_URL",
  "LOOTFORGE_CLIP_ADAPTER_TIMEOUT_MS",
  "LOOTFORGE_ENABLE_LPIPS_ADAPTER",
  "LOOTFORGE_LPIPS_ADAPTER_CMD",
  "LOOTFORGE_LPIPS_ADAPTER_URL",
  "LOOTFORGE_LPIPS_ADAPTER_TIMEOUT_MS",
  "LOOTFORGE_ENABLE_SSIM_ADAPTER",
  "LOOTFORGE_SSIM_ADAPTER_CMD",
  "LOOTFORGE_SSIM_ADAPTER_URL",
  "LOOTFORGE_SSIM_ADAPTER_TIMEOUT_MS",
  "LOOTFORGE_ADAPTER_TIMEOUT_MS",
] as const;

const ORIGINAL_ENV = new Map<string, string | undefined>(
  ADAPTER_ENV_KEYS.map((key) => [key, process.env[key]]),
);

interface EvalFixture {
  outDir: string;
  targetsIndexPath: string;
  referenceImagePath: string;
}

async function createEvalFixture(includeReferenceInput: boolean): Promise<EvalFixture> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lootforge-eval-adapter-test-"));
  const outDir = path.join(tempRoot, "work");
  const targetsIndexPath = path.join(outDir, "jobs", "targets-index.json");
  const processedImagePath = path.join(
    outDir,
    "assets",
    "imagegen",
    "processed",
    "images",
    "hero.png",
  );
  const provenancePath = path.join(outDir, "provenance", "run.json");
  const referenceImagePath = path.join(outDir, "refs", "hero-ref.png");

  await mkdir(path.dirname(targetsIndexPath), { recursive: true });
  await mkdir(path.dirname(processedImagePath), { recursive: true });
  await mkdir(path.dirname(provenancePath), { recursive: true });
  await mkdir(path.dirname(referenceImagePath), { recursive: true });

  await sharp({
    create: {
      width: 64,
      height: 64,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 0 },
    },
  })
    .png()
    .toFile(processedImagePath);

  await sharp({
    create: {
      width: 64,
      height: 64,
      channels: 4,
      background: { r: 0, g: 255, b: 0, alpha: 0 },
    },
  })
    .png()
    .toFile(referenceImagePath);

  await writeFile(
    targetsIndexPath,
    `${JSON.stringify(
      {
        targets: [
          {
            id: "hero",
            kind: "sprite",
            out: "hero.png",
            promptSpec: { primary: "hero sprite for top-down game" },
            generationPolicy: {
              outputFormat: "png",
              background: "transparent",
            },
            acceptance: {
              size: "64x64",
              alpha: true,
              maxFileSizeKB: 128,
            },
            runtimeSpec: { alphaRequired: true },
            ...(includeReferenceInput
              ? {
                  edit: {
                    inputs: [
                      {
                        path: path.relative(outDir, referenceImagePath),
                        role: "reference",
                      },
                    ],
                  },
                }
              : {}),
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  await writeFile(
    provenancePath,
    `${JSON.stringify(
      {
        jobs: [
          {
            targetId: "hero",
            provider: "openai",
            model: "gpt-image-1",
            inputHash: "abc123",
            outputPath: path.join(outDir, "assets", "imagegen", "raw", "hero.png"),
            candidateScores: [
              {
                outputPath: path.join(outDir, "assets", "imagegen", "raw", "hero.png"),
                score: 40,
                passedAcceptance: true,
                reasons: [],
                selected: true,
              },
            ],
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return {
    outDir,
    targetsIndexPath,
    referenceImagePath,
  };
}

describe("eval adapters", () => {
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

  it("executes clip and lpips adapter commands and applies adapter scores", async () => {
    const fixture = await createEvalFixture(true);
    const clipScriptPath = path.join(fixture.outDir, "clip-adapter.js");
    const lpipsScriptPath = path.join(fixture.outDir, "lpips-adapter.js");

    await writeFile(
      clipScriptPath,
      [
        'const fs = require("node:fs");',
        'const input = JSON.parse(fs.readFileSync(0, "utf8"));',
        'if (!input.prompt || !input.target || input.target.id !== "hero") {',
        '  console.error("missing prompt context");',
        "  process.exit(2);",
        "}",
        'process.stdout.write(JSON.stringify({ metrics: { alignment: 0.82 }, score: 5 }));',
        "",
      ].join("\n"),
      "utf8",
    );

    await writeFile(
      lpipsScriptPath,
      [
        'const fs = require("node:fs");',
        'const input = JSON.parse(fs.readFileSync(0, "utf8"));',
        "if (!Array.isArray(input.referenceImages) || input.referenceImages.length === 0) {",
        '  console.error("missing reference images");',
        "  process.exit(3);",
        "}",
        'process.stdout.write(JSON.stringify({ metrics: { perceptual_distance: 0.2 }, score: -2 }));',
        "",
      ].join("\n"),
      "utf8",
    );

    process.env.LOOTFORGE_ENABLE_CLIP_ADAPTER = "1";
    process.env.LOOTFORGE_CLIP_ADAPTER_CMD = `${process.execPath} ${clipScriptPath}`;
    process.env.LOOTFORGE_ENABLE_LPIPS_ADAPTER = "1";
    process.env.LOOTFORGE_LPIPS_ADAPTER_CMD = `${process.execPath} ${lpipsScriptPath}`;

    const result = await runEvalPipeline({
      outDir: fixture.outDir,
      targetsIndexPath: fixture.targetsIndexPath,
      strict: true,
    });

    expect(result.report.adaptersUsed).toEqual(expect.arrayContaining(["clip", "lpips"]));
    expect(result.report.adapterWarnings).toHaveLength(0);
    expect(result.report.adapterHealth.configured).toEqual(["clip", "lpips"]);
    expect(result.report.adapterHealth.active).toEqual(["clip", "lpips"]);
    expect(result.report.adapterHealth.failed).toEqual([]);
    expect(result.report.adapterHealth.adapters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "clip",
          configured: true,
          active: true,
          failed: false,
          attemptedTargets: 1,
          successfulTargets: 1,
          failedTargets: 0,
          warningCount: 0,
        }),
        expect.objectContaining({
          name: "lpips",
          configured: true,
          active: true,
          failed: false,
          attemptedTargets: 1,
          successfulTargets: 1,
          failedTargets: 0,
          warningCount: 0,
        }),
      ]),
    );
    expect(result.report.targets).toHaveLength(1);
    expect(result.report.targets[0].adapterMetrics?.["clip.alignment"]).toBeCloseTo(0.82, 6);
    expect(result.report.targets[0].adapterMetrics?.["lpips.perceptual_distance"]).toBeCloseTo(
      0.2,
      6,
    );
    expect(result.report.targets[0].adapterScore).toBe(3);
    expect(result.report.targets[0].finalScore).toBe(43);
  });

  it("keeps eval running and records warnings when an enabled adapter is misconfigured", async () => {
    const fixture = await createEvalFixture(false);

    process.env.LOOTFORGE_ENABLE_CLIP_ADAPTER = "1";
    delete process.env.LOOTFORGE_CLIP_ADAPTER_CMD;
    delete process.env.LOOTFORGE_CLIP_ADAPTER_URL;

    const result = await runEvalPipeline({
      outDir: fixture.outDir,
      targetsIndexPath: fixture.targetsIndexPath,
      strict: true,
    });

    expect(result.report.adaptersUsed).toContain("clip");
    expect(result.report.adapterWarnings.length).toBeGreaterThan(0);
    expect(result.report.adapterHealth.configured).toEqual([]);
    expect(result.report.adapterHealth.active).toEqual([]);
    expect(result.report.adapterHealth.failed).toEqual(["clip"]);
    expect(result.report.adapterHealth.adapters).toEqual([
      expect.objectContaining({
        name: "clip",
        mode: "unconfigured",
        configured: false,
        active: false,
        failed: true,
        attemptedTargets: 1,
        successfulTargets: 0,
        failedTargets: 1,
        warningCount: 1,
      }),
    ]);
    expect(result.report.targets[0].adapterWarnings?.length).toBeGreaterThan(0);
    expect(result.report.targets[0].finalScore).toBe(40);
  });

  it("fails fast when adapter reference paths escape the output root", async () => {
    const fixture = await createEvalFixture(true);
    const clipScriptPath = path.join(fixture.outDir, "clip-adapter-safe.js");

    await writeFile(
      clipScriptPath,
      [
        'process.stdout.write(JSON.stringify({ metrics: { alignment: 0.9 }, score: 1 }));',
        "",
      ].join("\n"),
      "utf8",
    );

    process.env.LOOTFORGE_ENABLE_CLIP_ADAPTER = "1";
    process.env.LOOTFORGE_CLIP_ADAPTER_CMD = `${process.execPath} ${clipScriptPath}`;

    const indexRaw = await readFile(fixture.targetsIndexPath, "utf8");
    const index = JSON.parse(indexRaw) as { targets?: Array<{ edit?: { inputs?: Array<{ path: string }> } }> };
    if (!index.targets?.[0]?.edit?.inputs?.[0]) {
      throw new Error("fixture target is missing edit input");
    }
    index.targets[0].edit.inputs[0].path = "../outside-reference.png";
    await writeFile(fixture.targetsIndexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");

    await expect(
      runEvalPipeline({
        outDir: fixture.outDir,
        targetsIndexPath: fixture.targetsIndexPath,
        strict: true,
      }),
    ).rejects.toThrow(/outside/i);
  });
});
