import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  ImageAcceptanceItemReport,
  runImageAcceptanceChecks,
} from "../checks/imageAcceptance.js";
import { buildStructuredPrompt } from "../providers/types.js";
import type { PlannedTarget } from "../providers/types.js";
import { writeJsonFile } from "../shared/fs.js";
import { resolveStagePathLayout } from "../shared/paths.js";

const DEFAULT_ADAPTER_TIMEOUT_MS = 30_000;
const GENERIC_ADAPTER_TIMEOUT_ENV = "LOOTFORGE_ADAPTER_TIMEOUT_MS";

type ExternalAdapterName = "clip" | "lpips" | "ssim";

interface TargetsIndexShape {
  targets?: PlannedTarget[];
}

interface ProvenanceRun {
  jobs?: Array<{
    targetId: string;
    candidateScores?: Array<{
      outputPath: string;
      score: number;
      passedAcceptance: boolean;
      reasons: string[];
      metrics?: Record<string, number>;
      selected?: boolean;
    }>;
  }>;
}

interface SoftMetricAdapterResult {
  metrics: Record<string, number>;
  score?: number;
}

interface SoftMetricAdapter {
  name: ExternalAdapterName;
  isAvailable(): boolean;
  score(params: {
    target: PlannedTarget;
    imagePath: string;
    outDir: string;
  }): Promise<SoftMetricAdapterResult>;
}

interface ExternalAdapterPayload {
  adapter: ExternalAdapterName;
  imagePath: string;
  prompt: string;
  referenceImages: string[];
  target: {
    id: string;
    kind?: string;
    out: string;
    styleKitId?: string;
    consistencyGroup?: string;
    evaluationProfileId?: string;
  };
}

export interface EvalPipelineOptions {
  outDir: string;
  targetsIndexPath?: string;
  imagesDir?: string;
  strict?: boolean;
  reportPath?: string;
}

export interface EvalTargetResult {
  targetId: string;
  out: string;
  passedHardGates: boolean;
  hardGateErrors: string[];
  hardGateWarnings: string[];
  acceptanceMetrics?: ImageAcceptanceItemReport["metrics"];
  candidateScore?: number;
  candidateReasons?: string[];
  candidateMetrics?: Record<string, number>;
  adapterMetrics?: Record<string, number>;
  adapterScore?: number;
  adapterScoreComponents?: Record<string, number>;
  adapterWarnings?: string[];
  finalScore: number;
}

export interface EvalReport {
  generatedAt: string;
  strict: boolean;
  imagesDir: string;
  targetCount: number;
  passed: number;
  failed: number;
  hardErrors: number;
  adaptersUsed: string[];
  adapterWarnings: string[];
  targets: EvalTargetResult[];
}

export interface EvalPipelineResult {
  reportPath: string;
  report: EvalReport;
}

export async function runEvalPipeline(options: EvalPipelineOptions): Promise<EvalPipelineResult> {
  const layout = resolveStagePathLayout(options.outDir);
  const targetsIndexPath = path.resolve(
    options.targetsIndexPath ?? path.join(layout.jobsDir, "targets-index.json"),
  );
  const imagesDir = path.resolve(options.imagesDir ?? layout.processedImagesDir);
  const strict = options.strict ?? true;

  const targets = await loadTargets(targetsIndexPath);
  const acceptance = await runImageAcceptanceChecks({
    targets,
    imagesDir,
    strict,
  });

  const provenance = await readProvenance(path.join(layout.provenanceDir, "run.json"));
  const candidateScoresByTarget = new Map(
    (provenance.jobs ?? []).map((job) => [
      job.targetId,
      (job.candidateScores ?? []).find((score) => score.selected) ?? job.candidateScores?.[0],
    ]),
  );

  const adapters = getSoftMetricAdapters().filter((adapter) => adapter.isAvailable());
  const reportAdapterWarnings: string[] = [];

  const targetsById = new Map(targets.map((target) => [target.id, target]));
  const targetResults: EvalTargetResult[] = [];

  for (const item of acceptance.items) {
    const target = targetsById.get(item.targetId);
    if (!target) {
      continue;
    }

    const candidate = candidateScoresByTarget.get(item.targetId);
    const adapterMetrics: Record<string, number> = {};
    const adapterScoreComponents: Record<string, number> = {};
    const adapterWarnings: string[] = [];
    let adapterScore = 0;

    for (const adapter of adapters) {
      try {
        const result = await adapter.score({
          target,
          imagePath: item.imagePath,
          outDir: layout.outDir,
        });

        for (const [name, value] of Object.entries(result.metrics)) {
          adapterMetrics[`${adapter.name}.${name}`] = value;
        }
        if (typeof result.score === "number" && Number.isFinite(result.score)) {
          adapterScore += result.score;
          adapterScoreComponents[adapter.name] = result.score;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const warning = `${adapter.name}: ${message}`;
        adapterWarnings.push(warning);
        reportAdapterWarnings.push(`${item.targetId}: ${warning}`);
      }
    }

    const hardGateErrors = item.issues
      .filter((issue) => issue.level === "error")
      .map((issue) => `${issue.code}: ${issue.message}`);
    const hardGateWarnings = item.issues
      .filter((issue) => issue.level === "warning")
      .map((issue) => `${issue.code}: ${issue.message}`);

    const candidateScore = typeof candidate?.score === "number" ? candidate.score : 0;
    const penalty = hardGateErrors.length * 1000;

    targetResults.push({
      targetId: item.targetId,
      out: item.out,
      passedHardGates: hardGateErrors.length === 0,
      hardGateErrors,
      hardGateWarnings,
      acceptanceMetrics: item.metrics,
      candidateScore,
      candidateReasons: candidate?.reasons,
      candidateMetrics: candidate?.metrics,
      adapterMetrics,
      ...(adapterScore !== 0 ? { adapterScore } : {}),
      ...(Object.keys(adapterScoreComponents).length > 0
        ? { adapterScoreComponents }
        : {}),
      ...(adapterWarnings.length > 0 ? { adapterWarnings } : {}),
      finalScore: candidateScore + adapterScore - penalty,
    });
  }

  targetResults.sort((left, right) => left.targetId.localeCompare(right.targetId));

  const failed = targetResults.filter((target) => !target.passedHardGates).length;
  const hardErrors = targetResults.reduce(
    (count, target) => count + target.hardGateErrors.length,
    0,
  );

  const report: EvalReport = {
    generatedAt: new Date().toISOString(),
    strict,
    imagesDir,
    targetCount: targetResults.length,
    passed: targetResults.length - failed,
    failed,
    hardErrors,
    adaptersUsed: adapters.map((adapter) => adapter.name),
    adapterWarnings: reportAdapterWarnings,
    targets: targetResults,
  };

  const reportPath = path.resolve(
    options.reportPath ?? path.join(layout.checksDir, "eval-report.json"),
  );
  await writeJsonFile(reportPath, report);

  if (strict && hardErrors > 0) {
    throw new Error(`Evaluation failed with ${hardErrors} hard error(s).`);
  }

  return {
    reportPath,
    report,
  };
}

async function loadTargets(targetsIndexPath: string): Promise<PlannedTarget[]> {
  const raw = await readFile(targetsIndexPath, "utf8");
  const parsed = JSON.parse(raw) as TargetsIndexShape;
  if (!Array.isArray(parsed.targets)) {
    return [];
  }
  return parsed.targets.filter((target) => !target.catalogDisabled);
}

async function readProvenance(runPath: string): Promise<ProvenanceRun> {
  try {
    const raw = await readFile(runPath, "utf8");
    return JSON.parse(raw) as ProvenanceRun;
  } catch {
    return {};
  }
}

function getSoftMetricAdapters(): SoftMetricAdapter[] {
  return [
    createExternalAdapter("clip"),
    createExternalAdapter("lpips"),
    createExternalAdapter("ssim"),
  ];
}

function createExternalAdapter(name: ExternalAdapterName): SoftMetricAdapter {
  const upper = name.toUpperCase();
  const enableEnv = `LOOTFORGE_ENABLE_${upper}_ADAPTER`;
  const cmdEnv = `LOOTFORGE_${upper}_ADAPTER_CMD`;
  const urlEnv = `LOOTFORGE_${upper}_ADAPTER_URL`;
  const timeoutEnv = `LOOTFORGE_${upper}_ADAPTER_TIMEOUT_MS`;

  return {
    name,
    isAvailable: () => parseBooleanEnv(enableEnv),
    score: async (params) => {
      const command = process.env[cmdEnv]?.trim();
      const url = process.env[urlEnv]?.trim();
      const timeoutMs = parseTimeoutMs(process.env[timeoutEnv]) ??
        parseTimeoutMs(process.env[GENERIC_ADAPTER_TIMEOUT_ENV]) ??
        DEFAULT_ADAPTER_TIMEOUT_MS;

      if (!command && !url) {
        throw new Error(
          `${name} adapter is enabled but neither ${cmdEnv} nor ${urlEnv} is configured.`,
        );
      }

      const payload = buildExternalAdapterPayload(name, params.target, params.imagePath, params.outDir);

      if (command) {
        return runAdapterCommand(name, command, payload, timeoutMs);
      }

      return runAdapterHttp(name, url as string, payload, timeoutMs);
    },
  };
}

function buildExternalAdapterPayload(
  adapter: ExternalAdapterName,
  target: PlannedTarget,
  imagePath: string,
  outDir: string,
): ExternalAdapterPayload {
  return {
    adapter,
    imagePath,
    prompt: buildStructuredPrompt(target.promptSpec),
    referenceImages: resolveReferenceImages(target, outDir),
    target: {
      id: target.id,
      kind: target.kind,
      out: target.out,
      styleKitId: target.styleKitId,
      consistencyGroup: target.consistencyGroup,
      evaluationProfileId: target.evaluationProfileId,
    },
  };
}

function resolveReferenceImages(target: PlannedTarget, outDir: string): string[] {
  const inputs = target.edit?.inputs ?? [];
  const resolved = new Set<string>();

  for (const input of inputs) {
    if (input.role === "mask") {
      continue;
    }
    if (path.isAbsolute(input.path)) {
      resolved.add(path.normalize(input.path));
    } else {
      resolved.add(path.resolve(outDir, input.path));
    }
  }

  return Array.from(resolved);
}

async function runAdapterCommand(
  name: ExternalAdapterName,
  command: string,
  payload: ExternalAdapterPayload,
  timeoutMs: number,
): Promise<SoftMetricAdapterResult> {
  const shell = resolveShell();
  const args = resolveShellArgs(command);
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(shell, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let output = "";
    let errorOutput = "";
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      errorOutput += chunk;
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(new Error(`timed out after ${timeoutMs}ms`));
        return;
      }
      if (code !== 0) {
        reject(
          new Error(
            `command exited with code ${code}. stderr: ${errorOutput.trim() || "(empty)"}`,
          ),
        );
        return;
      }
      resolve(output);
    });

    child.stdin.write(`${JSON.stringify(payload)}\n`, "utf8");
    child.stdin.end();
  });

  return parseAdapterResponse(name, stdout);
}

async function runAdapterHttp(
  name: ExternalAdapterName,
  url: string,
  payload: ExternalAdapterPayload,
  timeoutMs: number,
): Promise<SoftMetricAdapterResult> {
  if (typeof fetch !== "function") {
    throw new Error("global fetch is unavailable for adapter HTTP execution.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}: ${(await response.text()).trim() || "(empty response body)"}`,
      );
    }

    return parseAdapterResponse(name, await response.text());
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`HTTP adapter request timed out after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function parseAdapterResponse(
  name: ExternalAdapterName,
  rawOutput: string,
): SoftMetricAdapterResult {
  const trimmed = rawOutput.trim();
  if (!trimmed) {
    throw new Error("adapter produced empty stdout.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new Error(
      `adapter stdout is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!isRecord(parsed)) {
    throw new Error("adapter response must be a JSON object.");
  }

  const metricsSource = isRecord(parsed.metrics) ? parsed.metrics : parsed;
  const metrics: Record<string, number> = {};
  let score: number | undefined;

  if (typeof parsed.score === "number" && Number.isFinite(parsed.score)) {
    score = parsed.score;
  }

  for (const [key, value] of Object.entries(metricsSource)) {
    if (key === "score") {
      if (score === undefined && typeof value === "number" && Number.isFinite(value)) {
        score = value;
      }
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      metrics[key] = value;
    }
  }

  if (Object.keys(metrics).length === 0 && score === undefined) {
    throw new Error(
      `${name} adapter returned no numeric metrics or score.`,
    );
  }

  return {
    metrics,
    ...(typeof score === "number" ? { score } : {}),
  };
}

function parseBooleanEnv(name: string): boolean {
  const raw = process.env[name];
  if (!raw) {
    return false;
  }

  const normalized = raw.trim().toLowerCase();
  return ["1", "true", "yes", "y"].includes(normalized);
}

function parseTimeoutMs(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}

function resolveShell(): string {
  if (process.platform === "win32") {
    return process.env.ComSpec ?? "cmd.exe";
  }
  return process.env.SHELL?.trim() || "/bin/sh";
}

function resolveShellArgs(command: string): string[] {
  if (process.platform === "win32") {
    return ["/d", "/s", "/c", command];
  }
  return ["-lc", command];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
