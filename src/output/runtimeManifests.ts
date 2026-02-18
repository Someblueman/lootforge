import type { PlannedTarget } from "../providers/types.js";
import { AtlasBundle } from "./assetPackManifest.js";
import { CatalogItem } from "./catalog.js";
import { buildPhaserManifest } from "./phaserManifest.js";
import { buildPixiManifest } from "./pixiManifest.js";
import { buildUnityImportManifest } from "./unityImportManifest.js";

export const RUNTIME_MANIFEST_TARGETS = ["phaser", "pixi", "unity"] as const;

export type RuntimeManifestTarget = (typeof RUNTIME_MANIFEST_TARGETS)[number];

const DEFAULT_RUNTIME_MANIFEST_TARGETS: RuntimeManifestTarget[] = ["phaser"];
const RUNTIME_MANIFEST_FILE_NAMES: Record<RuntimeManifestTarget, string> = {
  phaser: "phaser.json",
  pixi: "pixi.json",
  unity: "unity-import.json",
};

export interface RuntimeManifestBuildInput {
  packId: string;
  atlasBundles: AtlasBundle[];
  catalogItems: CatalogItem[];
  targets: PlannedTarget[];
  runtimeTargets?: RuntimeManifestTarget[];
}

export interface RuntimeManifestArtifact {
  target: RuntimeManifestTarget;
  fileName: string;
  payload: Record<string, unknown>;
}

export function isRuntimeManifestTarget(value: string): value is RuntimeManifestTarget {
  return (RUNTIME_MANIFEST_TARGETS as readonly string[]).includes(value);
}

export function parseRuntimeManifestTargetsArg(value: string): RuntimeManifestTarget[] {
  const rawValues = value
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);

  if (rawValues.length === 0) {
    throw new Error(
      `Invalid --runtimes value "${value}". Use a comma-separated list of: ${RUNTIME_MANIFEST_TARGETS.join(", ")}.`,
    );
  }

  const parsed: RuntimeManifestTarget[] = [];
  const seen = new Set<RuntimeManifestTarget>();
  for (const rawValue of rawValues) {
    if (!isRuntimeManifestTarget(rawValue)) {
      throw new Error(
        `Unsupported runtime "${rawValue}" in --runtimes. Supported runtimes: ${RUNTIME_MANIFEST_TARGETS.join(", ")}.`,
      );
    }
    if (!seen.has(rawValue)) {
      seen.add(rawValue);
      parsed.push(rawValue);
    }
  }
  return parsed;
}

export function resolveRuntimeManifestTargets(
  inputTargets?: RuntimeManifestTarget[],
): RuntimeManifestTarget[] {
  const requested = inputTargets ?? DEFAULT_RUNTIME_MANIFEST_TARGETS;
  const ordered: RuntimeManifestTarget[] = [];
  const seen = new Set<RuntimeManifestTarget>();
  const withBaseline = ["phaser", ...requested] as RuntimeManifestTarget[];

  for (const target of withBaseline) {
    if (seen.has(target)) {
      continue;
    }
    seen.add(target);
    ordered.push(target);
  }

  return ordered;
}

export function buildRuntimeManifestArtifacts(
  input: RuntimeManifestBuildInput,
): RuntimeManifestArtifact[] {
  const targets = resolveRuntimeManifestTargets(input.runtimeTargets);

  return targets.map((target) => {
    let payload: Record<string, unknown>;
    if (target === "phaser") {
      payload = buildPhaserManifest({
        packId: input.packId,
        atlasBundles: input.atlasBundles,
        catalogItems: input.catalogItems,
      });
    } else if (target === "pixi") {
      payload = buildPixiManifest({
        packId: input.packId,
        atlasBundles: input.atlasBundles,
        catalogItems: input.catalogItems,
      });
    } else {
      payload = buildUnityImportManifest({
        packId: input.packId,
        atlasBundles: input.atlasBundles,
        catalogItems: input.catalogItems,
        targets: input.targets,
      });
    }

    return {
      target,
      fileName: RUNTIME_MANIFEST_FILE_NAMES[target],
      payload,
    };
  });
}
