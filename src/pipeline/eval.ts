import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  type ImageAcceptanceItemReport,
  runImageAcceptanceChecks,
} from "../checks/imageAcceptance.js";
import { type PackInvariantSummary } from "../checks/packInvariants.js";
import { getEnabledSoftAdapterStatuses, runEnabledSoftAdapters } from "../checks/softAdapters.js";
import { type SoftAdapterName } from "../checks/softAdapters.js";
import { type PlannedTarget } from "../providers/types.js";
import { writeJsonFile } from "../shared/fs.js";
import { resolveStagePathLayout } from "../shared/paths.js";

interface TargetsIndexShape {
  targets?: PlannedTarget[];
}

interface ProvenanceRun {
  jobs?: {
    targetId: string;
    candidateScores?: {
      outputPath: string;
      score: number;
      passedAcceptance: boolean;
      reasons: string[];
      metrics?: Record<string, number>;
      vlm?: {
        score: number;
        threshold: number;
        maxScore: number;
        passed: boolean;
        reason: string;
        rubric?: string;
        evaluator: "command" | "http";
      };
      selected?: boolean;
    }[];
  }[];
}

type ProvenanceCandidateScore = NonNullable<
  NonNullable<ProvenanceRun["jobs"]>[number]["candidateScores"]
>[number];

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
  candidateVlm?: {
    score: number;
    threshold: number;
    maxScore: number;
    passed: boolean;
    reason: string;
    rubric?: string;
    evaluator: "command" | "http";
  };
  candidateVlmGrades?: {
    outputPath: string;
    selected: boolean;
    score: number;
    threshold: number;
    maxScore: number;
    passed: boolean;
    reason: string;
    rubric?: string;
    evaluator: "command" | "http";
  }[];
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
  adapterHealth: {
    configured: string[];
    active: string[];
    failed: string[];
    adapters: {
      name: string;
      mode: "command" | "http" | "unconfigured";
      configured: boolean;
      active: boolean;
      failed: boolean;
      attemptedTargets: number;
      successfulTargets: number;
      failedTargets: number;
      warningCount: number;
      warnings: string[];
    }[];
  };
  adapterWarnings: string[];
  packInvariants?: PackInvariantSummary;
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
  const adapterStatuses = getEnabledSoftAdapterStatuses();
  const enabledAdapters = adapterStatuses.map((status) => status.name);

  const targets = await loadTargets(targetsIndexPath);
  const acceptance = await runImageAcceptanceChecks({
    targets,
    imagesDir,
    strict,
  });

  const provenance = await readProvenance(path.join(layout.provenanceDir, "run.json"));
  const candidateScoresByTarget = new Map(
    (provenance.jobs ?? []).map((job) => [job.targetId, job.candidateScores ?? []]),
  );

  const reportAdapterWarnings: string[] = [];
  const adapterHealthByName = new Map<
    SoftAdapterName,
    EvalReport["adapterHealth"]["adapters"][number]
  >(
    adapterStatuses.map((status) => [
      status.name,
      {
        name: status.name,
        mode: status.mode,
        configured: status.configured,
        active: false,
        failed: !status.configured,
        attemptedTargets: 0,
        successfulTargets: 0,
        failedTargets: 0,
        warningCount: 0,
        warnings: [],
      },
    ]),
  );
  const targetsById = new Map(targets.map((target) => [target.id, target]));
  const targetResults: EvalTargetResult[] = [];

  for (const item of acceptance.items) {
    const target = targetsById.get(item.targetId);
    if (!target) {
      continue;
    }

    const candidateScores = candidateScoresByTarget.get(item.targetId) ?? [];
    const candidate = candidateScores.find((score) => score.selected) ?? candidateScores[0];
    const candidateVlmGrades = candidateScores
      .filter(
        (
          score,
        ): score is ProvenanceCandidateScore & {
          vlm: NonNullable<ProvenanceCandidateScore["vlm"]>;
        } => Boolean(score.vlm),
      )
      .map((score) => ({
        outputPath: score.outputPath,
        selected: score.selected === true,
        score: score.vlm.score,
        threshold: score.vlm.threshold,
        maxScore: score.vlm.maxScore,
        passed: score.vlm.passed,
        reason: score.vlm.reason,
        rubric: score.vlm.rubric,
        evaluator: score.vlm.evaluator,
      }));
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
        const health = adapterHealthByName.get(adapterName);
        if (health) {
          health.attemptedTargets += 1;
        }
      }

      for (const adapterName of adapterResult.succeededAdapters) {
        const health = adapterHealthByName.get(adapterName);
        if (health) {
          health.active = true;
          health.successfulTargets += 1;
        }
      }

      for (const adapterName of adapterResult.failedAdapters) {
        const health = adapterHealthByName.get(adapterName);
        if (health) {
          health.failed = true;
          health.failedTargets += 1;
        }
      }

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
        const warningAdapter = parseAdapterWarningName(warning);
        if (warningAdapter) {
          const health = adapterHealthByName.get(warningAdapter);
          if (health) {
            health.warningCount += 1;
            health.warnings.push(warning);
          }
        }
      }
    }

    const hardGateErrors = item.issues
      .filter((issue) => issue.level === "error")
      .map((issue) => `${issue.code}: ${issue.message}`);
    const hardGateWarnings = item.issues
      .filter((issue) => issue.level === "warning")
      .map((issue) => `${issue.code}: ${issue.message}`);

    const candidateScore = typeof candidate.score === "number" ? candidate.score : 0;
    const penalty = hardGateErrors.length * 1000;

    targetResults.push({
      targetId: item.targetId,
      out: item.out,
      passedHardGates: hardGateErrors.length === 0,
      hardGateErrors,
      hardGateWarnings,
      acceptanceMetrics: item.metrics,
      candidateScore,
      candidateReasons: candidate.reasons,
      candidateMetrics: candidate.metrics,
      ...(candidate.vlm ? { candidateVlm: candidate.vlm } : {}),
      ...(candidateVlmGrades.length > 0 ? { candidateVlmGrades } : {}),
      adapterMetrics,
      ...(adapterScore !== 0 ? { adapterScore } : {}),
      ...(Object.keys(adapterScoreComponents).length > 0 ? { adapterScoreComponents } : {}),
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
  const adapterHealthEntries = Array.from(adapterHealthByName.values()).sort((left, right) =>
    left.name.localeCompare(right.name),
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
    adapterHealth: {
      configured: adapterHealthEntries
        .filter((adapter) => adapter.configured)
        .map((adapter) => adapter.name),
      active: adapterHealthEntries
        .filter((adapter) => adapter.active)
        .map((adapter) => adapter.name),
      failed: adapterHealthEntries
        .filter((adapter) => adapter.failed)
        .map((adapter) => adapter.name),
      adapters: adapterHealthEntries,
    },
    adapterWarnings: reportAdapterWarnings,
    ...(acceptance.packInvariants ? { packInvariants: acceptance.packInvariants } : {}),
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
  return parsed.targets;
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

function parseAdapterWarningName(warning: string): SoftAdapterName | undefined {
  const prefix = warning.split(":")[0]?.trim().toLowerCase();
  if (prefix === "clip" || prefix === "lpips" || prefix === "ssim") {
    return prefix;
  }
  return undefined;
}
