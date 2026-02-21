import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runRegenerateCommand } from "../../src/cli/commands/regenerate.js";
import { type ProviderRegistry } from "../../src/providers/registry.js";
import {
  createProviderJob,
  type GenerationProvider,
  type PlannedTarget,
  type ProviderCapabilities,
  ProviderError,
  type ProviderFeature,
  type ProviderJob,
  type ProviderPrepareContext,
  type ProviderRunContext,
  type ProviderRunResult,
  PROVIDER_CAPABILITIES,
} from "../../src/providers/types.js";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5Y6osAAAAASUVORK5CYII=",
  "base64",
);

class RegenerateStubProvider implements GenerationProvider {
  readonly name = "openai" as const;
  readonly capabilities: ProviderCapabilities = {
    ...PROVIDER_CAPABILITIES.openai,
    defaultConcurrency: 1,
    minDelayMs: 0,
  };

  constructor(private readonly observedJobs: ProviderJob[]) {}

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

  async runJob(job: ProviderJob, _ctx: ProviderRunContext): Promise<ProviderRunResult> {
    this.observedJobs.push(job);
    await mkdir(path.dirname(job.outPath), { recursive: true });
    await writeFile(job.outPath, TINY_PNG);

    return {
      jobId: job.id,
      provider: this.name,
      model: job.model,
      targetId: job.targetId,
      outputPath: job.outPath,
      bytesWritten: TINY_PNG.byteLength,
      inputHash: job.inputHash,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
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
      code: "regenerate_stub_error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function createRegistry(observedJobs: ProviderJob[]): ProviderRegistry {
  const provider = new RegenerateStubProvider(observedJobs);
  return {
    openai: provider,
    nano: provider,
    local: provider,
  };
}

describe("regenerate command", () => {
  it("uses lock-approved output as edit base and writes regeneration provenance", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "lootforge-regenerate-"));
    const outDir = path.join(root, "out");
    const targetsIndexPath = path.join(outDir, "jobs", "targets-index.json");
    const lockPath = path.join(outDir, "locks", "selection-lock.json");
    const lockedSourcePath = path.join(outDir, "assets", "imagegen", "raw", "hero.locked.png");

    await mkdir(path.dirname(targetsIndexPath), { recursive: true });
    await mkdir(path.dirname(lockPath), { recursive: true });
    await mkdir(path.dirname(lockedSourcePath), { recursive: true });
    await writeFile(lockedSourcePath, TINY_PNG);

    await writeFile(
      targetsIndexPath,
      `${JSON.stringify(
        {
          targets: [
            {
              id: "hero",
              out: "hero.png",
              promptSpec: { primary: "hero regenerate target" },
              generationMode: "text",
              generationPolicy: {
                outputFormat: "png",
                background: "transparent",
                candidates: 1,
              },
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await writeFile(
      lockPath,
      `${JSON.stringify(
        {
          generatedAt: "2026-02-18T01:00:00.000Z",
          targets: [
            {
              targetId: "hero",
              approved: true,
              inputHash: "lock-input-hash-1",
              selectedOutputPath: lockedSourcePath,
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const observedJobs: ProviderJob[] = [];
    const result = await runRegenerateCommand(
      ["--out", outDir, "--edit", "true", "--provider", "openai"],
      { registry: createRegistry(observedJobs), onProgress: () => {} },
    );

    expect(result.jobs).toBe(1);
    expect(result.targetsRegenerated).toEqual(["hero"]);
    expect(observedJobs).toHaveLength(1);
    expect(observedJobs[0]?.target.generationMode).toBe("edit-first");
    expect(observedJobs[0]?.target.edit?.inputs?.[0]).toEqual({
      path: path.resolve(lockedSourcePath),
      role: "base",
      fidelity: "high",
    });

    const provenance = JSON.parse(await readFile(result.provenancePath, "utf8")) as {
      jobs?: {
        targetId: string;
        generationMode?: string;
        regenerationSource?: {
          mode: string;
          lockSelectedOutputPath: string;
          lockInputHash: string;
        };
      }[];
    };

    const heroJob = provenance.jobs?.find((job) => job.targetId === "hero");
    expect(heroJob?.generationMode).toBe("edit-first");
    expect(heroJob?.regenerationSource?.mode).toBe("selection-lock-edit");
    expect(heroJob?.regenerationSource?.lockInputHash).toBe("lock-input-hash-1");
    expect(heroJob?.regenerationSource?.lockSelectedOutputPath).toBe(
      path.resolve(lockedSourcePath),
    );
  });

  it("rejects selection-lock paths that escape the output root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "lootforge-regenerate-unsafe-lock-"));
    const outDir = path.join(root, "out");
    const targetsIndexPath = path.join(outDir, "jobs", "targets-index.json");
    const lockPath = path.join(outDir, "locks", "selection-lock.json");
    const outsideLockedSourcePath = path.join(root, "outside-lock-source.png");

    await mkdir(path.dirname(targetsIndexPath), { recursive: true });
    await mkdir(path.dirname(lockPath), { recursive: true });
    await writeFile(outsideLockedSourcePath, TINY_PNG);

    await writeFile(
      targetsIndexPath,
      `${JSON.stringify(
        {
          targets: [
            {
              id: "hero",
              out: "hero.png",
              promptSpec: { primary: "hero regenerate target" },
              generationMode: "text",
              generationPolicy: {
                outputFormat: "png",
                background: "transparent",
                candidates: 1,
              },
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await writeFile(
      lockPath,
      `${JSON.stringify(
        {
          generatedAt: "2026-02-18T01:00:00.000Z",
          targets: [
            {
              targetId: "hero",
              approved: true,
              inputHash: "lock-input-hash-1",
              selectedOutputPath: outsideLockedSourcePath,
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await expect(
      runRegenerateCommand(["--out", outDir, "--edit", "true", "--provider", "openai"], {
        registry: createRegistry([]),
        onProgress: () => {},
      }),
    ).rejects.toMatchObject({
      code: "regenerate_unsafe_locked_path",
    });
  });
});
