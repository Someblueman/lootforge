import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";
import yauzl from "yauzl";

import { createZipArchive } from "../../src/output/zip.js";

async function listZipEntries(zipPath: string): Promise<string[]> {
  return await new Promise<string[]>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (openError, zipFile) => {
      if (openError || !zipFile) {
        reject(openError ?? new Error("Failed to open zip archive."));
        return;
      }

      const entries: string[] = [];
      zipFile.readEntry();

      zipFile.on("entry", (entry) => {
        entries.push(entry.fileName);
        zipFile.readEntry();
      });

      zipFile.on("error", (error) => reject(error));
      zipFile.on("end", () => resolve(entries));
    });
  });
}

describe("createZipArchive", () => {
  test("creates a valid zip containing all files recursively", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "lootforge-zip-test-"));
    const sourceDir = path.join(root, "source");
    const zipPath = path.join(root, "archive", "pack.zip");

    await mkdir(path.join(sourceDir, "nested", "deep"), { recursive: true });
    await writeFile(path.join(sourceDir, "root.txt"), "root", "utf8");
    await writeFile(path.join(sourceDir, "nested", "a.txt"), "a", "utf8");
    await writeFile(path.join(sourceDir, "nested", "deep", "b.txt"), "b", "utf8");

    const result = await createZipArchive(sourceDir, zipPath);
    expect(result.mode).toBe("zip");

    const entries = await listZipEntries(result.zipPath);
    expect(entries).toEqual(["nested/a.txt", "nested/deep/b.txt", "root.txt"]);
  });
});
