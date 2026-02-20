import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { PalettePolicy, PlannedTarget } from "../providers/types.js";
import { normalizeManifestAssetPath } from "../shared/paths.js";
import type {
  ManifestEvaluationProfile,
  ManifestStyleKit,
  ManifestTarget,
} from "./types.js";

export const HEX_COLOR_PATTERN = /^#?[0-9a-fA-F]{6}$/;

export function normalizePalettePolicy(
  target: ManifestTarget,
): PalettePolicy | undefined {
  const palette = target.palette;
  if (!palette) {
    return undefined;
  }

  if (palette.mode === "exact") {
    return {
      mode: "exact",
      colors: (palette.colors ?? []).map((color) => normalizeHexColor(color)),
      dither: palette.dither,
      strict: palette.strict,
    };
  }

  return {
    mode: "max-colors",
    maxColors: palette.maxColors,
    dither: palette.dither,
  };
}

export function resolveTargetPalettePolicy(
  target: ManifestTarget,
  styleKitPaletteDefault?: PalettePolicy,
): PalettePolicy | undefined {
  const targetPalette = normalizePalettePolicy(target);
  if (targetPalette) {
    return targetPalette;
  }

  if (!styleKitPaletteDefault) {
    return undefined;
  }

  if (styleKitPaletteDefault.mode === "exact") {
    return {
      mode: "exact",
      colors: [...(styleKitPaletteDefault.colors ?? [])],
      dither: styleKitPaletteDefault.dither,
      strict: styleKitPaletteDefault.strict,
    };
  }

  return { ...styleKitPaletteDefault };
}

export function resolveStyleKitPaletteDefaults(
  styleKits: ManifestStyleKit[],
  manifestPath?: string,
): Map<string, PalettePolicy> {
  const defaults = new Map<string, PalettePolicy>();
  if (!manifestPath) {
    return defaults;
  }

  const manifestDir = path.dirname(path.resolve(manifestPath));
  for (const styleKit of styleKits) {
    const palette = loadStyleKitPalettePolicy(styleKit, manifestDir);
    if (palette) {
      defaults.set(styleKit.id, palette);
    }
  }

  return defaults;
}

export function loadStyleKitPalettePolicy(
  styleKit: ManifestStyleKit,
  manifestDir: string,
): PalettePolicy | undefined {
  if (!styleKit.palettePath) {
    return undefined;
  }

  let normalizedPalettePath: string;
  try {
    normalizedPalettePath = normalizeManifestAssetPath(styleKit.palettePath);
  } catch {
    return undefined;
  }

  const paletteFilePath = path.resolve(
    manifestDir,
    normalizedPalettePath.split("/").join(path.sep),
  );
  if (!existsSync(paletteFilePath)) {
    return undefined;
  }

  let rawPalette = "";
  try {
    rawPalette = readFileSync(paletteFilePath, "utf8");
  } catch {
    return undefined;
  }

  const colors = parsePaletteFileColors(rawPalette);
  if (colors.length === 0) {
    return undefined;
  }

  return {
    mode: "exact",
    colors,
  };
}

export function parsePaletteFileColors(rawPalette: string): string[] {
  const colors: string[] = [];
  const seen = new Set<string>();

  const append = (color: string): void => {
    if (seen.has(color)) {
      return;
    }
    seen.add(color);
    colors.push(color);
  };

  for (const line of rawPalette.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    if (/^(gimp\s+palette|name:|columns:)/iu.test(trimmed)) {
      continue;
    }

    const directHex = /^#?[0-9a-fA-F]{6}$/u.exec(trimmed);
    if (directHex) {
      append(normalizeHexColor(directHex[0]));
      continue;
    }

    if (trimmed.startsWith("//") || trimmed.startsWith(";")) {
      continue;
    }

    const rgbTriple =
      /^\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s+.*)?$/u.exec(
        trimmed,
      ) ?? /^\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(?:\s+.*)?$/u.exec(trimmed);
    if (rgbTriple) {
      const r = Number.parseInt(rgbTriple[1], 10);
      const g = Number.parseInt(rgbTriple[2], 10);
      const b = Number.parseInt(rgbTriple[3], 10);
      if (
        Number.isFinite(r) &&
        Number.isFinite(g) &&
        Number.isFinite(b) &&
        r >= 0 &&
        r <= 255 &&
        g >= 0 &&
        g <= 255 &&
        b >= 0 &&
        b <= 255
      ) {
        append(rgbToHex(r, g, b));
      }
      continue;
    }

    const embeddedHex = /#?[0-9a-fA-F]{6}\b/u.exec(trimmed);
    if (embeddedHex) {
      append(normalizeHexColor(embeddedHex[0]));
    }
  }

  return colors;
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${r.toString(16).padStart(2, "0")}${g
    .toString(16)
    .padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

export function normalizeHexColor(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith("#")) {
    return trimmed.toLowerCase();
  }
  return `#${trimmed.toLowerCase()}`;
}

export function normalizeSeamHealPolicy(
  target: ManifestTarget,
  evalProfile: ManifestEvaluationProfile,
): PlannedTarget["seamHeal"] | undefined {
  const seamHeal = target.seamHeal;
  if (!seamHeal) {
    return undefined;
  }

  const stripPx =
    seamHeal.stripPx ??
    target.seamStripPx ??
    evalProfile.hardGates?.seamStripPx;
  return {
    enabled: seamHeal.enabled ?? true,
    ...(typeof stripPx === "number"
      ? { stripPx: Math.max(1, Math.round(stripPx)) }
      : {}),
    ...(typeof seamHeal.strength === "number"
      ? { strength: Math.max(0, Math.min(1, seamHeal.strength)) }
      : {}),
  };
}

export function normalizeWrapGridPolicy(
  target: ManifestTarget,
  evalProfile: ManifestEvaluationProfile,
): PlannedTarget["wrapGrid"] | undefined {
  const wrapGrid = target.wrapGrid;
  if (!wrapGrid) {
    return undefined;
  }

  const seamThreshold =
    wrapGrid.seamThreshold ??
    target.seamThreshold ??
    evalProfile.hardGates?.seamThreshold;
  const seamStripPx =
    wrapGrid.seamStripPx ??
    target.seamStripPx ??
    evalProfile.hardGates?.seamStripPx;

  return {
    columns: Math.max(1, Math.round(wrapGrid.columns)),
    rows: Math.max(1, Math.round(wrapGrid.rows)),
    ...(typeof seamThreshold === "number" ? { seamThreshold } : {}),
    ...(typeof seamStripPx === "number"
      ? { seamStripPx: Math.max(1, Math.round(seamStripPx)) }
      : {}),
  };
}
