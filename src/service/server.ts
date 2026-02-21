import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import {
  CanonicalGenerationRequestError,
  getCanonicalGenerationRequestContract,
  runCanonicalGenerationRequest,
} from "./generationRequest.js";
import {
  getProviderCapabilitiesContract,
  resolveProviderCapabilityDescriptors,
} from "./providerCapabilities.js";
import { runAtlasCommand } from "../cli/commands/atlas.js";
import { runEvalCommand } from "../cli/commands/eval.js";
import { runGenerateCommand } from "../cli/commands/generate.js";
import { runInitCommand } from "../cli/commands/init.js";
import { runPackageCommand } from "../cli/commands/package.js";
import { runPlanCommand } from "../cli/commands/plan.js";
import { runProcessCommand } from "../cli/commands/process.js";
import { runRegenerateCommand } from "../cli/commands/regenerate.js";
import { runReviewCommand } from "../cli/commands/review.js";
import { runSelectCommand } from "../cli/commands/select.js";
import { runValidateCommand } from "../cli/commands/validate.js";
import { isProviderName, type ProviderName } from "../providers/types.js";
import { CliError, getErrorExitCode, getErrorMessage } from "../shared/errors.js";
import { isRecord } from "../shared/typeGuards.js";

export const SERVICE_API_VERSION = "v1";
const API_PREFIX = `/${SERVICE_API_VERSION}`;
const MAX_REQUEST_BODY_BYTES = 1024 * 1024;

type ServiceToolName =
  | "init"
  | "plan"
  | "validate"
  | "generate"
  | "regenerate"
  | "process"
  | "atlas"
  | "eval"
  | "review"
  | "select"
  | "package";

type ServiceParamKind = "string" | "boolean" | "string_list";

interface ServiceToolParamSpec {
  key: string;
  flag: string;
  kind: ServiceParamKind;
  description: string;
}

interface ServiceToolDefinition {
  name: ServiceToolName;
  description: string;
  params: ServiceToolParamSpec[];
  run: (argv: string[]) => Promise<unknown>;
}

interface ServiceToolExecutionPayload {
  requestId?: string | number;
  params: Record<string, unknown>;
  argvOverride?: string[];
}

export interface ServiceToolDescriptor {
  name: ServiceToolName;
  description: string;
  endpoint: string;
  alias: string;
  params: {
    key: string;
    type: ServiceParamKind;
    description: string;
  }[];
}

export interface StartLootForgeServiceOptions {
  host: string;
  port: number;
  defaultOutDir?: string;
  onListen?: (result: LootForgeService) => void;
}

export interface LootForgeService {
  host: string;
  port: number;
  baseUrl: string;
  close: () => Promise<void>;
}

interface ServiceRequestErrorOptions {
  status: number;
  code: string;
}

class ServiceRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, options: ServiceRequestErrorOptions) {
    super(message);
    this.name = "ServiceRequestError";
    this.status = options.status;
    this.code = options.code;
  }
}

const SERVICE_TOOLS: ServiceToolDefinition[] = [
  {
    name: "init",
    description: "Scaffold assets/imagegen directories and default manifest.",
    params: [stringParam("out", "out", "Output root for init scaffold.")],
    run: runInitCommand,
  },
  {
    name: "plan",
    description: "Validate manifest and write targets/jobs outputs.",
    params: [
      stringParam("manifest", "manifest", "Manifest path."),
      stringParam("out", "out", "Output directory."),
    ],
    run: runPlanCommand,
  },
  {
    name: "validate",
    description: "Validate manifest and optionally run image acceptance checks.",
    params: [
      stringParam("manifest", "manifest", "Manifest path."),
      stringParam("out", "out", "Output directory."),
      booleanParam("strict", "strict", "Strict mode for validation failure behavior."),
      booleanParam(
        "checkImages",
        "check-images",
        "Run image acceptance checks in addition to manifest validation.",
      ),
      stringParam("imagesDir", "images-dir", "Optional processed-images directory override."),
    ],
    run: runValidateCommand,
  },
  {
    name: "generate",
    description: "Execute generation pipeline from targets index.",
    params: [
      stringParam("manifest", "manifest", "Optional manifest path."),
      stringParam("out", "out", "Output directory."),
      stringParam("index", "index", "Optional targets-index path override."),
      stringParam("provider", "provider", "Provider selection (openai|nano|local|auto)."),
      stringListParam("ids", "ids", "Optional target ID filter."),
      stringParam("lock", "lock", "Selection lock path."),
      booleanParam("skipLocked", "skip-locked", "Skip lock-approved targets when true."),
    ],
    run: runGenerateCommand,
  },
  {
    name: "regenerate",
    description: "Regenerate lock-approved targets through the edit-capable flow.",
    params: [
      stringParam("out", "out", "Output directory."),
      stringParam("index", "index", "Optional targets-index path override."),
      stringParam("provider", "provider", "Provider selection (openai|nano|local|auto)."),
      stringParam("lock", "lock", "Selection lock path."),
      stringListParam("ids", "ids", "Optional target ID filter."),
      booleanParam("edit", "edit", "Enable edit-first regenerate behavior."),
      stringParam("instruction", "instruction", "Optional edit instruction override."),
      booleanParam(
        "preserveComposition",
        "preserve-composition",
        "Preserve framing/composition during regenerate edit requests.",
      ),
    ],
    run: runRegenerateCommand,
  },
  {
    name: "process",
    description: "Post-process generated assets into runtime outputs.",
    params: [
      stringParam("out", "out", "Output directory."),
      stringParam("index", "index", "Optional targets-index path override."),
      booleanParam("strict", "strict", "Strict mode for process acceptance failures."),
    ],
    run: runProcessCommand,
  },
  {
    name: "atlas",
    description: "Build atlas outputs and atlas manifest.",
    params: [
      stringParam("out", "out", "Output directory."),
      stringParam("index", "index", "Optional targets-index path override."),
      stringParam("manifest", "manifest", "Optional manifest path."),
    ],
    run: runAtlasCommand,
  },
  {
    name: "eval",
    description: "Run hard/soft quality evaluation.",
    params: [
      stringParam("out", "out", "Output directory."),
      stringParam("index", "index", "Optional targets-index path override."),
      stringParam("imagesDir", "images-dir", "Optional processed-images directory override."),
      stringParam("report", "report", "Eval report output path override."),
      booleanParam("strict", "strict", "Strict mode for eval hard-gate failures."),
    ],
    run: runEvalCommand,
  },
  {
    name: "review",
    description: "Render review HTML from eval report output.",
    params: [
      stringParam("out", "out", "Output directory."),
      stringParam("eval", "eval", "Eval report path override."),
      stringParam("html", "html", "Review HTML output path override."),
    ],
    run: runReviewCommand,
  },
  {
    name: "select",
    description: "Create selection lock from eval + provenance artifacts.",
    params: [
      stringParam("out", "out", "Output directory."),
      stringParam("eval", "eval", "Eval report path override."),
      stringParam("provenance", "provenance", "Provenance run path override."),
      stringParam("lock", "lock", "Selection lock output path override."),
    ],
    run: runSelectCommand,
  },
  {
    name: "package",
    description: "Assemble distributable runtime pack artifacts.",
    params: [
      stringParam("out", "out", "Output directory."),
      stringParam("manifest", "manifest", "Manifest path override."),
      stringParam("index", "index", "Optional targets-index path override."),
      booleanParam("strict", "strict", "Strict mode for package-time checks."),
      stringListParam("runtimes", "runtimes", "Runtime targets (phaser,pixi,unity)."),
    ],
    run: runPackageCommand,
  },
];

const SERVICE_TOOL_BY_NAME = new Map<ServiceToolName, ServiceToolDefinition>(
  SERVICE_TOOLS.map((tool) => [tool.name, tool]),
);

export function getServiceToolDescriptors(): ServiceToolDescriptor[] {
  return SERVICE_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    endpoint: `${API_PREFIX}/tools/${tool.name}`,
    alias: `${API_PREFIX}/${tool.name}`,
    params: tool.params.map((param) => ({
      key: param.key,
      type: param.kind,
      description: param.description,
    })),
  }));
}

export async function startLootForgeService(
  options: StartLootForgeServiceOptions,
): Promise<LootForgeService> {
  const server = createServer((req, res) => {
    void handleRequest(req, res, options).catch((error: unknown) => {
      console.error("Unhandled request error:", error);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(
          JSON.stringify({
            ok: false,
            apiVersion: SERVICE_API_VERSION,
            error: { code: "internal_error", message: "Unexpected server error." },
          }),
        );
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const boundPort = typeof address === "object" && address !== null ? address.port : options.port;
  const baseUrlHost = options.host === "0.0.0.0" ? "127.0.0.1" : options.host;
  const service: LootForgeService = {
    host: options.host,
    port: boundPort,
    baseUrl: `http://${baseUrlHost}:${boundPort}`,
    close: async () => {
      await closeServer(server);
    },
  };

  options.onListen?.(service);
  return service;
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: StartLootForgeServiceOptions,
): Promise<void> {
  const method = req.method ?? "GET";
  const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
  const pathname = normalizePathname(requestUrl.pathname);

  if (method === "OPTIONS") {
    writeCorsHeaders(res);
    writeSecurityHeaders(res);
    res.statusCode = 204;
    res.end();
    return;
  }

  if (method === "GET" && pathname === "/") {
    writeJson(res, 200, {
      ok: true,
      apiVersion: SERVICE_API_VERSION,
      endpoints: {
        health: `${API_PREFIX}/health`,
        tools: `${API_PREFIX}/tools`,
        execute: `${API_PREFIX}/tools/:name`,
        aliases: `${API_PREFIX}/:name`,
        generationRequest: `${API_PREFIX}/generation/requests`,
        generationContract: `${API_PREFIX}/contracts/generation-request`,
        providerCapabilities: `${API_PREFIX}/providers/capabilities`,
        providerCapabilitiesContract: `${API_PREFIX}/contracts/provider-capabilities`,
      },
      noAuth: true,
    });
    return;
  }

  if (method === "GET" && pathname === `${API_PREFIX}/health`) {
    writeJson(res, 200, {
      ok: true,
      apiVersion: SERVICE_API_VERSION,
      service: "lootforge",
      noAuth: true,
      now: new Date().toISOString(),
    });
    return;
  }

  if (method === "GET" && pathname === `${API_PREFIX}/tools`) {
    writeJson(res, 200, {
      ok: true,
      apiVersion: SERVICE_API_VERSION,
      tools: getServiceToolDescriptors(),
      contracts: {
        generationRequest: getCanonicalGenerationRequestContract(),
        providerCapabilities: getProviderCapabilitiesContract(),
      },
    });
    return;
  }

  if (method === "GET" && pathname === `${API_PREFIX}/contracts/generation-request`) {
    writeJson(res, 200, {
      ok: true,
      apiVersion: SERVICE_API_VERSION,
      contract: getCanonicalGenerationRequestContract(),
    });
    return;
  }

  if (method === "GET" && pathname === `${API_PREFIX}/contracts/provider-capabilities`) {
    writeJson(res, 200, {
      ok: true,
      apiVersion: SERVICE_API_VERSION,
      contract: getProviderCapabilitiesContract(),
    });
    return;
  }

  if (method === "GET" && pathname === `${API_PREFIX}/providers/capabilities`) {
    const providerParamRaw = requestUrl.searchParams.get("provider");
    const providerParam =
      typeof providerParamRaw === "string" && providerParamRaw.trim()
        ? providerParamRaw.trim().toLowerCase()
        : undefined;
    const modelParamRaw = requestUrl.searchParams.get("model");
    const modelParam =
      typeof modelParamRaw === "string" && modelParamRaw.trim() ? modelParamRaw.trim() : undefined;

    if (providerParam && !isProviderName(providerParam)) {
      writeJson(res, 400, {
        ok: false,
        apiVersion: SERVICE_API_VERSION,
        error: {
          code: "invalid_query_parameter",
          message: `Unknown provider "${providerParam}". Use openai|nano|local.`,
        },
      });
      return;
    }

    if (modelParam && !providerParam) {
      writeJson(res, 400, {
        ok: false,
        apiVersion: SERVICE_API_VERSION,
        error: {
          code: "invalid_query_parameter",
          message: 'Query parameter "model" requires "provider".',
        },
      });
      return;
    }

    const capabilities = resolveProviderCapabilityDescriptors({
      ...(providerParam ? { provider: providerParam as ProviderName } : {}),
      ...(modelParam ? { model: modelParam } : {}),
    });

    writeJson(res, 200, {
      ok: true,
      apiVersion: SERVICE_API_VERSION,
      endpoint: `${API_PREFIX}/providers/capabilities`,
      capabilities,
    });
    return;
  }

  if (method === "POST" && pathname === `${API_PREFIX}/generation/requests`) {
    try {
      const body = await readJsonBody(req);
      const result = await runCanonicalGenerationRequest(body, {
        defaultOutDir: options.defaultOutDir,
      });
      writeJson(res, 200, {
        ok: true,
        apiVersion: SERVICE_API_VERSION,
        operation: "generation_request",
        result,
      });
    } catch (error) {
      if (error instanceof CanonicalGenerationRequestError) {
        writeJson(res, error.status, {
          ok: false,
          apiVersion: SERVICE_API_VERSION,
          operation: "generation_request",
          error: {
            code: error.code,
            message: error.message,
          },
        });
        return;
      }

      const status = error instanceof Error ? 422 : 500;
      console.error(getErrorMessage(error));
      writeJson(res, status, {
        ok: false,
        apiVersion: SERVICE_API_VERSION,
        operation: "generation_request",
        error: {
          code: resolveErrorCode(error),
          message: sanitizeErrorMessage(getErrorMessage(error)),
          exitCode: getErrorExitCode(error, 1),
        },
      });
    }
    return;
  }

  if (method !== "POST") {
    writeJson(res, 405, {
      ok: false,
      apiVersion: SERVICE_API_VERSION,
      error: {
        code: "method_not_allowed",
        message: `Method ${method} is not allowed for ${pathname}.`,
      },
    });
    return;
  }

  const toolName = resolveServiceToolName(pathname);
  if (!toolName) {
    writeJson(res, 404, {
      ok: false,
      apiVersion: SERVICE_API_VERSION,
      error: {
        code: "unknown_endpoint",
        message: `No service endpoint registered for ${pathname}.`,
      },
    });
    return;
  }

  const tool = SERVICE_TOOL_BY_NAME.get(toolName);
  if (!tool) {
    writeJson(res, 404, {
      ok: false,
      apiVersion: SERVICE_API_VERSION,
      tool: toolName,
      error: {
        code: "unknown_tool",
        message: `Tool "${toolName}" is not registered.`,
      },
    });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const payload = decodeToolExecutionPayload(body);
    const argv = buildCommandArgv(tool, payload, options.defaultOutDir);
    const result = await tool.run(argv);
    writeJson(res, 200, {
      ok: true,
      apiVersion: SERVICE_API_VERSION,
      tool: tool.name,
      ...(payload.requestId !== undefined ? { requestId: payload.requestId } : {}),
      result,
    });
  } catch (error) {
    if (error instanceof ServiceRequestError) {
      writeJson(res, error.status, {
        ok: false,
        apiVersion: SERVICE_API_VERSION,
        tool: tool.name,
        error: {
          code: error.code,
          message: error.message,
        },
      });
      return;
    }

    const status = error instanceof Error ? 422 : 500;
    console.error(getErrorMessage(error));
    writeJson(res, status, {
      ok: false,
      apiVersion: SERVICE_API_VERSION,
      tool: tool.name,
      error: {
        code: resolveErrorCode(error),
        message: sanitizeErrorMessage(getErrorMessage(error)),
        exitCode: getErrorExitCode(error, 1),
      },
    });
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += bufferChunk.length;
    if (totalBytes > MAX_REQUEST_BODY_BYTES) {
      throw new ServiceRequestError(`Request body exceeds ${MAX_REQUEST_BODY_BYTES} bytes.`, {
        status: 413,
        code: "request_too_large",
      });
    }
    chunks.push(bufferChunk as Buffer);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new ServiceRequestError(`Invalid JSON body: ${getErrorMessage(error)}`, {
      status: 400,
      code: "invalid_json",
    });
  }
}

function decodeToolExecutionPayload(value: unknown): ServiceToolExecutionPayload {
  if (value === undefined || value === null) {
    throw new ServiceRequestError("Tool request body is required.", {
      status: 400,
      code: "invalid_request_body",
    });
  }
  if (!isRecord(value)) {
    throw new ServiceRequestError("Request body must be a JSON object.", {
      status: 400,
      code: "invalid_request_body",
    });
  }

  const requestIdValue = value.requestId;
  const requestId =
    typeof requestIdValue === "string" || typeof requestIdValue === "number"
      ? requestIdValue
      : undefined;

  const hasArgs = Object.prototype.hasOwnProperty.call(value, "args");
  const hasParams = Object.prototype.hasOwnProperty.call(value, "params");

  if (hasArgs && hasParams) {
    throw new ServiceRequestError('Provide either "params" or "args", not both.', {
      status: 400,
      code: "invalid_request_body",
    });
  }

  const argvValue = value.args;
  if (hasArgs) {
    if (!Array.isArray(argvValue) || argvValue.some((item) => typeof item !== "string")) {
      throw new ServiceRequestError('Field "args" must be an array of strings.', {
        status: 400,
        code: "invalid_args_override",
      });
    }
    if (argvValue.length === 0) {
      throw new ServiceRequestError('Field "args" must include at least one CLI argument.', {
        status: 400,
        code: "invalid_args_override",
      });
    }
    return {
      requestId,
      params: {},
      argvOverride: [...(argvValue as string[])],
    };
  }

  const paramsValue = hasParams ? value.params : stripMetaFields(value, new Set(["requestId"]));
  if (paramsValue === undefined || paramsValue === null) {
    throw new ServiceRequestError('Tool request body must include "params" or "args".', {
      status: 400,
      code: "invalid_request_body",
    });
  }
  if (isRecord(paramsValue) && Object.keys(paramsValue).length === 0) {
    throw new ServiceRequestError(
      'Tool request body must include "params" with at least one field.',
      { status: 400, code: "invalid_request_body" },
    );
  }
  if (!isRecord(paramsValue)) {
    throw new ServiceRequestError('Field "params" must be an object.', {
      status: 400,
      code: "invalid_params",
    });
  }

  return {
    requestId,
    params: paramsValue,
  };
}

function buildCommandArgv(
  tool: ServiceToolDefinition,
  payload: ServiceToolExecutionPayload,
  defaultOutDir?: string,
): string[] {
  if (payload.argvOverride) {
    return payload.argvOverride;
  }

  const knownKeys = new Set(tool.params.map((param) => param.key));
  for (const key of Object.keys(payload.params)) {
    if (!knownKeys.has(key)) {
      throw new ServiceRequestError(`Unknown parameter "${key}" for tool "${tool.name}".`, {
        status: 400,
        code: "unknown_parameter",
      });
    }
  }

  const argv: string[] = [];
  for (const param of tool.params) {
    const resolvedValue =
      payload.params[param.key] !== undefined
        ? payload.params[param.key]
        : param.key === "out" && defaultOutDir
          ? defaultOutDir
          : undefined;
    if (resolvedValue === undefined) {
      continue;
    }

    const normalized = normalizeParamValue(tool.name, param, resolvedValue);
    if (normalized === undefined) {
      continue;
    }

    argv.push(`--${param.flag}`, normalized);
  }

  return argv;
}

function normalizeParamValue(
  toolName: ServiceToolName,
  param: ServiceToolParamSpec,
  value: unknown,
): string | undefined {
  if (param.kind === "string") {
    if (typeof value !== "string") {
      throw new ServiceRequestError(
        `Parameter "${param.key}" for tool "${toolName}" must be a string.`,
        { status: 400, code: "invalid_parameter_type" },
      );
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (param.kind === "boolean") {
    if (typeof value === "boolean") {
      return value ? "true" : "false";
    }
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "yes", "y"].includes(normalized)) {
        return "true";
      }
      if (["false", "0", "no", "n"].includes(normalized)) {
        return "false";
      }
    }

    throw new ServiceRequestError(
      `Parameter "${param.key}" for tool "${toolName}" must be a boolean.`,
      { status: 400, code: "invalid_parameter_type" },
    );
  }

  if (Array.isArray(value)) {
    const normalizedValues = value
      .map((item) => {
        if (typeof item !== "string") {
          throw new ServiceRequestError(
            `Parameter "${param.key}" for tool "${toolName}" must be a string array.`,
            { status: 400, code: "invalid_parameter_type" },
          );
        }
        return item.trim();
      })
      .filter(Boolean);
    return normalizedValues.length > 0 ? normalizedValues.join(",") : undefined;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  throw new ServiceRequestError(
    `Parameter "${param.key}" for tool "${toolName}" must be a string list.`,
    { status: 400, code: "invalid_parameter_type" },
  );
}

function normalizePathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function resolveServiceToolName(pathname: string): ServiceToolName | undefined {
  const toolPrefix = `${API_PREFIX}/tools/`;
  if (pathname.startsWith(toolPrefix)) {
    const candidate = pathname.slice(toolPrefix.length);
    return isServiceToolName(candidate) ? candidate : undefined;
  }

  const commandPrefix = `${API_PREFIX}/`;
  if (pathname.startsWith(commandPrefix)) {
    const candidate = pathname.slice(commandPrefix.length);
    if (candidate === "health" || candidate === "tools") {
      return undefined;
    }
    return isServiceToolName(candidate) ? candidate : undefined;
  }

  return undefined;
}

function isServiceToolName(value: string): value is ServiceToolName {
  return SERVICE_TOOL_BY_NAME.has(value as ServiceToolName);
}

function writeSecurityHeaders(res: ServerResponse): void {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("content-security-policy", "default-src 'none'");
  res.setHeader("cache-control", "no-store");
}

function sanitizeErrorMessage(message: string): string {
  return message.replace(
    /(?:\/(?:Users|home|var|tmp|opt|etc|usr|private)\/|[A-Z]:\\\\)[^\s"']+/g,
    "[path]",
  );
}

function writeJson(res: ServerResponse, status: number, payload: unknown): void {
  writeCorsHeaders(res);
  writeSecurityHeaders(res);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function writeCorsHeaders(res: ServerResponse): void {
  // Wildcard origin is intentional: this is a local dev tool with no auth.
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
}

function resolveErrorCode(error: unknown): string {
  if (error instanceof CliError) {
    return error.code;
  }
  if (error instanceof Error && typeof (error as { code?: unknown }).code === "string") {
    return String((error as { code?: string }).code);
  }
  return "tool_execution_failed";
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
    server.closeAllConnections();
  });
}

function stripMetaFields(
  value: Record<string, unknown>,
  keys: ReadonlySet<string>,
): Record<string, unknown> {
  const stripped: Record<string, unknown> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    if (keys.has(key)) {
      continue;
    }
    stripped[key] = entryValue;
  }
  return stripped;
}

function stringParam(key: string, flag: string, description: string): ServiceToolParamSpec {
  return {
    key,
    flag,
    kind: "string",
    description,
  };
}

function booleanParam(key: string, flag: string, description: string): ServiceToolParamSpec {
  return {
    key,
    flag,
    kind: "boolean",
    description,
  };
}

function stringListParam(key: string, flag: string, description: string): ServiceToolParamSpec {
  return {
    key,
    flag,
    kind: "string_list",
    description,
  };
}
