import path from "node:path";

import { parseRuntimeManifestTargetsArg } from "../../output/runtimeManifests.js";
import { runPackagePipeline } from "../../pipeline/package.js";
import { resolveStagePathLayout } from "../../shared/paths.js";
import { readArgValue, parseBooleanArg } from "../parseArgs.js";

export interface PackageCommandResult {
  packDir: string;
  zipPath: string;
  packId: string;
}

export async function runPackageCommand(argv: string[]): Promise<PackageCommandResult> {
  const outDir = path.resolve(readArgValue(argv, "out") ?? process.cwd());
  const layout = resolveStagePathLayout(outDir);
  const manifestPath = path.resolve(
    readArgValue(argv, "manifest") ?? path.join(layout.imagegenDir, "manifest.json"),
  );
  const indexPath = readArgValue(argv, "index");
  const strict = parseBooleanArg(readArgValue(argv, "strict") ?? "true", "--strict");
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
