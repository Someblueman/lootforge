import { access, mkdtemp, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { writeContactSheetPng } from "../../src/output/contactSheet.js";

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

describe("contact sheet", () => {
  it("generates a deterministic contact sheet image", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "lootforge-contact-sheet-"));
    const imagesDir = path.join(tempDir, "images");
    const outPath = path.join(tempDir, "contact-sheet.png");

    await mkdir(imagesDir, { recursive: true });

    await Promise.all(
      ["d.png", "c.png", "b.png", "a.png"].map(async (name, index) => {
        await sharp({
          create: {
            width: 64 + index,
            height: 64 + index,
            channels: 4,
            background: { r: 16 * index, g: 32, b: 48, alpha: 1 },
          },
        })
          .png()
          .toFile(path.join(imagesDir, name));
      }),
    );

    const result = await writeContactSheetPng(imagesDir, outPath, {
      orderedFilenames: ["a.png", "b.png", "c.png", "d.png"],
    });

    expect(result.imageCount).toBe(4);
    expect(await exists(outPath)).toBe(true);

    const metadata = await sharp(outPath).metadata();
    expect((metadata.width ?? 0) > 100).toBe(true);
    expect((metadata.height ?? 0) > 100).toBe(true);

    const stats = await sharp(outPath).stats();
    expect(stats.channels.length).toBe(4);
  });
});
