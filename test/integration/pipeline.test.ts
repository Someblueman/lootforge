import { mkdtemp, mkdir, writeFile, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, test } from "vitest";

import { runPackagePipeline } from "../../src/pipeline/package.js";

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

describe("pipeline package integration", () => {
  test("creates expected pack artifact layout", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lootforge-pack-test-"));
    const outDir = path.join(tempRoot, "work");
    const manifestPath = path.join(outDir, "assets", "imagegen", "manifest.json");
    const indexPath = path.join(outDir, "jobs", "targets-index.json");
    const imagePath = path.join(outDir, "assets", "imagegen", "processed", "images", "enemy.png");

    await mkdir(path.dirname(manifestPath), { recursive: true });
    await mkdir(path.dirname(indexPath), { recursive: true });
    await mkdir(path.dirname(imagePath), { recursive: true });
    await mkdir(path.join(outDir, "checks"), { recursive: true });
    await mkdir(path.join(outDir, "provenance"), { recursive: true });

    await writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          pack: {
            id: "test-pack",
            version: "0.1.0",
            license: "MIT",
            author: "tester",
          },
          providers: { default: "openai" },
          targets: [],
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
              atlasGroup: null,
              acceptance: { size: "32x32", alpha: true, maxFileSizeKB: 256 },
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
        width: 32,
        height: 32,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toFile(imagePath);
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

    const result = await runPackagePipeline({
      outDir,
      manifestPath,
      targetsIndexPath: indexPath,
      strict: false,
      runtimeTargets: ["pixi", "unity"],
    });
    expect(result.runtimeManifestPaths.pixi).toBeDefined();
    expect(result.runtimeManifestPaths.unity).toBeDefined();

    const requiredFiles = [
      path.join(result.packDir, "assets", "images", "enemy.png"),
      path.join(result.packDir, "assets", "atlases", "manifest.json"),
      path.join(result.packDir, "manifest", "asset-pack.json"),
      path.join(result.packDir, "manifest", "phaser.json"),
      path.join(result.packDir, "manifest", "pixi.json"),
      path.join(result.packDir, "manifest", "unity-import.json"),
      path.join(result.packDir, "review", "catalog.json"),
      path.join(result.packDir, "review", "contact-sheet.png"),
      path.join(result.packDir, "checks", "validation-report.json"),
      path.join(result.packDir, "checks", "image-acceptance-report.json"),
      path.join(result.packDir, "provenance", "run.json"),
      result.zipPath,
    ];

    for (const filePath of requiredFiles) {
      expect(await fileExists(filePath)).toBe(true);
    }
  });
});
