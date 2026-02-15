import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { runAtlasPipeline } from "./atlas.js";
import { buildAssetPackManifest } from "../output/assetPackManifest.js";
import { buildCatalog, CatalogTarget } from "../output/catalog.js";
import { writeContactSheetPng } from "../output/contactSheet.js";
import { buildPhaserManifest } from "../output/phaserManifest.js";
import { createZipArchive } from "../output/zip.js";

interface ManifestPack {
  id: string;
  version: string;
  license: string;
  author: string;
}

interface ManifestV2 {
  pack: ManifestPack;
  providers?: {
    default?: string;
  };
}

interface TargetsIndex {
  targets?: CatalogTarget[];
}

export interface PackagePipelineOptions {
  outDir: string;
  manifestPath: string;
  targetsIndexPath?: string;
}

export interface PackagePipelineResult {
  packDir: string;
  zipPath: string;
  packId: string;
  assetPackManifestPath: string;
  phaserManifestPath: string;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function parseJson<T>(raw: string, filePath: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(
      `Failed to parse JSON in ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function sanitizePackId(id: string): string {
  const clean = id.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  return clean || "asset-pack";
}

async function copyDirIfExists(src: string, dest: string): Promise<void> {
  if (!(await exists(src))) return;
  await mkdir(path.dirname(dest), { recursive: true });
  await cp(src, dest, { recursive: true, force: true });
}

async function loadTargets(targetsIndexPath: string): Promise<CatalogTarget[]> {
  const raw = await readFile(targetsIndexPath, "utf8");
  const parsed = parseJson<TargetsIndex>(raw, targetsIndexPath);
  if (!Array.isArray(parsed.targets)) return [];
  return parsed.targets;
}

export async function runPackagePipeline(
  options: PackagePipelineOptions,
): Promise<PackagePipelineResult> {
  const outDir = path.resolve(options.outDir);
  const manifestPath = path.resolve(options.manifestPath);
  const targetsIndexPath = path.resolve(
    options.targetsIndexPath ?? path.join(outDir, "jobs", "targets-index.json"),
  );

  const manifestRaw = await readFile(manifestPath, "utf8");
  const manifest = parseJson<ManifestV2>(manifestRaw, manifestPath);
  const packId = sanitizePackId(manifest.pack?.id ?? "asset-pack");

  const distPacksDir = path.join(outDir, "dist", "packs");
  const packDir = path.join(distPacksDir, packId);
  const packImagesDir = path.join(packDir, "assets", "images");
  const packAtlasesDir = path.join(packDir, "assets", "atlases");
  const packManifestDir = path.join(packDir, "manifest");
  const packReviewDir = path.join(packDir, "review");
  const packChecksDir = path.join(packDir, "checks");
  const packProvenanceDir = path.join(packDir, "provenance");

  await mkdir(packImagesDir, { recursive: true });
  await mkdir(packAtlasesDir, { recursive: true });
  await mkdir(packManifestDir, { recursive: true });
  await mkdir(packReviewDir, { recursive: true });
  await mkdir(packChecksDir, { recursive: true });
  await mkdir(packProvenanceDir, { recursive: true });

  const atlasResult = await runAtlasPipeline({
    outDir,
    targetsIndexPath,
  });

  const sourceImagesDir = path.join(outDir, "assets", "images");
  await copyDirIfExists(sourceImagesDir, packImagesDir);
  await copyDirIfExists(atlasResult.atlasDir, packAtlasesDir);

  const targets = await loadTargets(targetsIndexPath);
  const catalog = await buildCatalog(targets, sourceImagesDir);
  await writeFile(
    path.join(packReviewDir, "catalog.json"),
    `${JSON.stringify(catalog, null, 2)}\n`,
    "utf8",
  );

  await writeContactSheetPng(
    sourceImagesDir,
    path.join(packReviewDir, "contact-sheet.png"),
  );

  const assetPackManifest = buildAssetPackManifest({
    pack: {
      id: manifest.pack?.id ?? packId,
      version: manifest.pack?.version ?? "0.1.0",
      license: manifest.pack?.license ?? "UNLICENSED",
      author: manifest.pack?.author ?? "unknown",
    },
    providerDefault: manifest.providers?.default ?? "openai",
    catalogItems: catalog.items,
    atlasBundles: atlasResult.manifest.atlasBundles,
  });
  const assetPackManifestPath = path.join(packManifestDir, "asset-pack.json");
  await writeFile(
    assetPackManifestPath,
    `${JSON.stringify(assetPackManifest, null, 2)}\n`,
    "utf8",
  );

  const phaserManifest = buildPhaserManifest({
    packId,
    atlasBundles: atlasResult.manifest.atlasBundles,
    catalogItems: catalog.items,
  });
  const phaserManifestPath = path.join(packManifestDir, "phaser.json");
  await writeFile(phaserManifestPath, `${JSON.stringify(phaserManifest, null, 2)}\n`, "utf8");

  const validationSrc = path.join(outDir, "checks", "validation-report.json");
  if (await exists(validationSrc)) {
    await cp(validationSrc, path.join(packChecksDir, "validation-report.json"), {
      force: true,
    });
  } else {
    await writeFile(
      path.join(packChecksDir, "validation-report.json"),
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          status: "not-run",
          errors: [],
          warnings: ["Validation report was not available at package time."],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }

  const provenanceSrc = path.join(outDir, "provenance", "run.json");
  if (await exists(provenanceSrc)) {
    await cp(provenanceSrc, path.join(packProvenanceDir, "run.json"), {
      force: true,
    });
  } else {
    await writeFile(
      path.join(packProvenanceDir, "run.json"),
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          status: "not-run",
          jobs: [],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }

  const zipPath = path.join(distPacksDir, `game-asset-pack-${packId}.zip`);
  await createZipArchive(packDir, zipPath);

  return {
    packDir,
    zipPath,
    packId,
    assetPackManifestPath,
    phaserManifestPath,
  };
}

