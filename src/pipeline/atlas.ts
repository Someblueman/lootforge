import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

import sharp from "sharp";

import type { ManifestAtlasGroupOptions, ManifestV2 } from "../manifest/types.js";
import {
  normalizeTargetOutPath,
  resolvePathWithinDir,
  resolveStagePathLayout,
} from "../shared/paths.js";

interface PlannedTarget {
  id: string;
  kind: string;
  out: string;
  catalogDisabled?: boolean;
  atlasGroup?: string | null;
  acceptance?: {
    alpha?: boolean;
    size?: string;
  };
  runtimeSpec?: {
    alphaRequired?: boolean;
    previewWidth?: number;
    previewHeight?: number;
  };
}

interface PlannedIndex {
  targets?: PlannedTarget[];
}

export interface AtlasBundle {
  id: string;
  imageUrl: string;
  jsonUrl: string;
  targets: string[];
}

export interface AtlasManifestItem {
  id: string;
  kind: string;
  url: string;
  atlasGroup: string | null;
  alphaRequired: boolean;
  previewWidth: number;
  previewHeight: number;
}

export interface AtlasManifest {
  generatedAt: string;
  packer: "texturepacker" | "none";
  atlasBundles: AtlasBundle[];
  items: AtlasManifestItem[];
}

export interface AtlasPipelineOptions {
  outDir: string;
  targetsIndexPath?: string;
  manifestPath?: string;
  assetBaseUrl?: string;
}

export interface AtlasPipelineResult {
  atlasDir: string;
  manifestPath: string;
  manifest: AtlasManifest;
}

function parseSize(size: string | undefined): { width: number; height: number } {
  const fallback = { width: 96, height: 96 };
  if (!size) return fallback;
  const match = /^(\d+)x(\d+)$/i.exec(size);
  if (!match) return fallback;
  return {
    width: Number.parseInt(match[1], 10) || fallback.width,
    height: Number.parseInt(match[2], 10) || fallback.height,
  };
}

function sanitizeBundleId(targetId: string): string {
  return `atlas-${targetId.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-")}`;
}

function hasCommand(command: string): boolean {
  const run = spawnSync(command, ["--version"], { stdio: "ignore" });
  return run.status === 0;
}

function buildSingleFrameAtlasData(
  frameName: string,
  imageName: string,
  width: number,
  height: number,
): Record<string, unknown> {
  return {
    frames: {
      [frameName]: {
        frame: { x: 0, y: 0, w: width, h: height },
        rotated: false,
        trimmed: false,
        spriteSourceSize: { x: 0, y: 0, w: width, h: height },
        sourceSize: { w: width, h: height },
      },
    },
    meta: {
      app: "lootforge",
      format: "RGBA8888",
      image: imageName,
      scale: "1",
    },
  };
}

function animationMetadataPathForOut(out: string): string {
  const ext = path.extname(out);
  const base = out.slice(0, out.length - ext.length);
  return `${base}.anim.json`;
}

function buildAtlasDataFromSheetMetadata(params: {
  imageName: string;
  metadataFrames: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    frames: params.metadataFrames,
    meta: {
      app: "lootforge",
      format: "RGBA8888",
      image: params.imageName,
      scale: "1",
    },
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function parsePlannedIndex(raw: string, filePath: string): PlannedIndex {
  try {
    return JSON.parse(raw) as PlannedIndex;
  } catch (error) {
    throw new Error(
      `Failed to parse planned targets index (${filePath}): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function readManifestAtlasOptions(manifestPath: string): Promise<ManifestV2["atlas"]> {
  try {
    const raw = await readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw) as ManifestV2;
    return parsed.atlas;
  } catch {
    return undefined;
  }
}

function resolveAtlasGroupOptions(
  atlasConfig: ManifestV2["atlas"],
  groupId: string,
): ManifestAtlasGroupOptions {
  const defaults = atlasConfig ?? {};
  const group = atlasConfig?.groups?.[groupId] ?? {};

  return {
    padding: group.padding ?? defaults.padding ?? 2,
    trim: group.trim ?? defaults.trim ?? true,
    bleed: group.bleed ?? defaults.bleed ?? 1,
    multipack: group.multipack ?? defaults.multipack ?? false,
    maxWidth: group.maxWidth ?? defaults.maxWidth ?? 2048,
    maxHeight: group.maxHeight ?? defaults.maxHeight ?? 2048,
  };
}

async function detectImageSize(filePath: string): Promise<{ width: number; height: number }> {
  const metadata = await sharp(filePath).metadata();
  if (
    typeof metadata.width === "number" &&
    metadata.width > 0 &&
    typeof metadata.height === "number" &&
    metadata.height > 0
  ) {
    return { width: metadata.width, height: metadata.height };
  }
  return { width: 96, height: 96 };
}

export async function runAtlasPipeline(
  options: AtlasPipelineOptions,
): Promise<AtlasPipelineResult> {
  const layout = resolveStagePathLayout(options.outDir);
  const outDir = layout.outDir;
  const targetsIndexPath = path.resolve(
    options.targetsIndexPath ?? path.join(layout.jobsDir, "targets-index.json"),
  );
  const manifestPath = path.resolve(
    options.manifestPath ?? path.join(layout.imagegenDir, "manifest.json"),
  );
  const atlasDir = layout.atlasDir;
  const imagesDir = layout.processedImagesDir;
  const imageBaseUrl = resolveAssetBaseUrl(options.assetBaseUrl);
  const atlasBaseUrl = `${imageBaseUrl}/atlases`;
  const processedImagesBaseUrl = `${imageBaseUrl}/images`;

  await mkdir(atlasDir, { recursive: true });

  const indexRaw = await readFile(targetsIndexPath, "utf8");
  const index = parsePlannedIndex(indexRaw, targetsIndexPath);
  const targets = (Array.isArray(index.targets) ? index.targets : []).map(
    (target, targetIndex) => {
      try {
        return {
          ...target,
          out: normalizeTargetOutPath(target.out),
        };
      } catch (error) {
        throw new Error(
          `targets[${targetIndex}].out is invalid: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },
  );
  const atlasConfig = await readManifestAtlasOptions(manifestPath);

  const manifestItems: AtlasManifestItem[] = targets
    .filter((target) => !target.catalogDisabled)
    .map((target) => {
      const expectedSize = parseSize(target.acceptance?.size);
      return {
        id: target.id,
        kind: target.kind || "asset",
        url: `${processedImagesBaseUrl}/${target.out}`,
        atlasGroup: target.atlasGroup ?? null,
        alphaRequired:
          target.runtimeSpec?.alphaRequired ?? target.acceptance?.alpha === true,
        previewWidth: target.runtimeSpec?.previewWidth ?? expectedSize.width,
        previewHeight: target.runtimeSpec?.previewHeight ?? expectedSize.height,
      };
    });

  const groups = new Map<string, PlannedTarget[]>();
  for (const target of targets) {
    if (target.catalogDisabled) continue;
    if (!target.atlasGroup) continue;
    const list = groups.get(target.atlasGroup) ?? [];
    list.push(target);
    groups.set(target.atlasGroup, list);
  }

  const atlasConfigPath = path.join(atlasDir, "atlas-config.json");
  await writeFile(
    atlasConfigPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        sourceManifest: manifestPath,
        atlas: atlasConfig ?? null,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  let packer: AtlasManifest["packer"] = "none";
  const bundles: AtlasBundle[] = [];

  if (groups.size > 0 && hasCommand("texturepacker")) {
    packer = "texturepacker";
    for (const [groupId, groupTargets] of groups) {
      const inputPaths: string[] = [];
      for (const target of groupTargets) {
        const imagePath = resolvePathWithinDir(
          imagesDir,
          target.out,
          `atlas image for target "${target.id}"`,
        );
        if (await fileExists(imagePath)) {
          inputPaths.push(imagePath);
        }
      }

      if (inputPaths.length === 0) continue;

      const groupOptions = resolveAtlasGroupOptions(atlasConfig, groupId);
      const sheetPath = path.join(atlasDir, `${groupId}.png`);
      const dataPath = path.join(atlasDir, `${groupId}.json`);

      const args = [
        "--format",
        "phaser-json-hash",
        "--sheet",
        sheetPath,
        "--data",
        dataPath,
        "--shape-padding",
        String(groupOptions.padding ?? 2),
        "--extrude",
        String(groupOptions.bleed ?? 1),
        "--max-width",
        String(groupOptions.maxWidth ?? 2048),
        "--max-height",
        String(groupOptions.maxHeight ?? 2048),
      ];

      if (groupOptions.trim === true) {
        args.push("--trim-mode", "Trim");
      }
      if (groupOptions.multipack === true) {
        args.push("--multipack");
      }

      args.push(...inputPaths);

      const configArtifactPath = path.join(atlasDir, `${groupId}.texturepacker-config.json`);
      await writeFile(
        configArtifactPath,
        `${JSON.stringify(
          {
            groupId,
            args,
            inputPaths,
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      const run = spawnSync("texturepacker", args, { stdio: "ignore" });

      if (run.status !== 0) {
        throw new Error(`TexturePacker failed for atlas group \"${groupId}\"`);
      }

      bundles.push({
        id: groupId,
        imageUrl: `${atlasBaseUrl}/${groupId}.png`,
        jsonUrl: `${atlasBaseUrl}/${groupId}.json`,
        targets: groupTargets.map((target) => target.id),
      });
    }
  } else if (groups.size > 0) {
    for (const groupTargets of groups.values()) {
      for (const target of groupTargets) {
        const imagePath = resolvePathWithinDir(
          imagesDir,
          target.out,
          `atlas image for target "${target.id}"`,
        );
        if (!(await fileExists(imagePath))) continue;

        const bundleId = sanitizeBundleId(target.id);
        const atlasJsonPath = path.join(atlasDir, `${bundleId}.json`);
        let atlasData: Record<string, unknown>;
        let bundleTargets = [target.id];

        const sheetMetaPath = resolvePathWithinDir(
          imagesDir,
          animationMetadataPathForOut(target.out),
          `atlas metadata for target "${target.id}"`,
        );
        if (target.kind === "spritesheet" && (await fileExists(sheetMetaPath))) {
          const raw = await readFile(sheetMetaPath, "utf8");
          const parsed = JSON.parse(raw) as {
            frames?: Record<string, unknown>;
          };
          const metadataFrames = parsed.frames ?? {};
          atlasData = buildAtlasDataFromSheetMetadata({
            imageName: target.out,
            metadataFrames,
          });
          bundleTargets = [target.id, ...Object.keys(metadataFrames)];
        } else {
          const measured = await detectImageSize(imagePath);
          atlasData = buildSingleFrameAtlasData(
            target.id,
            target.out,
            measured.width,
            measured.height,
          );
        }

        await writeFile(atlasJsonPath, `${JSON.stringify(atlasData, null, 2)}\n`, "utf8");

        bundles.push({
          id: bundleId,
          imageUrl: `${processedImagesBaseUrl}/${target.out}`,
          jsonUrl: `${atlasBaseUrl}/${bundleId}.json`,
          targets: bundleTargets,
        });
      }
    }
  }

  const manifest: AtlasManifest = {
    generatedAt: new Date().toISOString(),
    packer,
    atlasBundles: bundles,
    items: manifestItems,
  };

  const manifestPathOut = path.join(atlasDir, "manifest.json");
  await writeFile(manifestPathOut, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return {
    atlasDir,
    manifestPath: manifestPathOut,
    manifest,
  };
}

function resolveAssetBaseUrl(rawAssetBaseUrl: string | undefined): string {
  const trimmed = (rawAssetBaseUrl ?? "/assets").trim();
  if (!trimmed || trimmed === "/") {
    return "/assets";
  }
  const normalized = trimmed.replace(/\\/g, "/");
  const withLeadingSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;
  const collapsed = withLeadingSlash.replace(/\/{2,}/g, "/");
  const withoutTrailingSlash =
    collapsed.endsWith("/") ? collapsed.slice(0, -1) : collapsed;
  return withoutTrailingSlash || "/assets";
}
