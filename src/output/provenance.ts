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
  bytesWritten?: number;
  skipped?: boolean;
  candidateOutputs?: Array<{
    outputPath: string;
    bytesWritten: number;
  }>;
  candidateScores?: Array<{
    outputPath: string;
    score: number;
    passedAcceptance: boolean;
    reasons: string[];
    components?: Record<string, number>;
    metrics?: Record<string, number>;
    vlm?: {
      score: number;
      threshold: number;
      maxScore: number;
      passed: boolean;
      reason: string;
      rubric?: string;
      evaluator: "command" | "http";
    };
    selected?: boolean;
  }>;
  generationMode?: "text" | "edit-first";
  edit?: {
    mode?: "edit" | "iterate";
    instruction?: string;
    inputs?: Array<{
      path: string;
      role?: "base" | "mask" | "reference";
      fidelity?: "low" | "medium" | "high";
    }>;
    preserveComposition?: boolean;
  };
  regenerationSource?: {
    mode: "selection-lock" | "selection-lock-edit";
    selectionLockPath: string;
    selectionLockGeneratedAt?: string;
    lockInputHash: string;
    lockSelectedOutputPath: string;
  };
}

export interface RunProvenance {
  runId: string;
  inputHash: string;
  startedAt: string;
  finishedAt: string;
  generatedAt: string;
  jobs: ProvenanceJobRecord[];
  failures?: Array<{
    targetId: string;
    provider: string;
    attemptedProviders: string[];
    message: string;
  }>;
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
