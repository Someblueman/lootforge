import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runReviewPipeline } from "../../src/pipeline/review.js";

describe("review pipeline", () => {
  it("renders score component details from eval output", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lootforge-review-"));
    const outDir = path.join(tempRoot, "work");
    const evalReportPath = path.join(outDir, "checks", "eval-report.json");
    await mkdir(path.dirname(evalReportPath), { recursive: true });

    await writeFile(
      evalReportPath,
      `${JSON.stringify(
        {
          generatedAt: "2026-02-18T00:00:00.000Z",
          packInvariants: {
            errors: 1,
            warnings: 1,
            issues: [
              {
                level: "error",
                code: "pack_duplicate_runtime_out",
                message: "Runtime output collision for normalized path \"dupes/hero.png\".",
                targetIds: ["hero-low", "hero-high"],
              },
              {
                level: "warning",
                code: "pack_texture_budget_profile_mismatch",
                message: "Conflicting texture budget values in profile.",
                targetIds: ["hero-high"],
                evaluationProfileId: "sprite-quality",
              },
            ],
            metrics: {
              textureBudgetMBByProfile: {
                "sprite-quality": {
                  estimatedMB: 12.3,
                  budgetMB: 10,
                  targetCount: 2,
                },
              },
              spritesheetContinuityByAnimation: {
                "hero.sheet:walk": {
                  comparisons: 3,
                  maxSilhouetteDrift: 0.1444,
                  maxAnchorDrift: 0.0912,
                },
              },
            },
          },
          targets: [
            {
              targetId: "hero-low",
              out: "hero-low.png",
              passedHardGates: true,
              finalScore: 10,
              candidateScore: 8,
              candidateReasons: ["low_readability"],
            },
            {
              targetId: "hero-high",
              out: "hero-high.png",
              passedHardGates: true,
              hardGateWarnings: ["near max file size"],
              finalScore: 22.5,
              candidateScore: 12.5,
              candidateReasons: ["good_readability", "stable_histogram"],
              candidateMetrics: {
                readabilityScore: 0.88,
                alphaCoverage: 0.97,
              },
              candidateVlm: {
                score: 4.5,
                threshold: 4,
                maxScore: 5,
                passed: true,
                reason: "readable framing",
                evaluator: "command",
              },
              candidateVlmGrades: [
                {
                  outputPath: "/tmp/candidates/hero-high-v1.png",
                  selected: false,
                  score: 3.1,
                  threshold: 4,
                  maxScore: 5,
                  passed: false,
                  reason: "cropped weapon",
                  evaluator: "command",
                },
                {
                  outputPath: "/tmp/candidates/hero-high-v2.png",
                  selected: true,
                  score: 4.5,
                  threshold: 4,
                  maxScore: 5,
                  passed: true,
                  reason: "readable framing",
                  evaluator: "command",
                },
              ],
              adapterScore: 10,
              adapterScoreComponents: {
                clip: 7,
                lpips: 3,
              },
              adapterMetrics: {
                "clip.rawScore": 3.5,
                "lpips.rawScore": 1.2,
              },
              adapterWarnings: ["ssim: timed out after 1000ms"],
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const result = await runReviewPipeline({ outDir });
    const html = await readFile(result.reviewHtmlPath, "utf8");

    expect(html).toContain("Score Details");
    expect(html).toContain("Pack Invariants");
    expect(html).toContain("Errors: 1");
    expect(html).toContain("pack_duplicate_runtime_out");
    expect(html).toContain("Texture budget sprite-quality");
    expect(html).toContain("Continuity hero.sheet:walk");
    expect(html).toContain("Candidate reasons (2)");
    expect(html).toContain("VLM candidate grades (2)");
    expect(html).toContain("Adapter score components (2)");
    expect(html).toContain("good_readability");
    expect(html).toContain("cropped weapon");
    expect(html).toContain("clip.rawScore");

    const tableBody = html.slice(html.indexOf("<tbody>"));
    const highScoreIndex = tableBody.indexOf("hero-high");
    const lowScoreIndex = tableBody.indexOf("hero-low");
    expect(highScoreIndex).toBeGreaterThanOrEqual(0);
    expect(lowScoreIndex).toBeGreaterThanOrEqual(0);
    expect(highScoreIndex).toBeLessThan(lowScoreIndex);
  });
});
