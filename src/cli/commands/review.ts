import path from "node:path";

import { runReviewPipeline } from "../../pipeline/review.js";
import { readArgValue } from "../parseArgs.js";

export interface ReviewCommandResult {
  reviewHtmlPath: string;
  targetCount: number;
}

export async function runReviewCommand(argv: string[]): Promise<ReviewCommandResult> {
  const outDir = path.resolve(readArgValue(argv, "out") ?? process.cwd());
  const evalReportPath = readArgValue(argv, "eval");
  const htmlPath = readArgValue(argv, "html");

  const result = await runReviewPipeline({
    outDir,
    evalReportPath: evalReportPath ? path.resolve(evalReportPath) : undefined,
    reviewHtmlPath: htmlPath ? path.resolve(htmlPath) : undefined,
  });

  return {
    reviewHtmlPath: result.reviewHtmlPath,
    targetCount: result.targetCount,
  };
}
