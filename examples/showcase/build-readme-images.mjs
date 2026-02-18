#!/usr/bin/env node
import { mkdir, access, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

const args = process.argv.slice(2);
const argMap = new Map();
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (!arg.startsWith("--")) continue;
  const key = arg.slice(2);
  const value = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "true";
  argMap.set(key, value);
}

const outDir = path.resolve(argMap.get("out-dir") ?? path.join(repoRoot, ".tmp", "showcase-0.2.0"));
const destDir = path.resolve(argMap.get("dest-dir") ?? path.join(repoRoot, "docs", "showcase", "0.2.0"));

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

async function ensureFile(filePath) {
  await access(filePath);
}

async function loadRaw(image, width, height, kernel = sharp.kernel.nearest) {
  const pipeline = (typeof image === "string" ? sharp(image) : sharp(image))
    .resize(width, height, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel,
    })
    .ensureAlpha()
    .raw();

  const rawResult = await pipeline.toBuffer({ resolveWithObject: true });
  return {
    data: Buffer.from(rawResult.data),
    width: rawResult.info.width,
    height: rawResult.info.height,
    channels: rawResult.info.channels,
  };
}

async function cardImage(image, width, height, kernel = sharp.kernel.nearest) {
  const pipeline = typeof image === "string" ? sharp(image) : sharp(image);
  return pipeline
    .resize(width, height, {
      fit: "contain",
      background: { r: 9, g: 7, b: 14, alpha: 1 },
      kernel,
    })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function computeDiffHeatmap(leftImage, rightImage, width, height) {
  const left = await loadRaw(leftImage, width, height, sharp.kernel.nearest);
  const right = await loadRaw(rightImage, width, height, sharp.kernel.nearest);

  if (left.width !== right.width || left.height !== right.height) {
    throw new Error("Diff heatmap requires equal dimensions after resize.");
  }

  const out = Buffer.alloc(left.width * left.height * 4, 0);

  for (let i = 0; i < left.data.length; i += left.channels) {
    const lr = left.data[i];
    const lg = left.data[i + 1];
    const lb = left.data[i + 2];
    const rr = right.data[i];
    const rg = right.data[i + 1];
    const rb = right.data[i + 2];

    const diff = (Math.abs(lr - rr) + Math.abs(lg - rg) + Math.abs(lb - rb)) / 3;
    const intensity = Math.min(1, diff / 96);

    const outIndex = Math.floor(i / left.channels) * 4;
    out[outIndex] = clampByte(255 * intensity);
    out[outIndex + 1] = clampByte(200 * Math.max(0, 1 - Math.abs(intensity - 0.35) / 0.35));
    out[outIndex + 2] = clampByte(240 * (1 - intensity * 0.45));
    out[outIndex + 3] = 255;
  }

  return sharp(out, {
    raw: {
      width: left.width,
      height: left.height,
      channels: 4,
    },
  })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

function edgeSeamScoreFromRaw(data, width, height, channels, stripPx = 8) {
  if (width <= 1 || height <= 1 || channels < 3) {
    return 0;
  }

  const strip = Math.max(1, Math.min(stripPx, Math.floor(Math.min(width, height) / 2)));
  if (strip <= 0) {
    return 0;
  }

  let total = 0;
  let samples = 0;

  for (let y = 0; y < height; y += 1) {
    for (let offset = 0; offset < strip; offset += 1) {
      const leftIndex = (y * width + offset) * channels;
      const rightIndex = (y * width + (width - strip + offset)) * channels;
      total += Math.abs(data[leftIndex] - data[rightIndex]);
      total += Math.abs(data[leftIndex + 1] - data[rightIndex + 1]);
      total += Math.abs(data[leftIndex + 2] - data[rightIndex + 2]);
      samples += 3;
    }
  }

  for (let x = 0; x < width; x += 1) {
    for (let offset = 0; offset < strip; offset += 1) {
      const topIndex = (offset * width + x) * channels;
      const bottomIndex = ((height - strip + offset) * width + x) * channels;
      total += Math.abs(data[topIndex] - data[bottomIndex]);
      total += Math.abs(data[topIndex + 1] - data[bottomIndex + 1]);
      total += Math.abs(data[topIndex + 2] - data[bottomIndex + 2]);
      samples += 3;
    }
  }

  if (samples === 0) {
    return 0;
  }

  return total / samples;
}

async function tilePreview(image, columns = 6, rows = 4, tileSize = 88) {
  const tileBuffer = await (typeof image === "string" ? sharp(image) : sharp(image))
    .resize(tileSize, tileSize, { fit: "fill", kernel: sharp.kernel.nearest })
    .png()
    .toBuffer();

  const width = columns * tileSize;
  const height = rows * tileSize;
  const composites = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      composites.push({
        input: tileBuffer,
        left: column * tileSize,
        top: row * tileSize,
      });
    }
  }

  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();
}

async function readEvalFinalScore(filePath, targetId) {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    const target = (parsed.targets ?? []).find((item) => item.targetId === targetId);
    if (typeof target?.finalScore === "number") {
      return target.finalScore;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function buildThreePanelSvg(width, height, title, subtitle, labels) {
  const margin = 40;
  const gap = 24;
  const panelWidth = Math.floor((width - margin * 2 - gap * 2) / 3);

  const safeTitle = escapeXml(title);
  const safeSubtitle = escapeXml(subtitle);
  const safeLabels = labels.map((label) => escapeXml(label));

  const labelRects = safeLabels
    .map((label, index) => {
      const x = margin + index * (panelWidth + gap);
      return `<rect x="${x}" y="138" width="${panelWidth}" height="42" rx="10" fill="#0a0812" fill-opacity="0.84" />\n<text x="${x + panelWidth / 2}" y="166" fill="#f3e9ff" font-size="18" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif">${label}</text>`;
    })
    .join("\n");

  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#171220" />
      <stop offset="100%" stop-color="#0d0a16" />
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)" />
  <rect x="24" y="24" width="${width - 48}" height="90" rx="12" fill="#09070e" fill-opacity="0.65" />
  <text x="44" y="66" fill="#f4edff" font-size="34" font-family="Georgia, 'Times New Roman', serif" font-weight="700">${safeTitle}</text>
  <text x="44" y="95" fill="#b9a9d4" font-size="17" font-family="Georgia, 'Times New Roman', serif">${safeSubtitle}</text>
  ${labelRects}
</svg>`);
}

async function buildThreePanelShowcase({ title, subtitle, leftImage, centerImage, rightImage, labels, outPath }) {
  const width = 1560;
  const height = 760;
  const margin = 40;
  const gap = 24;
  const panelWidth = Math.floor((width - margin * 2 - gap * 2) / 3);
  const panelHeight = panelWidth;
  const panelTop = 194;

  const base = buildThreePanelSvg(width, height, title, subtitle, labels);
  const leftBuffer = await cardImage(leftImage, panelWidth, panelHeight, sharp.kernel.nearest);
  const centerBuffer = await cardImage(centerImage, panelWidth, panelHeight, sharp.kernel.nearest);
  const rightBuffer = await cardImage(rightImage, panelWidth, panelHeight, sharp.kernel.nearest);

  await sharp(base)
    .composite([
      { input: leftBuffer, left: margin, top: panelTop },
      { input: centerBuffer, left: margin + panelWidth + gap, top: panelTop },
      { input: rightBuffer, left: margin + (panelWidth + gap) * 2, top: panelTop },
    ])
    .png({ compressionLevel: 9 })
    .toFile(outPath);
}

async function makeSeamBrokenTile(sourcePath) {
  const loaded = await loadRaw(sourcePath, 512, 512, sharp.kernel.nearest);
  const broken = Buffer.from(loaded.data);
  const width = loaded.width;
  const height = loaded.height;
  const channels = loaded.channels;
  const strip = 12;

  for (let y = 0; y < height; y += 1) {
    for (let offset = 0; offset < strip; offset += 1) {
      const leftIndex = (y * width + offset) * channels;
      const rightIndex = (y * width + (width - strip + offset)) * channels;

      broken[leftIndex] = clampByte(broken[leftIndex] + 38);
      broken[leftIndex + 1] = clampByte(broken[leftIndex + 1] + 8);
      broken[leftIndex + 2] = clampByte(broken[leftIndex + 2] - 28);

      broken[rightIndex] = clampByte(broken[rightIndex] - 42);
      broken[rightIndex + 1] = clampByte(broken[rightIndex + 1] - 18);
      broken[rightIndex + 2] = clampByte(broken[rightIndex + 2] + 28);
    }
  }

  for (let x = 0; x < width; x += 1) {
    for (let offset = 0; offset < strip; offset += 1) {
      const topIndex = (offset * width + x) * channels;
      const bottomIndex = ((height - strip + offset) * width + x) * channels;

      broken[topIndex] = clampByte(broken[topIndex] + 24);
      broken[topIndex + 1] = clampByte(broken[topIndex + 1] - 16);
      broken[topIndex + 2] = clampByte(broken[topIndex + 2] - 14);

      broken[bottomIndex] = clampByte(broken[bottomIndex] - 30);
      broken[bottomIndex + 1] = clampByte(broken[bottomIndex + 1] + 10);
      broken[bottomIndex + 2] = clampByte(broken[bottomIndex + 2] + 16);
    }
  }

  return sharp(broken, {
    raw: {
      width,
      height,
      channels,
    },
  })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

function packPreviewSvg(width, height) {
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1b1427" />
      <stop offset="100%" stop-color="#0b0811" />
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)" />
  <rect x="24" y="24" width="${width - 48}" height="90" rx="12" fill="#09070e" fill-opacity="0.65" />
  <text x="44" y="64" fill="#f6eeff" font-size="34" font-family="Georgia, 'Times New Roman', serif" font-weight="700">From Prompt to Playable Pack</text>
  <text x="44" y="93" fill="#bca9da" font-size="17" font-family="Georgia, 'Times New Roman', serif">Generate once, then ship runtime-ready artifacts for Phaser, Pixi, and Unity.</text>

  <rect x="40" y="162" width="468" height="328" rx="14" fill="#09070f" fill-opacity="0.92" stroke="#3f2a61" stroke-width="2" />
  <rect x="40" y="520" width="468" height="412" rx="14" fill="#09070f" fill-opacity="0.92" stroke="#3f2a61" stroke-width="2" />
  <rect x="540" y="162" width="340" height="328" rx="14" fill="#09070f" fill-opacity="0.92" stroke="#3f2a61" stroke-width="2" />
  <rect x="540" y="520" width="340" height="412" rx="14" fill="#09070f" fill-opacity="0.92" stroke="#3f2a61" stroke-width="2" />
  <rect x="912" y="162" width="608" height="770" rx="14" fill="#09070f" fill-opacity="0.92" stroke="#3f2a61" stroke-width="2" />

  <text x="56" y="188" fill="#f3e9ff" font-size="20" font-family="Georgia, 'Times New Roman', serif">Hero Sprite</text>
  <text x="56" y="546" fill="#f3e9ff" font-size="20" font-family="Georgia, 'Times New Roman', serif">Tile Repeat Preview</text>
  <text x="556" y="188" fill="#f3e9ff" font-size="20" font-family="Georgia, 'Times New Roman', serif">Loot Icon</text>
  <text x="556" y="546" fill="#f3e9ff" font-size="20" font-family="Georgia, 'Times New Roman', serif">Release-Ready Output Contract</text>
  <text x="928" y="188" fill="#f3e9ff" font-size="20" font-family="Georgia, 'Times New Roman', serif">Background Art</text>

  <text x="560" y="608" fill="#e0ccff" font-size="16" font-family="Georgia, 'Times New Roman', serif">Phaser manifest + Pixi manifest</text>
  <text x="560" y="636" fill="#e0ccff" font-size="16" font-family="Georgia, 'Times New Roman', serif">+ Unity import manifest</text>
  <text x="560" y="676" fill="#b293de" font-size="14" font-family="Georgia, 'Times New Roman', serif">plus eval metrics, review artifact,</text>
  <text x="560" y="700" fill="#b293de" font-size="14" font-family="Georgia, 'Times New Roman', serif">selection lock, and provenance metadata.</text>
</svg>`);
}

async function buildPackPreview({ heroImage, tileImage, relicImage, backgroundImage, outPath }) {
  const width = 1560;
  const height = 980;
  const overlay = packPreviewSvg(width, height);

  const tileGrid = await tilePreview(tileImage, 5, 4, 88);

  const hero = await cardImage(heroImage, 440, 270, sharp.kernel.nearest);
  const tile = await cardImage(tileGrid, 440, 340, sharp.kernel.nearest);
  const relic = await cardImage(relicImage, 312, 270, sharp.kernel.nearest);
  const background = await cardImage(backgroundImage, 580, 710, sharp.kernel.nearest);

  await sharp(overlay)
    .composite([
      { input: hero, left: 54, top: 202 },
      { input: tile, left: 54, top: 560 },
      { input: relic, left: 554, top: 202 },
      { input: background, left: 926, top: 202 },
    ])
    .png({ compressionLevel: 9 })
    .toFile(outPath);
}

async function main() {
  await mkdir(destDir, { recursive: true });

  const beforeHero = path.join(outDir, "showcase", "before", "hero-idle.png");
  const afterHero = path.join(outDir, "assets", "imagegen", "processed", "images", "hero-idle.png");
  const dungeonTile = path.join(outDir, "assets", "imagegen", "processed", "images", "dungeon-tile.png");
  const relicIcon = path.join(outDir, "assets", "imagegen", "processed", "images", "ui-relic-icon.png");
  const tavernBackground = path.join(outDir, "assets", "imagegen", "processed", "images", "tavern-hub-bg.png");
  const beforeEval = path.join(outDir, "showcase", "before", "eval-report-before.json");
  const afterEval = path.join(outDir, "checks", "eval-report.json");

  await Promise.all([
    ensureFile(beforeHero),
    ensureFile(afterHero),
    ensureFile(dungeonTile),
    ensureFile(relicIcon),
    ensureFile(tavernBackground),
  ]);

  const heroDiff = await computeDiffHeatmap(beforeHero, afterHero, 480, 480);
  const beforeScore = await readEvalFinalScore(beforeEval, "hero-idle");
  const afterScore = await readEvalFinalScore(afterEval, "hero-idle");
  const scoreSubtitle =
    typeof beforeScore === "number" && typeof afterScore === "number"
      ? `Eval finalScore delta (hero-idle): ${afterScore >= beforeScore ? "+" : ""}${formatNumber(afterScore - beforeScore)} (white in heatmap = stronger change)`
      : "Comparison of original approved render vs regenerated edit variant (white in heatmap = stronger change).";

  await buildThreePanelShowcase({
    title: "Edit-First Regenerate Comparison",
    subtitle: scoreSubtitle,
    leftImage: beforeHero,
    centerImage: afterHero,
    rightImage: heroDiff,
    labels: ["Original approved render", "Regenerated edit variant", "Pixel change heatmap"],
    outPath: path.join(destDir, "01-edit-loop.png"),
  });

  const brokenTile = await makeSeamBrokenTile(dungeonTile);
  const seamHealModule = await import(
    pathToFileURL(path.join(repoRoot, "dist", "pipeline", "seamHeal.js")).href
  );
  const healedTile = await seamHealModule.applySeamHeal(brokenTile, {
    tileable: true,
    seamStripPx: 12,
    seamHeal: {
      enabled: true,
      stripPx: 12,
      strength: 1,
    },
  });

  await writeFile(path.join(outDir, "showcase", "before", "dungeon-tile-seam-broken.png"), brokenTile);
  await writeFile(path.join(outDir, "showcase", "before", "dungeon-tile-seam-healed.png"), healedTile);

  const brokenScoreRaw = await loadRaw(brokenTile, 512, 512, sharp.kernel.nearest);
  const healedScoreRaw = await loadRaw(healedTile, 512, 512, sharp.kernel.nearest);
  const brokenScore = edgeSeamScoreFromRaw(
    brokenScoreRaw.data,
    brokenScoreRaw.width,
    brokenScoreRaw.height,
    brokenScoreRaw.channels,
    8,
  );
  const healedScore = edgeSeamScoreFromRaw(
    healedScoreRaw.data,
    healedScoreRaw.width,
    healedScoreRaw.height,
    healedScoreRaw.channels,
    8,
  );

  const brokenRepeat = await tilePreview(brokenTile, 6, 6, 80);
  const healedRepeat = await tilePreview(healedTile, 6, 6, 80);
  const seamDiff = await computeDiffHeatmap(brokenRepeat, healedRepeat, 480, 480);

  await buildThreePanelShowcase({
    title: "Seam-Heal Demonstration (Intentional Stress Test)",
    subtitle: `Same tile with intentional edge corruption -> seam-heal pass. Edge seam score: ${brokenScore.toFixed(2)} -> ${healedScore.toFixed(2)}`,
    leftImage: brokenRepeat,
    centerImage: healedRepeat,
    rightImage: seamDiff,
    labels: ["Broken repeat", "After seam-heal", "Pixel change heatmap"],
    outPath: path.join(destDir, "02-seam-heal.png"),
  });

  await buildPackPreview({
    heroImage: afterHero,
    tileImage: healedTile,
    relicImage: relicIcon,
    backgroundImage: tavernBackground,
    outPath: path.join(destDir, "03-pack-preview.png"),
  });

  console.log(`Wrote showcase images to ${destDir}`);
}

main().catch((error) => {
  const detail = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
  console.error(detail);
  process.exitCode = 1;
});
