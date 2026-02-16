import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { runAtlasCommand } from "./commands/atlas.js";
import { runEvalCommand } from "./commands/eval.js";
import { runGenerateCommand } from "./commands/generate.js";
import { runInitCommand } from "./commands/init.js";
import { runPackageCommand } from "./commands/package.js";
import { runPlanCommand } from "./commands/plan.js";
import { runProcessCommand } from "./commands/process.js";
import { runReviewCommand } from "./commands/review.js";
import { runSelectCommand } from "./commands/select.js";
import { runValidateCommand } from "./commands/validate.js";
import { getErrorExitCode, getErrorMessage } from "../shared/errors.js";

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (!command || isHelpFlag(command)) {
    writeUsage("stdout");
    return 0;
  }

  try {
    if (command === "init") {
      const result = await runInitCommand(rest);
      process.stdout.write(
        `Initialized ${result.imagegenDir} (manifest ${result.manifestCreated ? "created" : "kept"}).\n`,
      );
      return 0;
    }

    if (command === "plan") {
      const result = await runPlanCommand(rest);
      process.stdout.write(
        `Planned ${result.targets} target(s) -> ${result.targetsIndexPath}.\n`,
      );
      return 0;
    }

    if (command === "validate") {
      const result = await runValidateCommand(rest);
      process.stdout.write(
        `Validation ${result.report.ok ? "passed" : "failed"} (${result.report.errors} error(s), ${result.report.warnings} warning(s)) -> ${result.reportPath}.\n`,
      );
      return result.exitCode;
    }

    if (command === "generate") {
      const result = await runGenerateCommand(rest);
      process.stdout.write(
        `Generated ${result.jobs} job(s). Run ${result.runId} -> ${result.provenancePath}.\n`,
      );
      return 0;
    }

    if (command === "process") {
      const result = await runProcessCommand(rest);
      process.stdout.write(
        `Processed ${result.processedCount} asset(s) (${result.variantCount} variant(s)) -> ${result.catalogPath}\nChecks: ${result.acceptanceReportPath}\n`,
      );
      return 0;
    }

    if (command === "eval") {
      const result = await runEvalCommand(rest);
      process.stdout.write(
        `Evaluated ${result.targetCount} target(s), failed ${result.failed} -> ${result.reportPath}\n`,
      );
      return 0;
    }

    if (command === "review") {
      const result = await runReviewCommand(rest);
      process.stdout.write(
        `Review HTML written for ${result.targetCount} target(s) -> ${result.reviewHtmlPath}\n`,
      );
      return 0;
    }

    if (command === "select") {
      const result = await runSelectCommand(rest);
      process.stdout.write(
        `Selection lock written -> ${result.selectionLockPath} (${result.approvedTargets}/${result.totalTargets} approved)\n`,
      );
      return 0;
    }

    if (command === "atlas") {
      const result = await runAtlasCommand(rest);
      process.stdout.write(
        `Atlas manifest written -> ${result.manifestPath} (${result.bundles} bundle(s)).\n`,
      );
      return 0;
    }

    if (command === "package") {
      const result = await runPackageCommand(rest);
      process.stdout.write(
        `Packaged ${result.packId} -> ${result.packDir}\nArchive: ${result.zipPath}\n`,
      );
      return 0;
    }

    process.stderr.write(`lootforge: unknown command "${command}"\n`);
    writeUsage("stderr");
    return 1;
  } catch (error) {
    process.stderr.write(`lootforge: ${getErrorMessage(error)}\n`);
    return getErrorExitCode(error, 1);
  }
}

function writeUsage(stream: "stdout" | "stderr"): void {
  const output = stream === "stderr" ? process.stderr : process.stdout;
  output.write(
    [
      "Usage: lootforge <command> [options]",
      "",
      "Commands:",
      "  init                         Scaffold assets/imagegen + manifest.json",
      "  plan                         Validate manifest and write jobs outputs",
      "  validate                     Validate manifest and write report",
      "  generate                     Execute generation pipeline from targets index",
      "  process                      Post-process raw assets into processed runtime outputs",
      "  eval                         Run hard/soft quality evaluation over processed outputs",
      "  review                       Build HTML review artifact from eval report",
      "  select                       Build selection lockfile from eval + provenance",
      "  atlas                        Build atlas outputs and atlas manifest",
      "  package                      Assemble distributable asset-pack artifacts",
      "",
      "Options:",
      "  --manifest <path>            Manifest path (default assets/imagegen/manifest.json)",
      "  --out <dir>                  Output directory for command artifacts",
      "  --index <path>               Optional targets index path override",
      "  --strict <true|false>        Validate strict mode (non-zero on errors)",
      "  --check-images <true|false>  Validate processed image acceptance during validate",
      "  --provider <name>            Provider selection for generate (openai|nano|local|auto)",
      "  --ids <a,b,c>                Optional target id filter for generate",
      "  --lock <path>                Selection lock file path (generate/select)",
      "  --skip-locked <true|false>   Skip regeneration for approved locked targets",
      "  --images-dir <path>          Processed images directory override for eval/validate",
      "  --report <path>              Eval report output path override",
      "  --eval <path>                Eval report path for review/select",
      "  --provenance <path>          Provenance run path for select",
      "  --html <path>                Review HTML output path override",
      "",
    ].join("\n"),
  );
}

function isHelpFlag(value: string): boolean {
  return value === "help" || value === "--help" || value === "-h";
}

function isDirectExecution(): boolean {
  const argvEntry = process.argv[1];
  if (!argvEntry) {
    return false;
  }

  return pathToFileURL(path.resolve(argvEntry)).href === import.meta.url;
}

if (isDirectExecution()) {
  main(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      process.stderr.write(`lootforge: ${getErrorMessage(error)}\n`);
      process.exitCode = getErrorExitCode(error, 1);
    });
}
