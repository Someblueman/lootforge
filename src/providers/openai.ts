import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolvePathWithinRoot } from "../shared/paths.js";
import {
  DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS,
  fetchWithTimeout,
  MAX_DECODED_IMAGE_BYTES,
  normalizeNonNegativeInteger,
  normalizePositiveInteger,
  ProviderRequestTimeoutError,
  toOptionalNonNegativeInteger,
  validateImageUrl,
  withCandidateSuffix,
} from "./runtime.js";
import {
  createProviderJob,
  GenerationProvider,
  nowIso,
  PlannedTarget,
  ProviderCapabilities,
  ProviderCandidateOutput,
  ProviderError,
  ProviderFeature,
  ProviderJob,
  ProviderPrepareContext,
  ProviderRunContext,
  ProviderRunResult,
  PROVIDER_CAPABILITIES,
} from "./types.js";

const OPENAI_IMAGES_ENDPOINT = "https://api.openai.com/v1/images/generations";
const OPENAI_EDITS_ENDPOINT = "https://api.openai.com/v1/images/edits";
export const DEFAULT_OPENAI_MODEL = "gpt-image-1";
const DEFAULT_EDIT_IMAGE_MIME_TYPE = "image/png";

export interface OpenAIProviderOptions {
  model?: string;
  endpoint?: string;
  editsEndpoint?: string;
  timeoutMs?: number;
  maxRetries?: number;
  minDelayMs?: number;
  defaultConcurrency?: number;
}

export class OpenAIProvider implements GenerationProvider {
  readonly name = "openai" as const;
  readonly capabilities: ProviderCapabilities;

  private readonly model: string;
  private readonly endpoint: string;
  private readonly editsEndpoint: string;
  private readonly timeoutMs: number;
  private readonly maxRetries?: number;

  constructor(options: OpenAIProviderOptions = {}) {
    const defaults = PROVIDER_CAPABILITIES.openai;
    this.capabilities = {
      ...defaults,
      defaultConcurrency: normalizePositiveInteger(
        options.defaultConcurrency,
        defaults.defaultConcurrency,
      ),
      minDelayMs: normalizeNonNegativeInteger(
        options.minDelayMs,
        defaults.minDelayMs,
      ),
    };
    this.model = options.model ?? DEFAULT_OPENAI_MODEL;
    this.endpoint = options.endpoint ?? OPENAI_IMAGES_ENDPOINT;
    this.editsEndpoint = options.editsEndpoint ?? OPENAI_EDITS_ENDPOINT;
    this.timeoutMs = normalizePositiveInteger(
      options.timeoutMs,
      DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS,
    );
    this.maxRetries = toOptionalNonNegativeInteger(options.maxRetries);
  }

  prepareJobs(
    targets: PlannedTarget[],
    ctx: ProviderPrepareContext,
  ): ProviderJob[] {
    return targets.map((target) =>
      createProviderJob({
        provider: this.name,
        target,
        model: target.model ?? this.model,
        imagesDir: ctx.imagesDir,
        defaults: {
          maxRetries: this.maxRetries,
        },
      }),
    );
  }

  supports(feature: ProviderFeature): boolean {
    if (feature === "image-generation") return true;
    if (feature === "transparent-background") return true;
    if (feature === "image-edits") return true;
    if (feature === "multi-candidate") return true;
    if (feature === "controlnet") return false;
    return false;
  }

  normalizeError(error: unknown): ProviderError {
    if (error instanceof ProviderError && error.provider === this.name) {
      return error;
    }

    if (error instanceof Error) {
      return new ProviderError({
        provider: this.name,
        code: "openai_request_failed",
        message: error.message,
        cause: error,
        actionable:
          "Check OPENAI_API_KEY and provider/model settings, then retry generation.",
      });
    }

    return new ProviderError({
      provider: this.name,
      code: "openai_request_failed",
      message: "OpenAI provider failed with a non-error throwable.",
      cause: error,
      actionable:
        "Check OPENAI_API_KEY and provider/model settings, then retry generation.",
    });
  }

  async runJob(
    job: ProviderJob,
    ctx: ProviderRunContext,
  ): Promise<ProviderRunResult> {
    const startedAt = nowIso(ctx.now);
    const fetchImpl = ctx.fetchImpl ?? globalThis.fetch;
    const apiKey = process.env.OPENAI_API_KEY?.trim();

    if (!apiKey) {
      throw new ProviderError({
        provider: this.name,
        code: "missing_api_key",
        message: "OPENAI_API_KEY is required for OpenAI image generation.",
        actionable: "Set OPENAI_API_KEY in the environment and rerun generate.",
      });
    }

    if (!fetchImpl) {
      throw new ProviderError({
        provider: this.name,
        code: "missing_fetch",
        message: "Global fetch is unavailable for OpenAI provider.",
        actionable:
          "Use Node.js 18+ or pass a fetch implementation in the run context.",
      });
    }

    try {
      const response = this.shouldUseEdits(job)
        ? await this.runEditRequest(job, ctx, fetchImpl, apiKey)
        : await this.requestWithTimeout(fetchImpl, this.endpoint, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: job.model,
              prompt: job.prompt,
              size: job.size,
              quality: job.quality,
              background: job.background,
              output_format: job.outputFormat,
              n: Math.max(1, job.candidateCount),
            }),
          });

      if (!response.ok) {
        const bodyText = await response.text();
        throw new ProviderError({
          provider: this.name,
          code: "openai_http_error",
          status: response.status,
          message: `OpenAI images request failed with status ${response.status}.`,
          actionable:
            "Confirm OPENAI_API_KEY permissions and model availability for the Images API.",
          cause: bodyText,
        });
      }

      const payload = (await response.json()) as {
        data?: Array<{ b64_json?: string; url?: string }>;
      };

      const images = payload.data ?? [];
      if (images.length === 0) {
        throw new ProviderError({
          provider: this.name,
          code: "openai_missing_image",
          message: "OpenAI returned no image data for this job.",
          actionable:
            "Check prompt/model compatibility and retry with a simpler prompt.",
        });
      }

      const candidateOutputs: ProviderCandidateOutput[] = [];
      const count = Math.max(job.candidateCount, 1);

      for (let index = 0; index < count; index += 1) {
        const image = images[index] ?? images[0];
        const imageBytes = await this.resolveImageBytes(image, fetchImpl);
        const outputPath =
          index === 0
            ? job.outPath
            : withCandidateSuffix(job.outPath, index + 1);
        await mkdir(path.dirname(outputPath), { recursive: true });
        await writeFile(outputPath, imageBytes);
        candidateOutputs.push({
          outputPath,
          bytesWritten: imageBytes.byteLength,
        });
      }

      return {
        jobId: job.id,
        provider: this.name,
        model: job.model,
        targetId: job.targetId,
        outputPath: candidateOutputs[0].outputPath,
        bytesWritten: candidateOutputs[0].bytesWritten,
        inputHash: job.inputHash,
        startedAt,
        finishedAt: nowIso(ctx.now),
        candidateOutputs,
      };
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  private shouldUseEdits(job: ProviderJob): boolean {
    if (job.target.generationMode !== "edit-first") {
      return false;
    }

    return (job.target.edit?.inputs?.length ?? 0) > 0;
  }

  private async runEditRequest(
    job: ProviderJob,
    ctx: ProviderRunContext,
    fetchImpl: typeof fetch,
    apiKey: string,
  ): Promise<Response> {
    const editInputs = job.target.edit?.inputs ?? [];
    const baseAndReferenceInputs = editInputs.filter(
      (input) => input.role !== "mask",
    );
    const maskInputs = editInputs.filter((input) => input.role === "mask");

    if (baseAndReferenceInputs.length === 0) {
      throw new ProviderError({
        provider: this.name,
        code: "openai_edit_missing_base_image",
        message: `Target "${job.targetId}" requested edit-first mode but no base/reference images were provided.`,
        actionable:
          "Add at least one edit input with role base/reference for generationMode=edit-first.",
      });
    }

    const form = new FormData();
    form.set("model", job.model);
    form.set("prompt", this.buildEditPrompt(job));
    form.set("size", job.size);
    form.set("quality", job.quality);
    form.set("background", job.background);
    form.set("output_format", job.outputFormat);
    form.set("n", String(Math.max(1, job.candidateCount)));

    for (const input of baseAndReferenceInputs) {
      const resolvedPath = this.resolveEditInputPath(
        input.path,
        ctx.outDir,
        job.targetId,
      );
      const imageBytes = await this.readEditInputBytes(
        resolvedPath,
        job.targetId,
      );
      const imageData = new Uint8Array(imageBytes);

      if (baseAndReferenceInputs.length === 1) {
        form.append(
          "image",
          new Blob([imageData], { type: this.mimeTypeForPath(resolvedPath) }),
          path.basename(resolvedPath),
        );
      } else {
        form.append(
          "image[]",
          new Blob([imageData], { type: this.mimeTypeForPath(resolvedPath) }),
          path.basename(resolvedPath),
        );
      }
    }

    if (maskInputs.length > 0) {
      const maskPath = this.resolveEditInputPath(
        maskInputs[0].path,
        ctx.outDir,
        job.targetId,
      );
      const maskBytes = await this.readEditInputBytes(maskPath, job.targetId);
      const maskData = new Uint8Array(maskBytes);
      form.append(
        "mask",
        new Blob([maskData], { type: this.mimeTypeForPath(maskPath) }),
        path.basename(maskPath),
      );
    }

    return this.requestWithTimeout(fetchImpl, this.editsEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
    });
  }

  private resolveEditInputPath(
    inputPath: string,
    outDir: string,
    targetId: string,
  ): string {
    try {
      return resolvePathWithinRoot(
        outDir,
        inputPath,
        `edit input path for target "${targetId}"`,
      );
    } catch (error) {
      throw new ProviderError({
        provider: this.name,
        code: "openai_edit_input_unsafe_path",
        message: `Unsafe edit input path "${inputPath}" for target "${targetId}".`,
        actionable: `Edit input paths must stay within the output root (${path.resolve(outDir)}).`,
        cause: error,
      });
    }
  }

  private async readEditInputBytes(
    inputPath: string,
    targetId: string,
  ): Promise<Buffer> {
    try {
      return await readFile(inputPath);
    } catch (error) {
      throw new ProviderError({
        provider: this.name,
        code: "openai_edit_input_unreadable",
        message: `Failed to read edit input "${inputPath}" for target "${targetId}".`,
        actionable:
          "Ensure edit input files exist and paths are correct relative to --out (or absolute).",
        cause: error,
      });
    }
  }

  private buildEditPrompt(job: ProviderJob): string {
    const instruction = job.target.edit?.instruction?.trim();
    const preserveCompositionHint = job.target.edit?.preserveComposition
      ? "Preserve composition and camera framing unless the instruction explicitly changes them."
      : "";

    if (!instruction) {
      return [job.prompt, preserveCompositionHint].filter(Boolean).join("\n\n");
    }

    return [
      instruction,
      preserveCompositionHint,
      "Target style/output requirements:",
      job.prompt,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  private mimeTypeForPath(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
    if (ext === ".webp") return "image/webp";
    if (ext === ".gif") return "image/gif";
    if (ext === ".bmp") return "image/bmp";
    if (ext === ".svg") return "image/svg+xml";
    return DEFAULT_EDIT_IMAGE_MIME_TYPE;
  }

  private async resolveImageBytes(
    imageData: { b64_json?: string; url?: string },
    fetchImpl: typeof fetch,
  ): Promise<Buffer> {
    if (
      typeof imageData.b64_json === "string" &&
      imageData.b64_json.length > 0
    ) {
      const buffer = Buffer.from(imageData.b64_json, "base64");
      if (buffer.byteLength > MAX_DECODED_IMAGE_BYTES) {
        throw new ProviderError({
          provider: this.name,
          code: "openai_image_too_large",
          message: `Decoded image exceeds ${MAX_DECODED_IMAGE_BYTES} byte safety limit.`,
          actionable: "Request smaller images or reduce candidate count.",
        });
      }
      return buffer;
    }

    if (typeof imageData.url === "string" && imageData.url.length > 0) {
      validateImageUrl(imageData.url, "OpenAI image download");
      const imageResponse = await this.requestWithTimeout(
        fetchImpl,
        imageData.url,
      );
      if (!imageResponse.ok) {
        throw new ProviderError({
          provider: this.name,
          code: "openai_image_download_failed",
          status: imageResponse.status,
          message: `OpenAI image download failed with status ${imageResponse.status}.`,
          actionable:
            "Retry generation; if this persists, verify network egress and OpenAI response format.",
        });
      }

      const buffer = Buffer.from(await imageResponse.arrayBuffer());
      if (buffer.byteLength === 0) {
        throw new ProviderError({
          provider: this.name,
          code: "openai_empty_image",
          message: "OpenAI returned an empty image payload.",
          actionable:
            "Retry generation and verify the requested model can output images.",
        });
      }

      if (buffer.byteLength > MAX_DECODED_IMAGE_BYTES) {
        throw new ProviderError({
          provider: this.name,
          code: "openai_image_too_large",
          message: `Decoded image exceeds ${MAX_DECODED_IMAGE_BYTES} byte safety limit.`,
          actionable: "Request smaller images or reduce candidate count.",
        });
      }

      return buffer;
    }

    throw new ProviderError({
      provider: this.name,
      code: "openai_missing_image",
      message: "OpenAI response had neither b64_json nor url image data.",
      actionable:
        "Switch model or prompt format and verify the Images API response schema.",
    });
  }

  private async requestWithTimeout(
    fetchImpl: typeof fetch,
    input: Parameters<typeof fetch>[0],
    init?: RequestInit,
  ): Promise<Response> {
    try {
      return await fetchWithTimeout(fetchImpl, input, init, this.timeoutMs);
    } catch (error) {
      if (error instanceof ProviderRequestTimeoutError) {
        throw new ProviderError({
          provider: this.name,
          code: "openai_request_timeout",
          message: `OpenAI request timed out after ${error.timeoutMs}ms.`,
          actionable:
            "Increase providers.openai.timeoutMs or LOOTFORGE_OPENAI_TIMEOUT_MS and retry.",
          cause: error,
        });
      }
      throw error;
    }
  }
}

export function createOpenAIProvider(
  options: OpenAIProviderOptions = {},
): OpenAIProvider {
  return new OpenAIProvider(options);
}
