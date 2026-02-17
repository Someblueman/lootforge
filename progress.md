Current scope: rewrite LootForge for the strongest asset-generation pipeline outcome.

- 2026-02-16: Completed migration to `next` manifest flow with strict `generate -> process -> atlas -> eval -> review -> select -> package` stages.
- 2026-02-16: Removed all playable runtime/demo scaffolding from the repository so focus is fully on asset outputs and quality gates.
- 2026-02-16: Verified repository health after removal:
  - `npm run typecheck` ✅
  - `npm test` ✅
  - `npm run build` ✅
- 2026-02-17: Added versioned public release roadmap (`docs/ROADMAP.md`) covering `0.2.0` through `1.0.0`.
