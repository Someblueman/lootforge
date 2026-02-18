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
    candidateReasons?: string[];
    candidateMetrics?: Record<string, number>;
    adapterMetrics?: Record<string, number>;
    adapterScore?: number;
    adapterScoreComponents?: Record<string, number>;
    adapterWarnings?: string[];
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
  const targets = (report.targets ?? [])
    .slice()
    .sort((a, b) => (b.finalScore ?? 0) - (a.finalScore ?? 0));

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
    candidateReasons?: string[];
    candidateMetrics?: Record<string, number>;
    adapterMetrics?: Record<string, number>;
    adapterScore?: number;
    adapterScoreComponents?: Record<string, number>;
    adapterWarnings?: string[];
  }>;
}): string {
  const rows = params.targets
    .map((target) => {
      const errors = (target.hardGateErrors ?? []).join("<br>") || "-";
      const warnings = (target.hardGateWarnings ?? []).join("<br>") || "-";
      const scoreDetails = renderScoreDetails(target);
      return `<tr>
<td>${escapeHtml(target.targetId)}</td>
<td>${escapeHtml(target.out)}</td>
<td>${target.passedHardGates ? "PASS" : "FAIL"}</td>
<td>${formatScore(target.finalScore)}</td>
<td>${formatScore(target.candidateScore)}</td>
<td>${scoreDetails}</td>
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
    .score-detail {
      display: grid;
      gap: 8px;
      min-width: 320px;
    }
    .score-headline {
      color: #2a3440;
      font-size: 12px;
      line-height: 1.35;
    }
    .score-headline strong {
      font-weight: 700;
    }
    details {
      border: 1px solid #e0e6ec;
      border-radius: 8px;
      padding: 6px 8px;
      background: #f8fbff;
    }
    details > summary {
      cursor: pointer;
      font-size: 12px;
      font-weight: 700;
      color: #334257;
      list-style: none;
    }
    details > summary::-webkit-details-marker {
      display: none;
    }
    .detail-list {
      margin: 8px 0 0;
      padding-left: 18px;
      font-size: 12px;
      color: #2f3b47;
    }
    pre {
      margin: 8px 0 0;
      padding: 8px;
      border-radius: 8px;
      background: #1f2933;
      color: #f8fafc;
      font-size: 11px;
      line-height: 1.35;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .empty {
      color: #6b7785;
      font-size: 12px;
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
            <th>Score Details</th>
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

function renderScoreDetails(target: {
  candidateScore?: number;
  finalScore?: number;
  adapterScore?: number;
  candidateReasons?: string[];
  candidateMetrics?: Record<string, number>;
  adapterMetrics?: Record<string, number>;
  adapterScoreComponents?: Record<string, number>;
  adapterWarnings?: string[];
}): string {
  const sections: string[] = [];

  sections.push(
    `<div class="score-headline"><strong>Candidate:</strong> ${formatScore(
      target.candidateScore,
    )}</div>`,
  );

  if (typeof target.adapterScore === "number") {
    sections.push(
      `<div class="score-headline"><strong>Adapter:</strong> ${formatScore(
        target.adapterScore,
      )}</div>`,
    );
  }

  sections.push(
    `<div class="score-headline"><strong>Final:</strong> ${formatScore(target.finalScore)}</div>`,
  );

  sections.push(
    renderDetailsBlock(
      "Candidate reasons",
      renderList(target.candidateReasons),
      (target.candidateReasons ?? []).length,
    ),
  );
  sections.push(
    renderDetailsBlock(
      "Candidate metrics",
      renderObject(target.candidateMetrics),
      Object.keys(target.candidateMetrics ?? {}).length,
    ),
  );
  sections.push(
    renderDetailsBlock(
      "Adapter score components",
      renderObject(target.adapterScoreComponents),
      Object.keys(target.adapterScoreComponents ?? {}).length,
    ),
  );
  sections.push(
    renderDetailsBlock(
      "Adapter metrics",
      renderObject(target.adapterMetrics),
      Object.keys(target.adapterMetrics ?? {}).length,
    ),
  );
  sections.push(
    renderDetailsBlock(
      "Adapter warnings",
      renderList(target.adapterWarnings),
      (target.adapterWarnings ?? []).length,
    ),
  );

  return `<div class="score-detail">${sections.join("")}</div>`;
}

function renderDetailsBlock(title: string, content: string, count: number): string {
  const suffix = count > 0 ? ` (${count})` : "";
  return `<details><summary>${escapeHtml(`${title}${suffix}`)}</summary>${content}</details>`;
}

function renderList(values: string[] | undefined): string {
  if (!values || values.length === 0) {
    return `<div class="empty">No entries.</div>`;
  }

  return `<ul class="detail-list">${values
    .map((value) => `<li>${escapeHtml(value)}</li>`)
    .join("")}</ul>`;
}

function renderObject(
  value: Record<string, number> | undefined,
): string {
  if (!value || Object.keys(value).length === 0) {
    return `<div class="empty">No entries.</div>`;
  }

  const sortedEntries = Object.entries(value).sort((left, right) =>
    left[0].localeCompare(right[0]),
  );
  return `<pre>${escapeHtml(
    JSON.stringify(
      Object.fromEntries(
        sortedEntries.map(([key, metric]) => [key, Number(metric.toFixed(4))]),
      ),
      null,
      2,
    ),
  )}</pre>`;
}

function formatScore(score: number | undefined): string {
  if (typeof score !== "number" || !Number.isFinite(score)) {
    return "0.00";
  }
  return score.toFixed(2);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
