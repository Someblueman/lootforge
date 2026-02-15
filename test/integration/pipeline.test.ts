import { mkdtemp, mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { describe, expect, test } from "vitest";

import { runPackagePipeline } from "../../src/pipeline/package.js";

const SMALL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5Y6osAAAAASUVORK5CYII=",
  "base64",
);

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
    const imagePath = path.join(outDir, "assets", "images", "enemy.png");

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

    await writeFile(imagePath, SMALL_PNG);
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
    });

    const requiredFiles = [
      path.join(result.packDir, "assets", "images", "enemy.png"),
      path.join(result.packDir, "assets", "atlases", "manifest.json"),
      path.join(result.packDir, "manifest", "asset-pack.json"),
      path.join(result.packDir, "manifest", "phaser.json"),
      path.join(result.packDir, "review", "catalog.json"),
      path.join(result.packDir, "review", "contact-sheet.png"),
      path.join(result.packDir, "checks", "validation-report.json"),
      path.join(result.packDir, "provenance", "run.json"),
      result.zipPath,
    ];

    for (const filePath of requiredFiles) {
      // eslint-disable-next-line no-await-in-loop
      expect(await fileExists(filePath)).toBe(true);
    }
  });
});
