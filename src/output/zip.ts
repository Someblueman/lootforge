import { createWriteStream } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";

import { ZipFile } from "yazl";

export interface ZipResult {
  zipPath: string;
  mode: "zip";
}

async function collectFilesRecursive(rootDir: string): Promise<string[]> {
  const output: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        // Depth-first to keep deterministic central-directory ordering.
        await walk(absolutePath);
      } else if (entry.isFile()) {
        output.push(absolutePath);
      }
    }
  }

  await walk(rootDir);
  output.sort((left, right) => left.localeCompare(right));
  return output;
}

function toZipEntryName(sourceDir: string, filePath: string): string {
  const relativePath = path.relative(sourceDir, filePath);

  // Guard against path traversal via unexpected relative paths.
  if (
    relativePath.length === 0 ||
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`Unsafe zip entry path for ${filePath}`);
  }

  return relativePath.split(path.sep).join("/");
}

export async function createZipArchive(
  sourceDir: string,
  zipPath: string,
): Promise<ZipResult> {
  const resolvedSourceDir = path.resolve(sourceDir);
  const resolvedZipPath = path.resolve(zipPath);
  await mkdir(path.dirname(resolvedZipPath), { recursive: true });

  const files = await collectFilesRecursive(resolvedSourceDir);

  await new Promise<void>((resolve, reject) => {
    const zipFile = new ZipFile();
    const zipOutput = createWriteStream(resolvedZipPath);

    zipOutput.on("close", () => resolve());
    zipOutput.on("error", (error) => reject(error));
    zipFile.outputStream.on("error", (error) => reject(error));

    zipFile.outputStream.pipe(zipOutput);

    for (const filePath of files) {
      zipFile.addFile(filePath, toZipEntryName(resolvedSourceDir, filePath));
    }

    zipFile.end();
  });

  return { zipPath: resolvedZipPath, mode: "zip" };
}
