import { cp, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { scoreCandidateImages } from "../checks/candidateScore.js";
import { writeRunProvenance } from "../output/provenance.js";
import {
  createProviderRegistry,
  getProvider,
  ProviderRegistry,
  resolveTargetProviderRoute,
} from "../providers/registry.js";
import {
  nowIso,
  parseProviderSelection,
  PlannedTarget,
  ProviderJob,
  ProviderName,
  ProviderRunResult,
  ProviderSelection,
  sha256Hex,
} from "../providers/types.js";
import { resolveStagePathLayout } from "../shared/paths.js";

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

export interface GenerateJobFailure {
  targetId: string;
  provider: ProviderName;
  attemptedProviders: ProviderName[];
  message: string;
}

export interface GeneratePipelineResult {
  runId: string;
  inputHash: string;
  targetsIndexPath: string;
  imagesDir: string;
  provenancePath: string;
  jobs: ProviderRunResult[];
  failures: GenerateJobFailure[];
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

interface TargetTask {
  target: PlannedTarget;
  targetIndex: number;
  primaryProvider: ProviderName;
  fallbackProviders: ProviderName[];
}

export async function runGeneratePipeline(
  options: GeneratePipelineOptions,
): Promise<GeneratePipelineResult> {
  const layout = resolveStagePathLayout(options.outDir);
  const targetsIndexPath = path.resolve(
    options.targetsIndexPath ?? path.join(layout.jobsDir, "targets-index.json"),
  );
  const providerSelection = options.provider ?? "auto";
  const registry = options.registry ?? createProviderRegistry();
  const imagesDir = layout.rawDir;

  const indexRaw = await readFile(targetsIndexPath, "utf8");
  const index = parseTargetsIndex(indexRaw, targetsIndexPath);
  const targets = normalizeTargets(index, targetsIndexPath);
  const filteredTargets = filterTargetsByIds(targets, options.ids);
  const inputHash = sha256Hex(indexRaw);
  const startedAt = nowIso(options.now);
  const runId =
    options.runId ?? sha256Hex(`${inputHash}:${startedAt}`).slice(0, 16);

  await mkdir(imagesDir, { recursive: true });

  const tasks = filteredTargets.map((target, targetIndex) => {
    const route = resolveTargetProviderRoute(target, providerSelection);
    return {
      target,
      targetIndex,
      primaryProvider: route.primary,
      fallbackProviders: route.fallbacks,
    } as TargetTask;
  });

  options.onProgress?.({
    type: "prepare",
    totalJobs: tasks.length,
  });

  const groupedTasks = new Map<ProviderName, TargetTask[]>();
  for (const task of tasks) {
    const existing = groupedTasks.get(task.primaryProvider);
    if (existing) {
      existing.push(task);
    } else {
      groupedTasks.set(task.primaryProvider, [task]);
    }
  }

  const results: ProviderRunResult[] = [];
  const failures: GenerateJobFailure[] = [];

  await Promise.all(
    Array.from(groupedTasks.entries()).map(async ([providerName, providerTasks]) => {
      const provider = getProvider(registry, providerName);
      const providerConcurrency = Math.max(
        1,
        ...providerTasks.map(
          (task) => task.target.generationPolicy?.providerConcurrency ?? 0,
        ),
        provider.capabilities.defaultConcurrency,
      );

      const queue = [...providerTasks].sort((left, right) =>
        left.target.id.localeCompare(right.target.id),
      );
      let nextTask = 0;
      let lastRunAt = 0;

      const workers: Promise<void>[] = [];
      for (let workerIndex = 0; workerIndex < providerConcurrency; workerIndex += 1) {
        workers.push(
          (async () => {
            while (nextTask < queue.length) {
              const currentIndex = nextTask;
              nextTask += 1;
              const task = queue[currentIndex];

              const minDelayMs = computeProviderDelayMs(task, provider.capabilities.minDelayMs);
              const waitMs = Math.max(0, lastRunAt + minDelayMs - Date.now());
              if (waitMs > 0) {
                await delay(waitMs);
              }
              lastRunAt = Date.now();

              const progressIndex = task.targetIndex;
              options.onProgress?.({
                type: "job_start",
                totalJobs: tasks.length,
                jobIndex: progressIndex,
                targetId: task.target.id,
                provider: task.primaryProvider,
                model: task.target.model,
              });

              try {
                const result = await runTaskWithFallback({
                  task,
                  outDir: layout.outDir,
                  imagesDir,
                  now: options.now,
                  fetchImpl: options.fetchImpl,
                  registry,
                });
                results.push(result);

                options.onProgress?.({
                  type: "job_finish",
                  totalJobs: tasks.length,
                  jobIndex: progressIndex,
                  targetId: task.target.id,
                  provider: result.provider,
                  model: result.model,
                  bytesWritten: result.bytesWritten,
                  outputPath: result.outputPath,
                });
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                failures.push({
                  targetId: task.target.id,
                  provider: task.primaryProvider,
                  attemptedProviders: [task.primaryProvider, ...task.fallbackProviders],
                  message,
                });

                options.onProgress?.({
                  type: "job_error",
                  totalJobs: tasks.length,
                  jobIndex: progressIndex,
                  targetId: task.target.id,
                  provider: task.primaryProvider,
                  model: task.target.model,
                  message,
                });
              }
            }
          })(),
        );
      }

      await Promise.all(workers);
    }),
  );

  results.sort((left, right) => left.targetId.localeCompare(right.targetId));
  failures.sort((left, right) => left.targetId.localeCompare(right.targetId));

  const finishedAt = nowIso(options.now);
  const provenancePath = await writeRunProvenance(layout.outDir, {
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
    failures,
  });

  if (failures.length > 0) {
    throw new Error(
      `Generation failed for ${failures.length} target(s): ${failures
        .slice(0, 5)
        .map((failure) => `${failure.targetId}`)
        .join(", ")}`,
    );
  }

  return {
    runId,
    inputHash,
    targetsIndexPath,
    imagesDir,
    provenancePath,
    jobs: results,
    failures,
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

async function runTaskWithFallback(params: {
  task: TargetTask;
  outDir: string;
  imagesDir: string;
  now?: () => Date;
  fetchImpl?: typeof fetch;
  registry: ProviderRegistry;
}): Promise<ProviderRunResult> {
  const providerChain = [params.task.primaryProvider, ...params.task.fallbackProviders];
  let lastError: unknown;

  for (const providerName of providerChain) {
    const provider = getProvider(params.registry, providerName);
    const preparedJobs = await provider.prepareJobs([params.task.target], {
      outDir: params.outDir,
      imagesDir: params.imagesDir,
      now: params.now,
    });

    if (preparedJobs.length === 0) {
      lastError = new Error(`Provider ${providerName} produced no jobs for ${params.task.target.id}`);
      continue;
    }

    const job = preparedJobs[0];
    const attempts = Math.max(1, job.maxRetries + 1);

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const runResult = await provider.runJob(job, {
          outDir: params.outDir,
          imagesDir: params.imagesDir,
          now: params.now,
          fetchImpl: params.fetchImpl,
        });

        const candidatePaths =
          runResult.candidateOutputs?.map((candidate) => candidate.outputPath) ??
          [runResult.outputPath];

        const candidateSelection = await scoreCandidateImages(params.task.target, candidatePaths);
        const bestPath = candidateSelection.bestPath;
        if (bestPath !== job.outPath) {
          await cp(bestPath, job.outPath, { force: true });
        }

        const fileStat = await stat(job.outPath);
        return {
          ...runResult,
          provider: providerName,
          outputPath: job.outPath,
          bytesWritten: fileStat.size,
          candidateScores: candidateSelection.scores,
        };
      } catch (error) {
        lastError = provider.normalizeError(error);
        if (attempt < attempts) {
          await delay(backoffMsForAttempt(attempt));
        }
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Generation failed for target ${params.task.target.id}`);
}

function backoffMsForAttempt(attempt: number): number {
  return Math.min(5000, 300 * 2 ** (attempt - 1));
}

function computeProviderDelayMs(task: TargetTask, fallbackDelay: number): number {
  const requestedRateLimit = task.target.generationPolicy?.rateLimitPerMinute;
  if (
    typeof requestedRateLimit === "number" &&
    Number.isFinite(requestedRateLimit) &&
    requestedRateLimit > 0
  ) {
    const rateDelay = Math.ceil(60000 / requestedRateLimit);
    return Math.max(rateDelay, fallbackDelay);
  }

  return fallbackDelay;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
