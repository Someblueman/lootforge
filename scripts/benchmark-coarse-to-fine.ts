import { readFile } from "node:fs/promises";
import path from "node:path";

import { summarizeGenerateRunCost } from "../src/benchmarks/coarseToFineCost.js";
import { type ProviderRunResult } from "../src/providers/types.js";

interface ProvenanceShape {
  jobs?: ProviderRunResult[];
}

interface CliArgs {
  baseline: string;
  coarse: string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const [baselineRun, coarseRun] = await Promise.all([
    readProvenance(args.baseline),
    readProvenance(args.coarse),
  ]);

  const baseline = summarizeGenerateRunCost(baselineRun.jobs ?? []);
  const coarse = summarizeGenerateRunCost(coarseRun.jobs ?? []);
  const acceptanceEquivalent = baseline.approvedTargets === coarse.approvedTargets;

  const payload = {
    baseline: {
      path: path.resolve(args.baseline),
      ...baseline,
    },
    coarse: {
      path: path.resolve(args.coarse),
      ...coarse,
    },
    acceptanceEquivalent,
    reduction: {
      absolute: baseline.costPerApprovedTarget - coarse.costPerApprovedTarget,
      ratio:
        Number.isFinite(baseline.costPerApprovedTarget) && baseline.costPerApprovedTarget > 0
          ? coarse.costPerApprovedTarget / baseline.costPerApprovedTarget
          : null,
    },
  };

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function parseArgs(argv: string[]): CliArgs {
  let baseline = "";
  let coarse = "";

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--baseline") {
      baseline = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token === "--coarse") {
      coarse = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
  }

  if (!baseline || !coarse) {
    throw new Error(
      "Usage: npm run benchmark:coarse-to-fine -- --baseline <run.json> --coarse <run.json>",
    );
  }

  return { baseline, coarse };
}

async function readProvenance(filePath: string): Promise<ProvenanceShape> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as ProvenanceShape;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
