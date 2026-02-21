import path from "node:path";

export const IMAGEGEN_RELATIVE_DIR = path.join("assets", "imagegen");
export const RAW_RELATIVE_DIR = path.join(IMAGEGEN_RELATIVE_DIR, "raw");
export const PROCESSED_RELATIVE_DIR = path.join(IMAGEGEN_RELATIVE_DIR, "processed");
export const PROCESSED_IMAGES_RELATIVE_DIR = path.join(PROCESSED_RELATIVE_DIR, "images");
export const LEGACY_IMAGES_RELATIVE_DIR = path.join("assets", "images");
export const ATLAS_RELATIVE_DIR = path.join("assets", "atlases");
export const JOBS_RELATIVE_DIR = "jobs";
export const CHECKS_RELATIVE_DIR = "checks";
export const PROVENANCE_RELATIVE_DIR = "provenance";
export const DEFAULT_MANIFEST_RELATIVE_PATH = path.join(IMAGEGEN_RELATIVE_DIR, "manifest.json");

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

const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-zA-Z]:[\\/]/;

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

function normalizeRelativeProjectPath(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  if (trimmed.includes("\0")) {
    throw new Error(`${label} "${value}" contains a null byte.`);
  }

  if (path.isAbsolute(trimmed) || WINDOWS_ABSOLUTE_PATH_PATTERN.test(trimmed)) {
    throw new Error(`${label} "${value}" must be relative.`);
  }

  const normalized = path.posix.normalize(trimmed.replaceAll("\\", "/"));
  const withoutDotPrefix = normalized.startsWith("./") ? normalized.slice(2) : normalized;
  if (!withoutDotPrefix || withoutDotPrefix === ".") {
    throw new Error(`${label} "${value}" resolved to an empty path.`);
  }

  if (withoutDotPrefix === ".." || withoutDotPrefix.startsWith("../")) {
    throw new Error(`${label} "${value}" escapes the output root.`);
  }

  return withoutDotPrefix;
}

export function normalizeTargetOutPath(value: string): string {
  return normalizeRelativeProjectPath(value, "Target output path");
}

export function normalizeManifestAssetPath(value: string): string {
  return normalizeRelativeProjectPath(value, "Manifest asset path");
}

export function resolvePathWithinDir(
  baseDir: string,
  targetOutPath: string,
  label = "path",
): string {
  const normalizedOut = normalizeTargetOutPath(targetOutPath);
  const resolvedBase = path.resolve(baseDir);
  const resolvedPath = path.resolve(resolvedBase, normalizedOut.split("/").join(path.sep));
  const relativeToBase = path.relative(resolvedBase, resolvedPath);
  if (
    relativeToBase.length === 0 ||
    relativeToBase.startsWith("..") ||
    path.isAbsolute(relativeToBase)
  ) {
    throw new Error(`Unsafe ${label} "${targetOutPath}" resolves outside ${resolvedBase}.`);
  }

  return resolvedPath;
}

export function resolvePathWithinRoot(
  rootDir: string,
  candidatePath: string,
  label = "path",
): string {
  const trimmed = candidatePath.trim();
  if (!trimmed) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  if (trimmed.includes("\0")) {
    throw new Error(`${label} "${candidatePath}" contains a null byte.`);
  }

  const resolvedRoot = path.resolve(rootDir);
  if (WINDOWS_ABSOLUTE_PATH_PATTERN.test(trimmed) && process.platform !== "win32") {
    throw new Error(`Unsafe ${label} "${candidatePath}" resolves outside ${resolvedRoot}.`);
  }

  const resolvedPath = path.resolve(
    path.isAbsolute(trimmed) ? trimmed : resolvedRoot,
    path.isAbsolute(trimmed) ? "." : trimmed.replaceAll("\\", path.sep).split("/").join(path.sep),
  );
  const relativeToRoot = path.relative(resolvedRoot, resolvedPath);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    throw new Error(`Unsafe ${label} "${candidatePath}" resolves outside ${resolvedRoot}.`);
  }

  return resolvedPath;
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
