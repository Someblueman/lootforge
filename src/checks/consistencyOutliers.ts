interface OutlierMetricConfig {
  name: "clip" | "lpips";
  keys: string[];
}

const OUTLIER_METRICS: OutlierMetricConfig[] = [
  {
    name: "clip",
    keys: ["clip.rawScore", "clip.alignment"],
  },
  {
    name: "lpips",
    keys: ["lpips.rawScore", "lpips.perceptual_distance"],
  },
];

const DEFAULT_WARNING_THRESHOLD = 1.75;
const DEFAULT_PENALTY_THRESHOLD = 2.5;
const DEFAULT_PENALTY_WEIGHT = 25;
const MIN_SCALE = 1e-6;

export interface ConsistencyOutlierInputTarget {
  targetId: string;
  consistencyGroup?: string;
  candidateMetrics?: Record<string, number>;
  consistencyGroupScoring?: {
    warningThreshold?: number;
    penaltyThreshold?: number;
    penaltyWeight?: number;
  };
}

export interface ConsistencyOutlierTargetScore {
  score: number;
  warningThreshold: number;
  threshold: number;
  penaltyThreshold: number;
  penaltyWeight: number;
  warned: boolean;
  penalty: number;
  reasons: string[];
  metricDeltas: Record<string, number>;
}

export interface ConsistencyOutlierGroupSummary {
  consistencyGroup: string;
  targetCount: number;
  evaluatedTargetCount: number;
  warningTargetIds: string[];
  outlierTargetIds: string[];
  warningCount: number;
  outlierCount: number;
  maxScore: number;
  totalPenalty: number;
  metricMedians: Record<string, number>;
}

export interface ConsistencyOutlierScoring {
  byTargetId: Map<string, ConsistencyOutlierTargetScore>;
  groups: ConsistencyOutlierGroupSummary[];
}

export function computeConsistencyGroupOutliers(
  targets: ConsistencyOutlierInputTarget[],
  options?: {
    warningThreshold?: number;
    penaltyThreshold?: number;
    penaltyWeight?: number;
  },
): ConsistencyOutlierScoring {
  const defaultWarningThreshold = options?.warningThreshold ?? DEFAULT_WARNING_THRESHOLD;
  const defaultPenaltyThreshold = options?.penaltyThreshold ?? DEFAULT_PENALTY_THRESHOLD;
  const defaultPenaltyWeight = options?.penaltyWeight ?? DEFAULT_PENALTY_WEIGHT;
  const byTargetId = new Map<string, ConsistencyOutlierTargetScore>();
  const groups: ConsistencyOutlierGroupSummary[] = [];

  const groupsById = new Map<string, ConsistencyOutlierInputTarget[]>();
  for (const target of targets) {
    if (!target.consistencyGroup) {
      continue;
    }
    const bucket = groupsById.get(target.consistencyGroup);
    if (bucket) {
      bucket.push(target);
    } else {
      groupsById.set(target.consistencyGroup, [target]);
    }
  }

  for (const [consistencyGroup, groupTargets] of Array.from(groupsById.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    if (groupTargets.length < 2) {
      continue;
    }

    const metricSeries = new Map<
      OutlierMetricConfig["name"],
      { byTargetId: Map<string, number>; median: number; scale: number }
    >();

    for (const metric of OUTLIER_METRICS) {
      const byTargetId = new Map<string, number>();
      for (const target of groupTargets) {
        const value = resolveMetricValue(target.candidateMetrics, metric.keys);
        if (typeof value === "number") {
          byTargetId.set(target.targetId, value);
        }
      }
      if (byTargetId.size < 2) {
        continue;
      }

      const values = Array.from(byTargetId.values());
      const median = medianOf(values);
      const deviations = values.map((value) => Math.abs(value - median));
      const mad = medianOf(deviations);
      const scale = Math.max(mad, Math.abs(median) * 0.1, MIN_SCALE);
      metricSeries.set(metric.name, { byTargetId, median, scale });
    }

    const metricMedians: Record<string, number> = {};
    for (const [metricName, series] of metricSeries.entries()) {
      metricMedians[metricName] = series.median;
    }

    const warningTargetIds: string[] = [];
    const outlierTargetIds: string[] = [];
    let maxScore = 0;
    let totalPenalty = 0;
    let evaluatedTargetCount = 0;
    for (const target of groupTargets) {
      const reasons: string[] = [];
      const metricDeltas: Record<string, number> = {};
      let signalCount = 0;
      let normalizedDriftSum = 0;
      const warningThreshold =
        target.consistencyGroupScoring?.warningThreshold ?? defaultWarningThreshold;
      const penaltyThreshold =
        target.consistencyGroupScoring?.penaltyThreshold ?? defaultPenaltyThreshold;
      const penaltyWeight = target.consistencyGroupScoring?.penaltyWeight ?? defaultPenaltyWeight;

      for (const [metricName, series] of metricSeries.entries()) {
        const value = series.byTargetId.get(target.targetId);
        if (typeof value !== "number") {
          continue;
        }
        signalCount += 1;
        const delta = Math.abs(value - series.median);
        const normalizedDrift = delta / series.scale;
        metricDeltas[`${metricName}Delta`] = delta;
        normalizedDriftSum += normalizedDrift;
        if (normalizedDrift >= warningThreshold) {
          reasons.push(
            normalizedDrift >= penaltyThreshold ? `${metricName}_outlier` : `${metricName}_warning`,
          );
        }
      }

      if (signalCount === 0) {
        continue;
      }

      evaluatedTargetCount += 1;
      const score = normalizedDriftSum / signalCount;
      const warned = score >= warningThreshold;
      const penalty = score >= penaltyThreshold ? Math.round(score * penaltyWeight) : 0;
      if (warned) {
        warningTargetIds.push(target.targetId);
      }
      if (penalty > 0) {
        outlierTargetIds.push(target.targetId);
      }
      maxScore = Math.max(maxScore, score);
      totalPenalty += penalty;
      byTargetId.set(target.targetId, {
        score,
        warningThreshold,
        threshold: penaltyThreshold,
        penaltyThreshold,
        penaltyWeight,
        warned,
        penalty,
        reasons,
        metricDeltas,
      });
    }

    groups.push({
      consistencyGroup,
      targetCount: groupTargets.length,
      evaluatedTargetCount,
      warningTargetIds: warningTargetIds.sort((left, right) => left.localeCompare(right)),
      outlierTargetIds: outlierTargetIds.sort((left, right) => left.localeCompare(right)),
      warningCount: warningTargetIds.length,
      outlierCount: outlierTargetIds.length,
      maxScore,
      totalPenalty,
      metricMedians,
    });
  }

  return {
    byTargetId,
    groups,
  };
}

function resolveMetricValue(
  metrics: Record<string, number> | undefined,
  keys: string[],
): number | undefined {
  if (!metrics) {
    return undefined;
  }
  for (const key of keys) {
    const value = metrics[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) {
    return 0;
  }
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}
