import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { runImageAcceptanceChecks, assertImageAcceptanceReport } from "../checks/imageAcceptance.js";
import { buildCatalog } from "../output/catalog.js";
import { getTargetPostProcessPolicy, PlannedTarget } from "../providers/types.js";
import { writeJsonFile } from "../shared/fs.js";
import {
  normalizeTargetOutPath,
  resolvePathWithinDir,
  resolveStagePathLayout,
} from "../shared/paths.js";
import { applySeamHeal } from "./seamHeal.js";

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

async function writeDerivedVariant(params: {
  buffer: Buffer;
  processedPath: string;
  legacyPath: string;
  mirrorLegacy: boolean;
}): Promise<void> {
  const encoded = await sharp(params.buffer, { failOn: "none" })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await mkdir(path.dirname(params.processedPath), { recursive: true });
  await writeFile(params.processedPath, encoded);
  if (params.mirrorLegacy) {
    await mkdir(path.dirname(params.legacyPath), { recursive: true });
    await writeFile(params.legacyPath, encoded);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

async function smartCropImage(
  imageBuffer: Buffer,
  options: {
    mode?: "alpha-bounds" | "center";
    padding?: number;
    targetAspect?: number;
  },
): Promise<Buffer> {
  const mode = options.mode ?? "alpha-bounds";
  const padding = clamp(Math.round(options.padding ?? 0), 0, 256);
  const metadata = await sharp(imageBuffer, { failOn: "none" }).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width <= 0 || height <= 0) {
    return imageBuffer;
  }

  let cropLeft = 0;
  let cropTop = 0;
  let cropWidth = width;
  let cropHeight = height;

  if (mode === "center") {
    const targetAspect = options.targetAspect;
    if (typeof targetAspect === "number" && Number.isFinite(targetAspect) && targetAspect > 0) {
      const currentAspect = width / height;
      if (currentAspect > targetAspect) {
        cropWidth = Math.max(1, Math.round(height * targetAspect));
        cropHeight = height;
        cropLeft = Math.floor((width - cropWidth) / 2);
        cropTop = 0;
      } else if (currentAspect < targetAspect) {
        cropWidth = width;
        cropHeight = Math.max(1, Math.round(width / targetAspect));
        cropLeft = 0;
        cropTop = Math.floor((height - cropHeight) / 2);
      } else {
        return imageBuffer;
      }
    } else {
      return imageBuffer;
    }
  } else {
    const rawResult = await sharp(imageBuffer, { failOn: "none" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const data = rawResult.data;
    const channels = rawResult.info.channels;
    const rawWidth = rawResult.info.width;
    const rawHeight = rawResult.info.height;

    let minX = rawWidth;
    let minY = rawHeight;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < rawHeight; y += 1) {
      for (let x = 0; x < rawWidth; x += 1) {
        const index = (y * rawWidth + x) * channels;
        const alpha = channels >= 4 ? data[index + 3] : 255;
        if (alpha === 0) {
          continue;
        }
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }

    if (maxX < minX || maxY < minY) {
      return imageBuffer;
    }

    cropLeft = clamp(minX - padding, 0, rawWidth - 1);
    cropTop = clamp(minY - padding, 0, rawHeight - 1);
    const right = clamp(maxX + padding, 0, rawWidth - 1);
    const bottom = clamp(maxY + padding, 0, rawHeight - 1);
    cropWidth = Math.max(1, right - cropLeft + 1);
    cropHeight = Math.max(1, bottom - cropTop + 1);
  }

  if (cropLeft === 0 && cropTop === 0 && cropWidth === width && cropHeight === height) {
    return imageBuffer;
  }

  return sharp(imageBuffer, { failOn: "none" })
    .extract({
      left: cropLeft,
      top: cropTop,
      width: cropWidth,
      height: cropHeight,
    })
    .png()
    .toBuffer();
}

function parsePaletteColors(colors: string[] | undefined): Array<{ r: number; g: number; b: number }> {
  if (!colors || colors.length === 0) {
    return [];
  }

  return colors
    .map((input) => {
      const value = input.trim().toLowerCase();
      const raw = value.startsWith("#") ? value.slice(1) : value;
      if (!/^[0-9a-f]{6}$/i.test(raw)) {
        return null;
      }

      return {
        r: Number.parseInt(raw.slice(0, 2), 16),
        g: Number.parseInt(raw.slice(2, 4), 16),
        b: Number.parseInt(raw.slice(4, 6), 16),
      };
    })
    .filter((color): color is { r: number; g: number; b: number } => color !== null);
}

function nearestPaletteColor(
  source: { r: number; g: number; b: number },
  palette: Array<{ r: number; g: number; b: number }>,
): { r: number; g: number; b: number } {
  let best = palette[0];
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of palette) {
    const dr = source.r - candidate.r;
    const dg = source.g - candidate.g;
    const db = source.b - candidate.b;
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  return best;
}

async function quantizeToExactPalette(
  imageBuffer: Buffer,
  paletteColors: string[],
): Promise<Buffer> {
  const palette = parsePaletteColors(paletteColors);
  if (palette.length === 0) {
    return imageBuffer;
  }

  const rawResult = await sharp(imageBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const data = rawResult.data;
  const channels = rawResult.info.channels;
  const width = rawResult.info.width;
  const height = rawResult.info.height;

  for (let i = 0; i < data.length; i += channels) {
    const alpha = channels >= 4 ? data[i + 3] : 255;
    if (alpha === 0) {
      continue;
    }
    const nearest = nearestPaletteColor(
      { r: data[i], g: data[i + 1], b: data[i + 2] },
      palette,
    );
    data[i] = nearest.r;
    data[i + 1] = nearest.g;
    data[i + 2] = nearest.b;
  }

  return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
}

async function processSingleTarget(params: {
  target: PlannedTarget;
  rawImagePath: string;
  processedImagePath: string;
  mirrorLegacy: boolean;
  legacyImagePath: string;
}): Promise<{ variantCount: number }> {
  const postProcess = getTargetPostProcessPolicy(params.target);
  const emitVariants = postProcess.operations?.emitVariants;
  const pixelPerfect = postProcess.operations?.pixelPerfect;
  const pixelPerfectEnabled = pixelPerfect ? pixelPerfect.enabled !== false : false;

  let variantCount = 0;
  let outputBuffer = await sharp(params.rawImagePath, { failOn: "none" })
    .ensureAlpha()
    .png()
    .toBuffer();

  if (emitVariants?.raw === true) {
    await writeDerivedVariant({
      buffer: outputBuffer,
      processedPath: withVariantSuffix(params.processedImagePath, "raw"),
      legacyPath: withVariantSuffix(params.legacyImagePath, "raw"),
      mirrorLegacy: params.mirrorLegacy,
    });
    variantCount += 1;
  }

  const trimConfig = postProcess.operations?.trim;
  if (trimConfig?.enabled === true || trimConfig?.threshold !== undefined) {
    outputBuffer = await sharp(outputBuffer, { failOn: "none" })
      .trim({ threshold: trimConfig.threshold ?? 10 })
      .png()
      .toBuffer();
  }

  const padConfig = postProcess.operations?.pad;
  if (padConfig && padConfig.pixels > 0) {
    const background = parseColorHex(padConfig.background);
    outputBuffer = await sharp(outputBuffer, { failOn: "none" })
      .extend({
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
      })
      .png()
      .toBuffer();
  }

  const smartCrop = postProcess.operations?.smartCrop;
  if (smartCrop && smartCrop.enabled !== false) {
    const targetAspect =
      postProcess.resizeTo && postProcess.resizeTo.height > 0
        ? postProcess.resizeTo.width / postProcess.resizeTo.height
        : undefined;
    outputBuffer = await smartCropImage(outputBuffer, {
      mode: smartCrop.mode,
      padding: smartCrop.padding,
      targetAspect,
    });
  }

  if (postProcess.resizeTo) {
    outputBuffer = await sharp(outputBuffer, { failOn: "none" })
      .resize(postProcess.resizeTo.width, postProcess.resizeTo.height, {
        fit: "contain",
        background:
          params.target.acceptance?.alpha === true ||
          params.target.runtimeSpec?.alphaRequired === true
            ? { r: 0, g: 0, b: 0, alpha: 0 }
            : { r: 0, g: 0, b: 0, alpha: 1 },
        kernel: pixelPerfectEnabled
          ? kernelForAlgorithm("nearest")
          : kernelForAlgorithm(postProcess.algorithm),
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
  }

  if (
    pixelPerfectEnabled &&
    !postProcess.resizeTo &&
    typeof pixelPerfect?.scale === "number" &&
    pixelPerfect.scale > 1
  ) {
    const metadata = await sharp(outputBuffer, { failOn: "none" }).metadata();
    if (metadata.width && metadata.height) {
      outputBuffer = await sharp(outputBuffer, { failOn: "none" })
        .resize(metadata.width * pixelPerfect.scale, metadata.height * pixelPerfect.scale, {
          fit: "fill",
          kernel: kernelForAlgorithm("nearest"),
        })
        .png()
        .toBuffer();
    }
  }

  if (emitVariants?.styleRef === true) {
    await writeDerivedVariant({
      buffer: outputBuffer,
      processedPath: withVariantSuffix(params.processedImagePath, "style_ref"),
      legacyPath: withVariantSuffix(params.legacyImagePath, "style_ref"),
      mirrorLegacy: params.mirrorLegacy,
    });
    variantCount += 1;
  }

  const outlineConfig = postProcess.operations?.outline;
  if (outlineConfig?.size) {
    outputBuffer = await applyOutline(outputBuffer, outlineConfig.size, outlineConfig.color);
  }

  outputBuffer = await applySeamHeal(outputBuffer, params.target);

  const quantizeConfig = postProcess.operations?.quantize;
  const paletteColors = quantizeConfig?.colors ?? postProcess.pngPaletteColors;
  if (params.target.palette?.mode === "exact" && params.target.palette.colors?.length) {
    outputBuffer = await quantizeToExactPalette(outputBuffer, params.target.palette.colors);
  }

  if (postProcess.stripMetadata === false) {
    // Intentionally no-op: sharp preserves no metadata by default, and this pipeline
    // stays deterministic by avoiding metadata passthrough.
  }

  const encodedMain = await sharp(outputBuffer)
    .png({
      compressionLevel: 9,
      palette: typeof paletteColors === "number",
      colours: paletteColors,
      dither: quantizeConfig?.dither,
      effort: 8,
    })
    .toBuffer();
  const decodedMain = await sharp(encodedMain, { failOn: "none" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const mainRaw = decodedMain.data;
  const mainRawInfo = decodedMain.info;

  await mkdir(path.dirname(params.processedImagePath), { recursive: true });
  await writeFile(params.processedImagePath, encodedMain);

  if (params.mirrorLegacy) {
    await mkdir(path.dirname(params.legacyImagePath), { recursive: true });
    await cp(params.processedImagePath, params.legacyImagePath, { force: true });
  }

  if (emitVariants?.pixel === true) {
    await mkdir(path.dirname(withVariantSuffix(params.processedImagePath, "pixel")), {
      recursive: true,
    });
    await writeFile(withVariantSuffix(params.processedImagePath, "pixel"), encodedMain);
    if (params.mirrorLegacy) {
      await mkdir(path.dirname(withVariantSuffix(params.legacyImagePath, "pixel")), {
        recursive: true,
      });
      await writeFile(withVariantSuffix(params.legacyImagePath, "pixel"), encodedMain);
    }
    variantCount += 1;
  }

  const variants = postProcess.operations?.resizeVariants?.variants ?? [];
  for (const variant of variants) {
    const variantPath = withVariantSuffix(params.processedImagePath, variant.name);
    const variantLegacyPath = withVariantSuffix(params.legacyImagePath, variant.name);

    const variantBuffer = await sharp(mainRaw, { raw: mainRawInfo })
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

    const normalBuffer = await sharp(mainRaw, { raw: mainRawInfo })
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
    const specularBuffer = await sharp(mainRaw, { raw: mainRawInfo })
      .greyscale()
      .png()
      .toBuffer();
    await writeFile(specularPath, specularBuffer);
    if (params.mirrorLegacy) {
      await writeFile(specularLegacyPath, specularBuffer);
    }
  }

  if (params.target.auxiliaryMaps?.aoFromLuma) {
    const aoPath = withVariantSuffix(params.processedImagePath, "ao");
    const aoLegacyPath = withVariantSuffix(params.legacyImagePath, "ao");
    const aoBuffer = await sharp(mainRaw, { raw: mainRawInfo })
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

function animationMetadataPath(filePath: string): string {
  const ext = path.extname(filePath);
  const base = filePath.slice(0, filePath.length - ext.length);
  return `${base}.anim.json`;
}

async function assembleSpritesheetTarget(params: {
  sheetTarget: PlannedTarget;
  frameTargets: PlannedTarget[];
  processedImagesDir: string;
  legacyImagesDir: string;
  mirrorLegacy: boolean;
}): Promise<void> {
  if (params.frameTargets.length === 0) {
    return;
  }

  const orderedAnimations =
    params.sheetTarget.spritesheet?.animations?.map((animation) => animation.name) ?? [];
  const animationOrder = new Map(orderedAnimations.map((name, index) => [name, index]));

  const orderedFrames = [...params.frameTargets].sort((left, right) => {
    const leftAnimation = left.spritesheet?.animationName ?? "";
    const rightAnimation = right.spritesheet?.animationName ?? "";
    const leftOrder = animationOrder.get(leftAnimation) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = animationOrder.get(rightAnimation) ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    if (leftAnimation !== rightAnimation) {
      return leftAnimation.localeCompare(rightAnimation);
    }
    return (left.spritesheet?.frameIndex ?? 0) - (right.spritesheet?.frameIndex ?? 0);
  });

  const frameBuffers: Array<{
    target: PlannedTarget;
    buffer: Buffer;
    width: number;
    height: number;
  }> = [];

  for (const frameTarget of orderedFrames) {
    const framePath = resolvePathWithinDir(
      params.processedImagesDir,
      frameTarget.out,
      `spritesheet frame for target "${frameTarget.id}"`,
    );
    const image = sharp(framePath, { failOn: "none" });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) {
      continue;
    }
    const buffer = await image.png().toBuffer();
    frameBuffers.push({
      target: frameTarget,
      buffer,
      width: metadata.width,
      height: metadata.height,
    });
  }

  if (frameBuffers.length === 0) {
    return;
  }

  const frameWidth = Math.max(...frameBuffers.map((frame) => frame.width));
  const frameHeight = Math.max(...frameBuffers.map((frame) => frame.height));

  const framesByAnimation = new Map<string, typeof frameBuffers>();
  for (const frame of frameBuffers) {
    const animation = frame.target.spritesheet?.animationName ?? "default";
    const list = framesByAnimation.get(animation) ?? [];
    list.push(frame);
    framesByAnimation.set(animation, list);
  }

  const animationNames = Array.from(framesByAnimation.keys()).sort((left, right) => {
    const leftOrder = animationOrder.get(left) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = animationOrder.get(right) ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return left.localeCompare(right);
  });
  const maxFramesPerAnimation = Math.max(
    ...Array.from(framesByAnimation.values()).map((frames) => frames.length),
  );

  const sheetWidth = Math.max(1, maxFramesPerAnimation) * frameWidth;
  const sheetHeight = Math.max(1, animationNames.length) * frameHeight;

  const composites: sharp.OverlayOptions[] = [];
  const framesMeta: Record<string, unknown> = {};

  for (const [animationIndex, animationName] of animationNames.entries()) {
    const frames = (framesByAnimation.get(animationName) ?? []).sort(
      (left, right) =>
        (left.target.spritesheet?.frameIndex ?? 0) - (right.target.spritesheet?.frameIndex ?? 0),
    );

    for (const [frameOffset, frame] of frames.entries()) {
      const frameIndex = frame.target.spritesheet?.frameIndex ?? frameOffset;
      const x = frameIndex * frameWidth;
      const y = animationIndex * frameHeight;
      composites.push({
        input: frame.buffer,
        left: x,
        top: y,
      });

      framesMeta[`${params.sheetTarget.id}.${animationName}.${frameIndex}`] = {
        frame: { x, y, w: frame.width, h: frame.height },
        animation: {
          name: animationName,
          fps: frame.target.spritesheet?.fps ?? 8,
          loop: frame.target.spritesheet?.loop ?? true,
          pivot: frame.target.spritesheet?.pivot ?? { x: 0.5, y: 0.85 },
        },
      };
    }
  }

  const sheetBuffer = await sharp({
    create: {
      width: sheetWidth,
      height: sheetHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toBuffer();

  const processedSheetPath = resolvePathWithinDir(
    params.processedImagesDir,
    params.sheetTarget.out,
    `spritesheet output for target "${params.sheetTarget.id}"`,
  );
  const legacySheetPath = resolvePathWithinDir(
    params.legacyImagesDir,
    params.sheetTarget.out,
    `legacy spritesheet output for target "${params.sheetTarget.id}"`,
  );
  await mkdir(path.dirname(processedSheetPath), { recursive: true });
  await writeFile(processedSheetPath, sheetBuffer);
  if (params.mirrorLegacy) {
    await mkdir(path.dirname(legacySheetPath), { recursive: true });
    await writeFile(legacySheetPath, sheetBuffer);
  }

  const metadata = {
    generatedAt: new Date().toISOString(),
    sheetTargetId: params.sheetTarget.id,
    frameWidth,
    frameHeight,
    animations: animationNames.map((name) => ({
      name,
      frameCount: framesByAnimation.get(name)?.length ?? 0,
    })),
    frames: framesMeta,
  };

  const processedMetaPath = animationMetadataPath(processedSheetPath);
  await writeFile(processedMetaPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  if (params.mirrorLegacy) {
    const legacyMetaPath = animationMetadataPath(legacySheetPath);
    await writeFile(legacyMetaPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  }
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
  const targets = (Array.isArray(index.targets) ? index.targets : []).map(
    (target, targetIndex) => {
      try {
        return {
          ...target,
          out: normalizeTargetOutPath(target.out),
        };
      } catch (error) {
        throw new Error(
          `targets[${targetIndex}].out is invalid: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },
  );
  const generationTargets = targets.filter((target) => target.generationDisabled !== true);
  const spritesheetSheetTargets = targets.filter((target) => target.spritesheet?.isSheet === true);

  await mkdir(layout.processedImagesDir, { recursive: true });
  if (mirrorLegacy) {
    await mkdir(layout.legacyImagesDir, { recursive: true });
  }

  let variantCount = 0;
  for (const target of generationTargets) {
    const rawImagePath = resolvePathWithinDir(
      layout.rawDir,
      target.out,
      `raw image for target "${target.id}"`,
    );
    const processedImagePath = resolvePathWithinDir(
      layout.processedImagesDir,
      target.out,
      `processed image for target "${target.id}"`,
    );
    const legacyImagePath = resolvePathWithinDir(
      layout.legacyImagesDir,
      target.out,
      `legacy image for target "${target.id}"`,
    );

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

  for (const sheetTarget of spritesheetSheetTargets) {
    const frameTargets = generationTargets.filter(
      (target) =>
        target.spritesheet?.sheetTargetId === sheetTarget.id &&
        target.spritesheet?.isSheet !== true,
    );

    // eslint-disable-next-line no-await-in-loop
    await assembleSpritesheetTarget({
      sheetTarget,
      frameTargets,
      processedImagesDir: layout.processedImagesDir,
      legacyImagesDir: layout.legacyImagesDir,
      mirrorLegacy,
    });
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
    processedCount: targets.filter((target) => !target.catalogDisabled).length,
    variantCount,
  };
}
