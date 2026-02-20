# Investigation: 0.3 provider capability introspection endpoint

## Goal
Implement roadmap item: model capability introspection contract and endpoint for provider feature gating (`pixel`, `high-res`, `references`).

## Files examined
- `CODEMAP.paths`
- `docs/ROADMAP.md`
- `docs/ROADMAP_ISSUES.md`
- `docs/SERVICE_MODE.md`
- `src/service/server.ts`
- `src/providers/types.ts`
- `src/providers/openai.ts`
- `src/providers/nano.ts`
- `src/providers/localDiffusion.ts`
- `src/providers/registry.ts`
- `test/integration/service-mode.test.ts`
- `test/unit/providers.test.ts`

## Data flow traced
- Service mode currently exposes generation request contract only.
- Provider capability parity already exists internally via `ProviderCapabilities` and `supports(...)` checks.
- No external service contract currently exposes provider/model capability signals for wrapper-side feature gating.

## Hypotheses considered
- Add endpoint-only payload without separate contract endpoint.
- Mirror existing generation-request pattern with both contract + endpoint (chosen).
- Infer model-specific capability for Nano image edits from model naming rule.

## Fix decision (working)
- Add provider capability contract endpoint and runtime endpoint.
- Expose model-aware capability signals with explicit directive support states:
  - `pixel` (post-process enforced)
  - `highRes` (scaffold-only today)
  - `references` (via edit-input support)
- Add integration + unit tests for contract payload and query filtering.

## Verification plan
- `npm run typecheck`
- `npm test`
- `npm run build`

## Implementation progress
- Added service capability contract module: `src/service/providerCapabilities.ts`.
- Exported provider default model constants for introspection defaults:
  - `src/providers/openai.ts`
  - `src/providers/nano.ts`
  - `src/providers/localDiffusion.ts`
- Wired service endpoints in `src/service/server.ts`:
  - `GET /v1/contracts/provider-capabilities`
  - `GET /v1/providers/capabilities`
- Added service integration coverage in `test/integration/service-mode.test.ts`.
- Added unit coverage for capability contract/introspection in `test/unit/provider-capability-contract.test.ts`.
- Updated docs/roadmap/progress entries.

## Verification run
- `npm run typecheck` ✅
- `npm test -- test/unit/provider-capability-contract.test.ts test/integration/service-mode.test.ts` ✅
- `npm run typecheck && npm test && npm run build` ✅
