import path from "node:path";

import { parseRuntimeManifestTargetsArg } from "../../output/runtimeManifests.js";
import { runPackagePipeline } from "../../pipeline/package.js";
import { resolveStagePathLayout } from "../../shared/paths.js";

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
  const layout = resolveStagePathLayout(outDir);
  const manifestPath = path.resolve(
    readArgValue(argv, "manifest") ?? path.join(layout.imagegenDir, "manifest.json"),
  );
  const indexPath = readArgValue(argv, "index");
  const strict = parseBooleanArg(readArgValue(argv, "strict") ?? "true");
  const runtimesArg = readArgValue(argv, "runtimes");
  const runtimeTargets = runtimesArg ? parseRuntimeManifestTargetsArg(runtimesArg) : undefined;

  const result = await runPackagePipeline({
    outDir,
    manifestPath,
    targetsIndexPath: indexPath ? path.resolve(indexPath) : undefined,
    strict,
    runtimeTargets,
  });

  return {
    packDir: result.packDir,
    zipPath: result.zipPath,
    packId: result.packId,
  };
}

function parseBooleanArg(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "n"].includes(normalized)) {
    return false;
  }
  throw new Error(`Invalid boolean value "${value}" for --strict. Use true or false.`);
}
