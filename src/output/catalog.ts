import { stat } from "node:fs/promises";
import path from "node:path";

export interface CatalogTarget {
  id: string;
  kind: string;
  out: string;
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
    const filePath = path.join(imagesDir, target.out);
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

    items.push({
      id: target.id,
      kind: target.kind,
      atlasGroup: target.atlasGroup ?? null,
      out: target.out,
      url: `/assets/images/${target.out}`,
      alphaRequired:
        target.runtimeSpec?.alphaRequired ?? target.acceptance?.alpha === true,
      previewWidth: target.runtimeSpec?.previewWidth ?? expectedSize.width,
      previewHeight: target.runtimeSpec?.previewHeight ?? expectedSize.height,
      sizeBytes,
      exists,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    items,
  };
}
