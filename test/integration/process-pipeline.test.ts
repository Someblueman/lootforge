import { mkdtemp, mkdir, writeFile, access, readFile } from "node:fs/promises";
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
          version: "next",
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
      strict: false,
    });

    expect(await exists(packageResult.zipPath)).toBe(true);
  });

  test("applies seam-heal pass for tile targets before acceptance gating", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lootforge-process-seam-heal-"));
    const outDir = path.join(tempRoot, "work");
    const indexPath = path.join(outDir, "jobs", "targets-index.json");
    const rawImagePath = path.join(outDir, "assets", "imagegen", "raw", "tile.png");

    await mkdir(path.dirname(indexPath), { recursive: true });
    await mkdir(path.dirname(rawImagePath), { recursive: true });

    await writeFile(
      indexPath,
      `${JSON.stringify(
        {
          targets: [
            {
              id: "tile",
              kind: "tile",
              out: "tile.png",
              promptSpec: { primary: "tile texture" },
              generationPolicy: {
                outputFormat: "png",
                background: "opaque",
              },
              acceptance: { size: "8x8", alpha: false, maxFileSizeKB: 256 },
              tileable: true,
              seamThreshold: 8,
              seamStripPx: 1,
              seamHeal: {
                enabled: true,
                stripPx: 1,
                strength: 1,
              },
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const width = 8;
    const height = 8;
    const channels = 4;
    const raw = Buffer.alloc(width * height * channels, 0);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * channels;
        raw[index] = x === 0 ? 255 : 32;
        raw[index + 1] = 0;
        raw[index + 2] = x === width - 1 ? 255 : 32;
        raw[index + 3] = 255;
      }
    }

    await sharp(raw, { raw: { width, height, channels } }).png().toFile(rawImagePath);

    const result = await runProcessPipeline({
      outDir,
      targetsIndexPath: indexPath,
      strict: true,
      mirrorLegacyImages: false,
    });

    const reportRaw = await readFile(result.acceptanceReportPath, "utf8");
    const report = JSON.parse(reportRaw) as {
      errors: number;
      items: { metrics?: { seamScore?: number } }[];
    };
    expect(report.errors).toBe(0);
    expect(report.items[0]?.metrics?.seamScore ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(8);
  });

  test("applies alpha-safe exact-palette quantization for strict pixel outputs", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lootforge-process-palette-strict-"));
    const outDir = path.join(tempRoot, "work");
    const indexPath = path.join(outDir, "jobs", "targets-index.json");
    const rawImagePath = path.join(outDir, "assets", "imagegen", "raw", "hero.png");

    await mkdir(path.dirname(indexPath), { recursive: true });
    await mkdir(path.dirname(rawImagePath), { recursive: true });

    await writeFile(
      indexPath,
      `${JSON.stringify(
        {
          targets: [
            {
              id: "hero",
              kind: "sprite",
              out: "hero.png",
              promptSpec: { primary: "hero sprite" },
              generationPolicy: {
                outputFormat: "png",
                background: "transparent",
              },
              palette: {
                mode: "exact",
                colors: ["#0000ff", "#00ff00"],
                strict: true,
              },
              acceptance: { size: "2x1", alpha: true, maxFileSizeKB: 256 },
              runtimeSpec: { alphaRequired: true },
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const raw = Buffer.from([
      255,
      255,
      255,
      0, // fully transparent pixel should be zeroed
      10,
      20,
      200,
      255, // should quantize to #0000ff
    ]);
    await sharp(raw, { raw: { width: 2, height: 1, channels: 4 } })
      .png()
      .toFile(rawImagePath);

    await runProcessPipeline({
      outDir,
      targetsIndexPath: indexPath,
      strict: true,
      mirrorLegacyImages: false,
    });

    const processedPath = path.join(
      outDir,
      "assets",
      "imagegen",
      "processed",
      "images",
      "hero.png",
    );
    const decoded = await sharp(processedPath)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const data = decoded.data;

    expect(data[0]).toBe(0);
    expect(data[1]).toBe(0);
    expect(data[2]).toBe(0);
    expect(data[3]).toBe(0);

    const quantizedPacked = ((data[4] << 16) | (data[5] << 8) | data[6]) >>> 0;
    expect(new Set([0x0000ff, 0x00ff00]).has(quantizedPacked)).toBe(true);
    expect(data[7]).toBe(255);
  });

  test("emits resize variants and auxiliary maps for processed outputs", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lootforge-process-derived-"));
    const outDir = path.join(tempRoot, "work");
    const indexPath = path.join(outDir, "jobs", "targets-index.json");
    const rawImagePath = path.join(outDir, "assets", "imagegen", "raw", "hero.png");

    await mkdir(path.dirname(indexPath), { recursive: true });
    await mkdir(path.dirname(rawImagePath), { recursive: true });

    await writeFile(
      indexPath,
      `${JSON.stringify(
        {
          targets: [
            {
              id: "hero",
              kind: "sprite",
              out: "hero.png",
              promptSpec: { primary: "hero sprite" },
              generationPolicy: {
                outputFormat: "png",
                background: "transparent",
              },
              postProcess: {
                resizeTo: { width: 32, height: 32 },
                operations: {
                  resizeVariants: {
                    variants: [
                      { name: "half", width: 16, height: 16, algorithm: "nearest" },
                      { name: "tiny", width: 8, height: 8, algorithm: "nearest" },
                    ],
                  },
                },
              },
              auxiliaryMaps: {
                normalFromHeight: true,
                specularFromLuma: true,
                aoFromLuma: true,
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
        background: { r: 180, g: 120, b: 40, alpha: 0 },
      },
    })
      .png()
      .toFile(rawImagePath);

    const result = await runProcessPipeline({
      outDir,
      targetsIndexPath: indexPath,
      strict: true,
      mirrorLegacyImages: false,
    });

    expect(result.variantCount).toBe(2);
    expect(
      await exists(
        path.join(outDir, "assets", "imagegen", "processed", "images", "hero__half.png"),
      ),
    ).toBe(true);
    expect(
      await exists(
        path.join(outDir, "assets", "imagegen", "processed", "images", "hero__tiny.png"),
      ),
    ).toBe(true);
    expect(
      await exists(
        path.join(outDir, "assets", "imagegen", "processed", "images", "hero__normal.png"),
      ),
    ).toBe(true);
    expect(
      await exists(
        path.join(outDir, "assets", "imagegen", "processed", "images", "hero__specular.png"),
      ),
    ).toBe(true);
    expect(
      await exists(path.join(outDir, "assets", "imagegen", "processed", "images", "hero__ao.png")),
    ).toBe(true);
  });

  test("emits raw/style_ref/pixel/layer variants for smart-crop and pixel-perfect processing", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lootforge-process-variant-outputs-"));
    const outDir = path.join(tempRoot, "work");
    const indexPath = path.join(outDir, "jobs", "targets-index.json");
    const rawImagePath = path.join(outDir, "assets", "imagegen", "raw", "badge.png");

    await mkdir(path.dirname(indexPath), { recursive: true });
    await mkdir(path.dirname(rawImagePath), { recursive: true });

    await writeFile(
      indexPath,
      `${JSON.stringify(
        {
          targets: [
            {
              id: "badge",
              kind: "sprite",
              out: "badge.png",
              promptSpec: { primary: "badge icon" },
              generationPolicy: {
                outputFormat: "png",
                background: "transparent",
              },
              postProcess: {
                resizeTo: { width: 16, height: 16 },
                operations: {
                  smartCrop: {
                    enabled: true,
                    mode: "center",
                  },
                  pixelPerfect: {
                    enabled: true,
                  },
                  emitVariants: {
                    raw: true,
                    styleRef: true,
                    pixel: true,
                    layerColor: true,
                    layerMatte: true,
                  },
                },
              },
              acceptance: { size: "16x16", alpha: true, maxFileSizeKB: 256 },
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
        height: 32,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([
        {
          input: await sharp({
            create: {
              width: 40,
              height: 20,
              channels: 4,
              background: { r: 240, g: 120, b: 40, alpha: 1 },
            },
          })
            .png()
            .toBuffer(),
          left: 12,
          top: 6,
        },
      ])
      .png()
      .toFile(rawImagePath);

    const result = await runProcessPipeline({
      outDir,
      targetsIndexPath: indexPath,
      strict: true,
      mirrorLegacyImages: false,
    });

    expect(result.variantCount).toBe(5);

    const rawVariantPath = path.join(
      outDir,
      "assets",
      "imagegen",
      "processed",
      "images",
      "badge__raw.png",
    );
    const styleRefVariantPath = path.join(
      outDir,
      "assets",
      "imagegen",
      "processed",
      "images",
      "badge__style_ref.png",
    );
    const pixelVariantPath = path.join(
      outDir,
      "assets",
      "imagegen",
      "processed",
      "images",
      "badge__pixel.png",
    );
    const layerColorVariantPath = path.join(
      outDir,
      "assets",
      "imagegen",
      "processed",
      "images",
      "badge__layer_color.png",
    );
    const layerMatteVariantPath = path.join(
      outDir,
      "assets",
      "imagegen",
      "processed",
      "images",
      "badge__layer_matte.png",
    );

    expect(await exists(rawVariantPath)).toBe(true);
    expect(await exists(styleRefVariantPath)).toBe(true);
    expect(await exists(pixelVariantPath)).toBe(true);
    expect(await exists(layerColorVariantPath)).toBe(true);
    expect(await exists(layerMatteVariantPath)).toBe(true);

    const rawMetadata = await sharp(rawVariantPath).metadata();
    const styleMetadata = await sharp(styleRefVariantPath).metadata();
    const pixelMetadata = await sharp(pixelVariantPath).metadata();
    const layerColorMetadata = await sharp(layerColorVariantPath).metadata();
    const layerMatteMetadata = await sharp(layerMatteVariantPath).metadata();
    expect(rawMetadata.width).toBe(64);
    expect(rawMetadata.height).toBe(32);
    expect(styleMetadata.width).toBe(16);
    expect(styleMetadata.height).toBe(16);
    expect(pixelMetadata.width).toBe(16);
    expect(pixelMetadata.height).toBe(16);
    expect(layerColorMetadata.width).toBe(16);
    expect(layerColorMetadata.height).toBe(16);
    expect(layerMatteMetadata.width).toBe(16);
    expect(layerMatteMetadata.height).toBe(16);
  });
});
