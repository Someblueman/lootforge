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

interface PackageFixture {
  outDir: string;
  manifestPath: string;
  indexPath: string;
  targetId: string;
}

async function createPackageFixture(prefix: string): Promise<PackageFixture> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), prefix));
  const outDir = path.join(tempRoot, "work");
  const manifestPath = path.join(outDir, "assets", "imagegen", "manifest.json");
  const indexPath = path.join(outDir, "jobs", "targets-index.json");
  const targetId = "enemy";
  const imagePath = path.join(
    outDir,
    "assets",
    "imagegen",
    "processed",
    "images",
    `${targetId}.png`,
  );

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
            id: targetId,
            kind: "sprite",
            out: `${targetId}.png`,
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

  return {
    outDir,
    manifestPath,
    indexPath,
    targetId,
  };
}

describe("pipeline package integration", () => {
  test("creates expected pack artifact layout", async () => {
    const { outDir, manifestPath, indexPath } = await createPackageFixture("lootforge-pack-test-");

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

  test("fails strict packaging when eval report is missing", async () => {
    const { outDir, manifestPath, indexPath } = await createPackageFixture(
      "lootforge-pack-missing-eval-",
    );
    const evalReportPath = path.join(outDir, "checks", "eval-report.json");

    await expect(
      runPackagePipeline({
        outDir,
        manifestPath,
        targetsIndexPath: indexPath,
        strict: true,
      }),
    ).rejects.toThrow(`Strict packaging requires ${evalReportPath}. Run "lootforge eval" first.`);
  });

  test("fails strict packaging when selection lock is missing", async () => {
    const { outDir, manifestPath, indexPath } = await createPackageFixture(
      "lootforge-pack-missing-lock-",
    );
    const selectionLockPath = path.join(outDir, "locks", "selection-lock.json");

    await writeFile(
      path.join(outDir, "checks", "eval-report.json"),
      `${JSON.stringify(
        {
          hardErrors: 0,
          targets: [],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await expect(
      runPackagePipeline({
        outDir,
        manifestPath,
        targetsIndexPath: indexPath,
        strict: true,
      }),
    ).rejects.toThrow(
      `Strict packaging requires ${selectionLockPath}. Run "lootforge select" first.`,
    );
  });

  test("fails strict packaging when eval hard errors are present", async () => {
    const { outDir, manifestPath, indexPath, targetId } = await createPackageFixture(
      "lootforge-pack-eval-hard-errors-",
    );
    const selectionLockPath = path.join(outDir, "locks", "selection-lock.json");

    await mkdir(path.dirname(selectionLockPath), { recursive: true });
    await writeFile(
      path.join(outDir, "checks", "eval-report.json"),
      `${JSON.stringify(
        {
          hardErrors: 2,
          targets: [{ targetId, passedHardGates: false }],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      selectionLockPath,
      `${JSON.stringify(
        {
          targets: [
            {
              targetId,
              approved: true,
              inputHash: "hash",
              selectedOutputPath: `${targetId}.png`,
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await expect(
      runPackagePipeline({
        outDir,
        manifestPath,
        targetsIndexPath: indexPath,
        strict: true,
      }),
    ).rejects.toThrow("Strict packaging blocked: eval report has 2 hard errors.");
  });

  test("fails strict packaging when approved lock entries are missing", async () => {
    const { outDir, manifestPath, indexPath } = await createPackageFixture(
      "lootforge-pack-missing-approvals-",
    );
    const selectionLockPath = path.join(outDir, "locks", "selection-lock.json");

    await mkdir(path.dirname(selectionLockPath), { recursive: true });
    await writeFile(
      path.join(outDir, "checks", "eval-report.json"),
      `${JSON.stringify(
        {
          hardErrors: 0,
          targets: [],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      selectionLockPath,
      `${JSON.stringify(
        {
          targets: [
            {
              targetId: "someone-else",
              approved: true,
              inputHash: "hash",
              selectedOutputPath: "someone-else.png",
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await expect(
      runPackagePipeline({
        outDir,
        manifestPath,
        targetsIndexPath: indexPath,
        strict: true,
      }),
    ).rejects.toThrow("Strict packaging blocked: missing approved lock entries for enemy");
  });

  test("reports a parse error for malformed manifest JSON", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lootforge-pack-malformed-manifest-"));
    const outDir = path.join(tempRoot, "work");
    const manifestPath = path.join(outDir, "assets", "imagegen", "manifest.json");

    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, "{\n", "utf8");

    await expect(
      runPackagePipeline({
        outDir,
        manifestPath,
        strict: false,
      }),
    ).rejects.toThrow(`Failed to parse JSON in ${manifestPath}`);
  });
});
