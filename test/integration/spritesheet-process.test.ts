import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, test } from "vitest";

import { runProcessPipeline } from "../../src/pipeline/process.js";

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

describe("spritesheet processing", () => {
  test("assembles processed frame targets into a spritesheet output", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lootforge-spritesheet-process-"));
    const outDir = path.join(tempRoot, "work");
    const indexPath = path.join(outDir, "jobs", "targets-index.json");

    const frameTargets = [
      {
        id: "hero.walk.0",
        kind: "spritesheet",
        out: "__frames/hero/hero_walk_00.png",
        promptSpec: { primary: "hero frame 0" },
        generationPolicy: { outputFormat: "png", background: "transparent" },
        acceptance: { size: "32x32", alpha: true },
        runtimeSpec: { alphaRequired: true },
        catalogDisabled: true,
        spritesheet: {
          sheetTargetId: "hero",
          animationName: "walk",
          frameIndex: 0,
          frameCount: 2,
          fps: 10,
          loop: true,
        },
      },
      {
        id: "hero.walk.1",
        kind: "spritesheet",
        out: "__frames/hero/hero_walk_01.png",
        promptSpec: { primary: "hero frame 1" },
        generationPolicy: { outputFormat: "png", background: "transparent" },
        acceptance: { size: "32x32", alpha: true },
        runtimeSpec: { alphaRequired: true },
        catalogDisabled: true,
        spritesheet: {
          sheetTargetId: "hero",
          animationName: "walk",
          frameIndex: 1,
          frameCount: 2,
          fps: 10,
          loop: true,
        },
      },
    ];

    const sheetTarget = {
      id: "hero",
      kind: "spritesheet",
      out: "hero_sheet.png",
      promptSpec: { primary: "hero sheet" },
      generationPolicy: { outputFormat: "png", background: "transparent" },
      acceptance: { size: "64x32", alpha: true },
      runtimeSpec: { alphaRequired: true },
      generationDisabled: true,
      spritesheet: {
        sheetTargetId: "hero",
        isSheet: true,
        animations: [{ name: "walk", count: 2, fps: 10, loop: true, pivot: { x: 0.5, y: 0.85 } }],
      },
    };

    await mkdir(path.dirname(indexPath), { recursive: true });
    await writeFile(
      indexPath,
      `${JSON.stringify({ targets: [...frameTargets, sheetTarget] }, null, 2)}\n`,
      "utf8",
    );

    for (const [frameIndex, target] of frameTargets.entries()) {
      const rawPath = path.join(outDir, "assets", "imagegen", "raw", target.out);
      await mkdir(path.dirname(rawPath), { recursive: true });
      const spriteCore = await sharp({
        create: {
          width: 20,
          height: 20,
          channels: 4,
          background:
            frameIndex === 0 ? { r: 255, g: 0, b: 0, alpha: 1 } : { r: 0, g: 255, b: 0, alpha: 1 },
        },
      })
        .png()
        .toBuffer();

      await sharp({
        create: {
          width: 32,
          height: 32,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .composite([{ input: spriteCore, left: 6, top: 6 }])
        .png()
        .toFile(rawPath);
    }

    const result = await runProcessPipeline({
      outDir,
      targetsIndexPath: indexPath,
      strict: true,
    });

    const assembledPath = path.join(result.processedImagesDir, "hero_sheet.png");
    const metadataPath = path.join(result.processedImagesDir, "hero_sheet.anim.json");

    expect(await exists(assembledPath)).toBe(true);
    expect(await exists(metadataPath)).toBe(true);

    const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as {
      frames?: Record<string, unknown>;
    };
    expect(Object.keys(metadata.frames ?? {})).toContain("hero.walk.0");
    expect(Object.keys(metadata.frames ?? {})).toContain("hero.walk.1");
  });
});
