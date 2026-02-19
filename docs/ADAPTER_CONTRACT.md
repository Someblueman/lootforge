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
