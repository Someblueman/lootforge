import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { OpenAIProvider } from "../../src/providers/openai.ts";
import { type PlannedTarget, type ProviderJob } from "../../src/providers/types.ts";

function createTarget(overrides: Partial<PlannedTarget> = {}): PlannedTarget {
  return {
    id: "hero",
    out: "hero.png",
    promptSpec: { primary: "hero sprite" },
    generationPolicy: {
      size: "1024x1024",
      quality: "high",
      background: "transparent",
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
    provider: "openai",
    model: "gpt-image-1",
    targetId: target.id,
    targetOut: target.out,
    prompt: "Top-down hero sprite with clear silhouette",
    outPath,
    inputHash: "hash",
    size: "1024x1024",
    quality: "high",
    background: "transparent",
    outputFormat: "png",
    candidateCount: 1,
    maxRetries: 1,
    fallbackProviders: [],
    target,
  };
}

describe("openai provider", () => {
  const previousApiKey = process.env.OPENAI_API_KEY;

  afterEach(() => {
    if (previousApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = previousApiKey;
    }
  });

  it("uses generations endpoint for text mode", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lootforge-openai-text-"));
    const outPath = path.join(tempRoot, "hero.png");
    const provider = new OpenAIProvider({
      endpoint: "https://example.test/generations",
      editsEndpoint: "https://example.test/edits",
    });

    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          data: [{ b64_json: Buffer.from("text-output").toString("base64") }],
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
    expect(calls[0].url).toBe("https://example.test/generations");
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.prompt).toContain("Top-down hero sprite");
  });

  it("uses edits endpoint with multipart payload for edit-first mode", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lootforge-openai-edit-"));
    const outPath = path.join(tempRoot, "hero.png");
    const basePath = path.join(tempRoot, "inputs", "base.png");
    const maskPath = path.join(tempRoot, "inputs", "mask.png");

    await mkdir(path.dirname(basePath), { recursive: true });
    await writeFile(basePath, Buffer.from("base-image"));
    await writeFile(maskPath, Buffer.from("mask-image"));

    const provider = new OpenAIProvider({
      endpoint: "https://example.test/generations",
      editsEndpoint: "https://example.test/edits",
    });

    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          data: [{ b64_json: Buffer.from("edited-output").toString("base64") }],
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
    expect(calls[0].url).toBe("https://example.test/edits");

    const form = calls[0].init?.body;
    expect(form).toBeInstanceOf(FormData);

    const typedForm = form as FormData;
    expect(typedForm.get("model")).toBe("gpt-image-1");
    expect(String(typedForm.get("prompt"))).toContain("Change armor to blue");
    expect(typedForm.get("image")).toBeInstanceOf(File);
    expect(typedForm.get("mask")).toBeInstanceOf(File);

    const outputBytes = await readFile(outPath);
    expect(outputBytes.byteLength).toBeGreaterThan(0);
  });

  it("rejects edit input paths that escape the output root", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lootforge-openai-edit-unsafe-"));
    const outPath = path.join(tempRoot, "hero.png");
    const outsidePath = path.join(path.dirname(tempRoot), "outside.png");
    await writeFile(outsidePath, Buffer.from("outside"));

    const provider = new OpenAIProvider();
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
      code: "openai_edit_input_unsafe_path",
    });
  });

  it("applies provider-level maxRetries when target policy omits it", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lootforge-openai-default-retries-"));
    const provider = new OpenAIProvider({ maxRetries: 4 });
    const target = createTarget({
      generationPolicy: {
        size: "1024x1024",
        quality: "high",
        background: "transparent",
        outputFormat: "png",
        candidates: 1,
        fallbackProviders: [],
      },
    });

    const [job] = provider.prepareJobs([target], {
      outDir: tempRoot,
      imagesDir: tempRoot,
    });

    expect(job.maxRetries).toBe(4);
  });

  it("returns an explicit timeout error when the OpenAI request exceeds timeoutMs", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lootforge-openai-timeout-"));
    const outPath = path.join(tempRoot, "hero.png");
    const provider = new OpenAIProvider({
      endpoint: "https://example.test/generations",
      timeoutMs: 5,
    });

    const fetchImpl: typeof fetch = async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          return;
        }
        signal.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });

    await expect(
      provider.runJob(createJob(createTarget(), outPath), {
        outDir: tempRoot,
        imagesDir: tempRoot,
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      code: "openai_request_timeout",
    });
  });
});
