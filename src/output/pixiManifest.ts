import { type AtlasBundle } from "./assetPackManifest.js";
import { type CatalogItem } from "./catalog.js";

export interface PixiManifestInput {
  packId: string;
  atlasBundles: AtlasBundle[];
  catalogItems: CatalogItem[];
}

export function buildPixiManifest(input: PixiManifestInput): Record<string, unknown> {
  const standaloneImages = input.catalogItems.filter((item) => !item.atlasGroup);

  return {
    generatedAt: new Date().toISOString(),
    packId: input.packId,
    // This shape is compatible with PIXI.Assets manifest bundles.
    bundles: [
      {
        name: "atlases",
        assets: input.atlasBundles.map((bundle) => ({
          alias: bundle.id,
          src: bundle.jsonUrl,
        })),
      },
      {
        name: "images",
        assets: standaloneImages.map((item) => ({
          alias: item.id,
          src: item.url,
        })),
      },
    ],
    atlasSheets: input.atlasBundles.map((bundle) => ({
      alias: bundle.id,
      src: bundle.jsonUrl,
      textureURL: bundle.imageUrl,
      targets: bundle.targets,
    })),
    items: input.catalogItems.map((item) => ({
      id: item.id,
      kind: item.kind,
      atlasGroup: item.atlasGroup,
      url: item.url,
    })),
  };
}
