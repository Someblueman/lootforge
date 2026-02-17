# Engine Targeting Audit

Last updated: 2026-02-17

## Question
Are we targeting the right framework(s), and is support for Unity + Pixi + Phaser mostly the same work?

## Short Answer
- Phaser-only is too narrow for the current market.
- The pipeline core is highly reusable, but runtime integration is not uniformly "90% the same" across engines.
- A practical strategy is:
  - keep Phaser as baseline,
  - add Pixi as near-term parity (high overlap),
  - add Unity via import recipe + editor script path (lower overlap but high market reach).

## Market Signals (Current)
- GDC 2026 survey reports Unreal as most-used engine (`42%`) and Unity second (`30%`). [1]
- Same survey reports web browser platform usage rose from `16%` (2025) to `19%` (2026). [1]
- JavaScript ecosystem demand remains active:
  - `pixi.js` weekly downloads: `408,138` (`2026-02-09` to `2026-02-15`). [2]
  - `phaser` weekly downloads: `106,341` (same week). [3]
  - `@pixi/assets` weekly downloads: `103,096` (same week). [4]

## Technical Similarity: What Is Actually Shared
Shared across Phaser, Pixi, Unity:
- generation, post-processing, acceptance checks, eval/ranking, selection locks, provenance.
- atlas/image artifact creation.
- pack-level metadata and catalog semantics.

Mostly shared between Phaser and Pixi:
- both load JSON atlas/image assets in straightforward web runtime pipelines.
- Phaser loader supports atlas JSON + texture URLs. [5]
- Pixi Assets supports manifest bundles and Spritesheet loading from JSON. [6]
- TexturePacker supports both Phaser JSON and Pixi JSON exports. [7]

Unity-specific deltas (less shared):
- Unity runtime consumption is usually mediated by import settings/editor workflows, not direct web-loader JSON contracts.
- Texture import configuration (sprite mode, pivots, mesh type) is an editor-side responsibility. [8]
- TexturePacker documents Unity export as a distinct format (`Unity – Texture2D.sprite`) and calls out plugin usage in the Unity pipeline. [7]

## Similarity Estimate by Layer
- `~90% shared`: generation/eval/pipeline core.
- `~70-85% shared`: Phaser vs Pixi runtime manifest/export logic.
- `~50-65% shared`: Phaser/Pixi vs Unity runtime integration (due editor/import contract differences).

## Gaps Before Broad Engine Coverage
- Runtime exports were previously Phaser-only in package output.
- No explicit runtime target abstraction in packaging.
- Unity-oriented export metadata was not first-class.
- Anchor metadata from manifest runtime spec was not preserved into planned targets.

## What This Branch Adds
- Runtime manifest transpiler layer in packaging.
- `--runtimes` support on `lootforge package` (`phaser` baseline + optional `pixi`, `unity`).
- New runtime artifacts:
  - `manifest/phaser.json` (baseline),
  - `manifest/pixi.json` (when requested),
  - `manifest/unity-import.json` (when requested).
- Anchor metadata (`runtimeSpec.anchorX/anchorY`) now preserved through normalization and available to runtime exports.

## Recommended Next Steps
1. Ship a Unity Editor importer script that consumes `unity-import.json` and applies pivots/import settings automatically.
2. Add Godot runtime export (`godot-import.json`) to cover another high-growth OSS engine lane.
3. Add runtime adapter conformance tests that validate each manifest against a sample consumer loader/importer.

## Sources
[1] GDC 2026 State of the Game Industry key findings: https://gdconf.com/state-game-industry/  
[2] npm downloads API (`pixi.js`, last-week): https://api.npmjs.org/downloads/point/last-week/pixi.js  
[3] npm downloads API (`phaser`, last-week): https://api.npmjs.org/downloads/point/last-week/phaser  
[4] npm downloads API (`@pixi/assets`, last-week): https://api.npmjs.org/downloads/point/last-week/@pixi/assets  
[5] Phaser loader docs (`load.atlas`): https://docs.phaser.io/phaser/concepts/loader#texture-atlas  
[6] Pixi Assets + Spritesheet docs: https://pixijs.com/8.x/guides/components/assets and https://pixijs.download/dev/docs/assets.Spritesheet.html  
[7] TexturePacker framework export formats (Phaser/Pixi/Unity): https://www.codeandweb.com/texturepacker/documentation/free-split  
[8] Unity Texture Importer manual: https://docs.unity3d.com/Manual/class-TextureImporter.html
