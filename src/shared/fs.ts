import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

export async function ensureParentDir(filePath: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readTextFile(filePath: string): Promise<string> {
  return readFile(filePath, "utf8");
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await ensureParentDir(filePath);
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function writeJsonLines(
  filePath: string,
  rows: ReadonlyArray<unknown>,
): Promise<void> {
  await ensureParentDir(filePath);
  const body = rows.map((row) => JSON.stringify(row)).join("\n");
  await writeFile(filePath, body.length > 0 ? `${body}\n` : "", "utf8");
}
