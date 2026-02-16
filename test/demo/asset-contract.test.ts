import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { REQUIRED_ASSET_IDS } from "../../examples/phaser-demo/src/game/constants";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const publicDir = path.join(repoRoot, "examples/phaser-demo/public");

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

describe("phaser demo asset contracts", () => {
  test("required ids exist in processed catalog", async () => {
    const catalogPath = path.join(publicDir, "assets/imagegen/processed/catalog.json");
    const catalogRaw = await readFile(catalogPath, "utf8");
    const catalog = JSON.parse(catalogRaw) as {
      items?: Array<{ id: string }>;
    };

    const ids = new Set((catalog.items ?? []).map((item) => item.id));
    for (const id of REQUIRED_ASSET_IDS) {
      expect(ids.has(id), `missing catalog id ${id}`).toBe(true);
    }
  });

  test("atlas manifest bundle references resolve to committed assets", async () => {
    const atlasManifestPath = path.join(publicDir, "assets/atlases/manifest.json");
    const atlasRaw = await readFile(atlasManifestPath, "utf8");
    const atlasManifest = JSON.parse(atlasRaw) as {
      atlasBundles?: Array<{ id: string; imageUrl: string; jsonUrl: string }>;
    };

    const bundles = atlasManifest.atlasBundles ?? [];
    expect(bundles.length).toBeGreaterThan(0);

    for (const bundle of bundles) {
      const imagePath = path.join(publicDir, bundle.imageUrl.replace(/^\//, ""));
      const jsonPath = path.join(publicDir, bundle.jsonUrl.replace(/^\//, ""));

      // eslint-disable-next-line no-await-in-loop
      expect(await exists(imagePath), `missing bundle image for ${bundle.id}`).toBe(true);
      // eslint-disable-next-line no-await-in-loop
      expect(await exists(jsonPath), `missing bundle json for ${bundle.id}`).toBe(true);
    }
  });
});
