import { spawn } from "node:child_process";
import path from "node:path";

import { buildStructuredPrompt } from "../providers/types.js";
import type { PlannedTarget } from "../providers/types.js";

const DEFAULT_ADAPTER_TIMEOUT_MS = 30_000;
const GENERIC_ADAPTER_TIMEOUT_ENV = "LOOTFORGE_ADAPTER_TIMEOUT_MS";

export type SoftAdapterName = "clip" | "lpips" | "ssim";

export interface SoftAdapterRunInput {
  target: PlannedTarget;
  imagePath: string;
  outDir: string;
}

export interface SoftAdapterRunResult {
  adapterNames: SoftAdapterName[];
  adapterMetrics: Partial<Record<SoftAdapterName, Record<string, number>>>;
  adapterScores: Partial<Record<SoftAdapterName, number>>;
  warnings: string[];
}

interface SoftAdapterConfig {
  name: SoftAdapterName;
  command?: string;
  url?: string;
  timeoutMs: number;
}

interface SoftAdapterPayload {
  adapter: SoftAdapterName;
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

interface SoftAdapterResponse {
  metrics: Record<string, number>;
  score?: number;
}

export function getEnabledSoftAdapterNames(): SoftAdapterName[] {
  return getEnabledSoftAdapterConfigs().map((config) => config.name);
}

export async function runEnabledSoftAdapters(
  input: SoftAdapterRunInput,
): Promise<SoftAdapterRunResult> {
  const configs = getEnabledSoftAdapterConfigs();
  if (configs.length === 0) {
    return {
      adapterNames: [],
      adapterMetrics: {},
      adapterScores: {},
      warnings: [],
    };
  }

  const payload = buildSoftAdapterPayload(input);
  const adapterMetrics: Partial<Record<SoftAdapterName, Record<string, number>>> = {};
  const adapterScores: Partial<Record<SoftAdapterName, number>> = {};
  const warnings: string[] = [];

  for (const config of configs) {
    try {
      const response = config.command
        ? await runAdapterCommand(config, payload)
        : await runAdapterHttp(config, payload);
      adapterMetrics[config.name] = response.metrics;
      if (typeof response.score === "number" && Number.isFinite(response.score)) {
        adapterScores[config.name] = response.score;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`${config.name}: ${message}`);
    }
  }

  return {
    adapterNames: configs.map((config) => config.name),
    adapterMetrics,
    adapterScores,
    warnings,
  };
}

function getEnabledSoftAdapterConfigs(): SoftAdapterConfig[] {
  const names: SoftAdapterName[] = ["clip", "lpips", "ssim"];
  const configs: SoftAdapterConfig[] = [];

  for (const name of names) {
    const upper = name.toUpperCase();
    const enabled = parseBooleanEnv(`LOOTFORGE_ENABLE_${upper}_ADAPTER`);
    if (!enabled) {
      continue;
    }

    const command = process.env[`LOOTFORGE_${upper}_ADAPTER_CMD`]?.trim();
    const url = process.env[`LOOTFORGE_${upper}_ADAPTER_URL`]?.trim();
    if (!command && !url) {
      // Keep adapter visible as warning-producing so users know env is incomplete.
      configs.push({
        name,
        timeoutMs:
          parseTimeoutMs(process.env[`LOOTFORGE_${upper}_ADAPTER_TIMEOUT_MS`]) ??
          parseTimeoutMs(process.env[GENERIC_ADAPTER_TIMEOUT_ENV]) ??
          DEFAULT_ADAPTER_TIMEOUT_MS,
      });
      continue;
    }

    configs.push({
      name,
      command,
      url,
      timeoutMs:
        parseTimeoutMs(process.env[`LOOTFORGE_${upper}_ADAPTER_TIMEOUT_MS`]) ??
        parseTimeoutMs(process.env[GENERIC_ADAPTER_TIMEOUT_ENV]) ??
        DEFAULT_ADAPTER_TIMEOUT_MS,
    });
  }

  return configs;
}

function buildSoftAdapterPayload(input: SoftAdapterRunInput): SoftAdapterPayload {
  return {
    adapter: "clip",
    imagePath: input.imagePath,
    prompt: buildStructuredPrompt(input.target.promptSpec),
    referenceImages: resolveReferenceImages(input.target, input.outDir),
    target: {
      id: input.target.id,
      kind: input.target.kind,
      out: input.target.out,
      styleKitId: input.target.styleKitId,
      consistencyGroup: input.target.consistencyGroup,
      evaluationProfileId: input.target.evaluationProfileId,
    },
  };
}

async function runAdapterCommand(
  config: SoftAdapterConfig,
  payloadBase: SoftAdapterPayload,
): Promise<SoftAdapterResponse> {
  if (!config.command) {
    throw new Error(
      `adapter enabled but command/url missing. Set LOOTFORGE_${config.name.toUpperCase()}_ADAPTER_CMD or _URL.`,
    );
  }

  const payload = {
    ...payloadBase,
    adapter: config.name,
  };
  const shell = resolveShell();
  const args = resolveShellArgs(config.command);
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
    }, config.timeoutMs);

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
        reject(new Error(`timed out after ${config.timeoutMs}ms`));
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

  return parseSoftAdapterResponse(config.name, stdout);
}

async function runAdapterHttp(
  config: SoftAdapterConfig,
  payloadBase: SoftAdapterPayload,
): Promise<SoftAdapterResponse> {
  if (!config.url) {
    throw new Error(
      `adapter enabled but command/url missing. Set LOOTFORGE_${config.name.toUpperCase()}_ADAPTER_CMD or _URL.`,
    );
  }

  if (typeof fetch !== "function") {
    throw new Error("global fetch is unavailable for adapter HTTP execution.");
  }

  const payload = {
    ...payloadBase,
    adapter: config.name,
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(config.url, {
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

    return parseSoftAdapterResponse(config.name, await response.text());
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`HTTP adapter request timed out after ${config.timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function parseSoftAdapterResponse(
  name: SoftAdapterName,
  rawOutput: string,
): SoftAdapterResponse {
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
    throw new Error(`${name} adapter returned no numeric metrics or score.`);
  }

  return {
    metrics,
    ...(typeof score === "number" ? { score } : {}),
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
