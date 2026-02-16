import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { runImageAcceptanceChecks, assertImageAcceptanceReport } from "../checks/imageAcceptance.js";
import { buildCatalog } from "../output/catalog.js";
import { getTargetPostProcessPolicy, PlannedTarget } from "../providers/types.js";
import { writeJsonFile } from "../shared/fs.js";
import { resolveStagePathLayout } from "../shared/paths.js";

interface TargetsIndexShape {
  targets?: PlannedTarget[];
}

export interface ProcessPipelineOptions {
  outDir: string;
  targetsIndexPath?: string;
  strict?: boolean;
  mirrorLegacyImages?: boolean;
}

export interface ProcessPipelineResult {
  processedImagesDir: string;
  legacyImagesDir: string;
  catalogPath: string;
  acceptanceReportPath: string;
  processedCount: number;
  variantCount: number;
}

interface ProcessedVariant {
  outPath: string;
  width: number;
  height: number;
}

function parseTargetsIndex(raw: string, filePath: string): TargetsIndexShape {
  try {
    return JSON.parse(raw) as TargetsIndexShape;
  } catch (error) {
    throw new Error(
      `Failed to parse targets index JSON (${filePath}): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function kernelForAlgorithm(algorithm: string | undefined): keyof sharp.KernelEnum {
  if (algorithm === "nearest") {
    return "nearest";
  }
  return "lanczos3";
}

function parseColorHex(input: string | undefined): { r: number; g: number; b: number } {
  const fallback = { r: 0, g: 0, b: 0 };
  if (!input) return fallback;

  const value = input.trim().toLowerCase();
  const raw = value.startsWith("#") ? value.slice(1) : value;
  if (!/^[0-9a-f]{6}$/i.test(raw)) {
    return fallback;
  }

  return {
    r: Number.parseInt(raw.slice(0, 2), 16),
    g: Number.parseInt(raw.slice(2, 4), 16),
    b: Number.parseInt(raw.slice(4, 6), 16),
  };
}

async function applyOutline(
  imageBuffer: Buffer,
  size: number,
  colorHex: string | undefined,
): Promise<Buffer> {
  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width;
  const height = metadata.height;

  if (!width || !height || size <= 0) {
    return imageBuffer;
  }

  const alphaMask = await sharp(imageBuffer)
    .ensureAlpha()
    .extractChannel("alpha")
    .threshold(1)
    .dilate(size)
    .toBuffer();

  const color = parseColorHex(colorHex);
  const outlineLayer = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: color,
    },
  })
    .joinChannel(alphaMask)
    .png()
    .toBuffer();

  return await sharp(outlineLayer)
    .composite([
      {
        input: imageBuffer,
      },
    ])
    .png()
    .toBuffer();
}

function withVariantSuffix(filePath: string, variantName: string): string {
  const ext = path.extname(filePath);
  const base = filePath.slice(0, filePath.length - ext.length);
  const safeName = variantName.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  return `${base}__${safeName}${ext}`;
}

async function processSingleTarget(params: {
  target: PlannedTarget;
  rawImagePath: string;
  processedImagePath: string;
  mirrorLegacy: boolean;
  legacyImagePath: string;
}): Promise<{ variantCount: number }> {
  const postProcess = getTargetPostProcessPolicy(params.target);

  let pipeline = sharp(params.rawImagePath, { failOn: "none" }).ensureAlpha();

  const trimConfig = postProcess.operations?.trim;
  if (trimConfig?.enabled === true || trimConfig?.threshold !== undefined) {
    pipeline = pipeline.trim({ threshold: trimConfig.threshold ?? 10 });
  }

  const padConfig = postProcess.operations?.pad;
  if (padConfig && padConfig.pixels > 0) {
    const background = parseColorHex(padConfig.background);
    pipeline = pipeline.extend({
      top: padConfig.pixels,
      bottom: padConfig.pixels,
      left: padConfig.pixels,
      right: padConfig.pixels,
      background: {
        r: background.r,
        g: background.g,
        b: background.b,
        alpha: params.target.acceptance?.alpha === true ? 0 : 1,
      },
    });
  }

  if (postProcess.resizeTo) {
    pipeline = pipeline.resize(postProcess.resizeTo.width, postProcess.resizeTo.height, {
      fit: "contain",
      background:
        params.target.acceptance?.alpha === true ||
        params.target.runtimeSpec?.alphaRequired === true
          ? { r: 0, g: 0, b: 0, alpha: 0 }
          : { r: 0, g: 0, b: 0, alpha: 1 },
      kernel: kernelForAlgorithm(postProcess.algorithm),
      withoutEnlargement: true,
    });
  }

  let outputBuffer = await pipeline.png().toBuffer();

  const outlineConfig = postProcess.operations?.outline;
  if (outlineConfig?.size) {
    outputBuffer = await applyOutline(outputBuffer, outlineConfig.size, outlineConfig.color);
  }

  const quantizeConfig = postProcess.operations?.quantize;
  const paletteColors = quantizeConfig?.colors ?? postProcess.pngPaletteColors;

  if (postProcess.stripMetadata === false) {
    // Intentionally no-op: sharp preserves no metadata by default, and this pipeline
    // stays deterministic by avoiding metadata passthrough.
  }

  const encodedMain = await sharp(outputBuffer)
    .png({
      compressionLevel: 9,
      palette: typeof paletteColors === "number",
      colours: paletteColors,
      effort: 8,
      quality:
        typeof quantizeConfig?.dither === "number"
          ? Math.max(1, Math.min(100, Math.round(quantizeConfig.dither * 100)))
          : undefined,
    })
    .toBuffer();

  await mkdir(path.dirname(params.processedImagePath), { recursive: true });
  await writeFile(params.processedImagePath, encodedMain);

  if (params.mirrorLegacy) {
    await mkdir(path.dirname(params.legacyImagePath), { recursive: true });
    await cp(params.processedImagePath, params.legacyImagePath, { force: true });
  }

  let variantCount = 0;
  const variants = postProcess.operations?.resizeVariants?.variants ?? [];
  for (const variant of variants) {
    const variantPath = withVariantSuffix(params.processedImagePath, variant.name);
    const variantLegacyPath = withVariantSuffix(params.legacyImagePath, variant.name);

    const variantBuffer = await sharp(encodedMain)
      .resize(variant.width, variant.height, {
        fit: "contain",
        background:
          params.target.acceptance?.alpha === true ||
          params.target.runtimeSpec?.alphaRequired === true
            ? { r: 0, g: 0, b: 0, alpha: 0 }
            : { r: 0, g: 0, b: 0, alpha: 1 },
        kernel: kernelForAlgorithm(variant.algorithm),
      })
      .png({ compressionLevel: 9 })
      .toBuffer();

    await mkdir(path.dirname(variantPath), { recursive: true });
    await writeFile(variantPath, variantBuffer);

    if (params.mirrorLegacy) {
      await mkdir(path.dirname(variantLegacyPath), { recursive: true });
      await writeFile(variantLegacyPath, variantBuffer);
    }

    variantCount += 1;
  }

  if (params.target.auxiliaryMaps?.normalFromHeight) {
    const normalPath = withVariantSuffix(params.processedImagePath, "normal");
    const normalLegacyPath = withVariantSuffix(params.legacyImagePath, "normal");

    const normalBuffer = await sharp(encodedMain)
      .greyscale()
      .convolve({
        width: 3,
        height: 3,
        kernel: [-1, -2, -1, 0, 0, 0, 1, 2, 1],
      })
      .png({ compressionLevel: 9 })
      .toBuffer();

    await writeFile(normalPath, normalBuffer);
    if (params.mirrorLegacy) {
      await writeFile(normalLegacyPath, normalBuffer);
    }
  }

  if (params.target.auxiliaryMaps?.specularFromLuma) {
    const specularPath = withVariantSuffix(params.processedImagePath, "specular");
    const specularLegacyPath = withVariantSuffix(params.legacyImagePath, "specular");
    const specularBuffer = await sharp(encodedMain).greyscale().png().toBuffer();
    await writeFile(specularPath, specularBuffer);
    if (params.mirrorLegacy) {
      await writeFile(specularLegacyPath, specularBuffer);
    }
  }

  if (params.target.auxiliaryMaps?.aoFromLuma) {
    const aoPath = withVariantSuffix(params.processedImagePath, "ao");
    const aoLegacyPath = withVariantSuffix(params.legacyImagePath, "ao");
    const aoBuffer = await sharp(encodedMain)
      .greyscale()
      .linear(0.8, 10)
      .png()
      .toBuffer();
    await writeFile(aoPath, aoBuffer);
    if (params.mirrorLegacy) {
      await writeFile(aoLegacyPath, aoBuffer);
    }
  }

  return { variantCount };
}

export async function runProcessPipeline(
  options: ProcessPipelineOptions,
): Promise<ProcessPipelineResult> {
  const layout = resolveStagePathLayout(options.outDir);
  const targetsIndexPath = path.resolve(
    options.targetsIndexPath ?? path.join(layout.jobsDir, "targets-index.json"),
  );
  const strict = options.strict ?? true;
  const mirrorLegacy = options.mirrorLegacyImages ?? true;

  const rawIndex = await readFile(targetsIndexPath, "utf8");
  const index = parseTargetsIndex(rawIndex, targetsIndexPath);
  const targets = Array.isArray(index.targets) ? index.targets : [];

  await mkdir(layout.processedImagesDir, { recursive: true });
  if (mirrorLegacy) {
    await mkdir(layout.legacyImagesDir, { recursive: true });
  }

  let variantCount = 0;
  for (const target of targets) {
    const rawImagePath = path.join(layout.rawDir, target.out);
    const processedImagePath = path.join(layout.processedImagesDir, target.out);
    const legacyImagePath = path.join(layout.legacyImagesDir, target.out);

    // eslint-disable-next-line no-await-in-loop
    const result = await processSingleTarget({
      target,
      rawImagePath,
      processedImagePath,
      mirrorLegacy,
      legacyImagePath,
    });
    variantCount += result.variantCount;
  }

  const acceptanceReport = await runImageAcceptanceChecks({
    targets,
    imagesDir: layout.processedImagesDir,
    strict,
  });

  await mkdir(layout.checksDir, { recursive: true });
  const acceptanceReportPath = path.join(layout.checksDir, "image-acceptance-report.json");
  await writeJsonFile(acceptanceReportPath, acceptanceReport);
  assertImageAcceptanceReport(acceptanceReport);

  const catalog = await buildCatalog(targets, layout.processedImagesDir);
  const catalogPath = path.join(layout.processedDir, "catalog.json");
  await writeJsonFile(catalogPath, catalog);

  return {
    processedImagesDir: layout.processedImagesDir,
    legacyImagesDir: layout.legacyImagesDir,
    catalogPath,
    acceptanceReportPath,
    processedCount: targets.length,
    variantCount,
  };
}
