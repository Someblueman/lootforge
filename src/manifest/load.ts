import path from "node:path";

import { safeParseManifestV2 } from "./schema.js";
import { type LoadedManifest, type ManifestSource, type ManifestV2 } from "./types.js";
import { CliError, getErrorMessage } from "../shared/errors.js";
import { readTextFile } from "../shared/fs.js";
import { formatIssuePath } from "../shared/zod.js";

export async function loadManifestSource(manifestPath: string): Promise<ManifestSource> {
  const resolvedPath = path.resolve(manifestPath);

  let raw: string;
  try {
    raw = await readTextFile(resolvedPath);
  } catch (error) {
    throw new CliError(`Failed to read manifest at ${resolvedPath}: ${getErrorMessage(error)}`, {
      code: "manifest_read_failed",
      exitCode: 1,
      cause: error,
    });
  }

  let data: unknown;
  try {
    data = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new CliError(
      `Failed to parse JSON in manifest ${resolvedPath}: ${getErrorMessage(error)}`,
      { code: "manifest_json_invalid", exitCode: 1, cause: error },
    );
  }

  return {
    manifestPath: resolvedPath,
    raw,
    data,
  };
}

export async function loadManifest(manifestPath: string): Promise<LoadedManifest> {
  const source = await loadManifestSource(manifestPath);
  const parsed = safeParseManifestV2(source.data);

  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0] as (typeof parsed.error.issues)[number] | undefined;
    const where = firstIssue ? formatIssuePath(firstIssue.path) : "$";
    const what = firstIssue ? firstIssue.message : "Schema validation failed.";
    throw new CliError(`Manifest schema validation failed at ${where}: ${what}`, {
      code: "manifest_schema_invalid",
      exitCode: 1,
      cause: parsed.error,
    });
  }

  return {
    ...source,
    manifest: parsed.data as ManifestV2,
  };
}
