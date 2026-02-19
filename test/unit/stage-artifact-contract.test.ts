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

