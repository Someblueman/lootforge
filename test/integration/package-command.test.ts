import { access, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, test } from "vitest";

import { runPackageCommand } from "../../src/cli/commands/package.js";

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function createPackageFixture(prefix: string): Promise<{ outDir: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  const outDir = path.join(root, "work");
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
            runtimeSpec: { anchorX: 0.25, anchorY: 0.75 },
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

  return { outDir };
}

describe("package command", () => {
  test("defaults manifest resolution relative to --out", async () => {
    const { outDir } = await createPackageFixture("lootforge-package-command-");

    const result = await runPackageCommand(["--out", outDir, "--strict", "false"]);
    expect(await exists(result.zipPath)).toBe(true);
  });

  test("writes pixi and unity manifests when requested via --runtimes", async () => {
    const { outDir } = await createPackageFixture("lootforge-package-runtimes-");
    const result = await runPackageCommand([
      "--out",
      outDir,
      "--strict",
      "false",
      "--runtimes",
      "pixi,unity",
    ]);

    expect(await exists(path.join(result.packDir, "manifest", "phaser.json"))).toBe(true);
    expect(await exists(path.join(result.packDir, "manifest", "pixi.json"))).toBe(true);
    expect(await exists(path.join(result.packDir, "manifest", "unity-import.json"))).toBe(true);
  });
});
