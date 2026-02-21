import { access, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, test } from "vitest";

import { runPlanCommand } from "../../src/cli/commands/plan.ts";
import {
  readAndValidateStageArtifact,
  STAGE_ARTIFACT_CONTRACT_VERSION,
} from "../../src/contracts/stageArtifacts.ts";
import { runEvalPipeline } from "../../src/pipeline/eval.ts";
import { runGeneratePipeline } from "../../src/pipeline/generate.ts";
import { runProcessPipeline } from "../../src/pipeline/process.ts";
import { runReviewPipeline } from "../../src/pipeline/review.ts";
import { runSelectPipeline } from "../../src/pipeline/select.ts";
import { type ProviderRegistry } from "../../src/providers/registry.ts";
import {
  createProviderJob,
  type GenerationProvider,
  type PlannedTarget,
  PROVIDER_CAPABILITIES,
  ProviderError,
  type ProviderFeature,
  type ProviderJob,
  type ProviderPrepareContext,
  type ProviderRunResult,
} from "../../src/providers/types.ts";

class ContractStubProvider implements GenerationProvider {
  readonly name = "openai" as const;
  readonly capabilities = {
    ...PROVIDER_CAPABILITIES.openai,
    defaultConcurrency: 1,
    minDelayMs: 0,
  };

  prepareJobs(targets: PlannedTarget[], ctx: ProviderPrepareContext): ProviderJob[] {
    return targets.map((target) =>
      createProviderJob({
        provider: "openai",
        target,
        model: "gpt-image-1",
        imagesDir: ctx.imagesDir,
      }),
    );
  }

  async runJob(job: ProviderJob): Promise<ProviderRunResult> {
    const startedAt = new Date().toISOString();
    await mkdir(path.dirname(job.outPath), { recursive: true });
    await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toFile(job.outPath);
    const finishedAt = new Date().toISOString();

    return {
      jobId: job.id,
      provider: this.name,
      model: job.model,
      targetId: job.targetId,
      outputPath: job.outPath,
      bytesWritten: (await sharp(job.outPath).toBuffer()).byteLength,
      inputHash: job.inputHash,
      startedAt,
      finishedAt,
    };
  }

  supports(_feature: ProviderFeature): boolean {
    return true;
  }

  normalizeError(error: unknown): ProviderError {
    if (error instanceof ProviderError) {
      return error;
    }
    return new ProviderError({
      provider: this.name,
      code: "contract_stub_error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function createRegistry(): ProviderRegistry {
  const provider = new ContractStubProvider();
  return {
    openai: provider,
    nano: provider,
    local: provider,
  };
}

describe("stage artifact contract smoke", () => {
  test("validates stage artifacts for an end-to-end fixture-pack run", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "lootforge-stage-contracts-"));
    const outDir = path.join(root, "work");
    const manifestPath = path.join(outDir, "assets", "imagegen", "manifest.json");
    const rulesPath = path.join(path.dirname(manifestPath), "style", "rules.md");

    await mkdir(path.dirname(manifestPath), { recursive: true });
    await mkdir(path.dirname(rulesPath), { recursive: true });
    await writeFile(rulesPath, "Keep silhouettes clear.\n", "utf8");

    await writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          version: "next",
          pack: {
            id: "contract-pack",
            version: "0.1.0",
          },
          providers: {
            default: "openai",
            openai: { model: "gpt-image-1" },
          },
          styleKits: [
            {
              id: "default-kit",
              rulesPath: "style/rules.md",
              referenceImages: [],
              lightingModel: "flat top-left",
            },
          ],
          consistencyGroups: [
            {
              id: "default-group",
              styleKitId: "default-kit",
              referenceImages: [],
            },
          ],
          evaluationProfiles: [
            {
              id: "default-profile",
              hardGates: {
                requireAlpha: true,
                maxFileSizeKB: 256,
              },
            },
          ],
          targets: [
            {
              id: "hero",
              kind: "sprite",
              out: "hero.png",
              styleKitId: "default-kit",
              consistencyGroup: "default-group",
              evaluationProfileId: "default-profile",
              generationMode: "text",
              prompt: "Top-down hero sprite with clean readability.",
              generationPolicy: {
                size: "64x64",
                outputFormat: "png",
                quality: "high",
                background: "transparent",
                candidates: 1,
                maxRetries: 0,
              },
              postProcess: {
                resizeTo: "64x64",
              },
              acceptance: {
                size: "64x64",
                alpha: true,
                maxFileSizeKB: 256,
              },
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const planResult = await runPlanCommand(["--manifest", manifestPath, "--out", outDir]);
    const generateResult = await runGeneratePipeline({
      outDir,
      provider: "openai",
      skipLocked: false,
      registry: createRegistry(),
    });
    const processResult = await runProcessPipeline({
      outDir,
      strict: true,
      mirrorLegacyImages: false,
    });
    const evalResult = await runEvalPipeline({
      outDir,
      strict: true,
    });
    const reviewResult = await runReviewPipeline({
      outDir,
      evalReportPath: evalResult.reportPath,
    });
    const selectResult = await runSelectPipeline({
      outDir,
      evalReportPath: evalResult.reportPath,
      provenancePath: generateResult.provenancePath,
    });

    await access(reviewResult.reviewHtmlPath);
    expect(STAGE_ARTIFACT_CONTRACT_VERSION).toBe("0.3.0-stage-contract-v1");

    const targetsIndex = await readAndValidateStageArtifact(
      "targets-index",
      planResult.targetsIndexPath,
    );
    const provenance = await readAndValidateStageArtifact(
      "provenance-run",
      generateResult.provenancePath,
    );
    const acceptance = await readAndValidateStageArtifact(
      "acceptance-report",
      processResult.acceptanceReportPath,
    );
    const evalReport = await readAndValidateStageArtifact("eval-report", evalResult.reportPath);
    const selectionLock = await readAndValidateStageArtifact(
      "selection-lock",
      selectResult.selectionLockPath,
    );

    expect(targetsIndex.targets[0]?.id).toBe("hero");
    expect(provenance.jobs[0]?.targetId).toBe("hero");
    expect(acceptance.items[0]?.targetId).toBe("hero");
    expect(evalReport.targets[0]?.targetId).toBe("hero");
    expect(selectionLock.targets[0]?.targetId).toBe("hero");
  });
});
