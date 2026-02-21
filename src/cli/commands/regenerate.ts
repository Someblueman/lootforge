import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  type GenerateProgressEvent,
  parseGenerateProviderFlag,
  runGeneratePipeline,
} from "../../pipeline/generate.js";
import { type ProviderRegistry } from "../../providers/registry.js";
import { type PlannedTarget, type ProviderSelection } from "../../providers/types.js";
import { CliError } from "../../shared/errors.js";
import { resolvePathWithinRoot, resolveStagePathLayout } from "../../shared/paths.js";
import { readArgValue, parseBooleanArg } from "../parseArgs.js";

interface SelectionLockItem {
  targetId: string;
  inputHash: string;
  selectedOutputPath: string;
  approved?: boolean;
}

interface SelectionLockFile {
  generatedAt?: string;
  targets?: SelectionLockItem[];
}

interface TargetsIndexShape {
  generatedAt?: string;
  manifestPath?: string;
  targets?: PlannedTarget[];
}

export interface RegenerateCommandArgs {
  outDir: string;
  targetsIndexPath?: string;
  provider: ProviderSelection;
  selectionLockPath?: string;
  ids: string[];
  edit: boolean;
  instruction?: string;
  preserveComposition: boolean;
}

export interface RegenerateCommandResult {
  runId: string;
  jobs: number;
  imagesDir: string;
  provenancePath: string;
  targetsRegenerated: string[];
}

interface RunRegenerateCommandOptions {
  now?: () => Date;
  fetchImpl?: typeof fetch;
  registry?: ProviderRegistry;
  onProgress?: (event: GenerateProgressEvent) => void;
}

export function parseRegenerateCommandArgs(argv: string[]): RegenerateCommandArgs {
  const outFlag = readArgValue(argv, "out");
  const indexFlag = readArgValue(argv, "index");
  const providerFlag = readArgValue(argv, "provider");
  const lockFlag = readArgValue(argv, "lock");
  const idsFlag = readArgValue(argv, "ids");
  const editFlag = readArgValue(argv, "edit");
  const preserveCompositionFlag = readArgValue(argv, "preserve-composition");
  const instruction = readArgValue(argv, "instruction")?.trim() ?? undefined;

  return {
    outDir: path.resolve(outFlag ?? process.cwd()),
    targetsIndexPath: indexFlag ? path.resolve(indexFlag) : undefined,
    provider: parseGenerateProviderFlag(providerFlag),
    selectionLockPath: lockFlag ? path.resolve(lockFlag) : undefined,
    ids: idsFlag
      ? idsFlag
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : [],
    edit: parseBooleanArg(editFlag ?? "true", "--edit"),
    preserveComposition: parseBooleanArg(
      preserveCompositionFlag ?? "true",
      "--preserve-composition",
    ),
    instruction,
  };
}

export async function runRegenerateCommand(
  argv: string[],
  options: RunRegenerateCommandOptions = {},
): Promise<RegenerateCommandResult> {
  const args = parseRegenerateCommandArgs(argv);
  const layout = resolveStagePathLayout(args.outDir);

  const targetsIndexPath = path.resolve(
    args.targetsIndexPath ?? path.join(layout.jobsDir, "targets-index.json"),
  );
  const selectionLockPath = path.resolve(
    args.selectionLockPath ?? path.join(layout.outDir, "locks", "selection-lock.json"),
  );

  const [targetsIndex, selectionLock] = await Promise.all([
    readTargetsIndex(targetsIndexPath),
    readSelectionLock(selectionLockPath),
  ]);

  const prepared = await prepareRegenerateTargets({
    outDir: layout.outDir,
    targetsIndex,
    selectionLock,
    selectionLockPath,
    ids: args.ids,
    edit: args.edit,
    instruction: args.instruction,
    preserveComposition: args.preserveComposition,
  });

  const regenerateIndexPath = path.join(layout.jobsDir, "regenerate-targets-index.json");
  await mkdir(path.dirname(regenerateIndexPath), { recursive: true });
  await writeFile(
    regenerateIndexPath,
    `${JSON.stringify(
      {
        generatedAt: targetsIndex.generatedAt,
        manifestPath: targetsIndex.manifestPath,
        targets: prepared.targets,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const pipelineResult = await runGeneratePipeline({
    outDir: args.outDir,
    targetsIndexPath: regenerateIndexPath,
    provider: args.provider,
    ids: prepared.targetIds,
    selectionLockPath,
    skipLocked: false,
    onProgress: options.onProgress ?? writeGenerateProgressLog,
    now: options.now,
    fetchImpl: options.fetchImpl,
    registry: options.registry,
  });

  return {
    runId: pipelineResult.runId,
    jobs: pipelineResult.jobs.length,
    imagesDir: pipelineResult.imagesDir,
    provenancePath: pipelineResult.provenancePath,
    targetsRegenerated: prepared.targetIds,
  };
}

async function readTargetsIndex(targetsIndexPath: string): Promise<TargetsIndexShape> {
  const raw = await readFile(targetsIndexPath, "utf8");
  let parsed: TargetsIndexShape;
  try {
    parsed = JSON.parse(raw) as TargetsIndexShape;
  } catch (error) {
    throw new CliError(
      `Failed to parse targets index JSON (${targetsIndexPath}): ${
        error instanceof Error ? error.message : String(error)
      }`,
      { code: "invalid_targets_index", exitCode: 1 },
    );
  }

  if (!Array.isArray(parsed.targets)) {
    throw new CliError(`No targets found in planned index: ${targetsIndexPath}`, {
      code: "missing_targets",
      exitCode: 1,
    });
  }

  return parsed;
}

async function readSelectionLock(selectionLockPath: string): Promise<SelectionLockFile> {
  let raw: string;
  try {
    raw = await readFile(selectionLockPath, "utf8");
  } catch (error) {
    throw new CliError(
      `Failed to read selection lock "${selectionLockPath}". Run "lootforge select" first.`,
      { code: "selection_lock_missing", exitCode: 1, cause: error },
    );
  }

  try {
    return JSON.parse(raw) as SelectionLockFile;
  } catch (error) {
    throw new CliError(
      `Failed to parse selection lock JSON (${selectionLockPath}): ${
        error instanceof Error ? error.message : String(error)
      }`,
      { code: "selection_lock_invalid", exitCode: 1 },
    );
  }
}

async function prepareRegenerateTargets(params: {
  outDir: string;
  targetsIndex: TargetsIndexShape;
  selectionLock: SelectionLockFile;
  selectionLockPath: string;
  ids: string[];
  edit: boolean;
  instruction?: string;
  preserveComposition: boolean;
}): Promise<{ targets: PlannedTarget[]; targetIds: string[] }> {
  const plannedTargets = params.targetsIndex.targets ?? [];
  const targetsById = new Map(plannedTargets.map((target) => [target.id, target]));
  const lockTargets = params.selectionLock.targets ?? [];
  const lockByTargetId = new Map(lockTargets.map((target) => [target.targetId, target]));
  const approvedLockIds = lockTargets
    .filter((target) => target.approved)
    .map((target) => target.targetId);

  const requestedIds =
    params.ids.length > 0 ? Array.from(new Set(params.ids)) : Array.from(new Set(approvedLockIds));
  if (requestedIds.length === 0) {
    throw new CliError(
      "No regeneration targets resolved. Pass --ids or approve targets via lootforge select.",
      { code: "regenerate_no_targets", exitCode: 1 },
    );
  }

  const targetIdsToRegenerate: string[] = [];
  const rewrittenTargets = new Map<string, PlannedTarget>();

  for (const targetId of requestedIds) {
    const target = targetsById.get(targetId);
    if (!target) {
      throw new CliError(`Target "${targetId}" was not found in targets index.`, {
        code: "regenerate_missing_target",
        exitCode: 1,
      });
    }
    if (target.generationDisabled) {
      throw new CliError(`Target "${targetId}" is generationDisabled and cannot be regenerated.`, {
        code: "regenerate_disabled_target",
        exitCode: 1,
      });
    }

    const lock = lockByTargetId.get(targetId);
    if (!lock) {
      throw new CliError(
        `Target "${targetId}" is missing from selection lock. Run lootforge select before regenerate.`,
        { code: "regenerate_missing_lock_entry", exitCode: 1 },
      );
    }
    if (!lock.approved) {
      throw new CliError(
        `Target "${targetId}" is not approved in selection lock. Review/eval/select before regenerate.`,
        { code: "regenerate_unapproved_lock_entry", exitCode: 1 },
      );
    }

    let selectedOutputPath: string;
    try {
      selectedOutputPath = resolvePathWithinRoot(
        params.outDir,
        lock.selectedOutputPath,
        `selection lock output path for target "${targetId}"`,
      );
    } catch (error) {
      throw new CliError(
        `Selection lock output path for "${targetId}" must stay within --out (${params.outDir}).`,
        {
          code: "regenerate_unsafe_locked_path",
          exitCode: 1,
          cause: error,
        },
      );
    }

    let sourceExists = false;
    try {
      await access(selectedOutputPath);
      sourceExists = true;
    } catch {
      sourceExists = false;
    }
    if (!sourceExists) {
      throw new CliError(
        `Locked source image for "${targetId}" does not exist: ${selectedOutputPath}`,
        { code: "regenerate_missing_locked_image", exitCode: 1 },
      );
    }

    const rewritten = params.edit
      ? toEditFirstRegenerateTarget({
          target,
          lock,
          selectionLockPath: params.selectionLockPath,
          lockGeneratedAt: params.selectionLock.generatedAt,
          selectedOutputPath,
          instruction: params.instruction,
          preserveComposition: params.preserveComposition,
        })
      : {
          ...target,
          regenerationSource: {
            mode: "selection-lock" as const,
            selectionLockPath: params.selectionLockPath,
            selectionLockGeneratedAt: params.selectionLock.generatedAt,
            lockInputHash: lock.inputHash,
            lockSelectedOutputPath: selectedOutputPath,
          },
        };

    rewrittenTargets.set(targetId, rewritten);
    targetIdsToRegenerate.push(targetId);
  }

  return {
    targets: plannedTargets.map((target) => rewrittenTargets.get(target.id) ?? target),
    targetIds: targetIdsToRegenerate,
  };
}

function toEditFirstRegenerateTarget(params: {
  target: PlannedTarget;
  lock: SelectionLockItem;
  selectionLockPath: string;
  lockGeneratedAt?: string;
  selectedOutputPath: string;
  instruction?: string;
  preserveComposition: boolean;
}): PlannedTarget {
  const existingInputs = params.target.edit?.inputs ?? [];
  const nonBaseInputs = existingInputs.filter((input) => input.role !== "base");
  const baseInput = {
    path: params.selectedOutputPath,
    role: "base" as const,
    fidelity: "high" as const,
  };

  const dedupedInputs = [baseInput, ...nonBaseInputs].filter(
    (input, index, list) =>
      list.findIndex(
        (candidate) =>
          candidate.path === input.path &&
          (candidate.role ?? "reference") === (input.role ?? "reference"),
      ) === index,
  );

  return {
    ...params.target,
    generationMode: "edit-first",
    edit: {
      mode: "iterate",
      instruction:
        params.instruction ??
        params.target.edit?.instruction ??
        `Regenerate target "${params.target.id}" from approved selection lock output.`,
      inputs: dedupedInputs,
      preserveComposition: params.preserveComposition,
    },
    regenerationSource: {
      mode: "selection-lock-edit",
      selectionLockPath: params.selectionLockPath,
      selectionLockGeneratedAt: params.lockGeneratedAt,
      lockInputHash: params.lock.inputHash,
      lockSelectedOutputPath: params.selectedOutputPath,
    },
  };
}

function writeGenerateProgressLog(event: GenerateProgressEvent): void {
  if (event.type === "prepare") {
    process.stdout.write(`Preparing ${event.totalJobs} regeneration job(s)...\n`);
    return;
  }

  const printableIndex = typeof event.jobIndex === "number" ? event.jobIndex + 1 : undefined;
  const total = event.totalJobs;
  const slot = typeof printableIndex === "number" ? `[${printableIndex}/${total}] ` : "";
  const target = event.targetId ?? "unknown-target";

  if (event.type === "job_start") {
    process.stdout.write(
      `${slot}regenerating ${target} via ${event.provider ?? "provider"} (${event.model ?? "model"})\n`,
    );
    return;
  }

  if (event.type === "job_finish") {
    process.stdout.write(
      `${slot}finished ${target} -> ${event.outputPath ?? "unknown-output"} (${event.bytesWritten ?? 0} bytes)\n`,
    );
    return;
  }

  process.stdout.write(`${slot}failed ${target}: ${event.message ?? "unknown error"}\n`);
}
