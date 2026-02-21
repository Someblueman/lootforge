import path from "node:path";

import { runProcessPipeline } from "../../pipeline/process.js";
import { readArgValue, parseBooleanArg } from "../parseArgs.js";

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
    strict: parseBooleanArg(strictFlag ?? "true", "--strict"),
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
