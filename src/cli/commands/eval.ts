import path from "node:path";

import { runEvalPipeline } from "../../pipeline/eval.js";

export interface EvalCommandResult {
  reportPath: string;
  targetCount: number;
  failed: number;
}

export async function runEvalCommand(argv: string[]): Promise<EvalCommandResult> {
  const outDir = path.resolve(readArgValue(argv, "out") ?? process.cwd());
  const indexPath = readArgValue(argv, "index");
  const imagesDir = readArgValue(argv, "images-dir");
  const reportPath = readArgValue(argv, "report");
  const strict = parseBooleanArg(readArgValue(argv, "strict") ?? "true", "--strict");

  const result = await runEvalPipeline({
    outDir,
    targetsIndexPath: indexPath ? path.resolve(indexPath) : undefined,
    imagesDir: imagesDir ? path.resolve(imagesDir) : undefined,
    reportPath: reportPath ? path.resolve(reportPath) : undefined,
    strict,
  });

  return {
    reportPath: result.reportPath,
    targetCount: result.report.targetCount,
    failed: result.report.failed,
  };
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

function parseBooleanArg(value: string, flagName: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "n"].includes(normalized)) {
    return false;
  }
  throw new Error(`Invalid boolean value "${value}" for ${flagName}. Use true or false.`);
}
