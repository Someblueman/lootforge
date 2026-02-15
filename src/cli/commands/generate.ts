import path from "node:path";

import {
  parseGenerateProviderFlag,
  runGeneratePipeline,
} from "../../pipeline/generate.js";
import { ProviderSelection } from "../../providers/types.js";

export interface GenerateCommandArgs {
  manifestPath?: string;
  outDir: string;
  targetsIndexPath?: string;
  provider: ProviderSelection;
  ids: string[];
}

export interface GenerateCommandResult {
  runId: string;
  jobs: number;
  imagesDir: string;
  provenancePath: string;
}

export function parseGenerateCommandArgs(argv: string[]): GenerateCommandArgs {
  const outFlag = readArgValue(argv, "out");
  const manifestFlag = readArgValue(argv, "manifest");
  const indexFlag = readArgValue(argv, "index");
  const providerFlag = readArgValue(argv, "provider");
  const idsFlag = readArgValue(argv, "ids");
  const manifestPath = manifestFlag ? path.resolve(manifestFlag) : undefined;
  const defaultOutDir = manifestPath ? path.dirname(manifestPath) : process.cwd();

  return {
    manifestPath,
    outDir: path.resolve(outFlag || defaultOutDir),
    targetsIndexPath: indexFlag ? path.resolve(indexFlag) : undefined,
    provider: parseGenerateProviderFlag(providerFlag),
    ids: idsFlag
      ? idsFlag
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : [],
  };
}

export async function runGenerateCommand(
  argv: string[],
): Promise<GenerateCommandResult> {
  const args = parseGenerateCommandArgs(argv);
  const pipelineResult = await runGeneratePipeline({
    outDir: args.outDir,
    targetsIndexPath: args.targetsIndexPath,
    provider: args.provider,
    ids: args.ids,
  });

  return {
    runId: pipelineResult.runId,
    jobs: pipelineResult.jobs.length,
    imagesDir: pipelineResult.imagesDir,
    provenancePath: pipelineResult.provenancePath,
  };
}

function readArgValue(argv: string[], name: string): string | undefined {
  const exact = `--${name}`;
  const prefix = `--${name}=`;

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
