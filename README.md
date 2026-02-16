# LootForge

LootForge is a manifest-driven CLI for generating and packaging runtime-ready game image assets.

Current version: `0.1.0`

## Quickstart in 2 Minutes

```bash
npm install --cache .npm-cache
npm run build
node bin/lootforge.js init --out .
node bin/lootforge.js plan --manifest assets/imagegen/manifest.json --out assets/imagegen
node bin/lootforge.js validate --manifest assets/imagegen/manifest.json --out assets/imagegen
```

This exercises the planning + validation pipeline locally with no provider API keys.

It is designed to:
- plan generation jobs from a single manifest
- run image generation with pluggable providers (OpenAI + Nano + Local adapter)
- validate and bundle outputs into a portable asset pack
- emit Phaser-friendly manifests plus generic metadata

## Why LootForge

Most image generation tools stop at prompt -> image.
LootForge focuses on prompt -> image -> game runtime artifact.

That means it produces:
- consistent file structure
- deterministic job metadata
- validation reports
- atlas metadata
- zip-ready pack outputs for sharing or CI

## Features

- `next` manifest schema with style kits, evaluation profiles, and spritesheet planning
- Provider selection: `openai`, `nano`, `local`, or `auto`
- Provider-aware normalization (`jpg -> jpeg`, transparent/background compatibility checks)
- Deterministic job IDs keyed to normalized generation policy
- Raw/processed pipeline stages (`generate -> process -> atlas -> package`)
- Multi-candidate generation with deterministic best-of scoring
- Post-process operators (`trim`, `pad/extrude`, `quantize`, `outline`, `resizeVariants`)
- Pixel-level acceptance checks with JSON report output
- Atlas stage with optional TexturePacker integration plus reproducibility artifacts
- Pack assembly with runtime manifests and review artifacts

## Requirements

- Node.js 22+ (recommended)
- npm 10+
- Optional: `texturepacker` for atlas sprite sheets
- Provider keys only for generation:
  - `OPENAI_API_KEY`
  - `GEMINI_API_KEY`

## Installation

### Local development

```bash
npm install --cache .npm-cache
npm run build
```

Run the built CLI:

```bash
node bin/lootforge.js --help
```

If you want global command access during development:

```bash
npm link
lootforge --help
```

## Quickstart (end-to-end)

```bash
# 1) Scaffold manifest + folders
node dist/cli/index.js init --out .

# 2) Plan jobs
node dist/cli/index.js plan \
  --manifest assets/imagegen/manifest.json \
  --out assets/imagegen

# 3) Validate manifest (strict by default)
node dist/cli/index.js validate \
  --manifest assets/imagegen/manifest.json \
  --out assets/imagegen

# 4) Generate images (requires provider API key)
node dist/cli/index.js generate \
  --out assets/imagegen \
  --provider openai

# 5) Process raw assets into runtime-ready outputs
node dist/cli/index.js process --out assets/imagegen

# 6) Build atlases, evaluate/select, then package artifact bundle
node dist/cli/index.js atlas --out assets/imagegen
node dist/cli/index.js eval --out assets/imagegen --strict true
node dist/cli/index.js review --out assets/imagegen
node dist/cli/index.js select --out assets/imagegen
node dist/cli/index.js package \
  --manifest assets/imagegen/manifest.json \
  --out assets/imagegen
```

## CLI Commands

### `lootforge init`

Scaffolds:
- `assets/imagegen/manifest.json`
- `assets/imagegen/raw/`
- `assets/imagegen/processed/`
- `assets/imagegen/jobs/`

Example:
```bash
lootforge init --out .
```

### `lootforge plan`

Validates manifest and writes planned jobs:
- `<out>/jobs/targets-index.json`
- `<out>/jobs/openai.jsonl`
- `<out>/jobs/nano.jsonl`
- `<out>/jobs/local.jsonl`

Example:
```bash
lootforge plan --manifest assets/imagegen/manifest.json --out assets/imagegen
```

### `lootforge validate`

Writes:
- `<out>/checks/validation-report.json`
- optional `<out>/checks/image-acceptance-report.json`

Flags:
- `--strict true|false` (default: `true`)
- `--check-images true|false` (default: `false`)
- `--images-dir <path>` optional override for acceptance checks

Example:
```bash
lootforge validate --manifest assets/imagegen/manifest.json --out assets/imagegen --strict true --check-images true
```

### `lootforge generate`

Runs provider generation from planned targets index.

Flags:
- `--out <dir>`
- `--index <path>` optional (default `<out>/jobs/targets-index.json`)
- `--provider openai|nano|local|auto`
- `--ids a,b,c` optional subset

Example:
```bash
lootforge generate --out assets/imagegen --provider nano --ids enemy-1,ui-icon-attack
```

### `lootforge process`

Reads raw outputs, applies post-processing and acceptance checks, and writes:
- `<out>/assets/imagegen/processed/images/*` (or `<out>/processed/images/*` when `out` is already `assets/imagegen`)
- compatibility mirror: `<out>/assets/images/*`
- `<out>/assets/imagegen/processed/catalog.json`
- `<out>/checks/image-acceptance-report.json`

Example:
```bash
lootforge process --out assets/imagegen --strict true
```

### `lootforge atlas`

Reads generated images and atlas groups, then writes:
- `<out>/assets/atlases/manifest.json`
- optional atlas sheets/json when TexturePacker is available

### `lootforge package`

Assembles shareable outputs under:
- `<out>/dist/packs/<pack-id>/...`
- `<out>/dist/packs/game-asset-pack-<pack-id>.zip`

### `lootforge eval`

Runs hard/soft quality scoring and writes:
- `<out>/checks/eval-report.json`

### `lootforge review`

Builds a review artifact from eval data:
- `<out>/review/review.html`

### `lootforge select`

Builds lockfile selections from provenance + eval:
- `<out>/locks/selection-lock.json`

## Manifest (`version: "next"`)

Top-level fields:
- `version`: must be `next`
- `pack`: `{ id, version, license, author }` (required)
- `providers`: `{ default, openai?, nano?, local? }` (required)
- `styleKits[]` (required)
- `evaluationProfiles[]` (required)
- `atlas` options for packing defaults and per-group overrides
- `targets[]` (required)

Per target:
- `id`, `kind`, `out`, `atlasGroup?`, `styleKitId`, `consistencyGroup`, `evaluationProfileId`
- `generationMode`: `text|edit-first`
- `prompt` (string or structured object) for non-spritesheet targets
- `provider?` (`openai|nano|local`)
- `acceptance`: `{ size, alpha, maxFileSizeKB }`
- optional generation/runtime fields (`generationPolicy`, `postProcess`, `runtimeSpec`, `model`, `edit`, `auxiliaryMaps`, `palette`, `tileable`, `seamThreshold`)
- `kind: "spritesheet"` targets define `animations` and are expanded/assembled by the pipeline

Minimal example:

```json
{
  "version": "next",
  "pack": {
    "id": "my-pack",
    "version": "0.1.0",
    "license": "UNLICENSED",
    "author": "you"
  },
  "providers": {
    "default": "openai",
    "openai": { "model": "gpt-image-1" },
    "nano": { "model": "gemini-2.5-flash-image" },
    "local": { "model": "sdxl-controlnet", "baseUrl": "http://127.0.0.1:8188" }
  },
  "styleKits": [
    {
      "id": "fantasy-topdown",
      "rulesPath": "style/fantasy/style.md",
      "palettePath": "style/fantasy/palette.txt",
      "referenceImages": [],
      "lightingModel": "top-left key with warm fill"
    }
  ],
  "evaluationProfiles": [
    {
      "id": "sprite-quality",
      "hardGates": { "requireAlpha": true, "maxFileSizeKB": 512 }
    }
  ],
  "targets": [
    {
      "id": "player-idle",
      "kind": "sprite",
      "out": "player-idle.png",
      "atlasGroup": "actors",
      "styleKitId": "fantasy-topdown",
      "consistencyGroup": "player-family",
      "evaluationProfileId": "sprite-quality",
      "generationMode": "text",
      "prompt": "Top-down sci-fi pilot idle sprite with clear silhouette.",
      "postProcess": {
        "resizeTo": "512x512",
        "algorithm": "lanczos3",
        "stripMetadata": true
      },
      "acceptance": {
        "size": "512x512",
        "alpha": true,
        "maxFileSizeKB": 512
      }
    }
  ]
}
```

See also: `docs/manifest-schema.md`

## Output Contract

`lootforge package` emits:
- `dist/packs/<pack-id>/assets/images/*`
- `dist/packs/<pack-id>/assets/atlases/*`
- `dist/packs/<pack-id>/manifest/asset-pack.json`
- `dist/packs/<pack-id>/manifest/phaser.json`
- `dist/packs/<pack-id>/review/catalog.json`
- `dist/packs/<pack-id>/review/contact-sheet.png`
- `dist/packs/<pack-id>/provenance/run.json`
- `dist/packs/<pack-id>/checks/validation-report.json`
- `dist/packs/<pack-id>/checks/image-acceptance-report.json`
- `dist/packs/<pack-id>/checks/eval-report.json` (when available)
- `dist/packs/<pack-id>/provenance/selection-lock.json` (when available)
- `dist/packs/<pack-id>/review/review.html` (when available)
- `dist/packs/game-asset-pack-<pack-id>.zip`

Stage outputs during generation flow:
- `raw/` stage: generated provider outputs
- `processed/` stage: deterministic post-processed outputs + catalog
- compatibility mirror under `assets/images/`
- atlas reproducibility artifact: `assets/atlases/atlas-config.json`

## Environment Variables

- `OPENAI_API_KEY`: required for OpenAI generation
- `GEMINI_API_KEY`: required for Nano generation
- `LOCAL_DIFFUSION_BASE_URL`: optional for local diffusion adapter (default `http://127.0.0.1:8188`)

No network keys are required for `init`, `plan`, `validate`, `atlas`, or `package`.

## Development

Scripts:
- `npm run typecheck`
- `npm run build`
- `npm test`
- `npm run test:unit`
- `npm run test:integration`

## Status / Roadmap

`0.1.0` is an early foundation release.

Planned follow-ups:
- provider edit workflows and iterative refinement
- expanded local diffusion/ControlNet integrations
- deeper auxiliary map generation and runtime material pipelines
- expanded runtime templates and loaders
