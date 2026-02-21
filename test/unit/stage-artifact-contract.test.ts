import { describe, expect, it } from "vitest";

import {
  STAGE_ARTIFACT_CONTRACT_VERSION,
  StageArtifactContractError,
  validateStageArtifact,
} from "../../src/contracts/stageArtifacts.ts";

describe("stage artifact contracts", () => {
  it("exposes a versioned contract id", () => {
    expect(STAGE_ARTIFACT_CONTRACT_VERSION).toBe("0.3.0-stage-contract-v1");
  });

  it("validates selection lock artifacts", () => {
    const result = validateStageArtifact(
      "selection-lock",
      {
        generatedAt: "2026-02-19T00:00:00.000Z",
        evalReportPath: "/tmp/out/checks/eval-report.json",
        provenancePath: "/tmp/out/provenance/run.json",
        targets: [
          {
            targetId: "hero",
            approved: true,
            inputHash: "abc123",
            selectedOutputPath: "/tmp/out/assets/imagegen/raw/hero.png",
            provider: "openai",
            model: "gpt-image-1",
            score: 42,
            evalFinalScore: 18,
            groupSignalTrace: {
              consistencyGroup: "heroes",
              score: 3.2,
              warningThreshold: 1.75,
              penaltyThreshold: 2.5,
              penaltyWeight: 25,
              warned: true,
              penalty: 80,
              reasons: ["clip_outlier"],
              metricDeltas: {
                clipDelta: 0.5,
              },
            },
          },
        ],
      },
      "/tmp/out/locks/selection-lock.json",
    );

    expect(result.targets).toHaveLength(1);
    expect(result.targets[0]?.targetId).toBe("hero");
  });

  it("accepts eval-report artifacts with VLM traceability fields", () => {
    const result = validateStageArtifact(
      "eval-report",
      {
        generatedAt: "2026-02-19T00:00:00.000Z",
        strict: true,
        imagesDir: "/tmp/out/assets/imagegen/processed/images",
        targetCount: 1,
        passed: 1,
        failed: 0,
        hardErrors: 0,
        adaptersUsed: [],
        adapterHealth: {
          configured: [],
          active: [],
          failed: [],
          adapters: [],
        },
        adapterWarnings: [],
        consistencyGroupSummary: [
          {
            consistencyGroup: "heroes",
            targetCount: 3,
            evaluatedTargetCount: 3,
            warningTargetIds: ["hero-c"],
            outlierTargetIds: ["hero-c"],
            warningCount: 1,
            outlierCount: 1,
            maxScore: 3.2,
            totalPenalty: 80,
            metricMedians: {
              clip: 0.91,
              lpips: 0.12,
            },
          },
        ],
        targets: [
          {
            targetId: "hero",
            out: "hero.png",
            consistencyGroup: "heroes",
            passedHardGates: true,
            hardGateErrors: [],
            hardGateWarnings: [],
            candidateScore: 42,
            candidateReasons: [],
            candidateVlm: {
              score: 4.4,
              threshold: 4,
              maxScore: 5,
              passed: true,
              reason: "clear silhouette",
              evaluator: "command",
            },
            candidateVlmGrades: [
              {
                outputPath: "/tmp/out/assets/imagegen/raw/hero-v1.png",
                selected: false,
                score: 3.2,
                threshold: 4,
                maxScore: 5,
                passed: false,
                reason: "framing cutoff",
                evaluator: "command",
              },
              {
                outputPath: "/tmp/out/assets/imagegen/raw/hero-v2.png",
                selected: true,
                score: 4.4,
                threshold: 4,
                maxScore: 5,
                passed: true,
                reason: "clear silhouette",
                evaluator: "command",
              },
            ],
            consistencyGroupOutlier: {
              score: 3.2,
              warningThreshold: 1.75,
              threshold: 2.5,
              penaltyThreshold: 2.5,
              penaltyWeight: 25,
              warned: true,
              penalty: 80,
              reasons: ["clip_outlier"],
              metricDeltas: {
                clipDelta: 0.5,
              },
            },
            finalScore: 42,
          },
        ],
      },
      "/tmp/out/checks/eval-report.json",
    );

    expect(result.targets[0]?.candidateVlm?.passed).toBe(true);
    expect(result.targets[0]?.candidateVlmGrades).toHaveLength(2);
  });

  it("accepts provenance-run artifacts with agentic retry attempt traces", () => {
    const result = validateStageArtifact(
      "provenance-run",
      {
        runId: "run-1",
        inputHash: "hash-1",
        startedAt: "2026-02-21T00:00:00.000Z",
        finishedAt: "2026-02-21T00:00:05.000Z",
        generatedAt: "2026-02-21T00:00:05.000Z",
        jobs: [
          {
            jobId: "job-1",
            provider: "openai",
            model: "gpt-image-1",
            targetId: "hero",
            inputHash: "hash-hero",
            startedAt: "2026-02-21T00:00:00.000Z",
            finishedAt: "2026-02-21T00:00:05.000Z",
            outputPath: "/tmp/out/assets/imagegen/raw/hero.png",
            bytesWritten: 1024,
            candidateScores: [
              {
                outputPath: "/tmp/out/assets/imagegen/raw/hero.png",
                score: 10,
                passedAcceptance: false,
                reasons: ["vlm_gate_below_threshold"],
                stage: "draft",
                selected: false,
              },
              {
                outputPath: "/tmp/out/assets/imagegen/raw/hero.autocorrect-1.png",
                score: 42,
                passedAcceptance: true,
                reasons: [],
                stage: "autocorrect",
                autoCorrectAttempt: 1,
                sourceOutputPath: "/tmp/out/assets/imagegen/raw/hero.png",
                selected: true,
              },
            ],
            agenticRetry: {
              enabled: true,
              maxRetries: 2,
              attempted: 1,
              succeeded: true,
              attempts: [
                {
                  attempt: 1,
                  sourceOutputPath: "/tmp/out/assets/imagegen/raw/hero.png",
                  outputPath: "/tmp/out/assets/imagegen/raw/hero.autocorrect-1.png",
                  critique: "Refine framing and remove edge halo artifacts.",
                  triggeredBy: ["vlm_gate_below_threshold"],
                  scoreBefore: 10,
                  scoreAfter: 42,
                  passedBefore: false,
                  passedAfter: true,
                  reasonsBefore: ["vlm_gate_below_threshold"],
                  reasonsAfter: [],
                },
              ],
            },
          },
        ],
      },
      "/tmp/out/provenance/run.json",
    );

    expect(result.jobs[0]?.agenticRetry?.attempted).toBe(1);
    expect(result.jobs[0]?.candidateScores?.[1]?.stage).toBe("autocorrect");
  });

  it("accepts acceptance-report boundary quality metrics", () => {
    const result = validateStageArtifact(
      "acceptance-report",
      {
        generatedAt: "2026-02-19T00:00:00.000Z",
        imagesDir: "/tmp/out/assets/imagegen/processed/images",
        strict: true,
        total: 1,
        passed: 1,
        failed: 0,
        errors: 0,
        warnings: 0,
        items: [
          {
            targetId: "hero",
            out: "hero.png",
            imagePath: "/tmp/out/assets/imagegen/processed/images/hero.png",
            exists: true,
            width: 64,
            height: 64,
            format: "png",
            sizeBytes: 5120,
            hasAlphaChannel: true,
            hasTransparentPixels: true,
            metrics: {
              alphaBoundaryPixels: 220,
              alphaHaloRisk: 0.02,
              alphaStrayNoise: 0.001,
              alphaEdgeSharpness: 0.94,
            },
            issues: [],
          },
        ],
      },
      "/tmp/out/checks/image-acceptance-report.json",
    );

    expect(result.items[0]?.metrics?.alphaHaloRisk).toBe(0.02);
  });

  it("accepts targets-index artifacts with pixel/smart-crop post-process fields", () => {
    const result = validateStageArtifact(
      "targets-index",
      {
        generatedAt: "2026-02-20T00:00:00.000Z",
        manifestPath: "/tmp/out/assets/imagegen/manifest.json",
        targets: [
          {
            id: "hero",
            kind: "sprite",
            out: "hero.png",
            promptSpec: { primary: "hero sprite" },
            generationPolicy: {
              size: "1024x1024",
              quality: "high",
              background: "transparent",
              outputFormat: "png",
              candidates: 1,
              maxRetries: 1,
              fallbackProviders: [],
            },
            postProcess: {
              resizeTo: { width: 32, height: 32 },
              operations: {
                smartCrop: {
                  enabled: true,
                  mode: "alpha-bounds",
                  padding: 2,
                },
                pixelPerfect: {
                  enabled: true,
                  scale: 2,
                },
                emitVariants: {
                  raw: true,
                  styleRef: true,
                  pixel: true,
                },
              },
            },
          },
        ],
      },
      "/tmp/out/jobs/targets-index.json",
    );

    expect(result.targets[0]?.postProcess?.operations?.emitVariants?.styleRef).toBe(true);
    expect(result.targets[0]?.postProcess?.operations?.smartCrop?.mode).toBe("alpha-bounds");
  });

  it("accepts optional pack invariant summaries in acceptance/eval reports", () => {
    const acceptance = validateStageArtifact(
      "acceptance-report",
      {
        generatedAt: "2026-02-19T00:00:00.000Z",
        imagesDir: "/tmp/out/assets/imagegen/processed/images",
        strict: true,
        total: 1,
        passed: 0,
        failed: 1,
        errors: 1,
        warnings: 0,
        packInvariants: {
          errors: 1,
          warnings: 0,
          issues: [
            {
              level: "error",
              code: "pack_duplicate_runtime_out",
              message: "Runtime output collision.",
              targetIds: ["hero", "hero-alt"],
            },
          ],
          metrics: {
            textureBudgetMBByProfile: {
              "sprite-quality": {
                estimatedMB: 10.2,
                budgetMB: 8,
                targetCount: 2,
              },
            },
          },
        },
        items: [
          {
            targetId: "hero",
            out: "hero.png",
            imagePath: "/tmp/out/assets/imagegen/processed/images/hero.png",
            exists: true,
            metrics: {
              wrapGridTopologyComparisons: 8,
              wrapGridTopologyMismatchRatio: 0.125,
              wrapGridTopologyThreshold: 0.1,
              wrapGridTopologyColorTolerance: 4,
            },
            issues: [
              {
                level: "error",
                code: "pack_duplicate_runtime_out",
                targetId: "hero",
                imagePath: "/tmp/out/assets/imagegen/processed/images/hero.png",
                message: "Runtime output collision.",
              },
            ],
          },
        ],
      },
      "/tmp/out/checks/image-acceptance-report.json",
    );

    const evalReport = validateStageArtifact(
      "eval-report",
      {
        generatedAt: "2026-02-19T00:00:00.000Z",
        strict: false,
        imagesDir: "/tmp/out/assets/imagegen/processed/images",
        targetCount: 1,
        passed: 0,
        failed: 1,
        hardErrors: 1,
        adaptersUsed: [],
        adapterHealth: {
          configured: [],
          active: [],
          failed: [],
          adapters: [],
        },
        adapterWarnings: [],
        packInvariants: {
          errors: 1,
          warnings: 0,
          issues: [
            {
              level: "error",
              code: "pack_texture_budget_exceeded",
              message: "Profile exceeds configured texture budget.",
              targetIds: ["hero"],
              evaluationProfileId: "sprite-quality",
              metrics: {
                estimatedMB: 10.2,
                budgetMB: 8,
              },
            },
          ],
          metrics: {
            spritesheetContinuityByAnimation: {
              "hero.sheet:walk": {
                comparisons: 3,
                maxSilhouetteDrift: 0.12,
                maxAnchorDrift: 0.08,
                maxIdentityDrift: 0.2,
                maxPoseDrift: 0.3,
              },
            },
          },
        },
        targets: [
          {
            targetId: "hero",
            out: "hero.png",
            passedHardGates: false,
            hardGateErrors: ["pack_texture_budget_exceeded: exceeded budget"],
            hardGateWarnings: [],
            finalScore: -958,
          },
        ],
      },
      "/tmp/out/checks/eval-report.json",
    );

    expect(acceptance.packInvariants?.issues[0]?.code).toBe("pack_duplicate_runtime_out");
    expect(evalReport.packInvariants?.issues[0]?.code).toBe("pack_texture_budget_exceeded");
  });

  it("reports file/field diagnostics for contract failures", () => {
    expect(() =>
      validateStageArtifact(
        "selection-lock",
        {
          generatedAt: "2026-02-19T00:00:00.000Z",
          evalReportPath: "/tmp/out/checks/eval-report.json",
          provenancePath: "/tmp/out/provenance/run.json",
          targets: [
            {
              approved: true,
              inputHash: "abc123",
              selectedOutputPath: "/tmp/out/assets/imagegen/raw/hero.png",
            },
          ],
        },
        "/tmp/out/locks/selection-lock.json",
      ),
    ).toThrow(StageArtifactContractError);

    try {
      validateStageArtifact(
        "selection-lock",
        {
          generatedAt: "2026-02-19T00:00:00.000Z",
          evalReportPath: "/tmp/out/checks/eval-report.json",
          provenancePath: "/tmp/out/provenance/run.json",
          targets: [
            {
              approved: true,
              inputHash: "abc123",
              selectedOutputPath: "/tmp/out/assets/imagegen/raw/hero.png",
            },
          ],
        },
        "/tmp/out/locks/selection-lock.json",
      );
    } catch (error) {
      if (!(error instanceof StageArtifactContractError)) {
        throw error;
      }

      expect(error.code).toBe("stage_artifact_contract_invalid");
      expect(error.artifactPath).toBe("/tmp/out/locks/selection-lock.json");
      expect(error.diagnostics.length).toBeGreaterThan(0);
      expect(error.diagnostics[0]?.path).toContain("targets[0].targetId");
      return;
    }

    throw new Error("expected StageArtifactContractError");
  });
});
