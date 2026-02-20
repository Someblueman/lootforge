#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_SOURCE = "docs/MANIFEST_POLICY_COVERAGE.md";
const DEFAULT_REPORT = "coverage/manifest-policy-coverage.json";

function parseArgs(argv) {
  const args = {
    source: DEFAULT_SOURCE,
    report: DEFAULT_REPORT,
    repoRoot: process.cwd(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--source") {
      args.source = argv[index + 1] ?? args.source;
      index += 1;
      continue;
    }
    if (arg === "--report") {
      args.report = argv[index + 1] ?? args.report;
      index += 1;
      continue;
    }
    if (arg === "--repo-root") {
      args.repoRoot = argv[index + 1] ?? args.repoRoot;
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return args;
}

function printHelp() {
  console.log([
    "Usage: node scripts/check-manifest-policy-coverage.mjs [options]",
    "",
    "Options:",
    "  --source <path>     Markdown coverage index (default docs/MANIFEST_POLICY_COVERAGE.md)",
    "  --report <path>     JSON report path (default coverage/manifest-policy-coverage.json)",
    "  --repo-root <path>  Repository root for implementation/test path checks (default cwd)",
    "  -h, --help          Show this help message",
  ].join("\n"));
}

function parsePathList(cellValue) {
  const raw = cellValue.trim();
  if (!raw || raw === "-" || raw === "n/a" || raw === "N/A") {
    return [];
  }

  const codeMatches = [...raw.matchAll(/`([^`]+)`/g)].map((match) => match[1].trim());
  if (codeMatches.length > 0) {
    return codeMatches.filter(Boolean);
  }

  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseField(cellValue) {
  const trimmed = cellValue.trim();
  const wrapped = trimmed.match(/^`([^`]+)`$/);
  return wrapped ? wrapped[1].trim() : trimmed;
}

function isSeparatorRow(cells) {
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function parseCoverageTable(markdown, sourcePath) {
  const lines = markdown.split(/\r?\n/);
  const tableLines = lines.filter((line) => line.trim().startsWith("|"));
  if (tableLines.length < 3) {
    throw new Error(`Coverage table was not found in ${sourcePath}.`);
  }

  const rows = tableLines.map((line) =>
    line
      .trim()
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim()),
  );

  const header = rows[0].map((cell) => cell.toLowerCase());
  const expectedHeader = ["field", "status", "implementation", "tests", "notes"];
  if (
    header.length !== expectedHeader.length ||
    header.some((cell, index) => cell !== expectedHeader[index])
  ) {
    throw new Error(
      `Unexpected coverage header in ${sourcePath}. Expected: ${expectedHeader.join(" | ")}`,
    );
  }

  const entries = [];
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.length !== expectedHeader.length) {
      continue;
    }
    if (isSeparatorRow(row)) {
      continue;
    }

    const field = parseField(row[0]);
    const status = row[1].trim().toLowerCase();
    const implementation = parsePathList(row[2]);
    const tests = parsePathList(row[3]);
    const notes = row[4].trim();

    if (!field) {
      continue;
    }

    entries.push({
      field,
      status,
      implementation,
      tests,
      notes,
      row: index + 1,
    });
  }

  return entries;
}

function checkFileExists(repoRoot, relativePath) {
  return existsSync(path.resolve(repoRoot, relativePath));
}

function buildReport(params) {
  const errors = [];
  const fieldSeen = new Set();

  for (const entry of params.entries) {
    if (fieldSeen.has(entry.field)) {
      errors.push({
        code: "duplicate_field",
        field: entry.field,
        row: entry.row,
        message: `Duplicate policy field entry for ${entry.field}.`,
      });
      continue;
    }
    fieldSeen.add(entry.field);

    if (entry.status !== "implemented" && entry.status !== "reserved") {
      errors.push({
        code: "invalid_status",
        field: entry.field,
        row: entry.row,
        message: `Field ${entry.field} has invalid status \"${entry.status}\". Use implemented or reserved.`,
      });
      continue;
    }

    if (entry.status === "implemented") {
      if (entry.implementation.length === 0) {
        errors.push({
          code: "missing_implementation_evidence",
          field: entry.field,
          row: entry.row,
          message: `Implemented field ${entry.field} is missing implementation evidence paths.`,
        });
      }

      if (entry.tests.length === 0) {
        errors.push({
          code: "missing_test_evidence",
          field: entry.field,
          row: entry.row,
          message: `Implemented field ${entry.field} is missing test evidence paths.`,
        });
      }
    }

    for (const implementationPath of entry.implementation) {
      if (!checkFileExists(params.repoRoot, implementationPath)) {
        errors.push({
          code: "implementation_path_missing",
          field: entry.field,
          row: entry.row,
          message: `Implementation path not found: ${implementationPath}`,
        });
      }
    }

    for (const testPath of entry.tests) {
      if (!checkFileExists(params.repoRoot, testPath)) {
        errors.push({
          code: "test_path_missing",
          field: entry.field,
          row: entry.row,
          message: `Test path not found: ${testPath}`,
        });
      }
    }
  }

  const implemented = params.entries.filter((entry) => entry.status === "implemented").length;
  const reserved = params.entries.filter((entry) => entry.status === "reserved").length;

  return {
    generatedAt: new Date().toISOString(),
    sourcePath: params.sourcePath,
    repoRoot: params.repoRoot,
    totalFields: params.entries.length,
    implemented,
    reserved,
    errors,
    ok: errors.length === 0,
  };
}

function writeReport(reportPath, report) {
  const resolvedReport = path.resolve(reportPath);
  const reportDir = path.dirname(resolvedReport);
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(resolvedReport, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourcePath = path.resolve(args.source);
  const sourceMarkdown = readFileSync(sourcePath, "utf8");
  const entries = parseCoverageTable(sourceMarkdown, sourcePath);
  const report = buildReport({
    entries,
    sourcePath,
    repoRoot: path.resolve(args.repoRoot),
  });

  writeReport(args.report, report);

  console.log(
    `Manifest policy coverage: ${report.totalFields} fields (${report.implemented} implemented, ${report.reserved} reserved).`,
  );
  console.log(`Policy coverage report written to ${path.resolve(args.report)}`);

  if (!report.ok) {
    for (const error of report.errors) {
      console.error(`- [${error.code}] row ${error.row} ${error.field}: ${error.message}`);
    }
    process.exitCode = 1;
  }
}

main();
