# Investigation: 0.3 manifest policy coverage gate

## Goal
Implement roadmap item: manifest policy coverage gate for `0.3.0`.

## Files examined
- `docs/ROADMAP.md`
- `docs/ROADMAP_ISSUES.md`
- `docs/manifest-schema.md`
- `.github/workflows/ci.yml`
- `package.json`

## Data flow traced
- CI currently runs typecheck/tests/build but no machine-checkable manifest policy coverage gate.
- No script/report exists for manifest policy field coverage status.

## Hypotheses considered
- Add coverage enforcement as a lightweight script and CI step (chosen).
- Add full AST/schema introspection with generated docs (deferred; unnecessary for this scope).

## Fix decision (working)
- Add machine-checkable policy registry doc.
- Add gate script that validates status/evidence/tests and emits JSON report.
- Wire gate + artifact upload in CI.

## Verification plan
- `npm run check:manifest-policy`
- `npm run typecheck`
- `npm test`
- `npm run build`

## Implementation progress
- Added machine-checkable policy coverage index: `docs/MANIFEST_POLICY_COVERAGE.md`.
- Added gate script: `scripts/check-manifest-policy-coverage.mjs`.
- Added script-level tests: `test/unit/manifest-policy-coverage-gate.test.ts`.
- Wired gate into CI and artifact upload in `.github/workflows/ci.yml`.
- Added npm script: `check:manifest-policy` in `package.json`.
- Updated roadmap/progress/docs:
  - `docs/ROADMAP.md`
  - `docs/ROADMAP_ISSUES.md`
  - `docs/manifest-schema.md`
  - `progress.md`
- Added policy index doc: `docs/MANIFEST_POLICY_COVERAGE.md`.
- Gate currently reports: `95 fields (94 implemented, 1 reserved)`.

## Verification run
- `npm run check:manifest-policy` ✅
- `npm run typecheck` ✅
- `npm test` ✅
- `npm run build` ✅
- Opened PR: https://github.com/Someblueman/lootforge/pull/32
