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
    expect(html).toContain("Candidate reasons (2)");
    expect(html).toContain("Adapter score components (2)");
    expect(html).toContain("good_readability");
    expect(html).toContain("clip.rawScore");

    const highScoreIndex = html.indexOf("hero-high");
    const lowScoreIndex = html.indexOf("hero-low");
    expect(highScoreIndex).toBeGreaterThanOrEqual(0);
    expect(lowScoreIndex).toBeGreaterThanOrEqual(0);
    expect(highScoreIndex).toBeLessThan(lowScoreIndex);
  });
});
