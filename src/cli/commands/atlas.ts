import path from "node:path";

import { runAtlasPipeline } from "../../pipeline/atlas.js";

export interface AtlasCommandResult {
  manifestPath: string;
  bundles: number;
}

function readArgValue(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const exact = `--${name}`;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
    if (arg === exact) return argv[i + 1];
  }
  return undefined;
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
