import { type CandidateScoreRecord, type ProviderRunResult } from "../providers/types.js";

export interface CandidateStageCostModel {
  full: number;
  draft: number;
  refine: number;
  autocorrect: number;
}

export const DEFAULT_CANDIDATE_STAGE_COST_MODEL: CandidateStageCostModel = {
  full: 3,
  draft: 1,
  refine: 3,
  autocorrect: 3,
};

export interface RunCostSummary {
  targetCount: number;
  approvedTargets: number;
  providerRunCount: number;
  scoredCandidateCount: number;
  totalCostUnits: number;
  costPerApprovedTarget: number;
}

type JobCostInput = Pick<ProviderRunResult, "candidateScores">;

export function summarizeGenerateRunCost(
  jobs: JobCostInput[],
  model: CandidateStageCostModel = DEFAULT_CANDIDATE_STAGE_COST_MODEL,
): RunCostSummary {
  const approvedTargets = countSelectedAcceptedTargets(jobs);
  const scoredCandidateCount = jobs.reduce(
    (count, job) => count + (job.candidateScores?.length ?? 0),
    0,
  );
  const totalCostUnits = jobs.reduce((sum, job) => sum + estimateJobCostUnits(job, model), 0);

  return {
    targetCount: jobs.length,
    approvedTargets,
    providerRunCount: jobs.length,
    scoredCandidateCount,
    totalCostUnits,
    costPerApprovedTarget: approvedTargets > 0 ? totalCostUnits / approvedTargets : Infinity,
  };
}

export function estimateJobCostUnits(
  job: JobCostInput,
  model: CandidateStageCostModel = DEFAULT_CANDIDATE_STAGE_COST_MODEL,
): number {
  const scores = job.candidateScores ?? [];
  if (scores.length === 0) {
    return model.full;
  }

  return scores.reduce((sum, score) => sum + estimateCandidateScoreCostUnits(score, model), 0);
}

export function estimateCandidateScoreCostUnits(
  score: CandidateScoreRecord,
  model: CandidateStageCostModel = DEFAULT_CANDIDATE_STAGE_COST_MODEL,
): number {
  if (score.stage === "draft") {
    return model.draft;
  }
  if (score.stage === "refine") {
    return model.refine;
  }
  if (score.stage === "autocorrect") {
    return model.autocorrect;
  }
  return model.full;
}

function countSelectedAcceptedTargets(jobs: JobCostInput[]): number {
  let approved = 0;
  for (const job of jobs) {
    const selected =
      job.candidateScores?.find((score) => score.selected) ?? job.candidateScores?.[0];
    if (selected?.passedAcceptance) {
      approved += 1;
    }
  }
  return approved;
}
