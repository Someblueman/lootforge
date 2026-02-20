import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { runPlanCommand } from "../cli/commands/plan.js";
import { parseGenerateProviderFlag } from "../pipeline/generate.js";
import { runGeneratePipeline } from "../pipeline/generate.js";
import type { ProviderSelection } from "../providers/types.js";

export const CANONICAL_GENERATION_REQUEST_VERSION = "v1";

const providerSelectionSchema = z.enum(["openai", "nano", "local", "auto"]);
const canonicalGenerationRequestSchema = z
  .object({
    manifestPath: z.string().trim().min(1).optional(),
    manifest: z.record(z.unknown()).optional(),
    outDir: z.string().trim().min(1).optional(),
    provider: providerSelectionSchema.optional(),
    targetIds: z.array(z.string().trim().min(1)).optional(),
    skipLocked: z.boolean().optional(),
    selectionLockPath: z.string().trim().min(1).optional(),
  })
  .refine((value) => Boolean(value.manifestPath || value.manifest), {
    message: "Either manifestPath or manifest must be provided.",
    path: ["manifestPath"],
  });

const canonicalGenerationEnvelopeSchema = z
  .object({
    requestId: z.union([z.string(), z.number()]).optional(),
    request: canonicalGenerationRequestSchema,
  })
  .passthrough();

export interface CanonicalGenerationRequestInput {
  manifestPath?: string;
  manifest?: Record<string, unknown>;
  outDir?: string;
  provider?: ProviderSelection;
  targetIds?: string[];
  skipLocked?: boolean;
  selectionLockPath?: string;
}

export interface CanonicalGenerationRequestEnvelope {
  requestId?: string | number;
  request: CanonicalGenerationRequestInput;
}

export interface CanonicalGenerationRequestResult {
  requestId?: string | number;
  mappingVersion: string;
  normalizedRequest: {
    outDir: string;
    manifestPath: string;
    manifestSource: "inline" | "path";
    provider: ProviderSelection;
    targetIds: string[];
    skipLocked: boolean;
    selectionLockPath?: string;
  };
  plan: {
    targets: number;
    warnings: number;
    targetsIndexPath: string;
  };
  generate: {
    runId: string;
    jobs: number;
    imagesDir: string;
    provenancePath: string;
    targetsIndexPath: string;
  };
}

export interface CanonicalGenerationRequestContext {
  defaultOutDir?: string;
}

export class CanonicalGenerationRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, options: { code: string; status: number }) {
    super(message);
    this.name = "CanonicalGenerationRequestError";
    this.code = options.code;
    this.status = options.status;
  }
}

export function getCanonicalGenerationRequestContract(): {
  version: string;
  endpoint: string;
  summary: string;
  fields: Record<string, string>;
} {
  return {
    version: CANONICAL_GENERATION_REQUEST_VERSION,
    endpoint: "/v1/generation/requests",
    summary:
      "Canonical generation request contract that maps service payloads to manifest planning + generation pipeline targets.",
    fields: {
      manifestPath: "String path to manifest JSON (required unless manifest is provided).",
      manifest:
        "Inline manifest object; when present it is materialized to a service request manifest file before planning.",
      outDir:
        "Output directory root for plan/generate artifacts. Falls back to service default out dir, then manifest parent directory.",
      provider: "Provider selection (openai|nano|local|auto). Defaults to auto.",
      targetIds: "Optional target-id subset for generation.",
      skipLocked: "When true (default), lock-approved targets can be skipped during generation.",
      selectionLockPath: "Optional selection lock path override.",
    },
  };
}

export async function runCanonicalGenerationRequest(
  payload: unknown,
  context: CanonicalGenerationRequestContext,
): Promise<CanonicalGenerationRequestResult> {
  const envelope = parseCanonicalGenerationEnvelope(payload);
  const request = envelope.request;

  const requestedManifestPath = request.manifestPath
    ? path.resolve(request.manifestPath)
    : undefined;
  const outDir = resolveOutDir(request.outDir, context.defaultOutDir, requestedManifestPath);
  const manifestResolution = await resolveManifestPathForRequest({
    request,
    outDir,
    requestId: envelope.requestId,
  });

  const provider = parseGenerateProviderFlag(request.provider);
  const targetIds = normalizeTargetIds(request.targetIds);
  const skipLocked = request.skipLocked ?? true;
  const selectionLockPath = request.selectionLockPath
    ? path.resolve(request.selectionLockPath)
    : undefined;

  const planResult = await runPlanCommand([
    "--manifest",
    manifestResolution.manifestPath,
    "--out",
    outDir,
  ]);

  const generateResult = await runGeneratePipeline({
    outDir,
    targetsIndexPath: planResult.targetsIndexPath,
    provider,
    ids: targetIds,
    skipLocked,
    selectionLockPath,
  });

  return {
    ...(envelope.requestId !== undefined ? { requestId: envelope.requestId } : {}),
    mappingVersion: CANONICAL_GENERATION_REQUEST_VERSION,
    normalizedRequest: {
      outDir,
      manifestPath: manifestResolution.manifestPath,
      manifestSource: manifestResolution.source,
      provider,
      targetIds,
      skipLocked,
      ...(selectionLockPath ? { selectionLockPath } : {}),
    },
    plan: {
      targets: planResult.targets,
      warnings: planResult.warnings,
      targetsIndexPath: planResult.targetsIndexPath,
    },
    generate: {
      runId: generateResult.runId,
      jobs: generateResult.jobs.length,
      imagesDir: generateResult.imagesDir,
      provenancePath: generateResult.provenancePath,
      targetsIndexPath: generateResult.targetsIndexPath,
    },
  };
}

function parseCanonicalGenerationEnvelope(value: unknown): CanonicalGenerationRequestEnvelope {
  if (!isRecord(value)) {
    throw new CanonicalGenerationRequestError("Canonical generation request must be a JSON object.", {
      code: "invalid_canonical_generation_request",
      status: 400,
    });
  }

  const envelopeLike = canonicalGenerationEnvelopeSchema.safeParse(value);
  if (envelopeLike.success) {
    return envelopeLike.data;
  }

  const requestOnly = canonicalGenerationRequestSchema.safeParse(value);
  if (requestOnly.success) {
    return {
      request: requestOnly.data,
    };
  }

  const issue = envelopeLike.error.issues[0] ?? requestOnly.error.issues[0];
  throw new CanonicalGenerationRequestError(
    issue ? `${issue.path.join(".") || "request"}: ${issue.message}` : "Invalid request shape.",
    {
      code: "invalid_canonical_generation_request",
      status: 400,
    },
  );
}

function resolveOutDir(
  outDir: string | undefined,
  defaultOutDir: string | undefined,
  manifestPath: string | undefined,
): string {
  if (outDir) {
    return path.resolve(outDir);
  }
  if (defaultOutDir) {
    return path.resolve(defaultOutDir);
  }
  if (manifestPath) {
    return path.dirname(manifestPath);
  }
  throw new CanonicalGenerationRequestError(
    "Request must provide outDir (or service default out dir) when manifestPath is omitted.",
    {
      code: "canonical_generation_missing_out_dir",
      status: 400,
    },
  );
}

async function resolveManifestPathForRequest(params: {
  request: CanonicalGenerationRequestInput;
  outDir: string;
  requestId?: string | number;
}): Promise<{ manifestPath: string; source: "inline" | "path" }> {
  if (params.request.manifest) {
    const suggestedPath = params.request.manifestPath
      ? path.resolve(params.request.manifestPath)
      : undefined;
    const manifestPath =
      suggestedPath ??
      path.join(
        params.outDir,
        "jobs",
        "service-requests",
        `${createSafeRequestId(params.requestId)}-manifest.json`,
      );
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(
      manifestPath,
      `${JSON.stringify(params.request.manifest, null, 2)}\n`,
      "utf8",
    );

    return {
      manifestPath,
      source: "inline",
    };
  }

  if (params.request.manifestPath) {
    return {
      manifestPath: path.resolve(params.request.manifestPath),
      source: "path",
    };
  }

  throw new CanonicalGenerationRequestError(
    "Either manifestPath or manifest is required.",
    {
      code: "canonical_generation_missing_manifest",
      status: 400,
    },
  );
}

function normalizeTargetIds(value: string[] | undefined): string[] {
  if (!value || value.length === 0) {
    return [];
  }
  return Array.from(
    new Set(
      value.map((id) => id.trim()).filter((id) => id.length > 0),
    ),
  );
}

function createSafeRequestId(value: string | number | undefined): string {
  const source = String(value ?? Date.now());
  const sanitized = source.replace(/[^a-zA-Z0-9_-]/g, "-");
  return sanitized.length > 0 ? sanitized : "service-request";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
