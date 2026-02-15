import { CatalogItem } from "./catalog.js";
import { AtlasBundle } from "./assetPackManifest.js";

export interface PhaserManifestInput {
  packId: string;
  atlasBundles: AtlasBundle[];
  catalogItems: CatalogItem[];
}

export function buildPhaserManifest(
  input: PhaserManifestInput,
): Record<string, unknown> {
  return {
    generatedAt: new Date().toISOString(),
    packId: input.packId,
    atlases: input.atlasBundles.map((bundle) => ({
      key: bundle.id,
      textureURL: bundle.imageUrl,
      atlasURL: bundle.jsonUrl,
      targets: bundle.targets,
    })),
    standaloneImages: input.catalogItems
      .filter((item) => !item.atlasGroup)
      .map((item) => ({
        key: item.id,
        url: item.url,
      })),
    items: input.catalogItems.map((item) => ({
      id: item.id,
      kind: item.kind,
      atlasGroup: item.atlasGroup,
      url: item.url,
    })),
  };
}

