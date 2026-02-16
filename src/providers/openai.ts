import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

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
const DEFAULT_OPENAI_MODEL = "gpt-image-1";

export interface OpenAIProviderOptions {
  model?: string;
  endpoint?: string;
  editsEndpoint?: string;
}

export class OpenAIProvider implements GenerationProvider {
  readonly name = "openai" as const;
  readonly capabilities: ProviderCapabilities = PROVIDER_CAPABILITIES.openai;

  private readonly model: string;
  private readonly endpoint: string;
  private readonly editsEndpoint: string;

  constructor(options: OpenAIProviderOptions = {}) {
    this.model = options.model ?? DEFAULT_OPENAI_MODEL;
    this.endpoint = options.endpoint ?? OPENAI_IMAGES_ENDPOINT;
    this.editsEndpoint = options.editsEndpoint ?? OPENAI_EDITS_ENDPOINT;
  }

  prepareJobs(targets: PlannedTarget[], ctx: ProviderPrepareContext): ProviderJob[] {
    return targets.map((target) =>
      createProviderJob({
        provider: this.name,
        target,
        model: target.model ?? this.model,
        imagesDir: ctx.imagesDir,
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

  async runJob(job: ProviderJob, ctx: ProviderRunContext): Promise<ProviderRunResult> {
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
        actionable: "Use Node.js 18+ or pass a fetch implementation in the run context.",
      });
    }

    try {
      const response = await fetchImpl(this.endpoint, {
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
        const outputPath = index === 0 ? job.outPath : withCandidateSuffix(job.outPath, index + 1);
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

  private async resolveImageBytes(
    imageData: { b64_json?: string; url?: string },
    fetchImpl: typeof fetch,
  ): Promise<Buffer> {
    if (typeof imageData.b64_json === "string" && imageData.b64_json.length > 0) {
      return Buffer.from(imageData.b64_json, "base64");
    }

    if (typeof imageData.url === "string" && imageData.url.length > 0) {
      const imageResponse = await fetchImpl(imageData.url);
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
          actionable: "Retry generation and verify the requested model can output images.",
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
}

function withCandidateSuffix(filePath: string, candidateNumber: number): string {
  const ext = path.extname(filePath);
  const base = filePath.slice(0, filePath.length - ext.length);
  return `${base}.candidate-${candidateNumber}${ext}`;
}

export function createOpenAIProvider(
  options: OpenAIProviderOptions = {},
): OpenAIProvider {
  return new OpenAIProvider(options);
}
