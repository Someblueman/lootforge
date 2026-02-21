import path from "node:path";

import { SERVICE_API_VERSION, startLootForgeService } from "../../service/server.js";
import { CliError } from "../../shared/errors.js";
import { readArgValue } from "../parseArgs.js";

const DEFAULT_SERVICE_HOST = "127.0.0.1";
const DEFAULT_SERVICE_PORT = 8744;

export interface ServeCommandArgs {
  host: string;
  port: number;
  defaultOutDir?: string;
}

export interface ServeCommandResult {
  host: string;
  port: number;
  url: string;
  apiVersion: string;
  defaultOutDir?: string;
}

export function parseServeCommandArgs(argv: string[]): ServeCommandArgs {
  const hostFlag = readArgValue(argv, "host");
  const portFlag = readArgValue(argv, "port");
  const outFlag = readArgValue(argv, "out");

  const envHost = process.env.LOOTFORGE_SERVICE_HOST?.trim();
  const envPort = process.env.LOOTFORGE_SERVICE_PORT?.trim();
  const envOut = process.env.LOOTFORGE_SERVICE_OUT?.trim();

  const host = normalizeHost(hostFlag ?? envHost ?? DEFAULT_SERVICE_HOST);
  const port = parsePort(portFlag ?? envPort ?? String(DEFAULT_SERVICE_PORT));
  const defaultOut = outFlag ?? envOut;

  return {
    host,
    port,
    defaultOutDir: defaultOut ? path.resolve(defaultOut) : undefined,
  };
}

export async function runServeCommand(argv: string[]): Promise<ServeCommandResult> {
  const args = parseServeCommandArgs(argv);
  const service = await startLootForgeService({
    host: args.host,
    port: args.port,
    defaultOutDir: args.defaultOutDir,
  });

  registerShutdownHandlers(service.close);

  return {
    host: service.host,
    port: service.port,
    url: service.baseUrl,
    apiVersion: SERVICE_API_VERSION,
    ...(args.defaultOutDir ? { defaultOutDir: args.defaultOutDir } : {}),
  };
}

function normalizeHost(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new CliError("Invalid --host value. Host cannot be empty.", {
      code: "invalid_serve_host",
      exitCode: 1,
    });
  }
  return normalized;
}

function parsePort(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 65535) {
    throw new CliError(`Invalid --port value "${value}". Use a port between 0 and 65535.`, {
      code: "invalid_serve_port",
      exitCode: 1,
    });
  }
  return parsed;
}

function registerShutdownHandlers(close: () => Promise<void>): void {
  let isClosing = false;

  const shutdown = (signal: NodeJS.Signals): void => {
    if (isClosing) {
      return;
    }
    isClosing = true;

    void close()
      .catch(() => {
        // no-op: process is exiting on signal
      })
      .finally(() => {
        process.stdout.write(`lootforge service stopped (${signal}).\n`);
        // eslint-disable-next-line n/no-process-exit
        process.exit(0);
      });
  };

  process.once("SIGINT", () => {
    shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    shutdown("SIGTERM");
  });
}
