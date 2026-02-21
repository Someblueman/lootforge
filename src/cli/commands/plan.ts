import path from "node:path";

import { loadManifestSource } from "../../manifest/load.js";
import { createPlanArtifacts, validateManifestSource } from "../../manifest/validate.js";
import { CliError } from "../../shared/errors.js";
import { writeJsonFile, writeJsonLines } from "../../shared/fs.js";
import { resolveManifestPath, resolveOutDir } from "../../shared/paths.js";

export interface PlanCommandArgs {
  manifestPath: string;
  outDir: string;
}

export interface PlanCommandResult {
  manifestPath: string;
  outDir: string;
  targets: number;
  warnings: number;
  targetsIndexPath: string;
  openaiJobsPath: string;
  nanoJobsPath: string;
  localJobsPath: string;
}

export function parsePlanCommandArgs(argv: string[]): PlanCommandArgs {
  const manifestPath = resolveManifestPath(readArgValue(argv, "manifest"));
  const outDir = resolveOutDir(readArgValue(argv, "out"), path.dirname(manifestPath));

  return {
    manifestPath,
    outDir,
  };
}

export async function runPlanCommand(argv: string[]): Promise<PlanCommandResult> {
  const args = parsePlanCommandArgs(argv);
  const source = await loadManifestSource(args.manifestPath);
  const validation = validateManifestSource(source);

  if (!validation.manifest || validation.report.errors > 0) {
    throw new CliError(`Manifest validation failed with ${validation.report.errors} error(s).`, {
      code: "manifest_validation_failed",
      exitCode: 1,
    });
  }

  const artifacts = createPlanArtifacts(validation.manifest, source.manifestPath);
  const jobsDir = path.join(args.outDir, "jobs");
  const targetsIndexPath = path.join(jobsDir, "targets-index.json");
  const openaiJobsPath = path.join(jobsDir, "openai.jsonl");
  const nanoJobsPath = path.join(jobsDir, "nano.jsonl");
  const localJobsPath = path.join(jobsDir, "local.jsonl");

  await Promise.all([
    writeJsonFile(targetsIndexPath, artifacts.targetsIndex),
    writeJsonLines(openaiJobsPath, artifacts.openaiJobs),
    writeJsonLines(nanoJobsPath, artifacts.nanoJobs),
    writeJsonLines(localJobsPath, artifacts.localJobs),
  ]);

  return {
    manifestPath: source.manifestPath,
    outDir: args.outDir,
    targets: artifacts.targets.length,
    warnings: validation.report.warnings,
    targetsIndexPath,
    openaiJobsPath,
    nanoJobsPath,
    localJobsPath,
  };
}

function readArgValue(argv: string[], name: string): string | undefined {
  const exact = `--${name}`;
  const prefix = `${exact}=`;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length);
    }
    if (arg === exact) {
      return argv[index + 1];
    }
  }

  return undefined;
}
