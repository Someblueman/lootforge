# Eval Adapter Contract

LootForge can run optional soft adapters during `lootforge eval` for CLIP/LPIPS/SSIM style scoring.

## Enable + Configure

Enable adapters:

- `LOOTFORGE_ENABLE_CLIP_ADAPTER=1`
- `LOOTFORGE_ENABLE_LPIPS_ADAPTER=1`
- `LOOTFORGE_ENABLE_SSIM_ADAPTER=1`

Configure each enabled adapter with one of:

- `LOOTFORGE_<NAME>_ADAPTER_CMD` command (reads JSON from stdin, writes JSON to stdout)
- `LOOTFORGE_<NAME>_ADAPTER_URL` HTTP endpoint (POST JSON, return JSON)

Timeouts:

- Per-adapter: `LOOTFORGE_<NAME>_ADAPTER_TIMEOUT_MS`
- Global fallback: `LOOTFORGE_ADAPTER_TIMEOUT_MS`

## Request Payload

LootForge sends one request per target image per enabled adapter.

```json
{
  "adapter": "clip",
  "imagePath": "/abs/path/to/processed/image.png",
  "prompt": "Use case: ...\nPrimary request: ...",
  "referenceImages": ["/abs/path/to/reference.png"],
  "target": {
    "id": "hero",
    "kind": "sprite",
    "out": "hero.png",
    "styleKitId": "default-topdown",
    "consistencyGroup": "heroes",
    "evaluationProfileId": "default-sprite-quality"
  }
}
```

Notes:

- `adapter` is one of `clip`, `lpips`, `ssim`.
- `referenceImages` is derived from non-mask `edit.inputs`.
- `imagePath` and `referenceImages` are absolute filesystem paths.
- `referenceImages` paths must remain inside the active `--out` root; unsafe paths fail eval.

## Response Contract

Adapters must return JSON object with at least one numeric metric or numeric `score`.

Accepted forms:

```json
{ "metrics": { "alignment": 0.82 }, "score": 5 }
```

```json
{ "alignment": 0.82, "score": 5 }
```

Rules:

- Numeric fields in `metrics` are recorded under `adapterMetrics`.
- `score` is optional and contributes to additive soft score using target adapter weights.
- Non-numeric fields are ignored.
- Empty/non-JSON/error responses are treated as adapter failure and captured in warnings.

## Eval Report Health

`checks/eval-report.json` includes adapter health summary:

- `adapterHealth.configured`: enabled adapters with command/URL configured.
- `adapterHealth.active`: adapters with at least one successful response.
- `adapterHealth.failed`: adapters that failed at least once or were enabled but unconfigured.
- `adapterHealth.adapters[]`: per-adapter mode (`command`/`http`/`unconfigured`), target attempt/success/fail counters, and warnings.

## Runnable Examples

- Command/stdio adapter: `examples/adapters/stdin-adapter-example.js`
- HTTP adapter: `examples/adapters/http-adapter-example.js`

## VLM Candidate Gate Contract

LootForge can run an optional VLM hard gate during candidate selection when `targets[].generationPolicy.vlmGate` is configured.

### Configure Transport

Set one transport (command is preferred when both are set):

- `LOOTFORGE_VLM_GATE_CMD`
- `LOOTFORGE_VLM_GATE_URL`

Optional timeout override:

- `LOOTFORGE_VLM_GATE_TIMEOUT_MS`

### Request Payload

LootForge sends one request per candidate image:

```json
{
  "imagePath": "/abs/path/to/candidate.png",
  "prompt": "Use case: ...\nPrimary request: ...",
  "threshold": 4,
  "maxScore": 5,
  "rubric": "Score silhouette clarity and framing quality from 0 to 5.",
  "target": {
    "id": "hero",
    "kind": "sprite",
    "out": "hero.png",
    "styleKitId": "default-topdown",
    "consistencyGroup": "heroes",
    "evaluationProfileId": "default-sprite-quality"
  }
}
```

Notes:

- `imagePath` is absolute and must resolve inside the active `--out` root.
- `threshold` defaults to `4` (range `0..5`) when omitted in manifest.
- `rubric` is optional and comes from `generationPolicy.vlmGate.rubric`.

### Response Contract

VLM gate must return JSON with numeric `score` (`0..5`) and optional `reason`:

```json
{ "score": 4.4, "reason": "clear silhouette and framing" }
```

Rules:

- Candidates below threshold are rejected before final candidate selection.
- Rejection reason is recorded in provenance/eval/review artifacts.
- Invalid/empty responses fail generation for that target (no silent fallback).
