import { type AtlasBundle } from "./assetPackManifest.js";
import { type CatalogItem } from "./catalog.js";
import { type PlannedTarget } from "../providers/types.js";

export interface UnityImportManifestInput {
  packId: string;
  atlasBundles: AtlasBundle[];
  catalogItems: CatalogItem[];
  targets: PlannedTarget[];
}

interface TargetRuntimeHints {
  anchorX?: number;
  anchorY?: number;
}

function toUnityAssetPath(url: string): string {
  if (url.startsWith("/")) {
    return `Assets/LootForge${url}`;
  }
  return `Assets/LootForge/${url}`;
}

function mapRuntimeHintsByTargetId(targets: PlannedTarget[]): Map<string, TargetRuntimeHints> {
  const hints = new Map<string, TargetRuntimeHints>();
  for (const target of targets) {
    hints.set(target.id, {
      ...(typeof target.runtimeSpec?.anchorX === "number"
        ? { anchorX: target.runtimeSpec.anchorX }
        : {}),
      ...(typeof target.runtimeSpec?.anchorY === "number"
        ? { anchorY: target.runtimeSpec.anchorY }
        : {}),
    });
  }
  return hints;
}

export function buildUnityImportManifest(input: UnityImportManifestInput): Record<string, unknown> {
  const targetHints = mapRuntimeHintsByTargetId(input.targets);

  return {
    generatedAt: new Date().toISOString(),
    packId: input.packId,
    importer: {
      kind: "unity-editor",
      minimumVersion: "2022.3",
      description:
        "Import these files via a Unity Editor script, then apply pivots and atlas groups from this manifest.",
    },
    textures: input.catalogItems.map((item) => {
      const hints = targetHints.get(item.id);
      return {
        id: item.id,
        kind: item.kind,
        atlasGroup: item.atlasGroup,
        sourceUrl: item.url,
        unityAssetPath: toUnityAssetPath(item.url),
        alphaRequired: item.alphaRequired,
        previewWidth: item.previewWidth,
        previewHeight: item.previewHeight,
        pivot: {
          x: hints?.anchorX ?? 0.5,
          y: hints?.anchorY ?? 0.5,
        },
      };
    }),
    atlasBundles: input.atlasBundles.map((bundle) => ({
      id: bundle.id,
      textureUrl: bundle.imageUrl,
      textureAssetPath: toUnityAssetPath(bundle.imageUrl),
      dataUrl: bundle.jsonUrl,
      dataAssetPath: toUnityAssetPath(bundle.jsonUrl),
      targets: bundle.targets,
    })),
  };
}
