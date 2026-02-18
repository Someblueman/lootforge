import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { applySeamHeal } from "../../src/pipeline/seamHeal.js";
import type { PlannedTarget } from "../../src/providers/types.js";

async function createEdgeMismatchImage(width: number, height: number): Promise<Buffer> {
  const channels = 4;
  const raw = Buffer.alloc(width * height * channels, 0);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * channels;
      raw[index] = x === 0 ? 255 : 32;
      raw[index + 1] = 0;
      raw[index + 2] = x === width - 1 ? 255 : 32;
      raw[index + 3] = 255;
    }
  }

  return sharp(raw, { raw: { width, height, channels } }).png().toBuffer();
}

async function readRaw(
  imageBuffer: Buffer,
): Promise<{ data: Buffer; width: number; height: number; channels: number }> {
  const rawResult = await sharp(imageBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data: rawResult.data,
    width: rawResult.info.width,
    height: rawResult.info.height,
    channels: rawResult.info.channels,
  };
}

function edgeDelta(raw: Buffer, width: number, height: number, channels: number): number {
  let total = 0;
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    const left = (y * width) * channels;
    const right = (y * width + (width - 1)) * channels;
    for (let c = 0; c < 3; c += 1) {
      total += Math.abs(raw[left + c] - raw[right + c]);
      count += 1;
    }
  }
  return total / Math.max(1, count);
}

function makeTarget(overrides: Partial<PlannedTarget> = {}): PlannedTarget {
  return {
    id: "tile",
    kind: "tile",
    out: "tile.png",
    promptSpec: { primary: "tile" },
    ...overrides,
  };
}

describe("seam heal", () => {
  it("reduces opposite-edge deltas for tileable targets", async () => {
    const input = await createEdgeMismatchImage(8, 8);
    const before = await readRaw(input);
    const beforeDelta = edgeDelta(before.data, before.width, before.height, before.channels);

    const healed = await applySeamHeal(
      input,
      makeTarget({
        tileable: true,
        seamHeal: {
          enabled: true,
          stripPx: 1,
          strength: 1,
        },
      }),
    );
    const after = await readRaw(healed);
    const afterDelta = edgeDelta(after.data, after.width, after.height, after.channels);

    expect(afterDelta).toBeLessThan(beforeDelta);
  });

  it("is a no-op when seam heal is disabled", async () => {
    const input = await createEdgeMismatchImage(8, 8);
    const healed = await applySeamHeal(
      input,
      makeTarget({
        tileable: true,
        seamHeal: {
          enabled: false,
          stripPx: 1,
          strength: 1,
        },
      }),
    );

    const before = await readRaw(input);
    const after = await readRaw(healed);
    expect(Buffer.compare(after.data, before.data)).toBe(0);
  });
});
