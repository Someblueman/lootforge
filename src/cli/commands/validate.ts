import path from "node:path";

import { loadManifestSource } from "../../manifest/load.js";
import { validateManifestSource } from "../../manifest/validate.js";
import type { ValidationReport } from "../../manifest/types.js";
import { getErrorMessage, CliError } from "../../shared/errors.js";
import { writeJsonFile } from "../../shared/fs.js";
import { resolveManifestPath, resolveOutDir } from "../../shared/paths.js";

export interface ValidateCommandArgs {
  manifestPath: string;
  outDir: string;
  strict: boolean;
}

export interface ValidateCommandResult {
  report: ValidationReport;
  reportPath: string;
  strict: boolean;
  exitCode: number;
}

export function parseValidateCommandArgs(argv: string[]): ValidateCommandArgs {
  const manifestPath = resolveManifestPath(readArgValue(argv, "manifest"));
  const outDir = resolveOutDir(readArgValue(argv, "out"), path.dirname(manifestPath));
  const strict = parseBooleanArg(readArgValue(argv, "strict") ?? "true");

  return {
    manifestPath,
    outDir,
    strict,
  };
}

export async function runValidateCommand(
  argv: string[],
): Promise<ValidateCommandResult> {
  const args = parseValidateCommandArgs(argv);
  const reportPath = path.join(args.outDir, "checks", "validation-report.json");

  let report: ValidationReport;
  try {
    const source = await loadManifestSource(args.manifestPath);
    report = validateManifestSource(source).report;
  } catch (error) {
    report = {
      manifestPath: args.manifestPath,
      generatedAt: new Date().toISOString(),
      ok: false,
      errors: 1,
      warnings: 0,
      targetCount: 0,
      issues: [
        {
          level: "error",
          code: "manifest_load_failed",
          path: "$",
          message: getErrorMessage(error),
        },
      ],
    };
  }

  await writeJsonFile(reportPath, report);

  const strictFailure = args.strict && report.errors > 0;
  return {
    report,
    reportPath,
    strict: args.strict,
    exitCode: strictFailure ? 1 : 0,
  };
}

function parseBooleanArg(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "n"].includes(normalized)) {
    return false;
  }
  throw new CliError(
    `Invalid boolean value "${value}" for --strict. Use true or false.`,
    { code: "invalid_boolean_flag", exitCode: 1 },
  );
}

function readArgValue(argv: string[], name: string): string | undefined {
  const exact = `--${name}`;
  const prefix = `${exact}=`;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length);
    }
    if (arg === exact) {
      return argv[index + 1];
    }
  }

  return undefined;
}
