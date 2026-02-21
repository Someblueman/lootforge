import { describe, expect, it } from "vitest";

import { computeConsistencyGroupOutliers } from "../../src/checks/consistencyOutliers.js";

describe("consistency group outlier scoring", () => {
  it("flags outliers within the same consistency group and emits penalties", () => {
    const result = computeConsistencyGroupOutliers([
      {
        targetId: "hero-a",
        consistencyGroup: "heroes",
        candidateMetrics: {
          "clip.rawScore": 90,
          "lpips.rawScore": 0.1,
        },
      },
      {
        targetId: "hero-b",
        consistencyGroup: "heroes",
        candidateMetrics: {
          "clip.rawScore": 92,
          "lpips.rawScore": 0.12,
        },
      },
      {
        targetId: "hero-c-outlier",
        consistencyGroup: "heroes",
        candidateMetrics: {
          "clip.rawScore": 30,
          "lpips.rawScore": 0.9,
        },
      },
    ]);

    const outlier = result.byTargetId.get("hero-c-outlier");
    expect(outlier).toBeDefined();
    expect(outlier?.warned).toBe(true);
    expect(outlier?.penalty).toBeGreaterThan(0);
    expect(outlier?.reasons.length).toBeGreaterThan(0);
    expect(result.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          consistencyGroup: "heroes",
          warningTargetIds: ["hero-c-outlier"],
          outlierTargetIds: ["hero-c-outlier"],
          warningCount: 1,
          outlierCount: 1,
        }),
      ]),
    );
  });

  it("ignores groups without enough comparable metric signals", () => {
    const result = computeConsistencyGroupOutliers([
      {
        targetId: "solo",
        consistencyGroup: "single",
        candidateMetrics: {
          "clip.rawScore": 95,
        },
      },
      {
        targetId: "missing-metrics",
        consistencyGroup: "single",
      },
    ]);

    expect(result.byTargetId.size).toBe(0);
    expect(result.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          consistencyGroup: "single",
          outlierTargetIds: [],
        }),
      ]),
    );
  });

  it("applies per-target warning threshold and penalty weight overrides", () => {
    const result = computeConsistencyGroupOutliers([
      {
        targetId: "a",
        consistencyGroup: "heroes",
        candidateMetrics: {
          "clip.rawScore": 90,
          "lpips.rawScore": 0.1,
        },
      },
      {
        targetId: "b",
        consistencyGroup: "heroes",
        candidateMetrics: {
          "clip.rawScore": 91,
          "lpips.rawScore": 0.12,
        },
      },
      {
        targetId: "c",
        consistencyGroup: "heroes",
        consistencyGroupScoring: {
          warningThreshold: 1,
          penaltyThreshold: 1,
          penaltyWeight: 2,
        },
        candidateMetrics: {
          "clip.rawScore": 20,
          "lpips.rawScore": 0.8,
        },
      },
    ]);

    const target = result.byTargetId.get("c");
    expect(target).toBeDefined();
    expect(target?.warningThreshold).toBe(1);
    expect(target?.penaltyThreshold).toBe(1);
    expect(target?.penaltyWeight).toBe(2);
    expect(target?.warned).toBe(true);
    expect(target?.penalty).toBe(Math.round((target?.score ?? 0) * 2));
  });
});
