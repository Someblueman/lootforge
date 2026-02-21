import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { openImage } from "../shared/image.js";

const IMAGE_PATTERN = /\.(png|jpe?g|webp)$/i;

const EMPTY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5Y6osAAAAASUVORK5CYII=";

export interface ContactSheetOptions {
  orderedFilenames?: string[];
  maxColumns?: number;
  thumbnailSize?: number;
  padding?: number;
  labelHeight?: number;
  backgroundColor?: string;
}

export interface ContactSheetResult {
  source: string;
  imageCount: number;
}

async function listImageFilenames(imagesDir: string): Promise<string[]> {
  try {
    const entries = await readdir(imagesDir);
    return entries.filter((name) => IMAGE_PATTERN.test(name));
  } catch {
    return [];
  }
}

function sortFilenames(filenames: string[], orderedFilenames: string[] | undefined): string[] {
  if (!orderedFilenames || orderedFilenames.length === 0) {
    return [...filenames].sort((left, right) => left.localeCompare(right));
  }

  const orderIndex = new Map<string, number>();
  for (let index = 0; index < orderedFilenames.length; index += 1) {
    const filename = orderedFilenames[index];
    if (!orderIndex.has(filename)) {
      orderIndex.set(filename, index);
    }
  }

  return [...filenames].sort((left, right) => {
    const leftIndex = orderIndex.get(left);
    const rightIndex = orderIndex.get(right);

    if (typeof leftIndex === "number" && typeof rightIndex === "number") {
      return leftIndex - rightIndex;
    }

    if (typeof leftIndex === "number") return -1;
    if (typeof rightIndex === "number") return 1;
    return left.localeCompare(right);
  });
}

function toFilenameLabel(filename: string): string {
  const maxLength = 24;
  if (filename.length <= maxLength) {
    return filename;
  }
  return `${filename.slice(0, maxLength - 1)}…`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildLabelOverlaySvg(width: number, height: number, text: string): Buffer {
  const escaped = escapeXml(text);
  return Buffer.from(
    [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`,
      `<rect x="0" y="0" width="${width}" height="${height}" fill="#111" />`,
      `<text x="${Math.round(width / 2)}" y="${Math.round(height * 0.72)}"`,
      ` text-anchor="middle" font-family="monospace" font-size="12" fill="#ddd">${escaped}</text>`,
      "</svg>",
    ].join(""),
  );
}

export async function writeContactSheetPng(
  imagesDir: string,
  outputPath: string,
  options: ContactSheetOptions = {},
): Promise<ContactSheetResult> {
  const maxColumns = Math.max(1, options.maxColumns ?? 8);
  const thumbnailSize = Math.max(1, options.thumbnailSize ?? 128);
  const padding = Math.max(0, options.padding ?? 16);
  const labelHeight = Math.max(1, options.labelHeight ?? 22);
  const backgroundColor = options.backgroundColor ?? "#111";

  await mkdir(path.dirname(outputPath), { recursive: true });

  const filenames = sortFilenames(await listImageFilenames(imagesDir), options.orderedFilenames);

  if (filenames.length === 0) {
    await writeFile(outputPath, Buffer.from(EMPTY_PNG_BASE64, "base64"));
    return { source: "placeholder", imageCount: 0 };
  }

  const columns = Math.min(maxColumns, filenames.length);
  const rows = Math.ceil(filenames.length / columns);
  const cellWidth = thumbnailSize;
  const cellHeight = thumbnailSize + labelHeight;

  const sheetWidth = padding * 2 + columns * cellWidth + (columns - 1) * padding;
  const sheetHeight = padding * 2 + rows * cellHeight + (rows - 1) * padding;

  const compositeInputs: sharp.OverlayOptions[] = [];

  for (let index = 0; index < filenames.length; index += 1) {
    const filename = filenames[index];
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = padding + column * (cellWidth + padding);
    const top = padding + row * (cellHeight + padding);

    const thumbBuffer = await openImage(path.join(imagesDir, filename), "pipeline")
      .resize(thumbnailSize, thumbnailSize, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();

    compositeInputs.push({
      input: thumbBuffer,
      left,
      top,
    });

    compositeInputs.push({
      input: buildLabelOverlaySvg(cellWidth, labelHeight, toFilenameLabel(filename)),
      left,
      top: top + thumbnailSize,
    });
  }

  await sharp({
    create: {
      width: sheetWidth,
      height: sheetHeight,
      channels: 4,
      background: backgroundColor,
    },
  })
    .composite(compositeInputs)
    .png()
    .toFile(outputPath);

  return {
    source: path.join(imagesDir, filenames[0]),
    imageCount: filenames.length,
  };
}
