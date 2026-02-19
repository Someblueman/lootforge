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

  test("rejects skip-locked source paths that resolve outside the output root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "lootforge-generate-lock-safety-"));
    const outDir = path.join(root, "out");
    const indexPath = path.join(outDir, "jobs", "targets-index.json");
    const lockPath = path.join(outDir, "locks", "selection-lock.json");
    const outsideLockedPath = path.join(root, "outside-approved.png");
    await mkdir(path.dirname(indexPath), { recursive: true });
    await mkdir(path.dirname(lockPath), { recursive: true });
    await writeFile(outsideLockedPath, TINY_PNG);

    const target = {
      id: "hero",
      out: "hero.png",
      promptSpec: { primary: "hero" },
      generationPolicy: {
        outputFormat: "png",
        background: "transparent",
      },
    };

    await writeFile(
      indexPath,
      `${JSON.stringify(
        {
          targets: [target],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const job = createProviderJob({
      provider: "openai",
      target,
      model: "gpt-image-1",
      imagesDir: path.join(outDir, "assets", "imagegen", "raw"),
    });

    await writeFile(
      lockPath,
      `${JSON.stringify(
        {
          targets: [
            {
              targetId: "hero",
              approved: true,
              inputHash: job.inputHash,
              selectedOutputPath: outsideLockedPath,
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
        skipLocked: true,
        selectionLockPath: lockPath,
        registry: createStubRegistry([]),
      }),
    ).rejects.toThrow(/must stay within --out/i);
  });

  test("fails fast when selected provider does not support edit-first generation", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "lootforge-generate-edit-capability-"));
    const outDir = path.join(root, "out");
    const indexPath = path.join(outDir, "jobs", "targets-index.json");
    await mkdir(path.dirname(indexPath), { recursive: true });

    const target: PlannedTarget = {
      id: "hero-edit",
      out: "hero-edit.png",
      generationMode: "edit-first",
      edit: {
        inputs: [{ path: "inputs/base.png", role: "base" }],
      },
      promptSpec: { primary: "hero edit" },
      generationPolicy: {
        outputFormat: "png",
        background: "transparent",
      },
    };

    await writeFile(
      indexPath,
      `${JSON.stringify({ targets: [target] }, null, 2)}\n`,
      "utf8",
    );

    let nanoRunCalls = 0;
    const unsupportedNanoProvider: GenerationProvider = {
      name: "nano",
      capabilities: {
        ...PROVIDER_CAPABILITIES.nano,
        supportsEdits: false,
      },
      prepareJobs(targets, ctx) {
        return targets.map((entry) =>
          createProviderJob({
            provider: "nano",
            target: entry,
            model: "gemini-2.5-flash-image",
            imagesDir: ctx.imagesDir,
          }),
        );
      },
      async runJob(job) {
        nanoRunCalls += 1;
        await mkdir(path.dirname(job.outPath), { recursive: true });
        await writeFile(job.outPath, TINY_PNG);
        return {
          jobId: job.id,
          provider: "nano",
          model: job.model,
          targetId: job.targetId,
          outputPath: job.outPath,
          bytesWritten: TINY_PNG.byteLength,
          inputHash: job.inputHash,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        };
      },
      supports(feature) {
        if (feature === "image-edits") {
          return false;
        }
        return true;
      },
      normalizeError(error) {
        if (error instanceof ProviderError) {
          return error;
        }
        return new ProviderError({
          provider: "nano",
          code: "nano_stub_error",
          message: error instanceof Error ? error.message : String(error),
        });
      },
    };

    const genericProvider: GenerationProvider = {
      ...createStubProvider([]),
      name: "openai",
      capabilities: PROVIDER_CAPABILITIES.openai,
    };

    await expect(
      runGeneratePipeline({
        outDir,
        provider: "nano",
        skipLocked: false,
        registry: {
          openai: genericProvider,
          nano: unsupportedNanoProvider,
          local: genericProvider,
        },
      }),
    ).rejects.toThrow(/does not support edit-first generation/i);

    expect(nanoRunCalls).toBe(0);
  });
});
