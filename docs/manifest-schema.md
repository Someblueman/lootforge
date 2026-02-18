# Manifest Schema (`version: "next"`)

`next` is the only supported manifest contract in this rewrite.

## Top-level fields

- `version`: must be `"next"`
- `pack`: `{ id, version, license?, author? }`
- `providers`: `{ default, openai?, nano?, local? }`
- `styleKits[]` (required, at least one)
  - `id`
  - `rulesPath`
  - `palettePath?`
  - `referenceImages[]`
  - `lightingModel`
  - `negativeRulesPath?`
- `consistencyGroups[]` (optional)
  - `id`
  - `description?`
  - `styleKitId?`
  - `referenceImages[]`
- `evaluationProfiles[]` (required, at least one)
  - `id`
  - `hardGates?`: `{ requireAlpha?, maxFileSizeKB?, seamThreshold?, seamStripPx?, paletteComplianceMin? }`
  - `scoreWeights?`: `{ readability?, fileSize?, consistency?, clip?, lpips?, ssim? }`
- `atlas?`: atlas defaults + optional per-group overrides
- `targets[]` (required)

Style kit palette defaults:
- If a target omits `palette`, LootForge will attempt to load `styleKits[].palettePath` and apply it as an exact palette policy.
- If `targets[].palette` is provided, it overrides any style-kit palette default.

## Target contract

Required on every target:

- `id`
- `kind`
- `out`
- `styleKitId`
- `consistencyGroup`
- `evaluationProfileId`
- `generationMode` (`text|edit-first`) recommended

Optional quality controls:

- `palette`: `{ mode: exact|max-colors, colors?, maxColors?, dither? }`
- `tileable`, `seamThreshold`, `seamStripPx`

Generation + processing:

- `prompt` or `promptSpec` (required for non-`spritesheet` targets)
- `generationPolicy`
- `postProcess`
- `acceptance`
- `runtimeSpec`
- `provider`, `model`, `edit`, `auxiliaryMaps`

## Spritesheet targets

For `kind: "spritesheet"`, define:

- `animations`: record keyed by animation name
  - `count` (required)
  - `prompt` (required)
  - `fps?`, `loop?`, `pivot?`

Planner behavior:

- expands each animation frame into internal frame targets under `__frames/...`
- emits a generation-disabled sheet target that process stage assembles

## Example (minimal sprite)

```json
{
  "version": "next",
  "pack": {
    "id": "my-pack",
    "version": "0.1.0"
  },
  "providers": {
    "default": "openai",
    "openai": { "model": "gpt-image-1" }
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
  "consistencyGroups": [
    {
      "id": "player-family",
      "description": "Shared protagonist style and silhouette constraints.",
      "styleKitId": "fantasy-topdown",
      "referenceImages": []
    }
  ],
  "evaluationProfiles": [
    {
      "id": "sprite-quality",
      "hardGates": {
        "requireAlpha": true,
        "maxFileSizeKB": 512
      }
    }
  ],
  "targets": [
    {
      "id": "player.hero",
      "kind": "sprite",
      "out": "player_hero.png",
      "styleKitId": "fantasy-topdown",
      "consistencyGroup": "player-family",
      "evaluationProfileId": "sprite-quality",
      "generationMode": "text",
      "prompt": "Top-down hero sprite with clear readable silhouette.",
      "generationPolicy": {
        "size": "1024x1024",
        "background": "transparent",
        "outputFormat": "png",
        "quality": "high",
        "candidates": 4
      },
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
