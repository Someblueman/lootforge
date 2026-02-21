import path from "node:path";

import { type ManifestV2 } from "../../manifest/types.js";
import { ensureDir, pathExists, writeJsonFile } from "../../shared/fs.js";
import { resolveInitImagegenDir } from "../../shared/paths.js";

export interface InitCommandArgs {
  outFlag?: string;
}

export interface InitCommandResult {
  imagegenDir: string;
  manifestPath: string;
  rawDir: string;
  processedDir: string;
  processedImagesDir: string;
  legacyImagesDir: string;
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
  const processedImagesDir = path.join(processedDir, "images");
  const legacyImagesDir = path.join(path.dirname(imagegenDir), "images");
  const jobsDir = path.join(imagegenDir, "jobs");

  await Promise.all([
    ensureDir(imagegenDir),
    ensureDir(rawDir),
    ensureDir(processedDir),
    ensureDir(processedImagesDir),
    ensureDir(legacyImagesDir),
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
    processedImagesDir,
    legacyImagesDir,
    jobsDir,
    manifestCreated: !manifestAlreadyExists,
  };
}

function createDefaultManifest(): ManifestV2 {
  return {
    version: "next",
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
      local: {
        model: "sdxl-controlnet",
        baseUrl: "http://127.0.0.1:8188",
      },
    },
    styleKits: [
      {
        id: "default-topdown",
        rulesPath: "assets/style/default-topdown/style.md",
        palettePath: "assets/style/default-topdown/palette.txt",
        referenceImages: [],
        lightingModel: "top-left key light with soft ambient fill",
      },
    ],
    consistencyGroups: [
      {
        id: "heroes",
        description: "Shared hero character family for playable protagonists.",
        styleKitId: "default-topdown",
        referenceImages: [],
      },
    ],
    evaluationProfiles: [
      {
        id: "default-sprite-quality",
        hardGates: {
          requireAlpha: true,
          maxFileSizeKB: 512,
          seamThreshold: 12,
          seamStripPx: 4,
          paletteComplianceMin: 0.98,
        },
        scoreWeights: {
          readability: 1.0,
          fileSize: 0.3,
          consistency: 0.7,
        },
      },
    ],
    atlas: {
      padding: 2,
      trim: true,
      bleed: 1,
      multipack: false,
      maxWidth: 2048,
      maxHeight: 2048,
    },
    targets: [
      {
        id: "example-hero",
        kind: "sprite",
        out: "hero.png",
        styleKitId: "default-topdown",
        consistencyGroup: "heroes",
        evaluationProfileId: "default-sprite-quality",
        generationMode: "text",
        prompt: {
          primary: "Fantasy hero character sprite, front-facing idle pose, clean silhouette.",
          stylePreset: "topdown-painterly-sci-fi",
        },
        generationPolicy: {
          size: "1024x1024",
          outputFormat: "png",
          quality: "high",
          background: "transparent",
          candidates: 2,
          maxRetries: 1,
        },
        postProcess: {
          resizeTo: "512x512",
          algorithm: "lanczos3",
          stripMetadata: true,
          operations: {
            trim: { enabled: true },
            pad: { pixels: 2, extrude: true },
            quantize: { colors: 128, dither: 0.6 },
          },
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
