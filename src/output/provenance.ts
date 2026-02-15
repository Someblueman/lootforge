import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface ProvenanceJobRecord {
  jobId: string;
  provider: string;
  model: string;
  targetId: string;
  inputHash: string;
  startedAt: string;
  finishedAt: string;
  outputPath: string;
}

export interface RunProvenance {
  runId: string;
  inputHash: string;
  startedAt: string;
  finishedAt: string;
  generatedAt: string;
  jobs: ProvenanceJobRecord[];
}

export async function writeRunProvenance(
  outDir: string,
  provenance: RunProvenance,
): Promise<string> {
  const provenanceDir = path.join(outDir, "provenance");
  const filePath = path.join(provenanceDir, "run.json");
  await mkdir(provenanceDir, { recursive: true });
  await writeFile(filePath, `${JSON.stringify(provenance, null, 2)}\n`, "utf8");
  return filePath;
}

