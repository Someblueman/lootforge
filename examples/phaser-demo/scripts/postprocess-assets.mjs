import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const outDir = path.join(repoRoot, "examples/phaser-demo/public");
const atlasManifestPath = path.join(outDir, "assets/atlases/manifest.json");
const targetsIndexPath = path.join(outDir, "jobs/targets-index.json");
const catalogPath = path.join(outDir, "assets/imagegen/processed/catalog.json");

function parseSize(size) {
  const fallback = { width: 96, height: 96 };
  if (!size || typeof size !== "string") {
    return fallback;
  }
  const match = size.trim().match(/^(\d+)x(\d+)$/i);
  if (!match) {
    return fallback;
  }
  return {
    width: Number.parseInt(match[1], 10) || fallback.width,
    height: Number.parseInt(match[2], 10) || fallback.height,
  };
}

const atlasManifest = JSON.parse(await readFile(atlasManifestPath, "utf8"));
const targetsIndex = JSON.parse(await readFile(targetsIndexPath, "utf8"));

const atlasItemsById = new Map(
  Array.isArray(atlasManifest.items)
    ? atlasManifest.items
        .filter((item) => item && typeof item.id === "string")
        .map((item) => [item.id, item])
    : [],
);

const items = Array.isArray(targetsIndex.targets)
  ? targetsIndex.targets
      .filter((target) => target && typeof target.id === "string")
      .map((target) => {
        const atlasItem = atlasItemsById.get(target.id) ?? {};
        const parsedSize = parseSize(target.acceptance?.size);

        return {
          id: target.id,
          kind:
            typeof target.kind === "string" && target.kind.length > 0
              ? target.kind
              : atlasItem.kind ?? "asset",
          out: target.out,
          url:
            typeof atlasItem.url === "string" && atlasItem.url.length > 0
              ? atlasItem.url
              : `/assets/images/${target.out}`,
          atlasGroup:
            typeof target.atlasGroup === "string" && target.atlasGroup.length > 0
              ? target.atlasGroup
              : atlasItem.atlasGroup ?? null,
          alphaRequired:
            typeof target.runtimeSpec?.alphaRequired === "boolean"
              ? target.runtimeSpec.alphaRequired
              : atlasItem.alphaRequired === true,
          previewWidth:
            typeof target.runtimeSpec?.previewWidth === "number"
              ? target.runtimeSpec.previewWidth
              : atlasItem.previewWidth ?? parsedSize.width,
          previewHeight:
            typeof target.runtimeSpec?.previewHeight === "number"
              ? target.runtimeSpec.previewHeight
              : atlasItem.previewHeight ?? parsedSize.height,
        };
      })
  : [];

await mkdir(path.dirname(catalogPath), { recursive: true });
await writeFile(
  catalogPath,
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      items,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

console.log(`wrote ${catalogPath}`);
