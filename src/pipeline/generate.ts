// eslint-disable-next-line n/no-unsupported-features/node-builtins
import { access, cp, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { scoreCandidateImages, type ScoreCandidateImagesOptions } from "../checks/candidateScore.js";
import { writeRunProvenance } from "../output/provenance.js";
import {
  createProviderRegistry,
  getProvider,
  type ProviderRegistry,
  resolveTargetProviderRoute,
} from "../providers/registry.js";
import { resolveProviderRegistryOptions } from "../providers/runtimeConfig.js";
import {
  type CandidateScoreRecord,
  type GenerationProvider,
  getTargetGenerationPolicy,
  normalizeGenerationPolicyForProvider,
  nowIso,
  parseProviderSelection,
  type PlannedTarget,
  type ProviderCandidateOutput,
  ProviderError,
  type ProviderName,
  type ProviderRunResult,
  type ProviderSelection,
  sha256Hex,
} from "../providers/types.js";
import {
  normalizeTargetOutPath,
  resolvePathWithinRoot,
  resolveStagePathLayout,
} from "../shared/paths.js";

export interface GeneratePipelineOptions {
  outDir: string;
  targetsIndexPath?: string;
  provider?: ProviderSelection;
  ids?: string[];
  selectionLockPath?: string;
  skipLocked?: boolean;
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

export type GenerateProgressEventType = "prepare" | "job_start" | "job_finish" | "job_error";

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
  manifestPath?: string;
}

interface TargetTask {
  target: PlannedTarget;
  targetIndex: number;
  primaryProvider: ProviderName;
  fallbackProviders: ProviderName[];
}

interface SelectionLockItem {
  targetId: string;
  inputHash: string;
  selectedOutputPath: string;
  provider?: string;
  model?: string;
  approved?: boolean;
  score?: number;
}

interface SelectionLockFile {
  generatedAt?: string;
  targets?: SelectionLockItem[];
}

interface ScoredCandidateSet {
  candidateOutputs: ProviderCandidateOutput[];
  scores: CandidateScoreRecord[];
  bestPath: string;
}

const COARSE_TO_FINE_DRAFT_SCORING_OPTIONS: Omit<ScoreCandidateImagesOptions, "outDir"> = {
  includeSoftAdapters: false,
  includeVlmGate: false,
};

export async function runGeneratePipeline(
  options: GeneratePipelineOptions,
): Promise<GeneratePipelineResult> {
  const layout = resolveStagePathLayout(options.outDir);
  const targetsIndexPath = path.resolve(
    options.targetsIndexPath ?? path.join(layout.jobsDir, "targets-index.json"),
  );
  const providerSelection = options.provider ?? "auto";
  const imagesDir = layout.rawDir;
  const skipLocked = options.skipLocked ?? true;

  const indexRaw = await readFile(targetsIndexPath, "utf8");
  const index = parseTargetsIndex(indexRaw, targetsIndexPath);
  const registry =
    options.registry ??
    createProviderRegistry(
      await resolveProviderRegistryOptions(resolveManifestPathFromIndex(index, targetsIndexPath)),
    );
  const targets = normalizeTargets(index, targetsIndexPath);
  const filteredTargets = filterTargetsByIds(
    targets.filter((target) => target.generationDisabled !== true),
    options.ids,
  );
  const lock = await readSelectionLock(
    path.resolve(
      options.selectionLockPath ?? path.join(layout.outDir, "locks", "selection-lock.json"),
    ),
  );
  const lockByTargetId = new Map((lock.targets ?? []).map((item) => [item.targetId, item]));
  const inputHash = sha256Hex(indexRaw);
  const startedAt = nowIso(options.now);
  const runId = options.runId ?? sha256Hex(`${inputHash}:${startedAt}`).slice(0, 16);

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
  const taskById = new Map(tasks.map((task) => [task.target.id, task]));
  const executionStages = buildTaskExecutionStages(tasks);

  options.onProgress?.({
    type: "prepare",
    totalJobs: tasks.length,
  });

  const results: ProviderRunResult[] = [];
  const failures: GenerateJobFailure[] = [];

  for (const stageTasks of executionStages) {
    const groupedTasks = new Map<ProviderName, TargetTask[]>();
    for (const task of stageTasks) {
      const existing = groupedTasks.get(task.primaryProvider);
      if (existing) {
        existing.push(task);
      } else {
        groupedTasks.set(task.primaryProvider, [task]);
      }
    }

    await Promise.all(
      Array.from(groupedTasks.entries()).map(async ([providerName, providerTasks]) => {
        const provider = getProvider(registry, providerName);
        const providerConcurrency = Math.max(
          1,
          ...providerTasks.map((task) => task.target.generationPolicy?.providerConcurrency ?? 0),
          provider.capabilities.defaultConcurrency,
        );

        const queue = [...providerTasks].sort((left, right) =>
          left.target.id.localeCompare(right.target.id),
        );
        let nextTask = 0;
        let nextScheduledStartAt = 0;
        const reserveWaitMs = (task: TargetTask): number => {
          const minDelayMs = computeProviderDelayMs(task, provider.capabilities.minDelayMs);
          const nowMs = Date.now();
          const scheduledStart = Math.max(nowMs, nextScheduledStartAt);
          nextScheduledStartAt = scheduledStart + minDelayMs;
          return Math.max(0, scheduledStart - nowMs);
        };

        const workers: Promise<void>[] = [];
        for (let workerIndex = 0; workerIndex < providerConcurrency; workerIndex += 1) {
          workers.push(
            (async () => {
              while (nextTask < queue.length) {
                const currentIndex = nextTask;
                nextTask += 1;
                const task = queue[currentIndex];

                const waitMs = reserveWaitMs(task);
                if (waitMs > 0) {
                  await delay(waitMs);
                }

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
                    lockByTargetId,
                    skipLocked,
                    taskById,
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
  }

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
      bytesWritten: result.bytesWritten,
      skipped: result.skipped,
      candidateOutputs: result.candidateOutputs,
      candidateScores: result.candidateScores,
      coarseToFine: result.coarseToFine,
      styleReferenceLineage: result.styleReferenceLineage,
      generationMode: result.generationMode,
      edit: result.edit,
      regenerationSource: result.regenerationSource,
    })),
    failures,
  });

  if (failures.length > 0) {
    const firstFailure = failures[0];
    throw new Error(
      `Generation failed for ${failures.length} target(s): ${failures
        .slice(0, 5)
        .map((failure) => failure.targetId)
        .join(", ")}. First failure (${firstFailure.targetId}): ${firstFailure.message}`,
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
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!target || typeof target !== "object") {
      throw new Error(`Invalid target at index ${targetIndex} in ${filePath}`);
    }
    if (typeof target.id !== "string" || target.id.trim() === "") {
      throw new Error(`targets[${targetIndex}].id must be a non-empty string`);
    }
    if (typeof target.out !== "string" || target.out.trim() === "") {
      throw new Error(`targets[${targetIndex}].out must be a non-empty string`);
    }
    let normalizedOut: string;
    try {
      normalizedOut = normalizeTargetOutPath(target.out);
    } catch (error) {
      throw new Error(
        `targets[${targetIndex}].out is invalid: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (typeof target.promptSpec.primary !== "string") {
      throw new Error(`targets[${targetIndex}].promptSpec.primary must be a string`);
    }
    return {
      ...target,
      out: normalizedOut,
    };
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

function buildTaskExecutionStages(tasks: TargetTask[]): TargetTask[][] {
  const tasksById = new Map(tasks.map((task) => [task.target.id, task]));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const task of tasks) {
    inDegree.set(task.target.id, 0);
    adjacency.set(task.target.id, []);
  }

  for (const task of tasks) {
    const dependencies = dedupeTargetIdList(task.target.dependsOn ?? []);
    for (const dependencyId of dependencies) {
      if (dependencyId === task.target.id) {
        throw new Error(`Target "${task.target.id}" cannot depend on itself.`);
      }
      if (!tasksById.has(dependencyId)) {
        throw new Error(
          `Target "${task.target.id}" depends on "${dependencyId}", but that target is not in the current generation set.`,
        );
      }
      adjacency.get(dependencyId)?.push(task.target.id);
      inDegree.set(task.target.id, (inDegree.get(task.target.id) ?? 0) + 1);
    }
  }

  let currentStage = tasks
    .map((task) => task.target.id)
    .filter((targetId) => (inDegree.get(targetId) ?? 0) === 0)
    .sort((left, right) => left.localeCompare(right));
  const stages: TargetTask[][] = [];
  let visited = 0;

  while (currentStage.length > 0) {
    const stageTasks = currentStage
      .map((targetId) => tasksById.get(targetId))
      .filter((task): task is TargetTask => Boolean(task));
    stages.push(stageTasks);
    visited += stageTasks.length;

    const nextStageCandidates = new Set<string>();
    for (const targetId of currentStage) {
      const dependents = adjacency.get(targetId) ?? [];
      for (const dependentId of dependents) {
        const nextDegree = (inDegree.get(dependentId) ?? 0) - 1;
        inDegree.set(dependentId, nextDegree);
        if (nextDegree === 0) {
          nextStageCandidates.add(dependentId);
        }
      }
    }

    currentStage = Array.from(nextStageCandidates).sort((left, right) =>
      left.localeCompare(right),
    );
  }

  if (visited !== tasks.length) {
    const blockedTargets = tasks
      .map((task) => task.target.id)
      .filter((targetId) => (inDegree.get(targetId) ?? 0) > 0)
      .sort((left, right) => left.localeCompare(right));
    throw new Error(`Dependency cycle detected in generation targets: ${blockedTargets.join(", ")}.`);
  }

  return stages;
}

async function runTaskWithFallback(params: {
  task: TargetTask;
  outDir: string;
  imagesDir: string;
  now?: () => Date;
  fetchImpl?: typeof fetch;
  registry: ProviderRegistry;
  lockByTargetId: Map<string, SelectionLockItem>;
  skipLocked: boolean;
  taskById: Map<string, TargetTask>;
}): Promise<ProviderRunResult> {
  const providerChain = [params.task.primaryProvider, ...params.task.fallbackProviders];
  let lastError: unknown;

  for (const providerName of providerChain) {
    const provider = getProvider(params.registry, providerName);
    const normalizedPolicy = resolveProviderGenerationPolicy(params.task.target, providerName);
    const draftTarget = materializeDraftTarget(params.task.target, normalizedPolicy);
    if (targetRequiresEditSupport(params.task.target) && !provider.supports("image-edits")) {
      lastError = new Error(
        `Provider "${providerName}" does not support edit-first generation for target "${params.task.target.id}".`,
      );
      continue;
    }
    const preparedJobs = await provider.prepareJobs([draftTarget], {
      outDir: params.outDir,
      imagesDir: params.imagesDir,
      now: params.now,
    });

    if (preparedJobs.length === 0) {
      lastError = new Error(
        `Provider ${providerName} produced no jobs for ${params.task.target.id}`,
      );
      continue;
    }

    const job = preparedJobs[0];
    const styleReferenceLineage = resolveStyleReferenceLineage({
      task: params.task,
      taskById: params.taskById,
      imagesDir: params.imagesDir,
    });
    const lockEntry = params.lockByTargetId.get(params.task.target.id);
    if (params.skipLocked && lockEntry?.approved && lockEntry.inputHash === job.inputHash) {
      let lockedPath: string;
      try {
        lockedPath = resolvePathWithinRoot(
          params.outDir,
          lockEntry.selectedOutputPath,
          `selection lock output path for target "${job.targetId}"`,
        );
      } catch (error) {
        throw new Error(
          `Selection lock output path for "${job.targetId}" must stay within --out (${params.outDir}).`,
          { cause: error },
        );
      }
      if (await fileExists(lockedPath)) {
        if (lockedPath !== job.outPath) {
          await cp(lockedPath, job.outPath, { force: true });
        }
        const fileStat = await stat(job.outPath);
        return {
          jobId: job.id,
          provider: providerName,
          model: job.model,
          targetId: job.targetId,
          outputPath: job.outPath,
          bytesWritten: fileStat.size,
          inputHash: job.inputHash,
          startedAt: nowIso(params.now),
          finishedAt: nowIso(params.now),
          skipped: true,
          generationMode: params.task.target.generationMode,
          edit: params.task.target.edit,
          regenerationSource: params.task.target.regenerationSource,
          warnings: [`Skipped generation for ${job.targetId}; approved lock matched input hash.`],
          ...(styleReferenceLineage ? { styleReferenceLineage } : {}),
        };
      }
    }

    const attempts = Math.max(1, job.maxRetries + 1);

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const runResult = await provider.runJob(job, {
          outDir: params.outDir,
          imagesDir: params.imagesDir,
          now: params.now,
          fetchImpl: params.fetchImpl,
        });

        const coarseToFinePolicy = normalizedPolicy.coarseToFine;
        const draftCandidates = await scoreProviderRunCandidates({
          target: params.task.target,
          runResult,
          outDir: params.outDir,
          ...(coarseToFinePolicy?.enabled
            ? { scoreOptions: COARSE_TO_FINE_DRAFT_SCORING_OPTIONS }
            : {}),
        });

        if (coarseToFinePolicy?.enabled) {
          const coarseToFineResult = await runCoarseToFineRefinement({
            provider,
            providerName,
            task: params.task,
            runContext: {
              outDir: params.outDir,
              imagesDir: params.imagesDir,
              now: params.now,
              fetchImpl: params.fetchImpl,
            },
            policy: coarseToFinePolicy,
            normalizedPolicy,
            draftCandidates,
          });
          await copyIfDifferent(coarseToFineResult.bestPath, job.outPath);

          const fileStat = await stat(job.outPath);
          return {
            ...runResult,
            provider: providerName,
            outputPath: job.outPath,
            bytesWritten: fileStat.size,
            candidateOutputs: coarseToFineResult.candidateOutputs,
            candidateScores: coarseToFineResult.scores,
            coarseToFine: coarseToFineResult.coarseToFine,
            ...(styleReferenceLineage ? { styleReferenceLineage } : {}),
            generationMode: params.task.target.generationMode,
            edit: params.task.target.edit,
            regenerationSource: params.task.target.regenerationSource,
          };
        }

        await copyIfDifferent(draftCandidates.bestPath, job.outPath);
        const fileStat = await stat(job.outPath);
        return {
          ...runResult,
          provider: providerName,
          outputPath: job.outPath,
          bytesWritten: fileStat.size,
            candidateOutputs: draftCandidates.candidateOutputs,
            candidateScores: draftCandidates.scores,
            ...(styleReferenceLineage ? { styleReferenceLineage } : {}),
            generationMode: params.task.target.generationMode,
            edit: params.task.target.edit,
            regenerationSource: params.task.target.regenerationSource,
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

function resolveProviderGenerationPolicy(target: PlannedTarget, providerName: ProviderName) {
  return normalizeGenerationPolicyForProvider(providerName, getTargetGenerationPolicy(target))
    .policy;
}

function materializeDraftTarget(
  target: PlannedTarget,
  normalizedPolicy: ReturnType<typeof resolveProviderGenerationPolicy>,
): PlannedTarget {
  if (!normalizedPolicy.coarseToFine?.enabled || !normalizedPolicy.draftQuality) {
    return target;
  }

  return {
    ...target,
    generationPolicy: {
      ...(target.generationPolicy ?? {}),
      quality: normalizedPolicy.draftQuality,
    },
  };
}

async function scoreProviderRunCandidates(params: {
  target: PlannedTarget;
  runResult: ProviderRunResult;
  outDir: string;
  scoreOptions?: Omit<ScoreCandidateImagesOptions, "outDir">;
}): Promise<ScoredCandidateSet> {
  const candidateOutputs =
    params.runResult.candidateOutputs && params.runResult.candidateOutputs.length > 0
      ? params.runResult.candidateOutputs
      : [
          {
            outputPath: params.runResult.outputPath,
            bytesWritten: params.runResult.bytesWritten,
          },
        ];

  const candidateSelection = await scoreCandidateImages(
    params.target,
    candidateOutputs.map((candidate) => candidate.outputPath),
    {
      outDir: params.outDir,
      ...(params.scoreOptions ?? {}),
    },
  );

  return {
    candidateOutputs,
    scores: candidateSelection.scores,
    bestPath: candidateSelection.bestPath,
  };
}

async function runCoarseToFineRefinement(params: {
  provider: GenerationProvider;
  providerName: ProviderName;
  task: TargetTask;
  runContext: {
    outDir: string;
    imagesDir: string;
    now?: () => Date;
    fetchImpl?: typeof fetch;
  };
  policy: NonNullable<ReturnType<typeof resolveProviderGenerationPolicy>["coarseToFine"]>;
  normalizedPolicy: ReturnType<typeof resolveProviderGenerationPolicy>;
  draftCandidates: ScoredCandidateSet;
}): Promise<{
  bestPath: string;
  candidateOutputs: ProviderCandidateOutput[];
  scores: CandidateScoreRecord[];
  coarseToFine: NonNullable<ProviderRunResult["coarseToFine"]>;
}> {
  const draftQuality = params.normalizedPolicy.draftQuality ?? params.normalizedPolicy.quality;
  const finalQuality = params.normalizedPolicy.finalQuality ?? params.normalizedPolicy.quality;

  const promotedRows: {
    outputPath: string;
    score: number;
    passedAcceptance: boolean;
    refinedOutputPath?: string;
  }[] = [];
  const discardedRows: {
    outputPath: string;
    score: number;
    passedAcceptance: boolean;
    reason: string;
  }[] = [];
  const warnings: string[] = [];
  const promotedSet = new Set<string>();

  for (const score of params.draftCandidates.scores) {
    let discardReason: string | null = null;
    if (params.policy.requireDraftAcceptance && !score.passedAcceptance) {
      discardReason = "draft_failed_acceptance";
    } else if (
      typeof params.policy.minDraftScore === "number" &&
      score.score < params.policy.minDraftScore
    ) {
      discardReason = "below_min_draft_score";
    } else if (promotedRows.length >= params.policy.promoteTopK) {
      discardReason = "outside_top_k";
    }

    if (discardReason) {
      discardedRows.push({
        outputPath: score.outputPath,
        score: score.score,
        passedAcceptance: score.passedAcceptance,
        reason: discardReason,
      });
      continue;
    }

    promotedRows.push({
      outputPath: score.outputPath,
      score: score.score,
      passedAcceptance: score.passedAcceptance,
    });
    promotedSet.add(score.outputPath);
  }

  const draftScoresDecorated = params.draftCandidates.scores.map((score) => ({
    ...score,
    stage: "draft" as const,
    promoted: promotedSet.has(score.outputPath),
    selected: false,
  }));

  const coarseSummaryBase: Omit<
    NonNullable<ProviderRunResult["coarseToFine"]>,
    "discarded" | "promoted"
  > = {
    enabled: true,
    draftQuality,
    finalQuality,
    promoteTopK: params.policy.promoteTopK,
    ...(typeof params.policy.minDraftScore === "number"
      ? { minDraftScore: params.policy.minDraftScore }
      : {}),
    requireDraftAcceptance: params.policy.requireDraftAcceptance,
    draftCandidateCount: params.draftCandidates.candidateOutputs.length,
  };

  if (promotedRows.length === 0) {
    return {
      bestPath: params.draftCandidates.bestPath,
      candidateOutputs: params.draftCandidates.candidateOutputs,
      scores: draftScoresDecorated.map((score) => ({
        ...score,
        selected: score.outputPath === params.draftCandidates.bestPath,
      })),
      coarseToFine: {
        ...coarseSummaryBase,
        promoted: promotedRows,
        discarded: discardedRows,
        skippedReason: "no_candidates_promoted",
      },
    };
  }

  if (!params.provider.supports("image-edits")) {
    warnings.push(
      `Provider "${params.providerName}" lacks image-edits support; coarse-to-fine refinement skipped.`,
    );
    return {
      bestPath: params.draftCandidates.bestPath,
      candidateOutputs: params.draftCandidates.candidateOutputs,
      scores: draftScoresDecorated.map((score) => ({
        ...score,
        selected: score.outputPath === params.draftCandidates.bestPath,
      })),
      coarseToFine: {
        ...coarseSummaryBase,
        promoted: promotedRows,
        discarded: discardedRows,
        skippedReason: "provider_missing_image_edit_support",
        warnings,
      },
    };
  }

  if (params.task.target.generationMode === "edit-first") {
    warnings.push("Coarse-to-fine refinement is skipped for edit-first targets.");
    return {
      bestPath: params.draftCandidates.bestPath,
      candidateOutputs: params.draftCandidates.candidateOutputs,
      scores: draftScoresDecorated.map((score) => ({
        ...score,
        selected: score.outputPath === params.draftCandidates.bestPath,
      })),
      coarseToFine: {
        ...coarseSummaryBase,
        promoted: promotedRows,
        discarded: discardedRows,
        skippedReason: "target_already_edit_first",
        warnings,
      },
    };
  }

  const refinedOutputs: ProviderCandidateOutput[] = [];
  const sourceByRefinedOutput = new Map<string, string>();

  for (const [index, promoted] of promotedRows.entries()) {
    const refineTarget = createRefineTarget({
      target: params.task.target,
      sourceOutputPath: promoted.outputPath,
      outDir: params.runContext.outDir,
      finalQuality,
      refineIndex: index + 1,
    });

    const refineJobs = await params.provider.prepareJobs([refineTarget], {
      outDir: params.runContext.outDir,
      imagesDir: params.runContext.imagesDir,
      now: params.runContext.now,
    });
    if (refineJobs.length === 0) {
      throw new ProviderError({
        provider: params.providerName,
        code: "coarse_to_fine_no_refine_job",
        message: `Provider ${params.providerName} did not produce refine job for ${params.task.target.id}.`,
      });
    }

    const refineJob = refineJobs[0];
    const refineRunResult = await params.provider.runJob(refineJob, {
      outDir: params.runContext.outDir,
      imagesDir: params.runContext.imagesDir,
      now: params.runContext.now,
      fetchImpl: params.runContext.fetchImpl,
    });

    const refineSelection = await scoreProviderRunCandidates({
      target: params.task.target,
      runResult: refineRunResult,
      outDir: params.runContext.outDir,
      scoreOptions: COARSE_TO_FINE_DRAFT_SCORING_OPTIONS,
    });

    await copyIfDifferent(refineSelection.bestPath, refineJob.outPath);
    const refinedStat = await stat(refineJob.outPath);
    refinedOutputs.push({
      outputPath: refineJob.outPath,
      bytesWritten: refinedStat.size,
    });
    sourceByRefinedOutput.set(refineJob.outPath, promoted.outputPath);
    promoted.refinedOutputPath = refineJob.outPath;
  }

  const finalRefineSelection = await scoreCandidateImages(
    params.task.target,
    refinedOutputs.map((row) => row.outputPath),
    { outDir: params.runContext.outDir },
  );

  const refineScoresDecorated = finalRefineSelection.scores.map((score) => ({
    ...score,
    stage: "refine" as const,
    promoted: true,
    sourceOutputPath: sourceByRefinedOutput.get(score.outputPath),
  }));

  return {
    bestPath: finalRefineSelection.bestPath,
    candidateOutputs: [...params.draftCandidates.candidateOutputs, ...refinedOutputs],
    scores: [...draftScoresDecorated, ...refineScoresDecorated],
    coarseToFine: {
      ...coarseSummaryBase,
      promoted: promotedRows,
      discarded: discardedRows,
      ...(warnings.length > 0 ? { warnings } : {}),
    },
  };
}

function createRefineTarget(params: {
  target: PlannedTarget;
  sourceOutputPath: string;
  outDir: string;
  finalQuality: string;
  refineIndex: number;
}): PlannedTarget {
  const relativeSource = toPortableRelativePath(params.outDir, params.sourceOutputPath);
  return {
    ...params.target,
    out: withRefineSuffix(params.target.out, params.refineIndex),
    generationMode: "edit-first",
    generationPolicy: {
      ...(params.target.generationPolicy ?? {}),
      quality: params.finalQuality,
      candidates: 1,
    },
    edit: {
      mode: "iterate",
      instruction:
        params.target.edit?.instruction ??
        "Refine the supplied draft candidate at higher fidelity while preserving composition and silhouette.",
      preserveComposition: params.target.edit?.preserveComposition ?? true,
      inputs: [
        {
          path: relativeSource,
          role: "base",
          fidelity: "high",
        },
      ],
    },
  };
}

function withRefineSuffix(filePath: string, refineIndex: number): string {
  const ext = path.extname(filePath);
  const base = filePath.slice(0, filePath.length - ext.length);
  return `${base}.refine-${refineIndex}${ext}`;
}

function toPortableRelativePath(rootDir: string, filePath: string): string {
  const relative = path.relative(rootDir, filePath);
  return relative.split(path.sep).join("/");
}

async function copyIfDifferent(sourcePath: string, destinationPath: string): Promise<void> {
  if (sourcePath === destinationPath) {
    return;
  }
  await cp(sourcePath, destinationPath, { force: true });
}

function backoffMsForAttempt(attempt: number): number {
  return Math.min(5000, 300 * 2 ** (attempt - 1));
}

function targetRequiresEditSupport(target: PlannedTarget): boolean {
  if (target.generationMode !== "edit-first") {
    return false;
  }
  return (target.edit?.inputs?.length ?? 0) > 0;
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

function resolveStyleReferenceLineage(params: {
  task: TargetTask;
  taskById: Map<string, TargetTask>;
  imagesDir: string;
}): ProviderRunResult["styleReferenceLineage"] | undefined {
  const lineage: NonNullable<ProviderRunResult["styleReferenceLineage"]> = [];

  for (const styleReferenceImage of params.task.target.styleReferenceImages ?? []) {
    lineage.push({
      source: "style-kit",
      reference: styleReferenceImage,
    });
  }

  for (const sourceTargetId of params.task.target.styleReferenceFrom ?? []) {
    const sourceTask = params.taskById.get(sourceTargetId);
    if (!sourceTask) {
      throw new Error(
        `Target "${params.task.target.id}" chains style references from "${sourceTargetId}", but that target is not in the current generation set.`,
      );
    }
    const sourceOutputPath = path.resolve(
      params.imagesDir,
      sourceTask.target.out.split("/").join(path.sep),
    );
    lineage.push({
      source: "target-output",
      reference: sourceTask.target.out,
      sourceTargetId,
      resolvedPath: sourceOutputPath,
    });
  }

  return lineage.length > 0 ? lineage : undefined;
}

function dedupeTargetIdList(targetIds: string[]): string[] {
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const targetId of targetIds) {
    if (seen.has(targetId)) {
      continue;
    }
    seen.add(targetId);
    deduped.push(targetId);
  }
  return deduped;
}

function resolveManifestPathFromIndex(
  index: TargetsIndexShape,
  targetsIndexPath: string,
): string | undefined {
  if (typeof index.manifestPath !== "string") {
    return undefined;
  }
  const trimmed = index.manifestPath.trim();
  if (!trimmed) {
    return undefined;
  }
  if (path.isAbsolute(trimmed)) {
    return trimmed;
  }
  return path.resolve(path.dirname(targetsIndexPath), trimmed);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readSelectionLock(filePath: string): Promise<SelectionLockFile> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as SelectionLockFile;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!parsed || typeof parsed !== "object") {
      throw new Error(`selection lock file content is not a JSON object (${filePath}).`);
    }
    return parsed;
  } catch (error) {
    if (isNoSuchFileError(error)) {
      return {};
    }
    throw new Error(
      `Failed to parse selection lock JSON (${filePath}): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function isNoSuchFileError(error: unknown): error is { code: string } {
  return (
    Boolean(error) && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT"
  );
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
