import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runValidateCommand } from "../../src/cli/commands/validate.js";

describe("validate command", () => {
  it("preserves image acceptance diagnostics instead of masking them as manifest load failures", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "lootforge-validate-command-"));
    const manifestPath = path.join(root, "assets", "imagegen", "manifest.json");
    const outDir = path.join(root, "out");

    await mkdir(path.dirname(manifestPath), { recursive: true });
    await mkdir(path.join(outDir, "checks"), { recursive: true });

    await writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          version: "next",
          pack: {
            id: "test-pack",
            version: "0.1.0",
          },
          providers: {
            default: "openai",
            openai: { model: "gpt-image-1" },
          },
          styleKits: [
            {
              id: "default",
              rulesPath: "style/default.md",
              referenceImages: [],
              lightingModel: "flat",
            },
          ],
          evaluationProfiles: [{ id: "q" }],
          targets: [
            {
              id: "hero",
              kind: "sprite",
              out: "hero.png",
              styleKitId: "default",
              consistencyGroup: "heroes",
              evaluationProfileId: "q",
              prompt: "hero",
              generationPolicy: {
                outputFormat: "png",
                background: "transparent",
              },
              acceptance: {
                size: "64x64",
                alpha: true,
              },
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const result = await runValidateCommand([
      "--manifest",
      manifestPath,
      "--out",
      outDir,
      "--check-images",
      "true",
      "--strict",
      "true",
      "--images-dir",
      path.join(root, "missing-images"),
    ]);

    const issueCodes = result.report.issues.map((issue) => issue.code);
    expect(result.exitCode).toBe(1);
    expect(result.report.targetCount).toBe(1);
    expect(issueCodes).toContain("image_missing_or_invalid_image");
    expect(issueCodes).not.toContain("manifest_load_failed");
  });
});
