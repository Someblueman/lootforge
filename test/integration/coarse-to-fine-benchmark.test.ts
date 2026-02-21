import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, test } from "vitest";

import { summarizeGenerateRunCost } from "../../src/benchmarks/coarseToFineCost.js";
import { runGeneratePipeline } from "../../src/pipeline/generate.js";
import {
  createProviderJob,
  type GenerationProvider,
  type PlannedTarget,
  PROVIDER_CAPABILITIES,
  ProviderError,
  type ProviderFeature,
  type ProviderJob,
  type ProviderPrepareContext,
  type ProviderName,
  type ProviderRunResult,
} from "../../src/providers/types.js";

function createTestProvider(params: {
  name: ProviderName;
  runJob: (job: ProviderJob) => Promise<ProviderRunResult>;
  supports?: (feature: ProviderFeature) => boolean;
}): GenerationProvider {
  const baseCapabilities = PROVIDER_CAPABILITIES[params.name];
  return {
    name: params.name,
    capabilities: {
      ...baseCapabilities,
      minDelayMs: 0,
      defaultConcurrency: 1,
    },
    prepareJobs(targets: PlannedTarget[], ctx: ProviderPrepareContext): ProviderJob[] {
      return targets.map((target) =>
        createProviderJob({
          provider: params.name,
          target,
          model: "gpt-image-1",
          imagesDir: ctx.imagesDir,
        }),
      );
    },
    runJob(job: ProviderJob): Promise<ProviderRunResult> {
      return params.runJob(job);
    },
    supports(feature: ProviderFeature): boolean {
      if (params.supports) {
        return params.supports(feature);
      }
      return true;
    },
    normalizeError(error: unknown): ProviderError {
      if (error instanceof ProviderError) {
        return error;
      }
      return new ProviderError({
        provider: params.name,
        code: "benchmark_stub_error",
        message: error instanceof Error ? error.message : String(error),
      });
    },
  };
}

describe("coarse-to-fine benchmark evidence", () => {
  test("reduces estimated cost per approved target at equivalent acceptance", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "lootforge-c2f-benchmark-"));
    const baselineOut = path.join(root, "baseline");
    const coarseOut = path.join(root, "coarse");

    const opaqueCandidate = await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: { r: 90, g: 50, b: 30, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const transparentCandidate = await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: { r: 90, g: 50, b: 30, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
    const refinedCandidate = await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: { r: 30, g: 170, b: 80, alpha: 0 },
      },
    })
      .png()
      .toBuffer();

    const provider = createTestProvider({
      name: "openai",
      runJob: async (job) => {
        await mkdir(path.dirname(job.outPath), { recursive: true });

        if (job.target.generationMode === "edit-first") {
          await writeFile(job.outPath, refinedCandidate);
          return {
            jobId: job.id,
            provider: "openai",
            model: job.model,
            targetId: job.targetId,
            outputPath: job.outPath,
            bytesWritten: refinedCandidate.byteLength,
            inputHash: job.inputHash,
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
          };
        }

        const base = path.basename(job.outPath, ".png");
        const dir = path.dirname(job.outPath);
        const candidate2 = path.join(dir, `${base}.candidate-2.png`);
        const candidate3 = path.join(dir, `${base}.candidate-3.png`);
        const candidate4 = path.join(dir, `${base}.candidate-4.png`);
        await writeFile(job.outPath, opaqueCandidate);
        await writeFile(candidate2, opaqueCandidate);
        await writeFile(candidate3, transparentCandidate);
        await writeFile(candidate4, opaqueCandidate);
        return {
          jobId: job.id,
          provider: "openai",
          model: job.model,
          targetId: job.targetId,
          outputPath: job.outPath,
          bytesWritten: opaqueCandidate.byteLength,
          inputHash: job.inputHash,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          candidateOutputs: [
            {
              outputPath: job.outPath,
              bytesWritten: opaqueCandidate.byteLength,
            },
            {
              outputPath: candidate2,
              bytesWritten: opaqueCandidate.byteLength,
            },
            {
              outputPath: candidate3,
              bytesWritten: transparentCandidate.byteLength,
            },
            {
              outputPath: candidate4,
              bytesWritten: opaqueCandidate.byteLength,
            },
          ],
        };
      },
    });

    const baselineTarget: PlannedTarget = {
      id: "hero-baseline",
      kind: "sprite",
      out: "hero-baseline.png",
      promptSpec: { primary: "hero baseline benchmark" },
      generationPolicy: {
        outputFormat: "png",
        background: "transparent",
        quality: "high",
        candidates: 4,
      },
      acceptance: {
        size: "64x64",
        alpha: true,
        maxFileSizeKB: 256,
      },
      runtimeSpec: {
        alphaRequired: true,
      },
    };
    const coarseTarget: PlannedTarget = {
      id: "hero-coarse",
      kind: "sprite",
      out: "hero-coarse.png",
      promptSpec: { primary: "hero coarse benchmark" },
      generationPolicy: {
        outputFormat: "png",
        background: "transparent",
        quality: "high",
        draftQuality: "low",
        finalQuality: "high",
        candidates: 4,
        coarseToFine: {
          enabled: true,
          promoteTopK: 1,
          requireDraftAcceptance: true,
        },
      },
      acceptance: {
        size: "64x64",
        alpha: true,
        maxFileSizeKB: 256,
      },
      runtimeSpec: {
        alphaRequired: true,
      },
    };

    await mkdir(path.join(baselineOut, "jobs"), { recursive: true });
    await mkdir(path.join(coarseOut, "jobs"), { recursive: true });
    await writeFile(
      path.join(baselineOut, "jobs", "targets-index.json"),
      `${JSON.stringify({ targets: [baselineTarget] }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      path.join(coarseOut, "jobs", "targets-index.json"),
      `${JSON.stringify({ targets: [coarseTarget] }, null, 2)}\n`,
      "utf8",
    );

    const baselineRun = await runGeneratePipeline({
      outDir: baselineOut,
      provider: "openai",
      skipLocked: false,
      registry: {
        openai: provider,
        nano: provider,
        local: provider,
      },
    });
    const coarseRun = await runGeneratePipeline({
      outDir: coarseOut,
      provider: "openai",
      skipLocked: false,
      registry: {
        openai: provider,
        nano: provider,
        local: provider,
      },
    });

    const baselineSummary = summarizeGenerateRunCost(baselineRun.jobs);
    const coarseSummary = summarizeGenerateRunCost(coarseRun.jobs);

    expect(baselineSummary.approvedTargets).toBe(1);
    expect(coarseSummary.approvedTargets).toBe(1);
    expect(coarseSummary.costPerApprovedTarget).toBeLessThan(baselineSummary.costPerApprovedTarget);
  });
});
