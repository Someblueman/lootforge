import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT_PATH = path.join(REPO_ROOT, "scripts", "check-manifest-policy-coverage.mjs");

async function writeCoverageFile(params: {
  root: string;
  implementationCell: string;
  testsCell: string;
}) {
  const coveragePath = path.join(params.root, "coverage.md");
  const markdown = [
    "# Coverage",
    "",
    "| Field | Status | Implementation | Tests | Notes |",
    "| --- | --- | --- | --- | --- |",
    `| \`targets[].generationPolicy.size\` | implemented | ${params.implementationCell} | ${params.testsCell} | test fixture |`,
    "",
  ].join("\n");
  await writeFile(coveragePath, markdown, "utf8");
  return coveragePath;
}

describe("manifest policy coverage gate script", () => {
  it("passes when implemented fields include implementation and test evidence", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "manifest-policy-gate-pass-"));
    await mkdir(path.join(tempRoot, "src"), { recursive: true });
    await mkdir(path.join(tempRoot, "test"), { recursive: true });
    await writeFile(path.join(tempRoot, "src", "impl.ts"), "export const ok = true;\n", "utf8");
    await writeFile(
      path.join(tempRoot, "test", "impl.test.ts"),
      "export const ok = true;\n",
      "utf8",
    );

    const sourcePath = await writeCoverageFile({
      root: tempRoot,
      implementationCell: "`src/impl.ts`",
      testsCell: "`test/impl.test.ts`",
    });
    const reportPath = path.join(tempRoot, "coverage", "report.json");

    const run = spawnSync("node", [
      SCRIPT_PATH,
      "--source",
      sourcePath,
      "--report",
      reportPath,
      "--repo-root",
      tempRoot,
    ]);

    expect(run.status).toBe(0);

    const report = JSON.parse(await readFile(reportPath, "utf8"));
    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.totalFields).toBe(1);
  });

  it("fails when implemented fields do not provide test evidence", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "manifest-policy-gate-fail-"));
    await mkdir(path.join(tempRoot, "src"), { recursive: true });
    await writeFile(path.join(tempRoot, "src", "impl.ts"), "export const ok = true;\n", "utf8");

    const sourcePath = await writeCoverageFile({
      root: tempRoot,
      implementationCell: "`src/impl.ts`",
      testsCell: "-",
    });
    const reportPath = path.join(tempRoot, "coverage", "report.json");

    const run = spawnSync("node", [
      SCRIPT_PATH,
      "--source",
      sourcePath,
      "--report",
      reportPath,
      "--repo-root",
      tempRoot,
    ]);

    expect(run.status).toBe(1);

    const report = JSON.parse(await readFile(reportPath, "utf8"));
    expect(report.ok).toBe(false);
    expect(
      report.errors.some((error: { code: string }) => error.code === "missing_test_evidence"),
    ).toBe(true);
  });
});
