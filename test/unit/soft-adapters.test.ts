import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import { runEnabledSoftAdapters } from "../../src/checks/softAdapters.ts";
import { type PlannedTarget } from "../../src/providers/types.ts";

const ADAPTER_ENV_KEYS = [
  "LOOTFORGE_ENABLE_CLIP_ADAPTER",
  "LOOTFORGE_CLIP_ADAPTER_CMD",
  "LOOTFORGE_CLIP_ADAPTER_URL",
  "LOOTFORGE_CLIP_ADAPTER_TIMEOUT_MS",
  "LOOTFORGE_ENABLE_LPIPS_ADAPTER",
  "LOOTFORGE_LPIPS_ADAPTER_CMD",
  "LOOTFORGE_LPIPS_ADAPTER_URL",
  "LOOTFORGE_LPIPS_ADAPTER_TIMEOUT_MS",
  "LOOTFORGE_ENABLE_SSIM_ADAPTER",
  "LOOTFORGE_SSIM_ADAPTER_CMD",
  "LOOTFORGE_SSIM_ADAPTER_URL",
  "LOOTFORGE_SSIM_ADAPTER_TIMEOUT_MS",
  "LOOTFORGE_ADAPTER_TIMEOUT_MS",
] as const;

const ORIGINAL_ENV = new Map<string, string | undefined>(
  ADAPTER_ENV_KEYS.map((key) => [key, process.env[key]]),
);

function toCommand(program: string, ...args: string[]): string {
  return [program, ...args.map((value) => JSON.stringify(value))].join(" ");
}

describe("soft adapters", () => {
  afterEach(() => {
    for (const key of ADAPTER_ENV_KEYS) {
      const value = ORIGINAL_ENV.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("runs enabled adapters in parallel while keeping deterministic aggregation order", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lootforge-soft-adapters-"));
    const imagePath = path.join(tempRoot, "candidate.png");
    const adapterScriptPath = path.join(tempRoot, "adapter.js");
    const clipLogPath = path.join(tempRoot, "clip-log.json");
    const lpipsLogPath = path.join(tempRoot, "lpips-log.json");

    await sharp({
      create: {
        width: 16,
        height: 16,
        channels: 4,
        background: { r: 10, g: 20, b: 30, alpha: 255 },
      },
    })
      .png()
      .toFile(imagePath);

    await writeFile(
      adapterScriptPath,
      [
        'const fs = require("node:fs");',
        'const payload = JSON.parse(fs.readFileSync(0, "utf8"));',
        "const logPath = process.argv[2];",
        'const delayMs = Number(process.argv[3] || "0");',
        "const start = Date.now();",
        "setTimeout(() => {",
        "  const end = Date.now();",
        "  fs.writeFileSync(logPath, JSON.stringify({ start, end, adapter: payload.adapter }));",
        '  const score = payload.adapter === "clip" ? 1 : 2;',
        "  process.stdout.write(JSON.stringify({ metrics: { score }, score }));",
        "}, delayMs);",
        "",
      ].join("\n"),
      "utf8",
    );

    process.env.LOOTFORGE_ENABLE_CLIP_ADAPTER = "1";
    process.env.LOOTFORGE_ENABLE_LPIPS_ADAPTER = "1";
    process.env.LOOTFORGE_CLIP_ADAPTER_CMD = toCommand(
      process.execPath,
      adapterScriptPath,
      clipLogPath,
      "350",
    );
    process.env.LOOTFORGE_LPIPS_ADAPTER_CMD = toCommand(
      process.execPath,
      adapterScriptPath,
      lpipsLogPath,
      "350",
    );

    const target: PlannedTarget = {
      id: "soft-adapter-target",
      kind: "sprite",
      out: "candidate.png",
      promptSpec: { primary: "candidate sprite" },
      generationPolicy: {
        outputFormat: "png",
        background: "opaque",
      },
    };

    const result = await runEnabledSoftAdapters({
      target,
      imagePath,
      outDir: tempRoot,
    });

    expect(result.adapterNames).toEqual(["clip", "lpips"]);
    expect(result.succeededAdapters).toEqual(["clip", "lpips"]);
    expect(result.failedAdapters).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.adapterScores.clip).toBe(1);
    expect(result.adapterScores.lpips).toBe(2);

    const clipWindow = JSON.parse(await readFile(clipLogPath, "utf8")) as {
      start: number;
      end: number;
    };
    const lpipsWindow = JSON.parse(await readFile(lpipsLogPath, "utf8")) as {
      start: number;
      end: number;
    };

    const overlapStart = Math.max(clipWindow.start, lpipsWindow.start);
    const overlapEnd = Math.min(clipWindow.end, lpipsWindow.end);
    expect(overlapEnd - overlapStart).toBeGreaterThan(0);
  });

  it("supports quoted command arguments without using a shell", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lootforge-soft-adapters-quoted-"));
    const imagePath = path.join(tempRoot, "candidate.png");
    const adapterScriptPath = path.join(tempRoot, "adapter with space.js");
    const quotedLogPath = path.join(tempRoot, "quoted run log.json");

    await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 4,
        background: { r: 20, g: 30, b: 40, alpha: 255 },
      },
    })
      .png()
      .toFile(imagePath);

    await writeFile(
      adapterScriptPath,
      [
        'const fs = require("node:fs");',
        'const payload = JSON.parse(fs.readFileSync(0, "utf8"));',
        'const logPath = process.argv[2] || "missing-path";',
        "fs.writeFileSync(logPath, JSON.stringify({ adapter: payload.adapter }));",
        "process.stdout.write(JSON.stringify({ metrics: { score: 3 }, score: 3 }));",
      ].join("\n"),
      "utf8",
    );

    process.env.LOOTFORGE_ENABLE_CLIP_ADAPTER = "1";
    process.env.LOOTFORGE_ENABLE_LPIPS_ADAPTER = "0";
    process.env.LOOTFORGE_ENABLE_SSIM_ADAPTER = "0";
    process.env.LOOTFORGE_CLIP_ADAPTER_CMD = toCommand(
      process.execPath,
      adapterScriptPath,
      quotedLogPath,
    );

    const target: PlannedTarget = {
      id: "quoted-args",
      kind: "sprite",
      out: "candidate.png",
      promptSpec: { primary: "candidate sprite" },
      generationPolicy: {
        outputFormat: "png",
        background: "opaque",
      },
    };

    const result = await runEnabledSoftAdapters({
      target,
      imagePath,
      outDir: tempRoot,
    });

    expect(result.adapterNames).toEqual(["clip"]);
    expect(result.succeededAdapters).toEqual(["clip"]);
    const log = await readFile(quotedLogPath, "utf8");
    expect(log.includes("clip")).toBe(true);
  });
});
