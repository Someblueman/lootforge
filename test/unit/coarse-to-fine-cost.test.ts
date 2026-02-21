import { describe, expect, it } from "vitest";

import {
  estimateCandidateScoreCostUnits,
  estimateJobCostUnits,
  summarizeGenerateRunCost,
} from "../../src/benchmarks/coarseToFineCost.js";

describe("coarse-to-fine cost benchmark model", () => {
  it("applies stage-weighted units and selected-acceptance approval counting", () => {
    const baseline = summarizeGenerateRunCost([
      {
        candidateScores: [
          { outputPath: "a.png", score: 10, passedAcceptance: false, reasons: [] },
          { outputPath: "b.png", score: 20, passedAcceptance: true, reasons: [], selected: true },
          { outputPath: "c.png", score: 5, passedAcceptance: false, reasons: [] },
          { outputPath: "d.png", score: 1, passedAcceptance: false, reasons: [] },
        ],
      },
    ]);

    const coarse = summarizeGenerateRunCost([
      {
        candidateScores: [
          {
            outputPath: "a.png",
            score: -1,
            passedAcceptance: false,
            reasons: [],
            stage: "draft",
          },
          {
            outputPath: "b.png",
            score: 2,
            passedAcceptance: true,
            reasons: [],
            stage: "draft",
          },
          {
            outputPath: "c.png",
            score: 3,
            passedAcceptance: false,
            reasons: [],
            stage: "draft",
          },
          {
            outputPath: "d.png",
            score: 2,
            passedAcceptance: false,
            reasons: [],
            stage: "draft",
          },
          {
            outputPath: "d.refine-1.png",
            score: 30,
            passedAcceptance: true,
            reasons: [],
            stage: "refine",
            selected: true,
          },
        ],
      },
    ]);

    expect(baseline.approvedTargets).toBe(1);
    expect(coarse.approvedTargets).toBe(1);
    expect(coarse.totalCostUnits).toBeLessThan(baseline.totalCostUnits);
    expect(coarse.costPerApprovedTarget).toBeLessThan(baseline.costPerApprovedTarget);
  });

  it("falls back to full-stage cost when no candidate scores exist", () => {
    expect(estimateJobCostUnits({})).toBe(3);
    expect(
      estimateCandidateScoreCostUnits({
        outputPath: "x.png",
        score: 1,
        passedAcceptance: true,
        reasons: [],
      }),
    ).toBe(3);
  });
});
