import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, test } from "vitest";

import { runEvalPipeline } from "../../src/pipeline/eval.js";
import { runSelectPipeline } from "../../src/pipeline/select.js";

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

describe("eval + select integration", () => {
  test("writes eval report and selection lock", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lootforge-eval-select-"));
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

    await mkdir(path.dirname(targetsIndexPath), { recursive: true });
    await mkdir(path.dirname(processedImagePath), { recursive: true });
    await mkdir(path.dirname(provenancePath), { recursive: true });

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

    await writeFile(
      targetsIndexPath,
      `${JSON.stringify(
        {
          targets: [
            {
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
                maxFileSizeKB: 128,
              },
              runtimeSpec: { alphaRequired: true },
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
                  outputPath: path.join(outDir, "assets", "imagegen", "raw", "hero-v1.png"),
                  score: 38,
                  passedAcceptance: false,
                  reasons: ["vlm_gate_below_threshold"],
                  vlm: {
                    score: 3.3,
                    threshold: 4,
                    maxScore: 5,
                    passed: false,
                    reason: "framing cutoff",
                    evaluator: "command",
                  },
                },
                {
                  outputPath: path.join(outDir, "assets", "imagegen", "raw", "hero.png"),
                  score: 42,
                  passedAcceptance: true,
                  reasons: [],
                  vlm: {
                    score: 4.4,
                    threshold: 4,
                    maxScore: 5,
                    passed: true,
                    reason: "clear silhouette",
                    evaluator: "command",
                  },
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

    const evalResult = await runEvalPipeline({
      outDir,
      targetsIndexPath,
      strict: true,
    });

    expect(evalResult.report.failed).toBe(0);
    expect(await exists(evalResult.reportPath)).toBe(true);
    expect(evalResult.report.targets[0]?.candidateVlm).toMatchObject({
      score: 4.4,
      threshold: 4,
      passed: true,
      reason: "clear silhouette",
    });
    expect(evalResult.report.targets[0]?.candidateVlmGrades).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          outputPath: path.join(outDir, "assets", "imagegen", "raw", "hero-v1.png"),
          passed: false,
          reason: "framing cutoff",
        }),
        expect.objectContaining({
          outputPath: path.join(outDir, "assets", "imagegen", "raw", "hero.png"),
          passed: true,
          reason: "clear silhouette",
          selected: true,
        }),
      ]),
    );
    expect(evalResult.report.targets[0]?.acceptanceMetrics?.alphaHaloRisk).toBeDefined();
    expect(evalResult.report.targets[0]?.acceptanceMetrics?.alphaStrayNoise).toBeDefined();
    expect(evalResult.report.targets[0]?.acceptanceMetrics?.alphaEdgeSharpness).toBeDefined();

    const selectResult = await runSelectPipeline({
      outDir,
      evalReportPath: evalResult.reportPath,
      provenancePath,
    });

    expect(selectResult.approvedTargets).toBe(1);
    expect(await exists(selectResult.selectionLockPath)).toBe(true);
  });

  test("writes consistency-group signal trace into selection lock targets", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lootforge-eval-select-group-signal-"));
    const outDir = path.join(tempRoot, "work");
    const targetsIndexPath = path.join(outDir, "jobs", "targets-index.json");
    const processedDir = path.join(outDir, "assets", "imagegen", "processed", "images");
    const provenancePath = path.join(outDir, "provenance", "run.json");

    await mkdir(path.dirname(targetsIndexPath), { recursive: true });
    await mkdir(processedDir, { recursive: true });
    await mkdir(path.dirname(provenancePath), { recursive: true });

    for (const targetId of ["hero-a", "hero-b", "hero-c"]) {
      await sharp({
        create: {
          width: 64,
          height: 64,
          channels: 4,
          background: { r: 255, g: 0, b: 0, alpha: 0 },
        },
      })
        .png()
        .toFile(path.join(processedDir, `${targetId}.png`));
    }

    await writeFile(
      targetsIndexPath,
      `${JSON.stringify(
        {
          targets: [
            {
              id: "hero-a",
              kind: "sprite",
              out: "hero-a.png",
              consistencyGroup: "heroes",
              consistencyGroupScoring: {
                warningThreshold: 1.5,
                penaltyThreshold: 2,
                penaltyWeight: 10,
              },
              promptSpec: { primary: "hero a" },
              generationPolicy: {
                outputFormat: "png",
                background: "transparent",
              },
              acceptance: { size: "64x64", alpha: true, maxFileSizeKB: 128 },
              runtimeSpec: { alphaRequired: true },
            },
            {
              id: "hero-b",
              kind: "sprite",
              out: "hero-b.png",
              consistencyGroup: "heroes",
              consistencyGroupScoring: {
                warningThreshold: 1.5,
                penaltyThreshold: 2,
                penaltyWeight: 10,
              },
              promptSpec: { primary: "hero b" },
              generationPolicy: {
                outputFormat: "png",
                background: "transparent",
              },
              acceptance: { size: "64x64", alpha: true, maxFileSizeKB: 128 },
              runtimeSpec: { alphaRequired: true },
            },
            {
              id: "hero-c",
              kind: "sprite",
              out: "hero-c.png",
              consistencyGroup: "heroes",
              consistencyGroupScoring: {
                warningThreshold: 1.5,
                penaltyThreshold: 2,
                penaltyWeight: 10,
              },
              promptSpec: { primary: "hero c" },
              generationPolicy: {
                outputFormat: "png",
                background: "transparent",
              },
              acceptance: { size: "64x64", alpha: true, maxFileSizeKB: 128 },
              runtimeSpec: { alphaRequired: true },
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
              targetId: "hero-a",
              provider: "openai",
              model: "gpt-image-1",
              inputHash: "a",
              outputPath: path.join(outDir, "assets", "imagegen", "raw", "hero-a.png"),
              candidateScores: [
                {
                  outputPath: path.join(outDir, "assets", "imagegen", "raw", "hero-a.png"),
                  score: 100,
                  passedAcceptance: true,
                  selected: true,
                  reasons: [],
                  metrics: {
                    "clip.rawScore": 90,
                    "lpips.rawScore": 0.1,
                  },
                },
              ],
            },
            {
              targetId: "hero-b",
              provider: "openai",
              model: "gpt-image-1",
              inputHash: "b",
              outputPath: path.join(outDir, "assets", "imagegen", "raw", "hero-b.png"),
              candidateScores: [
                {
                  outputPath: path.join(outDir, "assets", "imagegen", "raw", "hero-b.png"),
                  score: 100,
                  passedAcceptance: true,
                  selected: true,
                  reasons: [],
                  metrics: {
                    "clip.rawScore": 91,
                    "lpips.rawScore": 0.11,
                  },
                },
              ],
            },
            {
              targetId: "hero-c",
              provider: "openai",
              model: "gpt-image-1",
              inputHash: "c",
              outputPath: path.join(outDir, "assets", "imagegen", "raw", "hero-c.png"),
              candidateScores: [
                {
                  outputPath: path.join(outDir, "assets", "imagegen", "raw", "hero-c.png"),
                  score: 100,
                  passedAcceptance: true,
                  selected: true,
                  reasons: [],
                  metrics: {
                    "clip.rawScore": 20,
                    "lpips.rawScore": 0.8,
                  },
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

    const evalResult = await runEvalPipeline({
      outDir,
      targetsIndexPath,
      strict: true,
    });
    const selectResult = await runSelectPipeline({
      outDir,
      evalReportPath: evalResult.reportPath,
      provenancePath,
    });

    const lock = JSON.parse(await readFile(selectResult.selectionLockPath, "utf8")) as {
      targets: {
        targetId: string;
        score?: number;
        evalFinalScore?: number;
        groupSignalTrace?: {
          consistencyGroup: string;
          warned: boolean;
          penalty: number;
        };
      }[];
    };
    const heroC = lock.targets.find((target) => target.targetId === "hero-c");
    expect(heroC?.groupSignalTrace).toMatchObject({
      consistencyGroup: "heroes",
      warned: true,
    });
    expect(heroC?.groupSignalTrace?.penalty).toBeGreaterThan(0);
    expect(heroC?.evalFinalScore).toBeLessThan(heroC?.score ?? 0);
  });

  test("fails strict eval when pack invariant hard errors exist", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lootforge-eval-pack-strict-"));
    const outDir = path.join(tempRoot, "work");
    const targetsIndexPath = path.join(outDir, "jobs", "targets-index.json");
    const processedImagePath = path.join(
      outDir,
      "assets",
      "imagegen",
      "processed",
      "images",
      "dupes",
      "hero.png",
    );
    const provenancePath = path.join(outDir, "provenance", "run.json");

    await mkdir(path.dirname(targetsIndexPath), { recursive: true });
    await mkdir(path.dirname(processedImagePath), { recursive: true });
    await mkdir(path.dirname(provenancePath), { recursive: true });

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

    await writeFile(
      targetsIndexPath,
      `${JSON.stringify(
        {
          targets: [
            {
              id: "hero-a",
              kind: "sprite",
              out: "dupes/hero.png",
              promptSpec: { primary: "hero a" },
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
            },
            {
              id: "hero-b",
              kind: "sprite",
              out: "dupes\\\\hero.png",
              promptSpec: { primary: "hero b" },
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
              targetId: "hero-a",
              provider: "openai",
              model: "gpt-image-1",
              inputHash: "hash-a",
              outputPath: path.join(outDir, "assets", "imagegen", "raw", "hero-a.png"),
              candidateScores: [
                {
                  outputPath: path.join(outDir, "assets", "imagegen", "raw", "hero-a.png"),
                  score: 10,
                  passedAcceptance: true,
                  reasons: [],
                  selected: true,
                },
              ],
            },
            {
              targetId: "hero-b",
              provider: "openai",
              model: "gpt-image-1",
              inputHash: "hash-b",
              outputPath: path.join(outDir, "assets", "imagegen", "raw", "hero-b.png"),
              candidateScores: [
                {
                  outputPath: path.join(outDir, "assets", "imagegen", "raw", "hero-b.png"),
                  score: 11,
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

    await expect(
      runEvalPipeline({
        outDir,
        targetsIndexPath,
        strict: true,
      }),
    ).rejects.toThrow("Evaluation failed with");
  });

  test("propagates pack invariant hard errors into selection approval", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lootforge-eval-pack-select-"));
    const outDir = path.join(tempRoot, "work");
    const targetsIndexPath = path.join(outDir, "jobs", "targets-index.json");
    const processedImagePath = path.join(
      outDir,
      "assets",
      "imagegen",
      "processed",
      "images",
      "dupes",
      "hero.png",
    );
    const provenancePath = path.join(outDir, "provenance", "run.json");

    await mkdir(path.dirname(targetsIndexPath), { recursive: true });
    await mkdir(path.dirname(processedImagePath), { recursive: true });
    await mkdir(path.dirname(provenancePath), { recursive: true });

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

    await writeFile(
      targetsIndexPath,
      `${JSON.stringify(
        {
          targets: [
            {
              id: "hero-a",
              kind: "sprite",
              out: "dupes/hero.png",
              promptSpec: { primary: "hero a" },
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
            },
            {
              id: "hero-b",
              kind: "sprite",
              out: "dupes\\\\hero.png",
              promptSpec: { primary: "hero b" },
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
              targetId: "hero-a",
              provider: "openai",
              model: "gpt-image-1",
              inputHash: "hash-a",
              outputPath: path.join(outDir, "assets", "imagegen", "raw", "hero-a.png"),
              candidateScores: [
                {
                  outputPath: path.join(outDir, "assets", "imagegen", "raw", "hero-a.png"),
                  score: 10,
                  passedAcceptance: true,
                  reasons: [],
                  selected: true,
                },
              ],
            },
            {
              targetId: "hero-b",
              provider: "openai",
              model: "gpt-image-1",
              inputHash: "hash-b",
              outputPath: path.join(outDir, "assets", "imagegen", "raw", "hero-b.png"),
              candidateScores: [
                {
                  outputPath: path.join(outDir, "assets", "imagegen", "raw", "hero-b.png"),
                  score: 11,
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

    const evalResult = await runEvalPipeline({
      outDir,
      targetsIndexPath,
      strict: false,
    });
    expect(evalResult.report.failed).toBe(2);
    expect(evalResult.report.targets.every((target) => target.passedHardGates === false)).toBe(
      true,
    );
    expect(
      evalResult.report.targets.every((target) =>
        target.hardGateErrors.some((error) => error.includes("pack_duplicate_runtime_out")),
      ),
    ).toBe(true);

    const selectResult = await runSelectPipeline({
      outDir,
      evalReportPath: evalResult.reportPath,
      provenancePath,
    });
    expect(selectResult.approvedTargets).toBe(0);

    const lock = JSON.parse(await readFile(selectResult.selectionLockPath, "utf8")) as {
      targets: { approved: boolean }[];
    };
    expect(lock.targets.every((target) => target.approved === false)).toBe(true);
  });

  test("falls back to deterministic candidate selection when no candidate is preselected", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lootforge-select-fallback-"));
    const outDir = path.join(tempRoot, "work");
    const evalReportPath = path.join(outDir, "checks", "eval-report.json");
    const provenancePath = path.join(outDir, "provenance", "run.json");

    await mkdir(path.dirname(evalReportPath), { recursive: true });
    await mkdir(path.dirname(provenancePath), { recursive: true });

    await writeFile(
      evalReportPath,
      `${JSON.stringify(
        {
          targets: [
            {
              targetId: "hero",
              passedHardGates: true,
              finalScore: 88,
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
              inputHash: "hero-hash",
              outputPath: path.join(outDir, "assets", "imagegen", "raw", "hero-default.png"),
              candidateScores: [
                {
                  outputPath: path.join(outDir, "assets", "imagegen", "raw", "hero-z.png"),
                  score: 99,
                  passedAcceptance: false,
                },
                {
                  outputPath: path.join(outDir, "assets", "imagegen", "raw", "hero-b.png"),
                  score: 50,
                  passedAcceptance: true,
                },
                {
                  outputPath: path.join(outDir, "assets", "imagegen", "raw", "hero-a.png"),
                  score: 50,
                  passedAcceptance: true,
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

    const result = await runSelectPipeline({
      outDir,
      evalReportPath,
      provenancePath,
    });
    const lock = JSON.parse(await readFile(result.selectionLockPath, "utf8")) as {
      targets: {
        targetId: string;
        selectedOutputPath: string;
        score?: number;
      }[];
    };
    const hero = lock.targets.find((target) => target.targetId === "hero");
    expect(hero?.selectedOutputPath).toBe(
      path.join(outDir, "assets", "imagegen", "raw", "hero-a.png"),
    );
    expect(hero?.score).toBe(50);
  });

  test("reports a clear error when the eval report file is missing", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lootforge-select-missing-eval-"));
    const outDir = path.join(tempRoot, "work");
    const missingEvalPath = path.join(outDir, "checks", "eval-report.json");
    const provenancePath = path.join(outDir, "provenance", "run.json");

    await mkdir(path.dirname(provenancePath), { recursive: true });
    await writeFile(
      provenancePath,
      `${JSON.stringify(
        {
          jobs: [],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await expect(
      runSelectPipeline({
        outDir,
        evalReportPath: missingEvalPath,
        provenancePath,
      }),
    ).rejects.toThrow(`Failed to read eval report at ${missingEvalPath}`);
  });

  test("reports a clear error when the provenance file is missing", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lootforge-select-missing-provenance-"));
    const outDir = path.join(tempRoot, "work");
    const evalReportPath = path.join(outDir, "checks", "eval-report.json");
    const missingProvenancePath = path.join(outDir, "provenance", "run.json");

    await mkdir(path.dirname(evalReportPath), { recursive: true });
    await writeFile(
      evalReportPath,
      `${JSON.stringify(
        {
          targets: [],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await expect(
      runSelectPipeline({
        outDir,
        evalReportPath,
        provenancePath: missingProvenancePath,
      }),
    ).rejects.toThrow(`Failed to read provenance at ${missingProvenancePath}`);
  });
});
