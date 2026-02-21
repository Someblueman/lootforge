# Manifest Schema (`version: "next"`)

`next` is the only supported manifest contract in this rewrite.

Manifest policy coverage gate:

- `docs/MANIFEST_POLICY_COVERAGE.md` is the machine-checkable index of documented policy fields.
- `npm run check:manifest-policy` validates coverage status (`implemented|reserved`) and required test evidence, then emits `coverage/manifest-policy-coverage.json`.

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
  - `styleReferenceImages[]?` (directed style-image scaffold inputs; provider support varies)
  - `lightingModel`
  - `negativeRulesPath?`
  - `loraPath?`
  - `loraStrength?` (`0..2`, requires `loraPath`)
- `consistencyGroups[]` (optional)
  - `id`
  - `description?`
  - `styleKitId?`
  - `referenceImages[]`
- `targetTemplates[]` (optional)
  - `id`
  - `dependsOn[]?` (target-id dependency policy)
  - `styleReferenceFrom[]?` (target-id style-reference chain policy)
- `evaluationProfiles[]` (required, at least one)
  - `id`
  - `hardGates?`: `{ requireAlpha?, maxFileSizeKB?, seamThreshold?, seamStripPx?, paletteComplianceMin?, alphaHaloRiskMax?, alphaStrayNoiseMax?, alphaEdgeSharpnessMin?, packTextureBudgetMB?, spritesheetSilhouetteDriftMax?, spritesheetAnchorDriftMax? }`
  - `consistencyGroupScoring?`: `{ warningThreshold?, penaltyThreshold?, penaltyWeight? }`
    - `warningThreshold`: normalized drift score threshold for group-level warning signals
    - `penaltyThreshold`: normalized drift score threshold where ranking penalties activate
    - `penaltyWeight`: deterministic multiplier used for final-score penalty (`round(score * weight)`)
  - `scoreWeights?`: `{ readability?, fileSize?, consistency?, clip?, lpips?, ssim? }`
- `scoringProfiles[]` (optional)
  - `id`
  - `scoreWeights?`: global score-weight overrides for all target kinds
  - `kindScoreWeights?`: optional per-kind overrides for `sprite|tile|background|effect|spritesheet`
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

- `templateId?`: references `targetTemplates[].id` for reusable orchestration policy
- `dependsOn?`: target-id dependencies used for deterministic execution staging
- `styleReferenceFrom?`: target-id style-reference lineage for chaining generated assets
  - when omitted, style-reference lineage defaults to `dependsOn`
- `palette`: `{ mode: exact|max-colors, colors?, maxColors?, dither?, strict? }`
  - `strict` is supported only in `mode: "exact"` and enforces 100% visible-pixel palette compliance.
- `scoringProfile?`: profile id from `scoringProfiles[]` (falls back to `evaluationProfileId` lookup)
- `tileable`, `seamThreshold`, `seamStripPx`
- `seamHeal?`: `{ enabled?, stripPx?, strength? }` (optional edge blending pass for tileable targets)
- `wrapGrid?`: `{ columns, rows, seamThreshold?, seamStripPx? }` (per-cell wrap validation gates)

Generation + processing:

- `prompt` or `promptSpec` (required for non-`spritesheet` targets)
- `generationPolicy`
  - `generationPolicy.highQuality?` (directed-synthesis scaffold flag)
  - `generationPolicy.hiresFix?`: `{ enabled?, upscale?, denoiseStrength? }`
  - `generationPolicy.vlmGate?`: `{ threshold?, rubric? }`
  - `threshold` defaults to `4` (scored on `0..5`) when gate is configured
  - `generationPolicy.coarseToFine?`: `{ enabled?, promoteTopK?, minDraftScore?, requireDraftAcceptance? }`
  - optional quality split: `draftQuality` (coarse pass) and `finalQuality` (refinement pass)
- `postProcess`
  - `postProcess.operations.smartCrop?`: `{ enabled?, mode?, padding? }`
    - `mode`: `alpha-bounds|center`
  - `postProcess.operations.pixelPerfect?`: `{ enabled?, scale? }`
    - favors nearest-neighbor semantics during resize when enabled
  - `postProcess.operations.emitVariants?`: `{ raw?, pixel?, styleRef? }`
    - writes explicit `__raw`, `__pixel`, and `__style_ref` processed artifacts when enabled
- `acceptance`
- `runtimeSpec`
- `provider`, `model`, `edit`, `auxiliaryMaps`
- `controlImage?` + `controlMode?` (`canny|depth|openpose`) must be provided together
- `generationMode: "edit-first"` requires an edit-capable provider (`openai`, `local`, or `nano` with an image-edit-capable Gemini model)
- `edit.inputs[].path` must resolve inside the active `--out` root at runtime
- `generationPolicy.background: "transparent"` requires a provider that supports transparent outputs (unsupported providers now fail validation)
- `generationPolicy.vlmGate` requires runtime evaluator transport via `LOOTFORGE_VLM_GATE_CMD` or `LOOTFORGE_VLM_GATE_URL`
- edge-aware hard gates can be configured in `evaluationProfiles[].hardGates`:
  - `alphaHaloRiskMax` (`0..1`, lower is stricter)
  - `alphaStrayNoiseMax` (`0..1`, lower is stricter)
  - `alphaEdgeSharpnessMin` (`0..1`, higher is stricter)
- score weighting defaults and overrides:
  - LootForge applies deterministic built-in score presets by target kind.
  - If a matching `scoringProfiles[]` entry is found (by `targets[].scoringProfile` or `evaluationProfileId`), profile weights override the built-in kind preset.
  - If no matching `scoringProfiles[]` entry exists, `evaluationProfiles[].scoreWeights` acts as a compatibility fallback override.
- pack-level gates can be configured in `evaluationProfiles[].hardGates` and are normalized onto each planned target:
  - `packTextureBudgetMB` (`>0`, optional profile-level uncompressed texture budget)
  - `spritesheetSilhouetteDriftMax` (`0..1`, optional max adjacent-frame silhouette drift)
  - `spritesheetAnchorDriftMax` (`0..1`, optional max adjacent-frame anchor drift)
- consistency-group drift controls can be configured in `evaluationProfiles[].consistencyGroupScoring` and are normalized onto each planned target:
  - `warningThreshold` (`>0`, optional warning trigger for aggregate group diagnostics)
  - `penaltyThreshold` (`>0`, optional threshold for deterministic ranking penalty)
  - `penaltyWeight` (`>=0`, optional multiplier for ranking influence)

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

Pack invariants enforced during acceptance/eval:

- runtime output uniqueness across non-catalog targets (case-insensitive normalized path)
- spritesheet sheet/frame family and atlas-group integrity checks
- continuity metrics per animation (`maxSilhouetteDrift`, `maxAnchorDrift`) with optional hard-gate thresholds
- optional profile texture budget gate using estimated uncompressed bytes (`width * height * 4`)

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
        "alphaEdgeSharpnessMin": 0.8,
        "packTextureBudgetMB": 48,
        "spritesheetSilhouetteDriftMax": 0.2,
        "spritesheetAnchorDriftMax": 0.15
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
