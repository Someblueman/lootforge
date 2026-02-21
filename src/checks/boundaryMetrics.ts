export interface BoundaryQualityMetrics {
  edgePixelCount: number;
  haloRisk: number;
  strayNoiseRatio: number;
  edgeSharpness: number;
}

interface PixelBounds {
  width: number;
  height: number;
}

const CARDINAL_NEIGHBORS: readonly [dx: number, dy: number][] = [
  [0, -1],
  [-1, 0],
  [1, 0],
  [0, 1],
];

const ALL_NEIGHBORS: readonly [dx: number, dy: number][] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

export function computeBoundaryQualityMetrics(params: {
  raw: Buffer;
  channels: number;
  width: number;
  height: number;
}): BoundaryQualityMetrics | undefined {
  if (params.channels < 4 || params.width <= 0 || params.height <= 0) {
    return undefined;
  }

  const alphaAt = (x: number, y: number): number => {
    return params.raw[(y * params.width + x) * params.channels + 3] ?? 0;
  };
  const rgbAt = (x: number, y: number): { r: number; g: number; b: number } => {
    const index = (y * params.width + x) * params.channels;
    return {
      r: params.raw[index] ?? 0,
      g: params.raw[index + 1] ?? 0,
      b: params.raw[index + 2] ?? 0,
    };
  };

  let opaquePixels = 0;
  let isolatedOpaquePixels = 0;
  let edgePixels = 0;
  let haloPixels = 0;
  let edgeSharpnessTotal = 0;
  let edgeSharpnessSamples = 0;

  forEachPixel({ width: params.width, height: params.height }, (x, y) => {
    const alpha = alphaAt(x, y);
    if (alpha <= 0) {
      return;
    }

    opaquePixels += 1;

    let transparentNeighborCount = 0;
    for (const [dx, dy] of ALL_NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!isWithinBounds({ width: params.width, height: params.height }, nx, ny)) {
        transparentNeighborCount += 1;
        continue;
      }
      if (alphaAt(nx, ny) === 0) {
        transparentNeighborCount += 1;
      }
    }
    if (transparentNeighborCount === ALL_NEIGHBORS.length) {
      isolatedOpaquePixels += 1;
    }

    let isBoundary = false;
    for (const [dx, dy] of CARDINAL_NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!isWithinBounds({ width: params.width, height: params.height }, nx, ny)) {
        isBoundary = true;
        edgeSharpnessTotal += alpha / 255;
        edgeSharpnessSamples += 1;
        continue;
      }
      if (alphaAt(nx, ny) === 0) {
        isBoundary = true;
        edgeSharpnessTotal += alpha / 255;
        edgeSharpnessSamples += 1;
      }
    }

    if (!isBoundary) {
      return;
    }

    edgePixels += 1;
    const { r, g, b } = rgbAt(x, y);
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (alpha < 250 && luma > 180) {
      haloPixels += 1;
    }
  });

  return {
    edgePixelCount: edgePixels,
    haloRisk: edgePixels > 0 ? haloPixels / edgePixels : 0,
    strayNoiseRatio: opaquePixels > 0 ? isolatedOpaquePixels / opaquePixels : 0,
    edgeSharpness: edgeSharpnessSamples > 0 ? edgeSharpnessTotal / edgeSharpnessSamples : 0,
  };
}

function forEachPixel(bounds: PixelBounds, fn: (x: number, y: number) => void): void {
  for (let y = 0; y < bounds.height; y += 1) {
    for (let x = 0; x < bounds.width; x += 1) {
      fn(x, y);
    }
  }
}

function isWithinBounds(bounds: PixelBounds, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < bounds.width && y < bounds.height;
}
