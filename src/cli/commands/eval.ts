import path from "node:path";

import { runEvalPipeline } from "../../pipeline/eval.js";
import { readArgValue, parseBooleanArg } from "../parseArgs.js";

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
