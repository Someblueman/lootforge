import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolvePathWithinRoot } from "../shared/paths.js";
import {
  DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS,
  fetchWithTimeout,
  normalizeNonNegativeInteger,
  normalizePositiveInteger,
  ProviderRequestTimeoutError,
  toOptionalNonNegativeInteger,
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
  TargetEditInput,
} from "./types.js";

export const DEFAULT_LOCAL_MODEL = "sdxl-controlnet";
const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:8188";

export interface LocalDiffusionProviderOptions {
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  minDelayMs?: number;
  defaultConcurrency?: number;
}

interface LocalImageResponse {
  images?: Array<{
    b64_json?: string;
    url?: string;
  }>;
}

export class LocalDiffusionProvider implements GenerationProvider {
  readonly name = "local" as const;
  readonly capabilities: ProviderCapabilities;

  private readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries?: number;

  constructor(options: LocalDiffusionProviderOptions = {}) {
    const defaults = PROVIDER_CAPABILITIES.local;
    this.capabilities = {
      ...defaults,
      defaultConcurrency: normalizePositiveInteger(
        options.defaultConcurrency,
        defaults.defaultConcurrency,
      ),
      minDelayMs: normalizeNonNegativeInteger(options.minDelayMs, defaults.minDelayMs),
    };
    this.model = options.model ?? DEFAULT_LOCAL_MODEL;
    this.baseUrl = options.baseUrl ?? process.env.LOCAL_DIFFUSION_BASE_URL ?? DEFAULT_LOCAL_BASE_URL;
    this.timeoutMs = normalizePositiveInteger(
      options.timeoutMs,
      DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS,
    );
    this.maxRetries = toOptionalNonNegativeInteger(options.maxRetries);
  }

  prepareJobs(targets: PlannedTarget[], ctx: ProviderPrepareContext): ProviderJob[] {
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
    if (feature === "controlnet") return true;
    return false;
  }

  normalizeError(error: unknown): ProviderError {
    if (error instanceof ProviderError && error.provider === this.name) {
      return error;
    }

    if (error instanceof Error) {
      return new ProviderError({
        provider: this.name,
        code: "local_diffusion_failed",
        message: error.message,
        cause: error,
        actionable:
          "Check LOCAL_DIFFUSION_BASE_URL and service health, then retry generation.",
      });
    }

    return new ProviderError({
      provider: this.name,
      code: "local_diffusion_failed",
      message: "Local diffusion provider failed with a non-error throwable.",
      cause: error,
      actionable: "Check local diffusion service health and request payload compatibility.",
    });
  }

  async runJob(job: ProviderJob, ctx: ProviderRunContext): Promise<ProviderRunResult> {
    const startedAt = nowIso(ctx.now);
    const fetchImpl = ctx.fetchImpl ?? globalThis.fetch;

    if (!fetchImpl) {
      throw new ProviderError({
        provider: this.name,
        code: "missing_fetch",
        message: "Global fetch is unavailable for Local Diffusion provider.",
        actionable: "Use Node.js 18+ or pass a fetch implementation in the run context.",
      });
    }

    try {
      const response = await this.requestWithTimeout(
        fetchImpl,
        `${this.baseUrl.replace(/\/$/, "")}/generate`,
        {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: job.model,
          prompt: job.prompt,
          size: job.size,
          quality: job.quality,
          background: job.background,
          output_format: job.outputFormat,
          candidates: job.candidateCount,
          control: this.toControlPayload(job.target.edit?.inputs, ctx.outDir, job.targetId),
        }),
      },
      );

      if (!response.ok) {
        throw new ProviderError({
          provider: this.name,
          code: "local_diffusion_http_error",
          status: response.status,
          message: `Local diffusion request failed with status ${response.status}.`,
          actionable: "Check local diffusion API compatibility and service logs.",
          cause: await response.text(),
        });
      }

      const payload = (await response.json()) as LocalImageResponse;
      const images = payload.images ?? [];
      if (images.length === 0) {
        throw new ProviderError({
          provider: this.name,
          code: "local_diffusion_missing_image",
          message: "Local diffusion response did not include generated images.",
        });
      }

      const outputs: ProviderCandidateOutput[] = [];
      for (let index = 0; index < Math.max(job.candidateCount, 1); index += 1) {
        const image = images[index] ?? images[0];
        const bytes = await this.resolveImageBytes(image, fetchImpl);
        const outputPath = index === 0 ? job.outPath : withCandidateSuffix(job.outPath, index + 1);
        await mkdir(path.dirname(outputPath), { recursive: true });
        await writeFile(outputPath, bytes);
        outputs.push({ outputPath, bytesWritten: bytes.byteLength });
      }

      return {
        jobId: job.id,
        provider: this.name,
        model: job.model,
        targetId: job.targetId,
        outputPath: outputs[0].outputPath,
        bytesWritten: outputs[0].bytesWritten,
        inputHash: job.inputHash,
        startedAt,
        finishedAt: nowIso(ctx.now),
        candidateOutputs: outputs,
      };
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  private toControlPayload(
    inputs: TargetEditInput[] | undefined,
    outDir: string,
    targetId: string,
  ) {
    if (!inputs || inputs.length === 0) {
      return undefined;
    }

    return inputs.map((input) => ({
      path: this.resolveControlInputPath(input.path, outDir, targetId),
      role: input.role ?? "reference",
      fidelity: input.fidelity ?? "medium",
    }));
  }

  private resolveControlInputPath(
    inputPath: string,
    outDir: string,
    targetId: string,
  ): string {
    try {
      return resolvePathWithinRoot(
        outDir,
        inputPath,
        `local control input path for target "${targetId}"`,
      );
    } catch (error) {
      throw new ProviderError({
        provider: this.name,
        code: "local_diffusion_unsafe_control_path",
        message: `Unsafe local control input path "${inputPath}" for target "${targetId}".`,
        actionable: `Control input paths must stay within the output root (${path.resolve(outDir)}).`,
        cause: error,
      });
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
      const imageResponse = await this.requestWithTimeout(fetchImpl, imageData.url);
      if (!imageResponse.ok) {
        throw new ProviderError({
          provider: this.name,
          code: "local_diffusion_image_download_failed",
          status: imageResponse.status,
          message: `Local diffusion image download failed with status ${imageResponse.status}.`,
        });
      }
      return Buffer.from(await imageResponse.arrayBuffer());
    }

    throw new ProviderError({
      provider: this.name,
      code: "local_diffusion_missing_image",
      message: "Local diffusion image payload contained neither b64_json nor url fields.",
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
          code: "local_diffusion_request_timeout",
          message: `Local diffusion request timed out after ${error.timeoutMs}ms.`,
          actionable:
            "Increase providers.local.timeoutMs or LOOTFORGE_LOCAL_TIMEOUT_MS and retry.",
          cause: error,
        });
      }
      throw error;
    }
  }
}

function withCandidateSuffix(filePath: string, candidateNumber: number): string {
  const ext = path.extname(filePath);
  const base = filePath.slice(0, filePath.length - ext.length);
  return `${base}.candidate-${candidateNumber}${ext}`;
}

export function createLocalDiffusionProvider(
  options: LocalDiffusionProviderOptions = {},
): LocalDiffusionProvider {
  return new LocalDiffusionProvider(options);
}
