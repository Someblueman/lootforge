import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const EMPTY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5Y6osAAAAASUVORK5CYII=";

async function firstImagePath(imagesDir: string): Promise<string | null> {
  let entries: string[] = [];
  try {
    entries = await readdir(imagesDir);
  } catch {
    return null;
  }

  const image = entries.find((name) => /\.(png|jpg|jpeg|webp)$/i.test(name));
  return image ? path.join(imagesDir, image) : null;
}

export async function writeContactSheetPng(
  imagesDir: string,
  outputPath: string,
): Promise<{ source: string }> {
  await mkdir(path.dirname(outputPath), { recursive: true });

  const imagePath = await firstImagePath(imagesDir);
  if (imagePath && /\.png$/i.test(imagePath)) {
    await copyFile(imagePath, outputPath);
    return { source: imagePath };
  }

  await writeFile(outputPath, Buffer.from(EMPTY_PNG_BASE64, "base64"));
  return { source: "placeholder" };
}

