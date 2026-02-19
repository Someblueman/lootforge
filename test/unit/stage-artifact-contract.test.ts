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
        targets: [
          {
            targetId: "hero",
            out: "hero.png",
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
            finalScore: 42,
          },
        ],
      },
      "/tmp/out/checks/eval-report.json",
    );

    expect(result.targets[0]?.candidateVlm?.passed).toBe(true);
    expect(result.targets[0]?.candidateVlmGrades).toHaveLength(2);
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
