import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  ImageAcceptanceItemReport,
  runImageAcceptanceChecks,
} from "../checks/imageAcceptance.js";
import {
  getEnabledSoftAdapterNames,
  runEnabledSoftAdapters,
} from "../checks/softAdapters.js";
import type { SoftAdapterName } from "../checks/softAdapters.js";
import type { PlannedTarget } from "../providers/types.js";
import { writeJsonFile } from "../shared/fs.js";
import { resolveStagePathLayout } from "../shared/paths.js";

interface TargetsIndexShape {
  targets?: PlannedTarget[];
}

interface ProvenanceRun {
  jobs?: Array<{
    targetId: string;
    candidateScores?: Array<{
      outputPath: string;
      score: number;
      passedAcceptance: boolean;
      reasons: string[];
      metrics?: Record<string, number>;
      selected?: boolean;
    }>;
  }>;
}

export interface EvalPipelineOptions {
  outDir: string;
  targetsIndexPath?: string;
  imagesDir?: string;
  strict?: boolean;
  reportPath?: string;
}

export interface EvalTargetResult {
  targetId: string;
  out: string;
  passedHardGates: boolean;
  hardGateErrors: string[];
  hardGateWarnings: string[];
  acceptanceMetrics?: ImageAcceptanceItemReport["metrics"];
  candidateScore?: number;
  candidateReasons?: string[];
  candidateMetrics?: Record<string, number>;
  adapterMetrics?: Record<string, number>;
  adapterScore?: number;
  adapterScoreComponents?: Record<string, number>;
  adapterWarnings?: string[];
  finalScore: number;
}

export interface EvalReport {
  generatedAt: string;
  strict: boolean;
  imagesDir: string;
  targetCount: number;
  passed: number;
  failed: number;
  hardErrors: number;
  adaptersUsed: string[];
  adapterWarnings: string[];
  targets: EvalTargetResult[];
}

export interface EvalPipelineResult {
  reportPath: string;
  report: EvalReport;
}

export async function runEvalPipeline(options: EvalPipelineOptions): Promise<EvalPipelineResult> {
  const layout = resolveStagePathLayout(options.outDir);
  const targetsIndexPath = path.resolve(
    options.targetsIndexPath ?? path.join(layout.jobsDir, "targets-index.json"),
  );
  const imagesDir = path.resolve(options.imagesDir ?? layout.processedImagesDir);
  const strict = options.strict ?? true;
  const enabledAdapters = getEnabledSoftAdapterNames();

  const targets = await loadTargets(targetsIndexPath);
  const acceptance = await runImageAcceptanceChecks({
    targets,
    imagesDir,
    strict,
  });

  const provenance = await readProvenance(path.join(layout.provenanceDir, "run.json"));
  const candidateScoresByTarget = new Map(
    (provenance.jobs ?? []).map((job) => [
      job.targetId,
      (job.candidateScores ?? []).find((score) => score.selected) ?? job.candidateScores?.[0],
    ]),
  );

  const reportAdapterWarnings: string[] = [];
  const targetsById = new Map(targets.map((target) => [target.id, target]));
  const targetResults: EvalTargetResult[] = [];

  for (const item of acceptance.items) {
    const target = targetsById.get(item.targetId);
    if (!target) {
      continue;
    }

    const candidate = candidateScoresByTarget.get(item.targetId);
    const adapterMetrics: Record<string, number> = {};
    const adapterScoreComponents: Record<string, number> = {};
    const adapterWarnings: string[] = [];
    let adapterScore = 0;

    if (enabledAdapters.length > 0) {
      const adapterResult = await runEnabledSoftAdapters({
        target,
        imagePath: item.imagePath,
        outDir: layout.outDir,
      });

      for (const adapterName of adapterResult.adapterNames) {
        const metricsForAdapter = adapterResult.adapterMetrics[adapterName] ?? {};
        for (const [metricName, metricValue] of Object.entries(metricsForAdapter)) {
          adapterMetrics[`${adapterName}.${metricName}`] = metricValue;
        }

        const rawScore = adapterResult.adapterScores[adapterName];
        if (typeof rawScore === "number" && Number.isFinite(rawScore)) {
          const weightedScore = Math.round(rawScore * resolveAdapterWeight(target, adapterName));
          adapterScore += weightedScore;
          adapterScoreComponents[adapterName] = weightedScore;
          adapterMetrics[`${adapterName}.rawScore`] = rawScore;
        }
      }

      for (const warning of adapterResult.warnings) {
        const scopedWarning = `${item.targetId}: ${warning}`;
        adapterWarnings.push(warning);
        reportAdapterWarnings.push(scopedWarning);
      }
    }

    const hardGateErrors = item.issues
      .filter((issue) => issue.level === "error")
      .map((issue) => `${issue.code}: ${issue.message}`);
    const hardGateWarnings = item.issues
      .filter((issue) => issue.level === "warning")
      .map((issue) => `${issue.code}: ${issue.message}`);

    const candidateScore = typeof candidate?.score === "number" ? candidate.score : 0;
    const penalty = hardGateErrors.length * 1000;

    targetResults.push({
      targetId: item.targetId,
      out: item.out,
      passedHardGates: hardGateErrors.length === 0,
      hardGateErrors,
      hardGateWarnings,
      acceptanceMetrics: item.metrics,
      candidateScore,
      candidateReasons: candidate?.reasons,
      candidateMetrics: candidate?.metrics,
      adapterMetrics,
      ...(adapterScore !== 0 ? { adapterScore } : {}),
      ...(Object.keys(adapterScoreComponents).length > 0
        ? { adapterScoreComponents }
        : {}),
      ...(adapterWarnings.length > 0 ? { adapterWarnings } : {}),
      finalScore: candidateScore + adapterScore - penalty,
    });
  }

  targetResults.sort((left, right) => left.targetId.localeCompare(right.targetId));

  const failed = targetResults.filter((target) => !target.passedHardGates).length;
  const hardErrors = targetResults.reduce(
    (count, target) => count + target.hardGateErrors.length,
    0,
  );

  const report: EvalReport = {
    generatedAt: new Date().toISOString(),
    strict,
    imagesDir,
    targetCount: targetResults.length,
    passed: targetResults.length - failed,
    failed,
    hardErrors,
    adaptersUsed: enabledAdapters,
    adapterWarnings: reportAdapterWarnings,
    targets: targetResults,
  };

  const reportPath = path.resolve(
    options.reportPath ?? path.join(layout.checksDir, "eval-report.json"),
  );
  await writeJsonFile(reportPath, report);

  if (strict && hardErrors > 0) {
    throw new Error(`Evaluation failed with ${hardErrors} hard error(s).`);
  }

  return {
    reportPath,
    report,
  };
}

async function loadTargets(targetsIndexPath: string): Promise<PlannedTarget[]> {
  const raw = await readFile(targetsIndexPath, "utf8");
  const parsed = JSON.parse(raw) as TargetsIndexShape;
  if (!Array.isArray(parsed.targets)) {
    return [];
  }
  return parsed.targets.filter((target) => !target.catalogDisabled);
}

async function readProvenance(runPath: string): Promise<ProvenanceRun> {
  try {
    const raw = await readFile(runPath, "utf8");
    return JSON.parse(raw) as ProvenanceRun;
  } catch {
    return {};
  }
}

function resolveAdapterWeight(target: PlannedTarget, adapter: SoftAdapterName): number {
  const weights = target.scoreWeights;
  if (adapter === "clip") {
    return normalizeWeight(weights?.clip);
  }
  if (adapter === "lpips") {
    return normalizeWeight(weights?.lpips);
  }
  return normalizeWeight(weights?.ssim);
}

function normalizeWeight(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 1;
  }
  if (value < 0) {
    return 0;
  }
  return value;
}
