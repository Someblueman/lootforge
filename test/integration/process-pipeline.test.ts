import { mkdtemp, mkdir, writeFile, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, test } from "vitest";

import { runAtlasPipeline } from "../../src/pipeline/atlas.js";
import { runPackagePipeline } from "../../src/pipeline/package.js";
import { runProcessPipeline } from "../../src/pipeline/process.js";

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

describe("process -> atlas -> package integration", () => {
  test("processes raw assets, mirrors compatibility images, and packages artifacts", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lootforge-process-pipeline-test-"));
    const outDir = path.join(tempRoot, "work");
    const manifestPath = path.join(outDir, "assets", "imagegen", "manifest.json");
    const indexPath = path.join(outDir, "jobs", "targets-index.json");
    const rawImagePath = path.join(outDir, "assets", "imagegen", "raw", "enemy.png");

    await mkdir(path.dirname(manifestPath), { recursive: true });
    await mkdir(path.dirname(indexPath), { recursive: true });
    await mkdir(path.dirname(rawImagePath), { recursive: true });
    await mkdir(path.join(outDir, "checks"), { recursive: true });
    await mkdir(path.join(outDir, "provenance"), { recursive: true });

    await writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          version: "2",
          pack: {
            id: "test-pack",
            version: "0.1.0",
            license: "MIT",
            author: "tester",
          },
          providers: { default: "openai" },
          targets: [
            {
              id: "enemy",
              kind: "sprite",
              out: "enemy.png",
              prompt: "enemy sprite",
              acceptance: { size: "32x32", alpha: true, maxFileSizeKB: 256 },
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await writeFile(
      indexPath,
      `${JSON.stringify(
        {
          targets: [
            {
              id: "enemy",
              kind: "sprite",
              out: "enemy.png",
              atlasGroup: "actors",
              promptSpec: { primary: "enemy sprite" },
              generationPolicy: {
                outputFormat: "png",
                background: "transparent",
              },
              postProcess: {
                resizeTo: { width: 32, height: 32 },
              },
              acceptance: { size: "32x32", alpha: true, maxFileSizeKB: 256 },
              runtimeSpec: { alphaRequired: true },
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toFile(rawImagePath);

    await writeFile(
      path.join(outDir, "checks", "validation-report.json"),
      `${JSON.stringify({ errors: [], warnings: [] }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      path.join(outDir, "provenance", "run.json"),
      `${JSON.stringify({ jobs: [] }, null, 2)}\n`,
      "utf8",
    );

    const processResult = await runProcessPipeline({
      outDir,
      targetsIndexPath: indexPath,
      strict: true,
      mirrorLegacyImages: true,
    });

    expect(await exists(processResult.catalogPath)).toBe(true);
    expect(await exists(processResult.acceptanceReportPath)).toBe(true);
    expect(await exists(path.join(outDir, "assets", "images", "enemy.png"))).toBe(true);

    const atlasResult = await runAtlasPipeline({
      outDir,
      targetsIndexPath: indexPath,
      manifestPath,
    });
    expect(atlasResult.manifest.atlasBundles.length).toBeGreaterThan(0);

    const packageResult = await runPackagePipeline({
      outDir,
      manifestPath,
      targetsIndexPath: indexPath,
    });

    expect(await exists(packageResult.zipPath)).toBe(true);
  });
});
