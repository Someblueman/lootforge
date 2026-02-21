#!/usr/bin/env node

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distEntry = resolve(__dirname, "../dist/cli/index.js");

if (!existsSync(distEntry)) {
  process.stderr.write("lootforge: CLI is not built yet. Run `npm run build` first.\n");
  process.exit(1);
}

try {
  const moduleUrl = pathToFileURL(distEntry).href;
  const module = await import(moduleUrl);
  const exitCode = await module.main(process.argv.slice(2));

  if (typeof exitCode === "number") {
    process.exitCode = exitCode;
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`lootforge: ${message}\n`);
  process.exitCode = 1;
}
