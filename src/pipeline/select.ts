import { readFile } from "node:fs/promises";
import path from "node:path";

import { writeJsonFile } from "../shared/fs.js";
import { resolveStagePathLayout } from "../shared/paths.js";

interface EvalReportShape {
  targets?: Array<{
    targetId: string;
    passedHardGates: boolean;
    finalScore?: number;
  }>;
}

interface ProvenanceRunShape {
  jobs?: Array<{
    targetId: string;
    provider: string;
    model: string;
    inputHash: string;
    outputPath: string;
    candidateScores?: Array<{
      outputPath: string;
      score: number;
      passedAcceptance?: boolean;
      selected?: boolean;
    }>;
  }>;
}

export interface SelectPipelineOptions {
  outDir: string;
  evalReportPath?: string;
  provenancePath?: string;
  selectionLockPath?: string;
}

export interface SelectionLockTarget {
  targetId: string;
  approved: boolean;
  inputHash: string;
  selectedOutputPath: string;
  provider?: string;
  model?: string;
  score?: number;
}

export interface SelectionLockFile {
  generatedAt: string;
  evalReportPath: string;
  provenancePath: string;
  targets: SelectionLockTarget[];
}

export interface SelectPipelineResult {
  selectionLockPath: string;
  approvedTargets: number;
  totalTargets: number;
}

export async function runSelectPipeline(
  options: SelectPipelineOptions,
): Promise<SelectPipelineResult> {
  const layout = resolveStagePathLayout(options.outDir);
  const evalReportPath = path.resolve(
    options.evalReportPath ?? path.join(layout.checksDir, "eval-report.json"),
  );
  const provenancePath = path.resolve(
    options.provenancePath ?? path.join(layout.provenanceDir, "run.json"),
  );

  const [evalRaw, provenanceRaw] = await Promise.all([
    readFile(evalReportPath, "utf8").catch((error) => {
      throw new Error(
        `Failed to read eval report at ${evalReportPath}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }),
    readFile(provenancePath, "utf8").catch((error) => {
      throw new Error(
        `Failed to read provenance at ${provenancePath}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }),
  ]);

  const evalReport = JSON.parse(evalRaw) as EvalReportShape;
  const provenance = JSON.parse(provenanceRaw) as ProvenanceRunShape;

  const evalByTarget = new Map(
    (evalReport.targets ?? []).map((target) => [target.targetId, target]),
  );

  const targets: SelectionLockTarget[] = [];

  for (const job of provenance.jobs ?? []) {
    const evalTarget = evalByTarget.get(job.targetId);
    if (!evalTarget) {
      continue;
    }

    const selected =
      (job.candidateScores ?? []).find((candidate) => candidate.selected) ??
      [...(job.candidateScores ?? [])].sort((a, b) => {
        const leftPassed = a.passedAcceptance !== false;
        const rightPassed = b.passedAcceptance !== false;
        if (leftPassed !== rightPassed) {
          return leftPassed ? -1 : 1;
        }
        if (a.score !== b.score) {
          return b.score - a.score;
        }
        return a.outputPath.localeCompare(b.outputPath);
      })[0];

    targets.push({
      targetId: job.targetId,
      approved: evalTarget.passedHardGates,
      inputHash: job.inputHash,
      selectedOutputPath: selected?.outputPath ?? job.outputPath,
      provider: job.provider,
      model: job.model,
      score: selected?.score ?? evalTarget.finalScore,
    });
  }

  targets.sort((left, right) => left.targetId.localeCompare(right.targetId));

  const selectionLockPath = path.resolve(
    options.selectionLockPath ??
      path.join(layout.outDir, "locks", "selection-lock.json"),
  );

  const lock: SelectionLockFile = {
    generatedAt: new Date().toISOString(),
    evalReportPath,
    provenancePath,
    targets,
  };

  await writeJsonFile(selectionLockPath, lock);

  return {
    selectionLockPath,
    approvedTargets: targets.filter((target) => target.approved).length,
    totalTargets: targets.length,
  };
}
