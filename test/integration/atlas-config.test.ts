import { mkdtemp, mkdir, writeFile, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, test } from "vitest";

import { runAtlasPipeline } from "../../src/pipeline/atlas.js";

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

describe("atlas config artifacts", () => {
  test("writes atlas-config artifact and fallback atlas bundles", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "lootforge-atlas-config-test-"));
    const outDir = path.join(root, "out");

    const manifestPath = path.join(outDir, "assets", "imagegen", "manifest.json");
    const indexPath = path.join(outDir, "jobs", "targets-index.json");
    const processedImagePath = path.join(
      outDir,
      "assets",
      "imagegen",
      "processed",
      "images",
      "enemy.png",
    );

    await mkdir(path.dirname(manifestPath), { recursive: true });
    await mkdir(path.dirname(indexPath), { recursive: true });
    await mkdir(path.dirname(processedImagePath), { recursive: true });

    await writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          version: "next",
          pack: { id: "test", version: "0.1.0", license: "MIT", author: "x" },
          providers: { default: "openai" },
          atlas: {
            padding: 4,
            trim: true,
            bleed: 2,
            multipack: false,
          },
          targets: [
            {
              id: "enemy",
              kind: "sprite",
              out: "enemy.png",
              atlasGroup: "actors",
              prompt: "enemy",
              acceptance: { size: "64x64", alpha: true },
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
              acceptance: { size: "64x64", alpha: true },
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
        background: { r: 255, g: 0, b: 0, alpha: 1 },
      },
    })
      .png()
      .toFile(processedImagePath);

    const result = await runAtlasPipeline({
      outDir,
      targetsIndexPath: indexPath,
      manifestPath,
    });

    expect(await exists(path.join(result.atlasDir, "atlas-config.json"))).toBe(true);
    expect(result.manifest.atlasBundles.length).toBeGreaterThan(0);
  });
});
