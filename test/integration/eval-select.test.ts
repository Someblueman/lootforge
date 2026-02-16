import { access, mkdtemp, mkdir, writeFile } from "node:fs/promises";
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
                  outputPath: path.join(outDir, "assets", "imagegen", "raw", "hero.png"),
                  score: 42,
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
      strict: true,
    });

    expect(evalResult.report.failed).toBe(0);
    expect(await exists(evalResult.reportPath)).toBe(true);

    const selectResult = await runSelectPipeline({
      outDir,
      evalReportPath: evalResult.reportPath,
      provenancePath,
    });

    expect(selectResult.approvedTargets).toBe(1);
    expect(await exists(selectResult.selectionLockPath)).toBe(true);
  });
});
