import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";
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
  type ProviderName,
  type ProviderRunResult,
} from "../../src/providers/types.js";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5Y6osAAAAASUVORK5CYII=",
  "base64",
);

function createStubProvider(startTimes: number[]): GenerationProvider {
  return createTestProvider({
    name: "openai",
    capabilities: {
      minDelayMs: 0,
      defaultConcurrency: 2,
    },
    runJob: async (job) => {
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
  });
}

function createTestProvider(params: {
  name: ProviderName;
  capabilities?: Partial<Pick<GenerationProvider["capabilities"], "minDelayMs" | "defaultConcurrency">>;
  runJob: (job: ProviderJob) => Promise<ProviderRunResult>;
  supports?: (feature: ProviderFeature) => boolean;
}): GenerationProvider {
  const baseCapabilities = PROVIDER_CAPABILITIES[params.name];
  return {
    name: params.name,
    capabilities: {
      ...baseCapabilities,
      minDelayMs: params.capabilities?.minDelayMs ?? baseCapabilities.minDelayMs,
      defaultConcurrency:
        params.capabilities?.defaultConcurrency ?? baseCapabilities.defaultConcurrency,
    },
    prepareJobs(
      targets: PlannedTarget[],
      ctx: ProviderPrepareContext,
    ): ProviderJob[] {
      return targets.map((target) =>
        createProviderJob({
          provider: params.name,
          target,
          model: defaultModelForProvider(params.name),
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

function defaultModelForProvider(provider: ProviderName): string {
  if (provider === "nano") {
    return "gemini-2.5-flash-image";
  }
  if (provider === "local") {
    return "sdxl-controlnet";
  }
  return "gpt-image-1";
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

  test("falls back to configured providers when the primary provider fails", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "lootforge-generate-fallback-chain-"));
    const outDir = path.join(root, "out");
    const indexPath = path.join(outDir, "jobs", "targets-index.json");
    await mkdir(path.dirname(indexPath), { recursive: true });

    await writeFile(
      indexPath,
      `${JSON.stringify(
        {
          targets: [
            {
              id: "fallback-target",
              out: "fallback-target.png",
              promptSpec: { primary: "fallback target" },
              generationPolicy: {
                outputFormat: "png",
                background: "opaque",
                maxRetries: 0,
                fallbackProviders: ["nano"],
              },
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    let openaiAttempts = 0;
    let nanoAttempts = 0;

    const openaiProvider = createTestProvider({
      name: "openai",
      runJob: async () => {
        openaiAttempts += 1;
        throw new ProviderError({
          provider: "openai",
          code: "forced_failure",
          message: "primary provider failed",
        });
      },
    });
    const nanoProvider = createTestProvider({
      name: "nano",
      runJob: async (job) => {
        nanoAttempts += 1;
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
    });
    const localProvider = createTestProvider({
      name: "local",
      runJob: async (job) => {
        await mkdir(path.dirname(job.outPath), { recursive: true });
        await writeFile(job.outPath, TINY_PNG);
        return {
          jobId: job.id,
          provider: "local",
          model: job.model,
          targetId: job.targetId,
          outputPath: job.outPath,
          bytesWritten: TINY_PNG.byteLength,
          inputHash: job.inputHash,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        };
      },
    });

    const result = await runGeneratePipeline({
      outDir,
      provider: "openai",
      skipLocked: false,
      registry: {
        openai: openaiProvider,
        nano: nanoProvider,
        local: localProvider,
      },
    });

    expect(openaiAttempts).toBe(1);
    expect(nanoAttempts).toBe(1);
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]?.provider).toBe("nano");
  });

  test("copies approved locked output and skips provider execution when input hash matches", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "lootforge-generate-lock-copy-"));
    const outDir = path.join(root, "out");
    const indexPath = path.join(outDir, "jobs", "targets-index.json");
    const lockPath = path.join(outDir, "locks", "selection-lock.json");
    const lockedSourcePath = path.join(outDir, "approved", "hero-locked.png");
    const lockedSourceBytes = Buffer.from("approved-locked-source");
    await mkdir(path.dirname(indexPath), { recursive: true });
    await mkdir(path.dirname(lockPath), { recursive: true });
    await mkdir(path.dirname(lockedSourcePath), { recursive: true });
    await writeFile(lockedSourcePath, lockedSourceBytes);

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
              selectedOutputPath: path.relative(outDir, lockedSourcePath),
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    let runCalls = 0;
    const openaiProvider = createTestProvider({
      name: "openai",
      runJob: async () => {
        runCalls += 1;
        throw new Error("provider should not run when lock skip is active");
      },
    });

    const result = await runGeneratePipeline({
      outDir,
      provider: "openai",
      skipLocked: true,
      selectionLockPath: lockPath,
      registry: {
        openai: openaiProvider,
        nano: openaiProvider,
        local: openaiProvider,
      },
    });

    expect(runCalls).toBe(0);
    expect(result.jobs[0]?.skipped).toBe(true);
    const copiedBytes = await readFile(job.outPath);
    expect(copiedBytes.equals(lockedSourceBytes)).toBe(true);
  });

  test("replaces primary output with best candidate selection when a non-primary candidate wins", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "lootforge-generate-candidate-replace-"));
    const outDir = path.join(root, "out");
    const indexPath = path.join(outDir, "jobs", "targets-index.json");
    await mkdir(path.dirname(indexPath), { recursive: true });

    const target = {
      id: "hero",
      kind: "sprite",
      out: "hero.png",
      promptSpec: { primary: "hero candidate replacement" },
      generationPolicy: {
        outputFormat: "png",
        background: "transparent",
        candidates: 2,
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

    const opaqueCandidate = await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: { r: 180, g: 80, b: 40, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const transparentCandidate = await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: { r: 180, g: 80, b: 40, alpha: 0 },
      },
    })
      .png()
      .toBuffer();

    const openaiProvider = createTestProvider({
      name: "openai",
      runJob: async (job) => {
        const candidateTwoPath = path.join(
          path.dirname(job.outPath),
          `${path.basename(job.outPath, ".png")}.candidate-2.png`,
        );
        await mkdir(path.dirname(job.outPath), { recursive: true });
        await writeFile(job.outPath, opaqueCandidate);
        await writeFile(candidateTwoPath, transparentCandidate);

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
              outputPath: candidateTwoPath,
              bytesWritten: transparentCandidate.byteLength,
            },
          ],
        };
      },
    });

    const result = await runGeneratePipeline({
      outDir,
      provider: "openai",
      skipLocked: false,
      registry: {
        openai: openaiProvider,
        nano: openaiProvider,
        local: openaiProvider,
      },
    });

    const finalBytes = await readFile(result.jobs[0]!.outputPath);
    expect(finalBytes.equals(transparentCandidate)).toBe(true);
    const selectedScore = result.jobs[0]!.candidateScores?.find((entry) => entry.selected);
    expect(selectedScore?.outputPath.endsWith(".candidate-2.png")).toBe(true);
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

    const fallbackProvider = createTestProvider({
      name: "openai",
      runJob: async (job) => {
        await mkdir(path.dirname(job.outPath), { recursive: true });
        await writeFile(job.outPath, TINY_PNG);
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
    });

    await expect(
      runGeneratePipeline({
        outDir,
        provider: "nano",
        skipLocked: false,
        registry: {
          openai: fallbackProvider,
          nano: unsupportedNanoProvider,
          local: fallbackProvider,
        },
      }),
    ).rejects.toThrow(/does not support edit-first generation/i);

    expect(nanoRunCalls).toBe(0);
  });
});
