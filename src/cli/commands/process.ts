import path from "node:path";

import { runProcessPipeline } from "../../pipeline/process.js";

export interface ProcessCommandArgs {
  outDir: string;
  targetsIndexPath?: string;
  strict: boolean;
}

export interface ProcessCommandResult {
  processedImagesDir: string;
  catalogPath: string;
  acceptanceReportPath: string;
  processedCount: number;
  variantCount: number;
}

export function parseProcessCommandArgs(argv: string[]): ProcessCommandArgs {
  const outFlag = readArgValue(argv, "out");
  const indexFlag = readArgValue(argv, "index");
  const strictFlag = readArgValue(argv, "strict");

  return {
    outDir: path.resolve(outFlag ?? process.cwd()),
    targetsIndexPath: indexFlag ? path.resolve(indexFlag) : undefined,
    strict: parseBooleanArg(strictFlag ?? "true"),
  };
}

export async function runProcessCommand(argv: string[]): Promise<ProcessCommandResult> {
  const args = parseProcessCommandArgs(argv);
  const result = await runProcessPipeline({
    outDir: args.outDir,
    targetsIndexPath: args.targetsIndexPath,
    strict: args.strict,
  });

  return {
    processedImagesDir: result.processedImagesDir,
    catalogPath: result.catalogPath,
    acceptanceReportPath: result.acceptanceReportPath,
    processedCount: result.processedCount,
    variantCount: result.variantCount,
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
  throw new Error(`Invalid boolean value \"${value}\" for --strict. Use true or false.`);
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
