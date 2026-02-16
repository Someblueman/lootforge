import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

interface PlannedTarget {
  id: string;
  kind: string;
  out: string;
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

export async function runAtlasPipeline(
  options: AtlasPipelineOptions,
): Promise<AtlasPipelineResult> {
  const outDir = path.resolve(options.outDir);
  const targetsIndexPath = path.resolve(
    options.targetsIndexPath ?? path.join(outDir, "jobs", "targets-index.json"),
  );
  const atlasDir = path.join(outDir, "assets", "atlases");
  const imagesDir = path.join(outDir, "assets", "images");

  await mkdir(atlasDir, { recursive: true });

  const indexRaw = await readFile(targetsIndexPath, "utf8");
  const index = parsePlannedIndex(indexRaw, targetsIndexPath);
  const targets = Array.isArray(index.targets) ? index.targets : [];

  const manifestItems: AtlasManifestItem[] = targets.map((target) => {
    const expectedSize = parseSize(target.acceptance?.size);
    return {
      id: target.id,
      kind: target.kind || "asset",
      url: `/assets/images/${target.out}`,
      atlasGroup: target.atlasGroup ?? null,
      alphaRequired:
        target.runtimeSpec?.alphaRequired ?? target.acceptance?.alpha === true,
      previewWidth: target.runtimeSpec?.previewWidth ?? expectedSize.width,
      previewHeight: target.runtimeSpec?.previewHeight ?? expectedSize.height,
    };
  });

  const groups = new Map<string, PlannedTarget[]>();
  for (const target of targets) {
    if (!target.atlasGroup) continue;
    const list = groups.get(target.atlasGroup) ?? [];
    list.push(target);
    groups.set(target.atlasGroup, list);
  }

  let packer: AtlasManifest["packer"] = "none";
  const bundles: AtlasBundle[] = [];

  if (groups.size > 0 && hasCommand("texturepacker")) {
    packer = "texturepacker";
    for (const [groupId, groupTargets] of groups) {
      const inputPaths = [];
      for (const target of groupTargets) {
        const imagePath = path.join(imagesDir, target.out);
        if (await fileExists(imagePath)) {
          inputPaths.push(imagePath);
        }
      }

      if (inputPaths.length === 0) continue;

      const sheetPath = path.join(atlasDir, `${groupId}.png`);
      const dataPath = path.join(atlasDir, `${groupId}.json`);

      const run = spawnSync(
        "texturepacker",
        [
          "--format",
          "phaser-json-hash",
          "--sheet",
          sheetPath,
          "--data",
          dataPath,
          ...inputPaths,
        ],
        { stdio: "ignore" },
      );

      if (run.status !== 0) {
        throw new Error(`TexturePacker failed for atlas group "${groupId}"`);
      }

      bundles.push({
        id: groupId,
        imageUrl: `/assets/atlases/${groupId}.png`,
        jsonUrl: `/assets/atlases/${groupId}.json`,
        targets: groupTargets.map((target) => target.id),
      });
    }
  } else if (groups.size > 0) {
    for (const groupTargets of groups.values()) {
      for (const target of groupTargets) {
        const imagePath = path.join(imagesDir, target.out);
        if (!(await fileExists(imagePath))) continue;

        const expectedSize = parseSize(target.acceptance?.size);
        const frameWidth = expectedSize.width;
        const frameHeight = expectedSize.height;
        const bundleId = sanitizeBundleId(target.id);
        const atlasJsonPath = path.join(atlasDir, `${bundleId}.json`);
        const atlasData = buildSingleFrameAtlasData(
          target.id,
          target.out,
          frameWidth,
          frameHeight,
        );

        await writeFile(atlasJsonPath, `${JSON.stringify(atlasData, null, 2)}\n`, "utf8");

        bundles.push({
          id: bundleId,
          imageUrl: `/assets/images/${target.out}`,
          jsonUrl: `/assets/atlases/${bundleId}.json`,
          targets: [target.id],
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

  const manifestPath = path.join(atlasDir, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return {
    atlasDir,
    manifestPath,
    manifest,
  };
}
