import path from "node:path";

import { runAtlasPipeline } from "../../pipeline/atlas.js";
import { readArgValue } from "../parseArgs.js";

export interface AtlasCommandResult {
  manifestPath: string;
  bundles: number;
}

export async function runAtlasCommand(argv: string[]): Promise<AtlasCommandResult> {
  const outDir = path.resolve(readArgValue(argv, "out") ?? process.cwd());
  const indexPath = readArgValue(argv, "index");
  const manifestPath = readArgValue(argv, "manifest");

  const result = await runAtlasPipeline({
    outDir,
    targetsIndexPath: indexPath ? path.resolve(indexPath) : undefined,
    manifestPath: manifestPath ? path.resolve(manifestPath) : undefined,
  });

  return {
    manifestPath: result.manifestPath,
    bundles: result.manifest.atlasBundles.length,
  };
}
