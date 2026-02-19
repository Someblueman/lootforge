# LootForge Agent Guide

## Purpose
- Keep LootForge focused on a reliable, manifest-driven asset generation pipeline.
- Prioritize deterministic outputs, reproducible runs, and measurable quality gates.

## Workflow
- Treat `main` as release-only while `0.3.0` is in progress.
- Integrate ongoing work in `release/0.3` (branched from `main` at `v0.2.0`).
- Work from short-lived feature branches off `release/0.3` and open PRs back to `release/0.3`.
- When `0.3.0` is ready, open a single release PR from `release/0.3` to `main`, then tag `v0.3.0`.
- Prefer small, reviewable commits with passing checks.
- Keep pipeline contracts stable unless a migration/update is included.

## Required Validation
- Run before opening PRs:
  - `npm run typecheck`
  - `npm test`
  - `npm run build`

## Engineering Priorities
- Reliability and safety first:
  - No unsafe path handling.
  - No silent fallback behavior that hides failures.
- Quality scoring should be explicit and inspectable:
  - Metrics and weights should be visible in reports.
  - Selection decisions should be traceable from inputs to outputs.
- Preserve compatibility for existing CLI flows and manifest schema when possible.

## Code Style
- Prefer straightforward TypeScript with clear types over clever abstractions.
- Keep functions focused and side effects explicit.
- Add tests for behavioral changes, especially pipeline/eval/scoring logic.

## PR Expectations
- Include a concise summary of behavior changes.
- Document new env vars and adapter/runtime contracts in `README.md`.
- Note any residual gaps or follow-up work explicitly.
