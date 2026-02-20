import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  parseGenerateCommandArgs,
  runGenerateCommand,
} from "../../src/cli/commands/generate.ts";
import * as generatePipelineModule from "../../src/pipeline/generate.ts";

describe("generate command", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses explicit generate flags and resolves absolute paths", () => {
    const args = parseGenerateCommandArgs([
      "--manifest",
      "assets/imagegen/manifest.json",
      "--out",
      "tmp/out",
      "--index",
      "tmp/jobs/targets-index.json",
      "--provider",
      "nano",
      "--ids",
      "hero, enemy , ui.icon",
      "--lock",
      "tmp/locks/selection-lock.json",
      "--skip-locked",
      "false",
    ]);

    expect(args.manifestPath).toBe(path.resolve("assets/imagegen/manifest.json"));
    expect(args.outDir).toBe(path.resolve("tmp/out"));
    expect(args.targetsIndexPath).toBe(path.resolve("tmp/jobs/targets-index.json"));
    expect(args.provider).toBe("nano");
    expect(args.ids).toEqual(["hero", "enemy", "ui.icon"]);
    expect(args.selectionLockPath).toBe(path.resolve("tmp/locks/selection-lock.json"));
    expect(args.skipLocked).toBe(false);
  });

  it("defaults to cwd outDir and skipLocked=true when flags are omitted", () => {
    const args = parseGenerateCommandArgs([]);
    expect(args.manifestPath).toBeUndefined();
    expect(args.outDir).toBe(path.resolve(process.cwd()));
    expect(args.provider).toBe("auto");
    expect(args.ids).toEqual([]);
    expect(args.selectionLockPath).toBeUndefined();
    expect(args.skipLocked).toBe(true);
  });

  it("accepts common boolean variants for --skip-locked", () => {
    const yesArgs = parseGenerateCommandArgs(["--skip-locked", "yes"]);
    const oneArgs = parseGenerateCommandArgs(["--skip-locked", "1"]);
    const noArgs = parseGenerateCommandArgs(["--skip-locked", "no"]);
    const zeroArgs = parseGenerateCommandArgs(["--skip-locked", "0"]);

    expect(yesArgs.skipLocked).toBe(true);
    expect(oneArgs.skipLocked).toBe(true);
    expect(noArgs.skipLocked).toBe(false);
    expect(zeroArgs.skipLocked).toBe(false);
  });

  it("throws for invalid --skip-locked boolean values", () => {
    expect(() =>
      parseGenerateCommandArgs(["--skip-locked", "not-a-bool"]),
    ).toThrow(/Invalid boolean value/i);
  });

  it("maps runGenerateCommand output and writes progress logs", async () => {
    const writes: string[] = [];
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        writes.push(String(chunk));
        return true;
      });

    const runSpy = vi
      .spyOn(generatePipelineModule, "runGeneratePipeline")
      .mockImplementation(async (options) => {
        options.onProgress?.({ type: "prepare", totalJobs: 1 });
        options.onProgress?.({
          type: "job_start",
          totalJobs: 1,
          jobIndex: 0,
          targetId: "hero",
          provider: "openai",
          model: "gpt-image-1",
        });
        options.onProgress?.({
          type: "job_finish",
          totalJobs: 1,
          jobIndex: 0,
          targetId: "hero",
          outputPath: "/tmp/hero.png",
          bytesWritten: 123,
        });
        options.onProgress?.({
          type: "job_error",
          totalJobs: 1,
          jobIndex: 0,
          targetId: "hero",
          message: "forced-error",
        });

        return {
          runId: "run-1",
          inputHash: "hash",
          targetsIndexPath: "/tmp/index.json",
          imagesDir: "/tmp/images",
          provenancePath: "/tmp/provenance.json",
          jobs: [
            {
              jobId: "job-1",
              provider: "openai",
              model: "gpt-image-1",
              targetId: "hero",
              outputPath: "/tmp/hero.png",
              bytesWritten: 123,
              inputHash: "hash",
              startedAt: new Date().toISOString(),
              finishedAt: new Date().toISOString(),
            },
          ],
          failures: [],
        };
      });

    const result = await runGenerateCommand([
      "--out",
      "tmp/out",
      "--provider",
      "openai",
      "--ids",
      "hero",
      "--skip-locked",
      "true",
    ]);

    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      runId: "run-1",
      jobs: 1,
      imagesDir: "/tmp/images",
      provenancePath: "/tmp/provenance.json",
    });
    expect(writes.some((line) => line.includes("Preparing 1 generation job"))).toBe(true);
    expect(writes.some((line) => line.includes("starting hero via openai"))).toBe(true);
    expect(writes.some((line) => line.includes("finished hero -> /tmp/hero.png"))).toBe(true);
    expect(writes.some((line) => line.includes("failed hero: forced-error"))).toBe(true);
    writeSpy.mockRestore();
  });
});
