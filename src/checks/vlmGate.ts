import { spawn } from "node:child_process";

import { buildStructuredPrompt } from "../providers/types.js";
import type { CandidateVlmScore, PlannedTarget } from "../providers/types.js";
import { resolvePathWithinRoot } from "../shared/paths.js";

const DEFAULT_VLM_GATE_THRESHOLD = 4;
const DEFAULT_VLM_GATE_MAX_SCORE = 5;
const DEFAULT_VLM_GATE_TIMEOUT_MS = 45_000;

const VLM_GATE_COMMAND_ENV = "LOOTFORGE_VLM_GATE_CMD";
const VLM_GATE_URL_ENV = "LOOTFORGE_VLM_GATE_URL";
const VLM_GATE_TIMEOUT_ENV = "LOOTFORGE_VLM_GATE_TIMEOUT_MS";

interface VlmGateConfig {
  mode: "command" | "http";
  timeoutMs: number;
  command?: string;
  url?: string;
}

interface VlmGatePayload {
  imagePath: string;
  prompt: string;
  threshold: number;
  maxScore: number;
  rubric?: string;
  target: {
    id: string;
    kind?: string;
    out: string;
    styleKitId?: string;
    consistencyGroup?: string;
    evaluationProfileId?: string;
  };
}

interface VlmGateResponse {
  score: number;
  reason?: string;
}

export interface CandidateVlmGateInput {
  target: PlannedTarget;
  imagePath: string;
  outDir: string;
}

export function targetHasVlmGate(target: PlannedTarget): boolean {
  return target.generationPolicy?.vlmGate !== undefined;
}

export async function runCandidateVlmGate(
  input: CandidateVlmGateInput,
): Promise<CandidateVlmScore | undefined> {
  const gate = resolveVlmGatePolicy(input.target);
  if (!gate) {
    return undefined;
  }

  const config = resolveVlmGateConfig(input.target.id);
  const payload = buildPayload(input, gate.threshold, gate.rubric);
  const response =
    config.mode === "command"
      ? await runVlmGateCommand(config, payload)
      : await runVlmGateHttp(config, payload);
  const passed = response.score >= gate.threshold;

  return {
    score: response.score,
    threshold: gate.threshold,
    maxScore: DEFAULT_VLM_GATE_MAX_SCORE,
    passed,
    reason:
      response.reason ??
      (passed
        ? `score ${response.score.toFixed(2)} met threshold ${gate.threshold.toFixed(2)}`
        : `score ${response.score.toFixed(2)} fell below threshold ${gate.threshold.toFixed(2)}`),
    ...(gate.rubric ? { rubric: gate.rubric } : {}),
    evaluator: config.mode,
  };
}

function resolveVlmGatePolicy(target: PlannedTarget): { threshold: number; rubric?: string } | undefined {
  const policy = target.generationPolicy?.vlmGate;
  if (!policy) {
    return undefined;
  }

  const threshold =
    typeof policy.threshold === "number" && Number.isFinite(policy.threshold)
      ? Math.max(0, Math.min(DEFAULT_VLM_GATE_MAX_SCORE, policy.threshold))
      : DEFAULT_VLM_GATE_THRESHOLD;
  const rubric =
    typeof policy.rubric === "string" && policy.rubric.trim()
      ? policy.rubric.trim()
      : undefined;

  return {
    threshold,
    ...(rubric ? { rubric } : {}),
  };
}

function resolveVlmGateConfig(targetId: string): VlmGateConfig {
  const command = process.env[VLM_GATE_COMMAND_ENV]?.trim();
  const url = process.env[VLM_GATE_URL_ENV]?.trim();
  const timeoutMs = parseTimeoutMs(process.env[VLM_GATE_TIMEOUT_ENV]) ?? DEFAULT_VLM_GATE_TIMEOUT_MS;

  if (command) {
    return {
      mode: "command",
      timeoutMs,
      command,
    };
  }

  if (url) {
    return {
      mode: "http",
      timeoutMs,
      url,
    };
  }

  throw new Error(
    `Target "${targetId}" configured generationPolicy.vlmGate but no evaluator is configured. Set ${VLM_GATE_COMMAND_ENV} or ${VLM_GATE_URL_ENV}.`,
  );
}

function buildPayload(
  input: CandidateVlmGateInput,
  threshold: number,
  rubric: string | undefined,
): VlmGatePayload {
  const safeImagePath = resolvePathWithinRoot(
    input.outDir,
    input.imagePath,
    `VLM candidate path for target "${input.target.id}"`,
  );

  return {
    imagePath: safeImagePath,
    prompt: buildStructuredPrompt(input.target.promptSpec),
    threshold,
    maxScore: DEFAULT_VLM_GATE_MAX_SCORE,
    ...(rubric ? { rubric } : {}),
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

async function runVlmGateCommand(
  config: VlmGateConfig,
  payload: VlmGatePayload,
): Promise<VlmGateResponse> {
  if (!config.command) {
    throw new Error("VLM gate command was not configured.");
  }

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

  return parseVlmGateResponse(stdout);
}

async function runVlmGateHttp(
  config: VlmGateConfig,
  payload: VlmGatePayload,
): Promise<VlmGateResponse> {
  if (!config.url) {
    throw new Error("VLM gate URL was not configured.");
  }

  if (typeof fetch !== "function") {
    throw new Error("global fetch is unavailable for VLM gate HTTP execution.");
  }

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

    return parseVlmGateResponse(await response.text());
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`HTTP gate request timed out after ${config.timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function parseVlmGateResponse(rawOutput: string): VlmGateResponse {
  const trimmed = rawOutput.trim();
  if (!trimmed) {
    throw new Error("VLM gate produced empty stdout.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new Error(
      `VLM gate stdout is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isRecord(parsed)) {
    throw new Error("VLM gate response must be a JSON object.");
  }

  const score = parsed.score;
  if (typeof score !== "number" || !Number.isFinite(score)) {
    throw new Error("VLM gate response requires numeric `score`.");
  }
  if (score < 0 || score > DEFAULT_VLM_GATE_MAX_SCORE) {
    throw new Error(
      `VLM gate score must be between 0 and ${DEFAULT_VLM_GATE_MAX_SCORE}; received ${score}.`,
    );
  }

  const reason =
    typeof parsed.reason === "string" && parsed.reason.trim()
      ? parsed.reason.trim()
      : undefined;

  return {
    score,
    ...(reason ? { reason } : {}),
  };
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
