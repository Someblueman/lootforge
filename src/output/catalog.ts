import { stat } from "node:fs/promises";
import path from "node:path";

import { normalizeTargetOutPath, resolvePathWithinDir } from "../shared/paths.js";

export interface CatalogTarget {
  id: string;
  kind?: string;
  out: string;
  catalogDisabled?: boolean;
  atlasGroup?: string | null;
  acceptance?: {
    size?: string;
    alpha?: boolean;
    maxFileSizeKB?: number;
  };
  runtimeSpec?: {
    alphaRequired?: boolean;
    previewWidth?: number;
    previewHeight?: number;
  };
  auxiliaryMaps?: {
    normalFromHeight?: boolean;
    specularFromLuma?: boolean;
    aoFromLuma?: boolean;
  };
}

export interface CatalogItem {
  id: string;
  kind: string;
  atlasGroup: string | null;
  out: string;
  url: string;
  alphaRequired: boolean;
  previewWidth: number;
  previewHeight: number;
  sizeBytes: number;
  exists: boolean;
  maps?: {
    normalUrl?: string;
    specularUrl?: string;
    aoUrl?: string;
  };
}

export interface CatalogOutput {
  generatedAt: string;
  items: CatalogItem[];
}

function parseSize(size: string | undefined): { width: number; height: number } {
  const defaultSize = { width: 96, height: 96 };
  if (!size) return defaultSize;

  const match = /^(\d+)x(\d+)$/i.exec(size.trim());
  if (!match) return defaultSize;

  const width = Number.parseInt(match[1], 10);
  const height = Number.parseInt(match[2], 10);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return defaultSize;
  if (width <= 0 || height <= 0) return defaultSize;
  return { width, height };
}

export async function buildCatalog(
  targets: CatalogTarget[],
  imagesDir: string,
): Promise<CatalogOutput> {
  const items: CatalogItem[] = [];

  for (const target of targets) {
    if (target.catalogDisabled) {
      continue;
    }

    const normalizedOut = normalizeTargetOutPath(target.out);
    const filePath = resolvePathWithinDir(
      imagesDir,
      normalizedOut,
      `catalog image for target "${target.id}"`,
    );
    const expectedSize = parseSize(target.acceptance?.size);
    let exists = false;
    let sizeBytes = 0;

    try {
      const fileStat = await stat(filePath);
      exists = fileStat.isFile();
      sizeBytes = fileStat.size;
    } catch {
      exists = false;
      sizeBytes = 0;
    }

    const ext = path.extname(normalizedOut);
    const base = normalizedOut.slice(0, normalizedOut.length - ext.length);
    const maps =
      target.auxiliaryMaps &&
      (target.auxiliaryMaps.normalFromHeight ||
        target.auxiliaryMaps.specularFromLuma ||
        target.auxiliaryMaps.aoFromLuma)
        ? {
            ...(target.auxiliaryMaps.normalFromHeight
              ? { normalUrl: `/assets/images/${base}__normal${ext}` }
              : {}),
            ...(target.auxiliaryMaps.specularFromLuma
              ? { specularUrl: `/assets/images/${base}__specular${ext}` }
              : {}),
            ...(target.auxiliaryMaps.aoFromLuma
              ? { aoUrl: `/assets/images/${base}__ao${ext}` }
              : {}),
          }
        : undefined;

    items.push({
      id: target.id,
      kind: target.kind ?? "asset",
      atlasGroup: target.atlasGroup ?? null,
      out: normalizedOut,
      url: `/assets/images/${normalizedOut}`,
      alphaRequired:
        target.runtimeSpec?.alphaRequired ?? target.acceptance?.alpha === true,
      previewWidth: target.runtimeSpec?.previewWidth ?? expectedSize.width,
      previewHeight: target.runtimeSpec?.previewHeight ?? expectedSize.height,
      sizeBytes,
      exists,
      ...(maps ? { maps } : {}),
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    items,
  };
}
