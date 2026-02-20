# Investigation: 0.3 scoring profiles and per-kind presets

## Goal
Implement roadmap item: introduce per-kind scoring presets and manifest-level scoring profile overrides for `0.3.0`.

## Files examined
- `docs/ROADMAP.md`
- `docs/ROADMAP_ISSUES.md`
- `docs/manifest-schema.md`
- `src/manifest/types.ts`
- `src/manifest/schema.ts`
- `src/manifest/validate.ts`
- `src/checks/candidateScore.ts`
- `src/pipeline/eval.ts`
- `src/providers/types.ts`
- `test/unit/manifest-validate.test.ts`

## Data flow traced
- Manifest normalization currently sets `PlannedTarget.scoreWeights` from `evaluationProfiles[].scoreWeights`.
- Candidate ranking and eval adapter weighting consume `target.scoreWeights`.
- `targets[].scoringProfile` exists but is not yet connected to a manifest-level profile contract.

## Hypotheses considered
- Add per-kind defaults only in scoring stage.
- Add manifest scoring profiles and resolve into normalized planned targets (chosen).
- Keep backward compatibility by preserving evaluation-profile score weight behavior when no scoring profile override is present.

## Fix decision (working)
- Add top-level `scoringProfiles[]` schema/type.
- Add deterministic built-in per-kind presets.
- Resolve target score weights with precedence: kind preset -> manifest scoring profile override (if found) -> evaluation profile fallback.
- Add validation for unknown/duplicate scoring profile IDs and optional kind override maps.

## Verification plan
- `npm run typecheck`
- `npm test`
- `npm run build`

## Implementation progress
- Added manifest contract support for `scoringProfiles[]` in:
  - `src/manifest/types.ts`
  - `src/manifest/schema.ts`
- Added normalization and validation for scoring profiles in:
  - `src/manifest/validate.ts`
  - deterministic per-kind score preset defaults
  - profile resolution precedence and unknown-profile checks
- Added test coverage in `test/unit/manifest-validate.test.ts` for:
  - per-kind baseline weights
  - manifest scoring profile overrides (global + per-kind)
  - evaluation-profile-id fallback profile resolution
  - missing/duplicate scoring profile validation
- Updated docs:
  - `docs/manifest-schema.md`
  - `docs/ROADMAP.md`
  - `docs/ROADMAP_ISSUES.md`

## Verification run
- `npm run typecheck` ✅
- `npm test -- test/unit/manifest-validate.test.ts` ✅
- `npm run typecheck && npm test && npm run build` ✅
- Updated rollout tracking in `progress.md`.
