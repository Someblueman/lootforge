import path from "node:path";

import { runReviewPipeline } from "../../pipeline/review.js";

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
