import { CatalogItem } from "./catalog.js";

export interface AtlasBundle {
  id: string;
  imageUrl: string;
  jsonUrl: string;
  targets: string[];
}

export interface AssetPackManifestInput {
  pack: {
    id: string;
    version: string;
    license: string;
    author: string;
  };
  providerDefault: string;
  catalogItems: CatalogItem[];
  atlasBundles: AtlasBundle[];
}

export function buildAssetPackManifest(
  input: AssetPackManifestInput,
): Record<string, unknown> {
  return {
    generatedAt: new Date().toISOString(),
    pack: input.pack,
    providerDefault: input.providerDefault,
    atlasBundles: input.atlasBundles,
    items: input.catalogItems.map((item) => ({
      id: item.id,
      kind: item.kind,
      atlasGroup: item.atlasGroup,
      url: item.url,
      alphaRequired: item.alphaRequired,
      previewWidth: item.previewWidth,
      previewHeight: item.previewHeight,
      ...(typeof item.anchorX === "number" ? { anchorX: item.anchorX } : {}),
      ...(typeof item.anchorY === "number" ? { anchorY: item.anchorY } : {}),
    })),
  };
}
