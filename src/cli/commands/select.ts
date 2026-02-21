import path from "node:path";

import { runSelectPipeline } from "../../pipeline/select.js";
import { readArgValue } from "../parseArgs.js";

export interface SelectCommandResult {
  selectionLockPath: string;
  approvedTargets: number;
  totalTargets: number;
}

export async function runSelectCommand(argv: string[]): Promise<SelectCommandResult> {
  const outDir = path.resolve(readArgValue(argv, "out") ?? process.cwd());
  const evalReportPath = readArgValue(argv, "eval");
  const provenancePath = readArgValue(argv, "provenance");
  const lockPath = readArgValue(argv, "lock");

  const result = await runSelectPipeline({
    outDir,
    evalReportPath: evalReportPath ? path.resolve(evalReportPath) : undefined,
    provenancePath: provenancePath ? path.resolve(provenancePath) : undefined,
    selectionLockPath: lockPath ? path.resolve(lockPath) : undefined,
  });

  return {
    selectionLockPath: result.selectionLockPath,
    approvedTargets: result.approvedTargets,
    totalTargets: result.totalTargets,
  };
}
