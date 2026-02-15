import path from "node:path";

import { runPreviewPipeline } from "../../pipeline/preview.js";

function readArgValue(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const exact = `--${name}`;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
    if (arg === exact) return argv[i + 1];
  }
  return undefined;
}

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export async function runPreviewCommand(argv: string[]): Promise<number> {
  const host = readArgValue(argv, "host") ?? "127.0.0.1";
  const port = parsePort(readArgValue(argv, "port"), 4173);
  const starterDir = readArgValue(argv, "starter-dir");

  return runPreviewPipeline({
    host,
    port,
    starterDir: starterDir ? path.resolve(starterDir) : undefined,
  });
}

