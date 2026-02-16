import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  ImageAcceptanceItemReport,
  runImageAcceptanceChecks,
} from "../checks/imageAcceptance.js";
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

interface SoftMetricAdapter {
  name: string;
  isAvailable(): boolean;
  score(params: {
    target: PlannedTarget;
    imagePath: string;
  }): Promise<Record<string, number>>;
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

  const adapters = getSoftMetricAdapters().filter((adapter) => adapter.isAvailable());

  const targetsById = new Map(targets.map((target) => [target.id, target]));
  const targetResults: EvalTargetResult[] = [];

  for (const item of acceptance.items) {
    const target = targetsById.get(item.targetId);
    if (!target) {
      continue;
    }

    const candidate = candidateScoresByTarget.get(item.targetId);
    const adapterMetrics: Record<string, number> = {};

    for (const adapter of adapters) {
      const metrics = await adapter.score({
        target,
        imagePath: item.imagePath,
      });
      for (const [name, value] of Object.entries(metrics)) {
        adapterMetrics[`${adapter.name}.${name}`] = value;
      }
    }

    const hardGateErrors = item.issues
      .filter((issue) => issue.level === "error")
      .map((issue) => `${issue.code}: ${issue.message}`);
    const hardGateWarnings = item.issues
      .filter((issue) => issue.level === "warning")
      .map((issue) => `${issue.code}: ${issue.message}`);

    const adapterBonus = Object.values(adapterMetrics).reduce((sum, value) => sum + value, 0);
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
      finalScore: candidateScore + adapterBonus - penalty,
    });
  }

  targetResults.sort((left, right) => left.targetId.localeCompare(right.targetId));

  const failed = targetResults.filter((target) => !target.passedHardGates).length;
  const hardErrors = targetResults.reduce((count, target) => count + target.hardGateErrors.length, 0);

  const report: EvalReport = {
    generatedAt: new Date().toISOString(),
    strict,
    imagesDir,
    targetCount: targetResults.length,
    passed: targetResults.length - failed,
    failed,
    hardErrors,
    adaptersUsed: adapters.map((adapter) => adapter.name),
    targets: targetResults,
  };

  const reportPath = path.resolve(options.reportPath ?? path.join(layout.checksDir, "eval-report.json"));
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

function getSoftMetricAdapters(): SoftMetricAdapter[] {
  return [
    {
      name: "clip",
      isAvailable: () => process.env.LOOTFORGE_ENABLE_CLIP_ADAPTER === "1",
      score: async () => ({
        // Placeholder until external adapter wiring is configured.
        alignment: 0,
      }),
    },
    {
      name: "lpips",
      isAvailable: () => process.env.LOOTFORGE_ENABLE_LPIPS_ADAPTER === "1",
      score: async () => ({
        perceptual_distance: 0,
      }),
    },
    {
      name: "ssim",
      isAvailable: () => process.env.LOOTFORGE_ENABLE_SSIM_ADAPTER === "1",
      score: async () => ({
        structural_similarity: 0,
      }),
    },
  ];
}
