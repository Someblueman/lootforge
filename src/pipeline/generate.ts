import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { writeRunProvenance } from "../output/provenance.js";
import {
  createProviderRegistry,
  getProvider,
  ProviderRegistry,
  resolveTargetProviderName,
} from "../providers/registry.js";
import {
  nowIso,
  parseProviderSelection,
  PlannedTarget,
  ProviderJob,
  ProviderRunResult,
  ProviderSelection,
  sha256Hex,
} from "../providers/types.js";
import {
  assertTargetAcceptance,
  postProcessGeneratedImage,
} from "../shared/image.js";

export interface GeneratePipelineOptions {
  outDir: string;
  targetsIndexPath?: string;
  provider?: ProviderSelection;
  ids?: string[];
  now?: () => Date;
  fetchImpl?: typeof fetch;
  registry?: ProviderRegistry;
  runId?: string;
  onProgress?: (event: GenerateProgressEvent) => void;
}

export interface GeneratePipelineResult {
  runId: string;
  inputHash: string;
  targetsIndexPath: string;
  imagesDir: string;
  provenancePath: string;
  jobs: ProviderRunResult[];
}

export type GenerateProgressEventType =
  | "prepare"
  | "job_start"
  | "job_finish"
  | "job_error";

export interface GenerateProgressEvent {
  type: GenerateProgressEventType;
  totalJobs: number;
  jobIndex?: number;
  targetId?: string;
  provider?: string;
  model?: string;
  bytesWritten?: number;
  outputPath?: string;
  message?: string;
}

interface TargetsIndexShape {
  targets?: PlannedTarget[];
}

export async function runGeneratePipeline(
  options: GeneratePipelineOptions,
): Promise<GeneratePipelineResult> {
  const outDir = path.resolve(options.outDir);
  const targetsIndexPath = path.resolve(
    options.targetsIndexPath ?? path.join(outDir, "jobs", "targets-index.json"),
  );
  const providerSelection = options.provider ?? "auto";
  const registry = options.registry ?? createProviderRegistry();
  const imagesDir = path.join(outDir, "assets", "images");

  const indexRaw = await readFile(targetsIndexPath, "utf8");
  const index = parseTargetsIndex(indexRaw, targetsIndexPath);
  const targets = normalizeTargets(index, targetsIndexPath);
  const filteredTargets = filterTargetsByIds(targets, options.ids);
  const inputHash = sha256Hex(indexRaw);
  const startedAt = nowIso(options.now);
  const runId =
    options.runId ?? sha256Hex(`${inputHash}:${startedAt}`).slice(0, 16);

  await mkdir(imagesDir, { recursive: true });

  const jobs = await prepareAllJobs({
    targets: filteredTargets,
    providerSelection,
    outDir,
    imagesDir,
    now: options.now,
    registry,
  });
  options.onProgress?.({
    type: "prepare",
    totalJobs: jobs.length,
  });

  const results: ProviderRunResult[] = [];
  for (let jobIndex = 0; jobIndex < jobs.length; jobIndex += 1) {
    const job = jobs[jobIndex];
    const provider = getProvider(registry, job.provider);
    options.onProgress?.({
      type: "job_start",
      totalJobs: jobs.length,
      jobIndex,
      targetId: job.targetId,
      provider: job.provider,
      model: job.model,
    });
    let result: ProviderRunResult;
    try {
      result = await provider.runJob(job, {
        outDir,
        imagesDir,
        now: options.now,
        fetchImpl: options.fetchImpl,
      });
    } catch (error) {
      options.onProgress?.({
        type: "job_error",
        totalJobs: jobs.length,
        jobIndex,
        targetId: job.targetId,
        provider: job.provider,
        model: job.model,
        message: error instanceof Error ? error.message : String(error),
      });
      throw provider.normalizeError(error);
    }

    try {
      const inspection = await postProcessGeneratedImage(job.target, result.outputPath);
      assertTargetAcceptance(job.target, inspection);

      const finalizedResult: ProviderRunResult = {
        ...result,
        bytesWritten: inspection.sizeBytes,
      };
      results.push(finalizedResult);
      options.onProgress?.({
        type: "job_finish",
        totalJobs: jobs.length,
        jobIndex,
        targetId: job.targetId,
        provider: job.provider,
        model: job.model,
        bytesWritten: finalizedResult.bytesWritten,
        outputPath: finalizedResult.outputPath,
      });
    } catch (error) {
      options.onProgress?.({
        type: "job_error",
        totalJobs: jobs.length,
        jobIndex,
        targetId: job.targetId,
        provider: job.provider,
        model: job.model,
        message: error instanceof Error ? error.message : String(error),
      });
      throw new Error(
        `Post-processing or acceptance checks failed for "${job.targetId}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  const finishedAt = nowIso(options.now);
  const provenancePath = await writeRunProvenance(outDir, {
    runId,
    inputHash,
    startedAt,
    finishedAt,
    generatedAt: finishedAt,
    jobs: results.map((result) => ({
      jobId: result.jobId,
      provider: result.provider,
      model: result.model,
      targetId: result.targetId,
      inputHash: result.inputHash,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      outputPath: result.outputPath,
    })),
  });

  return {
    runId,
    inputHash,
    targetsIndexPath,
    imagesDir,
    provenancePath,
    jobs: results,
  };
}

export function parseGenerateProviderFlag(value: string | undefined): ProviderSelection {
  return parseProviderSelection(value);
}

function parseTargetsIndex(raw: string, filePath: string): TargetsIndexShape {
  try {
    return JSON.parse(raw) as TargetsIndexShape;
  } catch (error) {
    throw new Error(
      `Failed to parse targets index JSON (${filePath}): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function normalizeTargets(index: TargetsIndexShape, filePath: string): PlannedTarget[] {
  if (!Array.isArray(index.targets) || index.targets.length === 0) {
    throw new Error(`No targets found in planned index: ${filePath}`);
  }

  return index.targets.map((target, targetIndex) => {
    if (!target || typeof target !== "object") {
      throw new Error(`Invalid target at index ${targetIndex} in ${filePath}`);
    }
    if (typeof target.id !== "string" || target.id.trim() === "") {
      throw new Error(`targets[${targetIndex}].id must be a non-empty string`);
    }
    if (typeof target.out !== "string" || target.out.trim() === "") {
      throw new Error(`targets[${targetIndex}].out must be a non-empty string`);
    }
    if (typeof target.promptSpec?.primary !== "string") {
      throw new Error(
        `targets[${targetIndex}].promptSpec.primary must be a string`,
      );
    }
    return target;
  });
}

async function prepareAllJobs(params: {
  targets: PlannedTarget[];
  providerSelection: ProviderSelection;
  outDir: string;
  imagesDir: string;
  now?: () => Date;
  registry: ProviderRegistry;
}): Promise<ProviderJob[]> {
  const groupedTargets = new Map<string, PlannedTarget[]>();

  for (const target of params.targets) {
    const providerName = resolveTargetProviderName(
      target,
      params.providerSelection,
    );
    const existing = groupedTargets.get(providerName);
    if (existing) {
      existing.push(target);
    } else {
      groupedTargets.set(providerName, [target]);
    }
  }

  const jobs: ProviderJob[] = [];
  for (const [providerName, targets] of groupedTargets) {
    const provider = getProvider(params.registry, providerName as "openai" | "nano");
    try {
      const providerJobs = await provider.prepareJobs(targets, {
        outDir: params.outDir,
        imagesDir: params.imagesDir,
        now: params.now,
      });
      jobs.push(...providerJobs);
    } catch (error) {
      throw provider.normalizeError(error);
    }
  }

  jobs.sort((left, right) => left.id.localeCompare(right.id));
  return jobs;
}

function filterTargetsByIds(targets: PlannedTarget[], ids?: string[]): PlannedTarget[] {
  if (!ids || ids.length === 0) {
    return targets;
  }

  const idSet = new Set(ids.map((id) => id.trim()).filter(Boolean));
  if (idSet.size === 0) {
    return targets;
  }

  const filtered = targets.filter((target) => idSet.has(target.id));
  if (filtered.length === 0) {
    throw new Error(
      `No targets matched --ids (${Array.from(idSet).join(",")}). Check planned target ids.`,
    );
  }

  return filtered;
}
