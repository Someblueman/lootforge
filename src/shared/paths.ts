import path from "node:path";

export const IMAGEGEN_RELATIVE_DIR = path.join("assets", "imagegen");
export const DEFAULT_MANIFEST_RELATIVE_PATH = path.join(
  IMAGEGEN_RELATIVE_DIR,
  "manifest.json",
);

export function resolveManifestPath(
  manifestFlag: string | undefined,
  cwd: string = process.cwd(),
): string {
  const value = manifestFlag ?? DEFAULT_MANIFEST_RELATIVE_PATH;
  return path.resolve(cwd, value);
}

export function resolveOutDir(
  outFlag: string | undefined,
  defaultDir: string,
  cwd: string = process.cwd(),
): string {
  return path.resolve(cwd, outFlag ?? defaultDir);
}

export function resolveInitImagegenDir(
  outFlag: string | undefined,
  cwd: string = process.cwd(),
): string {
  const rootDir = path.resolve(cwd, outFlag ?? ".");
  return path.join(rootDir, IMAGEGEN_RELATIVE_DIR);
}
