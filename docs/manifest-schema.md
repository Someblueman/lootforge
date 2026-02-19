# Manifest Schema (`version: "next"`)

`next` is the only supported manifest contract in this rewrite.

## Top-level fields

- `version`: must be `"next"`
- `pack`: `{ id, version, license?, author? }`
- `providers`: `{ default, openai?, nano?, local? }`
  - Provider configs support runtime fields:
    - `model?`
    - `endpoint?` (OpenAI generation endpoint, Nano API base)
    - `timeoutMs?` (request timeout per provider call)
    - `maxRetries?` (default retries when target policy omits `generationPolicy.maxRetries`)
    - `minDelayMs?` (provider-level minimum spacing between jobs)
    - `defaultConcurrency?` (provider-level worker count)
  - `providers.local` also supports `baseUrl?` (alias for local endpoint)
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
  - `hardGates?`: `{ requireAlpha?, maxFileSizeKB?, seamThreshold?, seamStripPx?, paletteComplianceMin?, alphaHaloRiskMax?, alphaStrayNoiseMax?, alphaEdgeSharpnessMin? }`
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
- `seamHeal?`: `{ enabled?, stripPx?, strength? }` (optional edge blending pass for tileable targets)
- `wrapGrid?`: `{ columns, rows, seamThreshold?, seamStripPx? }` (per-cell wrap validation gates)

Generation + processing:

- `prompt` or `promptSpec` (required for non-`spritesheet` targets)
- `generationPolicy`
  - `generationPolicy.vlmGate?`: `{ threshold?, rubric? }`
  - `threshold` defaults to `4` (scored on `0..5`) when gate is configured
- `postProcess`
- `acceptance`
- `runtimeSpec`
- `provider`, `model`, `edit`, `auxiliaryMaps`
- `generationMode: "edit-first"` requires an edit-capable provider (`openai` or `local`)
- `edit.inputs[].path` must resolve inside the active `--out` root at runtime
- `generationPolicy.background: "transparent"` requires a provider that supports transparent outputs (unsupported providers now fail validation)
- `generationPolicy.vlmGate` requires runtime evaluator transport via `LOOTFORGE_VLM_GATE_CMD` or `LOOTFORGE_VLM_GATE_URL`
- edge-aware hard gates can be configured in `evaluationProfiles[].hardGates`:
  - `alphaHaloRiskMax` (`0..1`, lower is stricter)
  - `alphaStrayNoiseMax` (`0..1`, lower is stricter)
  - `alphaEdgeSharpnessMin` (`0..1`, higher is stricter)

Provider runtime precedence for generate/regenerate:
- target-level `generationPolicy` overrides provider defaults for retries/concurrency settings
- provider runtime fields resolve from manifest and can be overridden by environment variables (`LOOTFORGE_*` / provider-specific env aliases)
- capability parity is enforced at runtime (`supports(...)` must match provider capability flags)

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
        "maxFileSizeKB": 512,
        "alphaHaloRiskMax": 0.08,
        "alphaStrayNoiseMax": 0.01,
        "alphaEdgeSharpnessMin": 0.8
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
        "candidates": 4,
        "vlmGate": {
          "threshold": 4,
          "rubric": "Score silhouette clarity and framing quality from 0 to 5."
        }
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
