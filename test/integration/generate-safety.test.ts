import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { type ProviderRegistry } from "../../src/providers/registry.js";
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
  type ProviderRunResult,
} from "../../src/providers/types.js";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5Y6osAAAAASUVORK5CYII=",
  "base64",
);

function createStubProvider(startTimes: number[]): GenerationProvider {
  return {
    name: "openai",
    capabilities: {
      ...PROVIDER_CAPABILITIES.openai,
      minDelayMs: 0,
      defaultConcurrency: 2,
    },
    prepareJobs(
      targets: PlannedTarget[],
      ctx: ProviderPrepareContext,
    ): ProviderJob[] {
      return targets.map((target) =>
        createProviderJob({
          provider: "openai",
          target,
          model: "gpt-image-1",
          imagesDir: ctx.imagesDir,
        }),
      );
    },
    async runJob(job: ProviderJob): Promise<ProviderRunResult> {
      startTimes.push(Date.now());
      await mkdir(path.dirname(job.outPath), { recursive: true });
      await writeFile(job.outPath, TINY_PNG);
      await new Promise((resolve) => setTimeout(resolve, 5));
      return {
        jobId: job.id,
        provider: "openai",
        model: job.model,
        targetId: job.targetId,
        outputPath: job.outPath,
        bytesWritten: TINY_PNG.byteLength,
        inputHash: job.inputHash,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      };
    },
    supports(_feature: ProviderFeature): boolean {
      return true;
    },
    normalizeError(error: unknown): ProviderError {
      if (error instanceof ProviderError) {
        return error;
      }
      return new ProviderError({
        provider: "openai",
        code: "stub_error",
        message: error instanceof Error ? error.message : String(error),
      });
    },
  };
}

function createStubRegistry(startTimes: number[]): ProviderRegistry {
  const provider = createStubProvider(startTimes);
  return {
    openai: provider,
    nano: provider,
    local: provider,
  };
}

describe("generate pipeline safety", () => {
  test("applies provider delay spacing consistently under concurrency", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "lootforge-generate-rate-limit-"));
    const outDir = path.join(root, "out");
    const indexPath = path.join(outDir, "jobs", "targets-index.json");
    await mkdir(path.dirname(indexPath), { recursive: true });

    await writeFile(
      indexPath,
      `${JSON.stringify(
        {
          targets: ["a", "b", "c"].map((id) => ({
            id,
            out: `${id}.png`,
            promptSpec: { primary: id },
            generationPolicy: {
              outputFormat: "png",
              background: "transparent",
              rateLimitPerMinute: 240,
            },
          })),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const startTimes: number[] = [];
    await runGeneratePipeline({
      outDir,
      provider: "openai",
      skipLocked: false,
      registry: createStubRegistry(startTimes),
    });

    expect(startTimes.length).toBe(3);
    const orderedStarts = [...startTimes].sort((left, right) => left - right);
    const deltas = orderedStarts
      .slice(1)
      .map((time, index) => time - orderedStarts[index]!);
    expect(Math.min(...deltas)).toBeGreaterThanOrEqual(180);
  });

  test("rejects unsafe out paths from planned index before running providers", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "lootforge-generate-out-safety-"));
    const outDir = path.join(root, "out");
    const indexPath = path.join(outDir, "jobs", "targets-index.json");
    await mkdir(path.dirname(indexPath), { recursive: true });

    await writeFile(
      indexPath,
      `${JSON.stringify(
        {
          targets: [
            {
              id: "unsafe",
              out: "../../../../escape.png",
              promptSpec: { primary: "unsafe" },
              generationPolicy: { outputFormat: "png" },
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await expect(
      runGeneratePipeline({
        outDir,
        provider: "openai",
        skipLocked: false,
        registry: createStubRegistry([]),
      }),
    ).rejects.toThrow(/out is invalid/i);
  });
});
