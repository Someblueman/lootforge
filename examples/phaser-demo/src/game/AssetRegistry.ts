import Phaser from "phaser";

interface AtlasBundle {
  id: string;
  imageUrl: string;
  jsonUrl: string;
  targets: string[];
}

interface CatalogItem {
  id: string;
  kind: string;
  url: string;
  atlasGroup: string | null;
  previewWidth: number;
  previewHeight: number;
}

export interface VisualRef {
  textureKey: string;
  frame?: string;
}

export class AssetRegistry {
  private readonly bundles: AtlasBundle[];
  private readonly itemsById: Map<string, CatalogItem>;
  private readonly bundleByTargetId: Map<string, AtlasBundle>;

  private constructor(bundles: AtlasBundle[], items: CatalogItem[]) {
    this.bundles = bundles;
    this.itemsById = new Map(items.map((item) => [item.id, item]));
    this.bundleByTargetId = new Map();

    for (const bundle of bundles) {
      for (const targetId of bundle.targets) {
        this.bundleByTargetId.set(targetId, bundle);
      }
    }
  }

  static fromRaw(atlasManifestRaw: unknown, catalogRaw: unknown): AssetRegistry {
    const atlasManifest = (atlasManifestRaw ?? {}) as {
      atlasBundles?: unknown;
      items?: unknown;
    };

    const catalog = (catalogRaw ?? {}) as {
      items?: unknown;
    };

    const bundles = toAtlasBundles(atlasManifest.atlasBundles);
    const catalogItems = toCatalogItems(catalog.items ?? atlasManifest.items);

    return new AssetRegistry(bundles, catalogItems);
  }

  enqueueLoaderAssets(loader: Phaser.Loader.LoaderPlugin): void {
    for (const bundle of this.bundles) {
      loader.atlas(bundle.id, bundle.imageUrl, bundle.jsonUrl);
    }

    for (const item of this.itemsById.values()) {
      if (this.bundleByTargetId.has(item.id)) continue;
      loader.image(this.textureKeyForItem(item.id), item.url);
    }
  }

  requireVisual(id: string): VisualRef {
    const item = this.itemsById.get(id);
    if (!item) {
      throw new Error(`Missing asset id in catalog: ${id}`);
    }

    const bundle = this.bundleByTargetId.get(id);
    if (bundle) {
      return {
        textureKey: bundle.id,
        frame: id,
      };
    }

    return { textureKey: this.textureKeyForItem(id) };
  }

  assertIds(ids: string[]): void {
    const missing = ids.filter((id) => !this.itemsById.has(id));
    if (missing.length > 0) {
      throw new Error(`Asset registry missing required ids: ${missing.join(", ")}`);
    }
  }

  hasId(id: string): boolean {
    return this.itemsById.has(id);
  }

  toDebugShape(): Record<string, unknown> {
    return {
      bundles: this.bundles.map((bundle) => ({
        id: bundle.id,
        imageUrl: bundle.imageUrl,
        jsonUrl: bundle.jsonUrl,
        targets: [...bundle.targets],
      })),
      itemCount: this.itemsById.size,
    };
  }

  private textureKeyForItem(id: string): string {
    return `item:${id}`;
  }
}

function toAtlasBundles(value: unknown): AtlasBundle[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const candidate = entry as Record<string, unknown>;
      if (
        typeof candidate.id !== "string" ||
        typeof candidate.imageUrl !== "string" ||
        typeof candidate.jsonUrl !== "string" ||
        !Array.isArray(candidate.targets)
      ) {
        return null;
      }

      const targets = candidate.targets.filter(
        (target): target is string => typeof target === "string" && target.length > 0,
      );

      return {
        id: candidate.id,
        imageUrl: candidate.imageUrl,
        jsonUrl: candidate.jsonUrl,
        targets,
      } as AtlasBundle;
    })
    .filter((entry): entry is AtlasBundle => entry !== null);
}

function toCatalogItems(value: unknown): CatalogItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const candidate = entry as Record<string, unknown>;
      if (
        typeof candidate.id !== "string" ||
        typeof candidate.kind !== "string" ||
        typeof candidate.url !== "string"
      ) {
        return null;
      }

      return {
        id: candidate.id,
        kind: candidate.kind,
        url: candidate.url,
        atlasGroup: typeof candidate.atlasGroup === "string" ? candidate.atlasGroup : null,
        previewWidth:
          typeof candidate.previewWidth === "number" && Number.isFinite(candidate.previewWidth)
            ? candidate.previewWidth
            : 96,
        previewHeight:
          typeof candidate.previewHeight === "number" && Number.isFinite(candidate.previewHeight)
            ? candidate.previewHeight
            : 96,
      } as CatalogItem;
    })
    .filter((entry): entry is CatalogItem => entry !== null);
}
