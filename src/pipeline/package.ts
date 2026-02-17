import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { assertImageAcceptanceReport, runImageAcceptanceChecks } from "../checks/imageAcceptance.js";
import { runAtlasPipeline } from "./atlas.js";
import { buildAssetPackManifest } from "../output/assetPackManifest.js";
import { buildCatalog } from "../output/catalog.js";
import { writeContactSheetPng } from "../output/contactSheet.js";
import {
  buildRuntimeManifestArtifacts,
  type RuntimeManifestTarget,
} from "../output/runtimeManifests.js";
import { createZipArchive } from "../output/zip.js";
import type { PlannedTarget } from "../providers/types.js";
import { writeJsonFile } from "../shared/fs.js";
import { resolveStagePathLayout } from "../shared/paths.js";

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
  targets?: PlannedTarget[];
}

interface EvalReport {
  hardErrors?: number;
  targets?: Array<{
    targetId: string;
    passedHardGates: boolean;
  }>;
}

interface SelectionLockFile {
  targets?: Array<{
    targetId: string;
    approved: boolean;
    inputHash: string;
    selectedOutputPath: string;
  }>;
}

export interface PackagePipelineOptions {
  outDir: string;
  manifestPath: string;
  targetsIndexPath?: string;
  strict?: boolean;
  runtimeTargets?: RuntimeManifestTarget[];
}

export interface PackagePipelineResult {
  packDir: string;
  zipPath: string;
  packId: string;
  assetPackManifestPath: string;
  phaserManifestPath: string;
  runtimeManifestPaths: Partial<Record<RuntimeManifestTarget, string>>;
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

async function loadTargets(targetsIndexPath: string): Promise<PlannedTarget[]> {
  const raw = await readFile(targetsIndexPath, "utf8");
  const parsed = parseJson<TargetsIndex>(raw, targetsIndexPath);
  if (!Array.isArray(parsed.targets)) return [];
  return parsed.targets;
}

export async function runPackagePipeline(
  options: PackagePipelineOptions,
): Promise<PackagePipelineResult> {
  const layout = resolveStagePathLayout(options.outDir);
  const manifestPath = path.resolve(options.manifestPath);
  const targetsIndexPath = path.resolve(
    options.targetsIndexPath ?? path.join(layout.jobsDir, "targets-index.json"),
  );
  const strict = options.strict ?? true;

  const manifestRaw = await readFile(manifestPath, "utf8");
  const manifest = parseJson<ManifestV2>(manifestRaw, manifestPath);
  const packId = sanitizePackId(manifest.pack?.id ?? "asset-pack");

  const processedImagesDir = layout.processedImagesDir;
  if (!(await exists(processedImagesDir))) {
    throw new Error(
      `Processed images were not found at ${processedImagesDir}. Run \"lootforge process\" before packaging.`,
    );
  }

  const distPacksDir = path.join(layout.outDir, "dist", "packs");
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
    outDir: layout.outDir,
    targetsIndexPath,
    manifestPath,
  });

  await copyDirIfExists(processedImagesDir, packImagesDir);
  await copyDirIfExists(atlasResult.atlasDir, packAtlasesDir);

  const targets = await loadTargets(targetsIndexPath);
  const catalog = await buildCatalog(targets, processedImagesDir);
  await writeFile(
    path.join(packReviewDir, "catalog.json"),
    `${JSON.stringify(catalog, null, 2)}\n`,
    "utf8",
  );

  await writeContactSheetPng(
    processedImagesDir,
    path.join(packReviewDir, "contact-sheet.png"),
    {
      orderedFilenames: catalog.items.map((item) => path.basename(item.out)),
    },
  );

  const acceptanceReport = await runImageAcceptanceChecks({
    targets,
    imagesDir: processedImagesDir,
    strict: true,
  });
  assertImageAcceptanceReport(acceptanceReport);

  const acceptanceReportPath = path.join(layout.checksDir, "image-acceptance-report.json");
  await writeJsonFile(acceptanceReportPath, acceptanceReport);

  const evalReportPath = path.join(layout.checksDir, "eval-report.json");
  const selectionLockPath = path.join(layout.outDir, "locks", "selection-lock.json");
  if (strict) {
    if (!(await exists(evalReportPath))) {
      throw new Error(
        `Strict packaging requires ${evalReportPath}. Run \"lootforge eval\" first.`,
      );
    }
    if (!(await exists(selectionLockPath))) {
      throw new Error(
        `Strict packaging requires ${selectionLockPath}. Run \"lootforge select\" first.`,
      );
    }
  }

  const evalReport = (await exists(evalReportPath))
    ? parseJson<EvalReport>(await readFile(evalReportPath, "utf8"), evalReportPath)
    : undefined;
  const selectionLock = (await exists(selectionLockPath))
    ? parseJson<SelectionLockFile>(
        await readFile(selectionLockPath, "utf8"),
        selectionLockPath,
      )
    : undefined;

  if (strict && evalReport && (evalReport.hardErrors ?? 0) > 0) {
    throw new Error(
      `Strict packaging blocked: eval report has ${evalReport.hardErrors ?? 0} hard errors.`,
    );
  }
  if (strict && selectionLock) {
    const approvedIds = new Set(
      (selectionLock.targets ?? [])
        .filter((target) => target.approved)
        .map((target) => target.targetId),
    );
    const missingApprovals = catalog.items
      .map((item) => item.id)
      .filter((id) => !approvedIds.has(id));
    if (missingApprovals.length > 0) {
      throw new Error(
        `Strict packaging blocked: missing approved lock entries for ${missingApprovals
          .slice(0, 8)
          .join(", ")}${missingApprovals.length > 8 ? "..." : ""}`,
      );
    }
  }

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

  const runtimeManifestArtifacts = buildRuntimeManifestArtifacts({
    packId,
    atlasBundles: atlasResult.manifest.atlasBundles,
    catalogItems: catalog.items,
    targets,
    runtimeTargets: options.runtimeTargets,
  });
  const runtimeManifestPaths: Partial<Record<RuntimeManifestTarget, string>> = {};
  for (const artifact of runtimeManifestArtifacts) {
    const manifestPathOut = path.join(packManifestDir, artifact.fileName);
    await writeFile(manifestPathOut, `${JSON.stringify(artifact.payload, null, 2)}\n`, "utf8");
    runtimeManifestPaths[artifact.target] = manifestPathOut;
  }
  const phaserManifestPath = runtimeManifestPaths.phaser;
  if (!phaserManifestPath) {
    throw new Error("Packaging failed to emit baseline phaser runtime manifest.");
  }

  const validationSrc = path.join(layout.checksDir, "validation-report.json");
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

  await cp(
    acceptanceReportPath,
    path.join(packChecksDir, "image-acceptance-report.json"),
    { force: true },
  );
  if (await exists(evalReportPath)) {
    await cp(evalReportPath, path.join(packChecksDir, "eval-report.json"), {
      force: true,
    });
  }
  if (await exists(selectionLockPath)) {
    await cp(selectionLockPath, path.join(packProvenanceDir, "selection-lock.json"), {
      force: true,
    });
  }
  const reviewHtmlSrc = path.join(layout.outDir, "review", "review.html");
  if (await exists(reviewHtmlSrc)) {
    await cp(reviewHtmlSrc, path.join(packReviewDir, "review.html"), {
      force: true,
    });
  }

  const provenanceSrc = path.join(layout.provenanceDir, "run.json");
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
    runtimeManifestPaths,
  };
}
