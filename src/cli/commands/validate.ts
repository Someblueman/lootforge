import path from "node:path";

import { runImageAcceptanceChecks } from "../../checks/imageAcceptance.js";
import { loadManifestSource } from "../../manifest/load.js";
import { normalizeManifestTargets, validateManifestSource } from "../../manifest/validate.js";
import type { ManifestV2, ValidationReport } from "../../manifest/types.js";
import { getErrorMessage, CliError } from "../../shared/errors.js";
import { writeJsonFile } from "../../shared/fs.js";
import { resolveManifestPath, resolveOutDir, resolveStagePathLayout } from "../../shared/paths.js";

export interface ValidateCommandArgs {
  manifestPath: string;
  outDir: string;
  strict: boolean;
  checkImages: boolean;
  imagesDir?: string;
}

export interface ValidateCommandResult {
  report: ValidationReport;
  reportPath: string;
  imageAcceptanceReportPath?: string;
  strict: boolean;
  exitCode: number;
}

export function parseValidateCommandArgs(argv: string[]): ValidateCommandArgs {
  const manifestPath = resolveManifestPath(readArgValue(argv, "manifest"));
  const outDir = resolveOutDir(readArgValue(argv, "out"), path.dirname(manifestPath));
  const strict = parseBooleanArg(readArgValue(argv, "strict") ?? "true", "--strict");
  const checkImages = parseBooleanArg(
    readArgValue(argv, "check-images") ?? "false",
    "--check-images",
  );
  const imagesDirFlag = readArgValue(argv, "images-dir");

  return {
    manifestPath,
    outDir,
    strict,
    checkImages,
    imagesDir: imagesDirFlag ? path.resolve(imagesDirFlag) : undefined,
  };
}

export async function runValidateCommand(
  argv: string[],
): Promise<ValidateCommandResult> {
  const args = parseValidateCommandArgs(argv);
  const reportPath = path.join(args.outDir, "checks", "validation-report.json");

  let report: ValidationReport;
  let imageAcceptanceReportPath: string | undefined;
  let manifest: ManifestV2 | undefined;

  try {
    const source = await loadManifestSource(args.manifestPath);
    const validation = validateManifestSource(source);
    report = {
      ...validation.report,
      issues: [...validation.report.issues],
    };
    manifest = validation.manifest;
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
    await writeJsonFile(reportPath, report);
    const strictFailure = args.strict && report.errors > 0;
    return {
      report,
      reportPath,
      imageAcceptanceReportPath,
      strict: args.strict,
      exitCode: strictFailure ? 1 : 0,
    };
  }

  if (args.checkImages && manifest) {
    try {
      const targets = normalizeManifestTargets(manifest, {
        manifestPath: args.manifestPath,
      });
      const layout = resolveStagePathLayout(args.outDir);
      const imagesDir = args.imagesDir ?? layout.processedImagesDir;
      const acceptanceReport = await runImageAcceptanceChecks({
        targets,
        imagesDir,
        strict: args.strict,
      });

      imageAcceptanceReportPath = path.join(
        args.outDir,
        "checks",
        "image-acceptance-report.json",
      );
      await writeJsonFile(imageAcceptanceReportPath, acceptanceReport);

      report.issues.push(
        ...acceptanceReport.items.flatMap((item) =>
          item.issues.map((issue) => ({
            level: issue.level,
            code: `image_${issue.code}`,
            path: `targets.${item.targetId}.image`,
            message: issue.message,
          })),
        ),
      );
    } catch (error) {
      report.issues.push({
        level: "error",
        code: "image_acceptance_check_failed",
        path: "$",
        message: getErrorMessage(error),
      });
    }

    report.errors = report.issues.filter((issue) => issue.level === "error").length;
    report.warnings = report.issues.filter((issue) => issue.level === "warning").length;
    report.ok = report.errors === 0;
  }

  await writeJsonFile(reportPath, report);

  const strictFailure = args.strict && report.errors > 0;
  return {
    report,
    reportPath,
    imageAcceptanceReportPath,
    strict: args.strict,
    exitCode: strictFailure ? 1 : 0,
  };
}

function parseBooleanArg(value: string, flagName: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "n"].includes(normalized)) {
    return false;
  }
  throw new CliError(
    `Invalid boolean value \"${value}\" for ${flagName}. Use true or false.`,
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
