import path from "node:path";

import { ensureDir, pathExists, writeJsonFile } from "../../shared/fs.js";
import { resolveInitImagegenDir } from "../../shared/paths.js";
import type { ManifestV2 } from "../../manifest/types.js";

export interface InitCommandArgs {
  outFlag?: string;
}

export interface InitCommandResult {
  imagegenDir: string;
  manifestPath: string;
  rawDir: string;
  processedDir: string;
  jobsDir: string;
  manifestCreated: boolean;
}

export function parseInitCommandArgs(argv: string[]): InitCommandArgs {
  return {
    outFlag: readArgValue(argv, "out"),
  };
}

export async function runInitCommand(argv: string[]): Promise<InitCommandResult> {
  const args = parseInitCommandArgs(argv);
  const imagegenDir = resolveInitImagegenDir(args.outFlag);
  const manifestPath = path.join(imagegenDir, "manifest.json");
  const rawDir = path.join(imagegenDir, "raw");
  const processedDir = path.join(imagegenDir, "processed");
  const jobsDir = path.join(imagegenDir, "jobs");

  await Promise.all([
    ensureDir(imagegenDir),
    ensureDir(rawDir),
    ensureDir(processedDir),
    ensureDir(jobsDir),
  ]);

  const manifestAlreadyExists = await pathExists(manifestPath);
  if (!manifestAlreadyExists) {
    await writeJsonFile(manifestPath, createDefaultManifest());
  }

  return {
    imagegenDir,
    manifestPath,
    rawDir,
    processedDir,
    jobsDir,
    manifestCreated: !manifestAlreadyExists,
  };
}

function createDefaultManifest(): ManifestV2 {
  return {
    version: "2",
    pack: {
      id: "example-pack",
      version: "0.1.0",
      license: "UNLICENSED",
      author: "team",
    },
    providers: {
      default: "openai",
      openai: {
        model: "gpt-image-1",
      },
      nano: {
        model: "gemini-2.5-flash-image",
      },
    },
    targets: [
      {
        id: "example-hero",
        kind: "sprite",
        out: "hero.png",
        prompt: {
          primary:
            "Fantasy hero character sprite, front-facing idle pose, clean silhouette.",
          stylePreset: "topdown-painterly-sci-fi",
        },
        generationPolicy: {
          size: "1024x1024",
          outputFormat: "png",
          quality: "high",
          background: "transparent",
        },
        postProcess: {
          resizeTo: "512x512",
          algorithm: "lanczos3",
          stripMetadata: true,
        },
        acceptance: {
          size: "512x512",
          alpha: true,
          maxFileSizeKB: 512,
        },
      },
    ],
  };
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
