import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

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
} from "./types.js";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_NANO_MODEL = "gemini-2.5-flash-image";

export interface NanoProviderOptions {
  model?: string;
  apiBase?: string;
  timeoutMs?: number;
  maxRetries?: number;
  minDelayMs?: number;
  defaultConcurrency?: number;
}

interface GeminiInlineData {
  data?: string;
  mimeType?: string;
}

export class NanoProvider implements GenerationProvider {
  readonly name = "nano" as const;
  readonly capabilities: ProviderCapabilities;

  private readonly model: string;
  private readonly apiBase: string;
  private readonly timeoutMs: number;
  private readonly maxRetries?: number;

  constructor(options: NanoProviderOptions = {}) {
    const defaults = PROVIDER_CAPABILITIES.nano;
    this.capabilities = {
      ...defaults,
      defaultConcurrency: normalizePositiveInteger(
        options.defaultConcurrency,
        defaults.defaultConcurrency,
      ),
      minDelayMs: normalizeNonNegativeInteger(options.minDelayMs, defaults.minDelayMs),
    };
    this.model = options.model ?? DEFAULT_NANO_MODEL;
    this.apiBase = options.apiBase ?? GEMINI_API_BASE;
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
    if (feature === "transparent-background") return false;
    if (feature === "image-edits") return false;
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
        code: "nano_request_failed",
        message: error.message,
        cause: error,
        actionable:
          "Check GEMINI_API_KEY, selected model, and request payload compatibility.",
      });
    }

    return new ProviderError({
      provider: this.name,
      code: "nano_request_failed",
      message: "Nano provider failed with a non-error throwable.",
      cause: error,
      actionable:
        "Check GEMINI_API_KEY, selected model, and request payload compatibility.",
    });
  }

  async runJob(job: ProviderJob, ctx: ProviderRunContext): Promise<ProviderRunResult> {
    const startedAt = nowIso(ctx.now);
    const fetchImpl = ctx.fetchImpl ?? globalThis.fetch;
    const apiKey = process.env.GEMINI_API_KEY?.trim();

    if (!apiKey) {
      throw new ProviderError({
        provider: this.name,
        code: "missing_api_key",
        message: "GEMINI_API_KEY is required for Nano provider generation.",
        actionable: "Set GEMINI_API_KEY in the environment and rerun generate.",
      });
    }

    if (!fetchImpl) {
      throw new ProviderError({
        provider: this.name,
        code: "missing_fetch",
        message: "Global fetch is unavailable for Nano provider.",
        actionable: "Use Node.js 18+ or pass a fetch implementation in the run context.",
      });
    }

    const endpoint =
      `${this.apiBase}/${encodeURIComponent(job.model)}:generateContent` +
      `?key=${encodeURIComponent(apiKey)}`;

    try {
      const candidateOutputs: ProviderCandidateOutput[] = [];
      const count = Math.max(job.candidateCount, 1);
      for (let index = 0; index < count; index += 1) {
        const response = await this.requestWithTimeout(fetchImpl, endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text: [
                      job.prompt,
                      "",
                      "Output requirements:",
                      `- image size: ${job.size}`,
                      `- image format: ${job.outputFormat}`,
                      `- background: ${job.background}`,
                    ].join("\n"),
                  },
                ],
              },
            ],
            generationConfig: {
              responseModalities: ["TEXT", "IMAGE"],
            },
          }),
        });

        if (!response.ok) {
          const bodyText = await response.text();
          throw new ProviderError({
            provider: this.name,
            code: "nano_http_error",
            status: response.status,
            message: `Nano provider request failed with status ${response.status}.`,
            actionable:
              "Confirm GEMINI_API_KEY access and that the chosen model supports image output.",
            cause: bodyText,
          });
        }

        const payload = (await response.json()) as {
          candidates?: Array<{
            content?: {
              parts?: Array<{
                inlineData?: GeminiInlineData;
              }>;
            };
          }>;
        };

        const inlineData = this.findInlineImage(payload);
        if (!inlineData?.data) {
          throw new ProviderError({
            provider: this.name,
            code: "nano_missing_image",
            message:
              "Nano provider response did not include image data. The selected Gemini model may not support image generation for this request.",
            actionable:
              "Use an image-capable Gemini model and ensure generationConfig.responseModalities includes IMAGE.",
          });
        }

        const imageBytes = Buffer.from(inlineData.data, "base64");
        if (imageBytes.byteLength === 0) {
          throw new ProviderError({
            provider: this.name,
            code: "nano_empty_image",
            message: "Nano provider returned empty image bytes.",
            actionable:
              "Retry with a simpler prompt and verify the model returns inlineData image payloads.",
          });
        }

        const outputPath = index === 0 ? job.outPath : withCandidateSuffix(job.outPath, index + 1);
        await mkdir(path.dirname(outputPath), { recursive: true });
        await writeFile(outputPath, imageBytes);
        candidateOutputs.push({ outputPath, bytesWritten: imageBytes.byteLength });
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

  private findInlineImage(payload: {
    candidates?: Array<{
      content?: { parts?: Array<{ inlineData?: GeminiInlineData }> };
    }>;
  }): GeminiInlineData | undefined {
    for (const candidate of payload.candidates ?? []) {
      for (const part of candidate.content?.parts ?? []) {
        if (part.inlineData?.data) {
          return part.inlineData;
        }
      }
    }

    return undefined;
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
          code: "nano_request_timeout",
          message: `Nano provider request timed out after ${error.timeoutMs}ms.`,
          actionable:
            "Increase providers.nano.timeoutMs or LOOTFORGE_NANO_TIMEOUT_MS and retry.",
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

export function createNanoProvider(options: NanoProviderOptions = {}): NanoProvider {
  return new NanoProvider(options);
}
