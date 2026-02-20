import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { NanoProvider } from "../../src/providers/nano.ts";
import type { PlannedTarget, ProviderJob } from "../../src/providers/types.ts";

function createTarget(overrides: Partial<PlannedTarget> = {}): PlannedTarget {
  return {
    id: "hero",
    out: "hero.png",
    promptSpec: { primary: "hero sprite" },
    generationPolicy: {
      size: "1024x1024",
      quality: "high",
      background: "opaque",
      outputFormat: "png",
      candidates: 1,
      maxRetries: 1,
      fallbackProviders: [],
    },
    ...overrides,
  };
}

function createJob(target: PlannedTarget, outPath: string): ProviderJob {
  return {
    id: "job-1",
    provider: "nano",
    model: "gemini-2.5-flash-image",
    targetId: target.id,
    targetOut: target.out,
    prompt: "Top-down hero sprite with clear silhouette",
    outPath,
    inputHash: "hash",
    size: "1024x1024",
    quality: "high",
    background: "opaque",
    outputFormat: "png",
    candidateCount: 1,
    maxRetries: 1,
    fallbackProviders: [],
    target,
  };
}

describe("nano provider", () => {
  const previousApiKey = process.env.GEMINI_API_KEY;

  afterEach(() => {
    if (previousApiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = previousApiKey;
    }
  });

  it("uses generateContent endpoint for text mode", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lootforge-nano-text-"));
    const outPath = path.join(tempRoot, "hero.png");
    const provider = new NanoProvider({
      apiBase: "https://example.test/v1beta/models",
    });

    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: "image/png",
                      data: Buffer.from("nano-text-output").toString("base64"),
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const target = createTarget({
      generationMode: "text",
    });
    const result = await provider.runJob(createJob(target, outPath), {
      outDir: tempRoot,
      imagesDir: tempRoot,
      fetchImpl,
    });

    expect(result.outputPath).toBe(outPath);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "https://example.test/v1beta/models/gemini-2.5-flash-image:generateContent?key=test-key",
    );
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.contents[0].parts[0].text).toContain("Top-down hero sprite");
  });

  it("uses inline edit inputs in edit-first mode when image edits are supported", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lootforge-nano-edit-"));
    const outPath = path.join(tempRoot, "hero.png");
    const basePath = path.join(tempRoot, "inputs", "base.png");
    const maskPath = path.join(tempRoot, "inputs", "mask.png");

    await mkdir(path.dirname(basePath), { recursive: true });
    await writeFile(basePath, Buffer.from("base-image"));
    await writeFile(maskPath, Buffer.from("mask-image"));

    const provider = new NanoProvider({
      apiBase: "https://example.test/v1beta/models",
    });

    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: "image/png",
                      data: Buffer.from("nano-edit-output").toString("base64"),
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const target = createTarget({
      generationMode: "edit-first",
      edit: {
        instruction: "Change armor to blue while preserving character pose.",
        preserveComposition: true,
        inputs: [
          { path: path.relative(tempRoot, basePath), role: "base" },
          { path: path.relative(tempRoot, maskPath), role: "mask" },
        ],
      },
    });

    await provider.runJob(createJob(target, outPath), {
      outDir: tempRoot,
      imagesDir: tempRoot,
      fetchImpl,
    });

    expect(calls).toHaveLength(1);

    const body = JSON.parse(String(calls[0].init?.body)) as {
      contents: Array<{ parts: Array<{ text?: string; inlineData?: { data?: string } }> }>;
    };

    const parts = body.contents[0]?.parts ?? [];
    const inlineParts = parts.filter((part) => typeof part.inlineData?.data === "string");
    const textParts = parts
      .map((part) => part.text)
      .filter((text): text is string => typeof text === "string");

    expect(inlineParts).toHaveLength(2);
    expect(textParts.some((text) => text.includes("Change armor to blue"))).toBe(true);
    expect(textParts.some((text) => text.includes("role=mask"))).toBe(true);

    const outputBytes = await readFile(outPath);
    expect(outputBytes.byteLength).toBeGreaterThan(0);
  });

  it("rejects edit input paths that escape the output root", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lootforge-nano-edit-unsafe-"));
    const outPath = path.join(tempRoot, "hero.png");
    const outsidePath = path.join(path.dirname(tempRoot), "outside.png");
    await writeFile(outsidePath, Buffer.from("outside"));

    const provider = new NanoProvider();
    const target = createTarget({
      generationMode: "edit-first",
      edit: {
        inputs: [{ path: "../outside.png", role: "base" }],
      },
    });

    await expect(
      provider.runJob(createJob(target, outPath), {
        outDir: tempRoot,
        imagesDir: tempRoot,
        fetchImpl: async () => {
          throw new Error("fetch should not be called for unsafe edit paths");
        },
      }),
    ).rejects.toMatchObject({
      code: "nano_edit_input_unsafe_path",
    });
  });

  it("rejects edit-first jobs when the configured model lacks edit support", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lootforge-nano-edit-unsupported-"));
    const outPath = path.join(tempRoot, "hero.png");
    const basePath = path.join(tempRoot, "inputs", "base.png");
    await mkdir(path.dirname(basePath), { recursive: true });
    await writeFile(basePath, Buffer.from("base-image"));

    const provider = new NanoProvider({
      model: "gemini-2.5-flash",
    });
    const target = createTarget({
      generationMode: "edit-first",
      edit: {
        inputs: [{ path: path.relative(tempRoot, basePath), role: "base" }],
      },
    });
    const job = createJob(target, outPath);
    job.model = "gemini-2.5-flash";

    await expect(
      provider.runJob(job, {
        outDir: tempRoot,
        imagesDir: tempRoot,
        fetchImpl: async () => {
          throw new Error("fetch should not be called for unsupported edit model");
        },
      }),
    ).rejects.toMatchObject({
      code: "nano_edit_unsupported_model",
    });
  });

  it("requires at least one base/reference edit input", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lootforge-nano-edit-mask-only-"));
    const outPath = path.join(tempRoot, "hero.png");
    const maskPath = path.join(tempRoot, "inputs", "mask.png");
    await mkdir(path.dirname(maskPath), { recursive: true });
    await writeFile(maskPath, Buffer.from("mask-image"));

    const provider = new NanoProvider();
    const target = createTarget({
      generationMode: "edit-first",
      edit: {
        inputs: [{ path: path.relative(tempRoot, maskPath), role: "mask" }],
      },
    });

    await expect(
      provider.runJob(createJob(target, outPath), {
        outDir: tempRoot,
        imagesDir: tempRoot,
        fetchImpl: async () => {
          throw new Error("fetch should not be called when base/reference is missing");
        },
      }),
    ).rejects.toMatchObject({
      code: "nano_edit_missing_base_image",
    });
  });
});
