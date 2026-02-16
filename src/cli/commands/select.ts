import path from "node:path";

import { runSelectPipeline } from "../../pipeline/select.js";

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
