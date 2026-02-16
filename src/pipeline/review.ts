import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveStagePathLayout } from "../shared/paths.js";

interface EvalReportShape {
  generatedAt?: string;
  targets?: Array<{
    targetId: string;
    out: string;
    passedHardGates: boolean;
    hardGateErrors?: string[];
    hardGateWarnings?: string[];
    finalScore?: number;
    candidateScore?: number;
  }>;
}

export interface ReviewPipelineOptions {
  outDir: string;
  evalReportPath?: string;
  reviewHtmlPath?: string;
}

export interface ReviewPipelineResult {
  reviewHtmlPath: string;
  targetCount: number;
}

export async function runReviewPipeline(
  options: ReviewPipelineOptions,
): Promise<ReviewPipelineResult> {
  const layout = resolveStagePathLayout(options.outDir);
  const evalReportPath = path.resolve(
    options.evalReportPath ?? path.join(layout.checksDir, "eval-report.json"),
  );

  const raw = await readFile(evalReportPath, "utf8");
  const report = JSON.parse(raw) as EvalReportShape;
  const targets = (report.targets ?? []).slice().sort((a, b) => b.finalScore! - a.finalScore!);

  const html = renderReviewHtml({
    generatedAt: report.generatedAt ?? new Date().toISOString(),
    targets,
  });

  const reviewHtmlPath = path.resolve(
    options.reviewHtmlPath ?? path.join(layout.outDir, "review", "review.html"),
  );

  await mkdir(path.dirname(reviewHtmlPath), { recursive: true });
  await writeFile(reviewHtmlPath, html, "utf8");

  return {
    reviewHtmlPath,
    targetCount: targets.length,
  };
}

function renderReviewHtml(params: {
  generatedAt: string;
  targets: Array<{
    targetId: string;
    out: string;
    passedHardGates: boolean;
    hardGateErrors?: string[];
    hardGateWarnings?: string[];
    finalScore?: number;
    candidateScore?: number;
  }>;
}): string {
  const rows = params.targets
    .map((target) => {
      const errors = (target.hardGateErrors ?? []).join("<br>") || "-";
      const warnings = (target.hardGateWarnings ?? []).join("<br>") || "-";
      return `<tr>
<td>${escapeHtml(target.targetId)}</td>
<td>${escapeHtml(target.out)}</td>
<td>${target.passedHardGates ? "PASS" : "FAIL"}</td>
<td>${target.finalScore?.toFixed(2) ?? "0.00"}</td>
<td>${target.candidateScore?.toFixed(2) ?? "0.00"}</td>
<td>${escapeHtml(errors)}</td>
<td>${escapeHtml(warnings)}</td>
</tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>LootForge Review</title>
  <style>
    :root {
      --bg: #f8f7f3;
      --ink: #1b1d1f;
      --muted: #5a646e;
      --accent: #bb3a2d;
      --card: #ffffff;
      --line: #d8dde3;
    }
    body {
      margin: 0;
      font-family: "IBM Plex Sans", "Avenir Next", sans-serif;
      color: var(--ink);
      background: linear-gradient(120deg, #f8f7f3 0%, #ebeef2 100%);
    }
    main {
      max-width: 1200px;
      margin: 0 auto;
      padding: 32px 20px 48px;
    }
    h1 {
      margin: 0;
      letter-spacing: 0.02em;
      font-size: 34px;
    }
    .meta {
      color: var(--muted);
      margin-top: 8px;
      margin-bottom: 24px;
    }
    .table-wrap {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 14px;
      overflow-x: auto;
      box-shadow: 0 14px 30px rgba(0, 0, 0, 0.08);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th, td {
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
      padding: 10px 12px;
    }
    th {
      background: #f3f6fa;
      font-weight: 700;
      color: #2a3440;
      position: sticky;
      top: 0;
      z-index: 2;
    }
    tr:last-child td {
      border-bottom: none;
    }
  </style>
</head>
<body>
  <main>
    <h1>LootForge Evaluation Review</h1>
    <p class="meta">Generated at ${escapeHtml(params.generatedAt)} · Targets: ${params.targets.length}</p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Target</th>
            <th>Output</th>
            <th>Hard Gates</th>
            <th>Final Score</th>
            <th>Candidate Score</th>
            <th>Hard Errors</th>
            <th>Warnings</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  </main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
