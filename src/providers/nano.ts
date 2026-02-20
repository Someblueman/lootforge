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
  TargetEditInput,
} from "./types.js";

const GEMINI_API_BASE =
  "https://generativelanguage.googleapis.com/v1beta/models";
export const DEFAULT_NANO_MODEL = "gemini-2.5-flash-image";
const DEFAULT_EDIT_IMAGE_MIME_TYPE = "image/png";

export interface NanoProviderOptions {
  model?: string;
  apiBase?: string;
  supportsEdits?: boolean;
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
    const model = options.model ?? DEFAULT_NANO_MODEL;
    const supportsEdits =
      typeof options.supportsEdits === "boolean"
        ? options.supportsEdits
        : supportsNanoImageEdits(model);
    this.capabilities = {
      ...defaults,
      supportsEdits,
      defaultConcurrency: normalizePositiveInteger(
        options.defaultConcurrency,
        defaults.defaultConcurrency,
      ),
      minDelayMs: normalizeNonNegativeInteger(
        options.minDelayMs,
        defaults.minDelayMs,
      ),
    };
    this.model = model;
    this.apiBase = options.apiBase ?? GEMINI_API_BASE;
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
    if (feature === "transparent-background") return false;
    if (feature === "image-edits") return this.capabilities.supportsEdits;
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

  async runJob(
    job: ProviderJob,
    ctx: ProviderRunContext,
  ): Promise<ProviderRunResult> {
    const startedAt = nowIso(ctx.now);
    const fetchImpl = ctx.fetchImpl ?? globalThis.fetch;
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    const useEdits = this.shouldUseEdits(job);

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
        actionable:
          "Use Node.js 18+ or pass a fetch implementation in the run context.",
      });
    }

    if (useEdits && !this.capabilities.supportsEdits) {
      throw new ProviderError({
        provider: this.name,
        code: "nano_edit_unsupported_model",
        message: `Nano provider model "${job.model}" does not advertise edit-first image support.`,
        actionable:
          "Use an image-edit-capable Gemini image model (for example gemini-2.5-flash-image) or switch providers for edit-first targets.",
      });
    }

    const endpoint =
      `${this.apiBase}/${encodeURIComponent(job.model)}:generateContent` +
      `?key=${encodeURIComponent(apiKey)}`;

    try {
      const requestPayload = useEdits
        ? await this.buildEditRequestPayload(job, ctx)
        : this.buildTextRequestPayload(job);
      const candidateOutputs: ProviderCandidateOutput[] = [];
      const count = Math.max(job.candidateCount, 1);
      for (let index = 0; index < count; index += 1) {
        const response = await this.requestWithTimeout(fetchImpl, endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestPayload),
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

        if (imageBytes.byteLength > MAX_DECODED_IMAGE_BYTES) {
          throw new ProviderError({
            provider: this.name,
            code: "nano_image_too_large",
            message: `Decoded image exceeds ${MAX_DECODED_IMAGE_BYTES} byte safety limit.`,
            actionable: "Request smaller images or adjust model settings.",
          });
        }

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

  private buildTextRequestPayload(job: ProviderJob): {
    contents: Array<{ role: "user"; parts: Array<{ text: string }> }>;
    generationConfig: { responseModalities: ["TEXT", "IMAGE"] };
  } {
    return {
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
    };
  }

  private async buildEditRequestPayload(
    job: ProviderJob,
    ctx: ProviderRunContext,
  ): Promise<{
    contents: Array<{
      role: "user";
      parts: Array<
        { text: string } | { inlineData: { mimeType: string; data: string } }
      >;
    }>;
    generationConfig: { responseModalities: ["TEXT", "IMAGE"] };
  }> {
    const editInputs = job.target.edit?.inputs ?? [];
    const baseAndReferenceInputs = editInputs.filter(
      (input) => input.role !== "mask",
    );

    if (baseAndReferenceInputs.length === 0) {
      throw new ProviderError({
        provider: this.name,
        code: "nano_edit_missing_base_image",
        message: `Target "${job.targetId}" requested edit-first mode but no base/reference inputs were provided.`,
        actionable:
          "Add at least one edit input with role base/reference for generationMode=edit-first.",
      });
    }

    const parts: Array<
      { text: string } | { inlineData: { mimeType: string; data: string } }
    > = [{ text: this.buildEditPrompt(job, editInputs) }];

    for (const [index, input] of editInputs.entries()) {
      const resolvedPath = this.resolveEditInputPath(
        input.path,
        ctx.outDir,
        job.targetId,
      );
      const imageBytes = await this.readEditInputBytes(
        resolvedPath,
        job.targetId,
      );
      parts.push({
        text: this.describeEditInput(index + 1, input),
      });
      parts.push({
        inlineData: {
          mimeType: this.mimeTypeForPath(resolvedPath),
          data: imageBytes.toString("base64"),
        },
      });
    }

    return {
      contents: [
        {
          role: "user",
          parts,
        },
      ],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
      },
    };
  }

  private buildEditPrompt(job: ProviderJob, inputs: TargetEditInput[]): string {
    const instruction = job.target.edit?.instruction?.trim();
    const preserveCompositionHint = job.target.edit?.preserveComposition
      ? "Preserve composition and camera framing unless the instruction explicitly changes them."
      : "";
    const hasMask = inputs.some((input) => input.role === "mask");
    const maskHint = hasMask
      ? "If a mask input is provided, treat white/opaque regions as editable and preserve dark/transparent regions."
      : "";

    if (!instruction) {
      return [
        "Use the supplied edit input images to modify the asset.",
        preserveCompositionHint,
        maskHint,
        "Target style/output requirements:",
        job.prompt,
      ]
        .filter(Boolean)
        .join("\n\n");
    }

    return [
      instruction,
      preserveCompositionHint,
      maskHint,
      "Target style/output requirements:",
      job.prompt,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  private describeEditInput(index: number, input: TargetEditInput): string {
    const role = input.role ?? "reference";
    const fidelity = input.fidelity ?? "medium";
    if (role === "mask") {
      return `Input ${index}: role=mask, fidelity=${fidelity}. Use this as the edit mask guide.`;
    }
    if (role === "base") {
      return `Input ${index}: role=base, fidelity=${fidelity}. Preserve identity and composition unless instructed otherwise.`;
    }
    return `Input ${index}: role=reference, fidelity=${fidelity}. Use this for style and detail guidance.`;
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
        code: "nano_edit_input_unsafe_path",
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
        code: "nano_edit_input_unreadable",
        message: `Failed to read edit input "${inputPath}" for target "${targetId}".`,
        actionable:
          "Ensure edit input files exist and paths are correct relative to --out (or absolute).",
        cause: error,
      });
    }
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

export function createNanoProvider(
  options: NanoProviderOptions = {},
): NanoProvider {
  return new NanoProvider(options);
}

function supportsNanoImageEdits(model: string): boolean {
  return model.toLowerCase().includes("image");
}
