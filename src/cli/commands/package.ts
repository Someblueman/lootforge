import path from "node:path";

import { runPackagePipeline } from "../../pipeline/package.js";

export interface PackageCommandResult {
  packDir: string;
  zipPath: string;
  packId: string;
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

export async function runPackageCommand(argv: string[]): Promise<PackageCommandResult> {
  const outDir = path.resolve(readArgValue(argv, "out") ?? process.cwd());
  const manifestPath = path.resolve(
    readArgValue(argv, "manifest") ?? path.join(process.cwd(), "assets/imagegen/manifest.json"),
  );
  const indexPath = readArgValue(argv, "index");

  const result = await runPackagePipeline({
    outDir,
    manifestPath,
    targetsIndexPath: indexPath ? path.resolve(indexPath) : undefined,
  });

  return {
    packDir: result.packDir,
    zipPath: result.zipPath,
    packId: result.packId,
  };
}

