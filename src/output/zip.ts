import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

function hasZipCommand(): boolean {
  const run = spawnSync("zip", ["-v"], { stdio: "ignore" });
  return run.status === 0;
}

export interface ZipResult {
  zipPath: string;
  mode: "zip" | "stub";
}

export async function createZipArchive(
  sourceDir: string,
  zipPath: string,
): Promise<ZipResult> {
  await mkdir(path.dirname(zipPath), { recursive: true });

  if (hasZipCommand()) {
    const run = spawnSync("zip", ["-rq", zipPath, "."], {
      cwd: sourceDir,
      stdio: "ignore",
    });

    if (run.status !== 0) {
      throw new Error(`zip command failed for ${sourceDir}`);
    }

    return { zipPath, mode: "zip" };
  }

  await writeFile(
    zipPath,
    "zip command unavailable on this system; this is a placeholder archive.\n",
    "utf8",
  );
  return { zipPath, mode: "stub" };
}

