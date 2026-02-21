import path from "node:path";

import {
  type GenerateProgressEvent,
  parseGenerateProviderFlag,
  runGeneratePipeline,
} from "../../pipeline/generate.js";
import { type ProviderSelection } from "../../providers/types.js";

export interface GenerateCommandArgs {
  manifestPath?: string;
  outDir: string;
  targetsIndexPath?: string;
  provider: ProviderSelection;
  ids: string[];
  selectionLockPath?: string;
  skipLocked: boolean;
}

export interface GenerateCommandResult {
  runId: string;
  jobs: number;
  imagesDir: string;
  provenancePath: string;
}

export function parseGenerateCommandArgs(argv: string[]): GenerateCommandArgs {
  const outFlag = readArgValue(argv, "out");
  const manifestFlag = readArgValue(argv, "manifest");
  const indexFlag = readArgValue(argv, "index");
  const providerFlag = readArgValue(argv, "provider");
  const idsFlag = readArgValue(argv, "ids");
  const lockFlag = readArgValue(argv, "lock");
  const skipLockedFlag = readArgValue(argv, "skip-locked");
  const manifestPath = manifestFlag ? path.resolve(manifestFlag) : undefined;
  const defaultOutDir = manifestPath ? path.dirname(manifestPath) : process.cwd();

  return {
    manifestPath,
    outDir: path.resolve(outFlag ?? defaultOutDir),
    targetsIndexPath: indexFlag ? path.resolve(indexFlag) : undefined,
    provider: parseGenerateProviderFlag(providerFlag),
    selectionLockPath: lockFlag ? path.resolve(lockFlag) : undefined,
    skipLocked: parseBooleanArg(skipLockedFlag ?? "true"),
    ids: idsFlag
      ? idsFlag
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : [],
  };
}

export async function runGenerateCommand(argv: string[]): Promise<GenerateCommandResult> {
  const args = parseGenerateCommandArgs(argv);
  const pipelineResult = await runGeneratePipeline({
    outDir: args.outDir,
    targetsIndexPath: args.targetsIndexPath,
    provider: args.provider,
    ids: args.ids,
    selectionLockPath: args.selectionLockPath,
    skipLocked: args.skipLocked,
    onProgress: writeGenerateProgressLog,
  });

  return {
    runId: pipelineResult.runId,
    jobs: pipelineResult.jobs.length,
    imagesDir: pipelineResult.imagesDir,
    provenancePath: pipelineResult.provenancePath,
  };
}

function writeGenerateProgressLog(event: GenerateProgressEvent): void {
  if (event.type === "prepare") {
    process.stdout.write(`Preparing ${event.totalJobs} generation job(s)...\n`);
    return;
  }

  const printableIndex = typeof event.jobIndex === "number" ? event.jobIndex + 1 : undefined;
  const total = event.totalJobs;
  const slot = typeof printableIndex === "number" ? `[${printableIndex}/${total}] ` : "";
  const target = event.targetId ?? "unknown-target";

  if (event.type === "job_start") {
    process.stdout.write(
      `${slot}starting ${target} via ${event.provider ?? "provider"} (${event.model ?? "model"})\n`,
    );
    return;
  }

  if (event.type === "job_finish") {
    process.stdout.write(
      `${slot}finished ${target} -> ${event.outputPath ?? "unknown-output"} (${event.bytesWritten ?? 0} bytes)\n`,
    );
    return;
  }

  process.stdout.write(`${slot}failed ${target}: ${event.message ?? "unknown error"}\n`);
}

function readArgValue(argv: string[], name: string): string | undefined {
  const exact = `--${name}`;
  const prefix = `--${name}=`;

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

function parseBooleanArg(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "n"].includes(normalized)) {
    return false;
  }
  throw new Error(`Invalid boolean value "${value}" for --skip-locked. Use true or false.`);
}
