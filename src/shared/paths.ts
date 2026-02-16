import path from "node:path";

export const IMAGEGEN_RELATIVE_DIR = path.join("assets", "imagegen");
export const RAW_RELATIVE_DIR = path.join(IMAGEGEN_RELATIVE_DIR, "raw");
export const PROCESSED_RELATIVE_DIR = path.join(IMAGEGEN_RELATIVE_DIR, "processed");
export const PROCESSED_IMAGES_RELATIVE_DIR = path.join(
  PROCESSED_RELATIVE_DIR,
  "images",
);
export const LEGACY_IMAGES_RELATIVE_DIR = path.join("assets", "images");
export const ATLAS_RELATIVE_DIR = path.join("assets", "atlases");
export const JOBS_RELATIVE_DIR = "jobs";
export const CHECKS_RELATIVE_DIR = "checks";
export const PROVENANCE_RELATIVE_DIR = "provenance";
export const DEFAULT_MANIFEST_RELATIVE_PATH = path.join(
  IMAGEGEN_RELATIVE_DIR,
  "manifest.json",
);

export interface StagePathLayout {
  outDir: string;
  imagegenDir: string;
  rawDir: string;
  processedDir: string;
  processedImagesDir: string;
  legacyImagesDir: string;
  atlasDir: string;
  jobsDir: string;
  checksDir: string;
  provenanceDir: string;
}

export function resolveStagePathLayout(outDir: string): StagePathLayout {
  const root = path.resolve(outDir);
  const imagegenSuffix = path.join("assets", "imagegen");
  const isImagegenRoot = root.endsWith(imagegenSuffix);
  const imagegenDir = isImagegenRoot ? root : path.join(root, IMAGEGEN_RELATIVE_DIR);
  const legacyImagesDir = isImagegenRoot
    ? path.join(root, "assets", "images")
    : path.join(root, LEGACY_IMAGES_RELATIVE_DIR);

  return {
    outDir: root,
    imagegenDir,
    rawDir: path.join(imagegenDir, "raw"),
    processedDir: path.join(imagegenDir, "processed"),
    processedImagesDir: path.join(imagegenDir, "processed", "images"),
    legacyImagesDir,
    atlasDir: path.join(root, ATLAS_RELATIVE_DIR),
    jobsDir: path.join(root, JOBS_RELATIVE_DIR),
    checksDir: path.join(root, CHECKS_RELATIVE_DIR),
    provenanceDir: path.join(root, PROVENANCE_RELATIVE_DIR),
  };
}

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
