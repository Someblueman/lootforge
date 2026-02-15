# game-asset-pipeline

Standalone CLI for generating runtime-ready game image assets from a manifest.

## Commands

- `node ./bin/game-asset-pipeline.mjs plan`
- `node ./bin/game-asset-pipeline.mjs generate --mode=draft`
- `node ./bin/game-asset-pipeline.mjs generate --mode=final --ids=enemy-scrap-rat,ui-icon-attack`
- `node ./bin/game-asset-pipeline.mjs postprocess`
- `node ./bin/game-asset-pipeline.mjs atlas`
- `node ./bin/game-asset-pipeline.mjs preview`

## Expected project layout (in the consuming game repo)

- `assets/imagegen/manifest.json`
- `assets/imagegen/jobs/`
- `assets/imagegen/raw/`
- `assets/imagegen/processed/`
- `public/assets/images/`
- `public/assets/atlases/`

## Required environment

- `OPENAI_API_KEY` for generation
- `IMAGE_GEN` optional override to `image_gen.py`
  - defaults to `$CODEX_HOME/skills/imagegen/scripts/image_gen.py`

## Optional tools

- `texturepacker` for atlas packing (if unavailable, atlas manifest is still produced)
