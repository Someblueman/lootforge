# Service Mode (`lootforge serve`)

`lootforge serve` runs a local HTTP server for command execution without adding auth/credit controls in core.

## Start

```bash
lootforge serve --host 127.0.0.1 --port 8744
```

Optional defaults:

- `--out <dir>`: default out directory injected when command payload omits `out`
- `--max-active-jobs <number>`: max concurrent active tool executions before returning `429 service_busy` (default `2`)
- `LOOTFORGE_SERVICE_HOST`
- `LOOTFORGE_SERVICE_PORT`
- `LOOTFORGE_SERVICE_OUT`
- `LOOTFORGE_SERVICE_MAX_ACTIVE_JOBS`

## Endpoints (`v1`)

- `GET /v1/health`
- `GET /v1/tools`
- `GET /v1/contracts/generation-request`
- `GET /v1/contracts/provider-capabilities`
- `GET /v1/providers/capabilities`
- `POST /v1/tools/:name`
- `POST /v1/:name` (alias for tools endpoint)
- `POST /v1/generation/requests` (canonical generation request contract)

Root helper endpoint:

- `GET /`

Provider capabilities query options:

- `provider` (optional): `openai|nano|local`
- `model` (optional): model override for introspection; requires `provider`

## Request Shape

Tool execution accepts one of:

1. `params` object (recommended stable interface)

```json
{
  "requestId": "req-123",
  "params": {
    "out": "/abs/path/to/workdir",
    "strict": true
  }
}
```

2. `args` override (raw CLI flag compatibility)

```json
{
  "args": ["--out", "/abs/path/to/workdir", "--strict", "true"]
}
```

`ids` and `runtimes` support string arrays in `params` and are converted to CSV flags.

Canonical generation request contract:

```json
{
  "requestId": "req-gen-001",
  "request": {
    "manifestPath": "/abs/path/to/manifest.json",
    "outDir": "/abs/path/to/out",
    "provider": "auto",
    "targetIds": ["hero", "enemy_01"],
    "skipLocked": true,
    "selectionLockPath": "/abs/path/to/locks/selection-lock.json"
  }
}
```

Notes:

- `request.manifest` can be provided inline instead of `manifestPath`; service mode will materialize it before planning.
- Canonical request execution maps to `plan -> generate` and returns both plan metadata and generation run metadata.

## Response Shape

Success:

```json
{
  "ok": true,
  "apiVersion": "v1",
  "tool": "validate",
  "requestId": "req-123",
  "result": {}
}
```

Failure:

```json
{
  "ok": false,
  "apiVersion": "v1",
  "tool": "validate",
  "error": {
    "code": "manifest_validation_failed",
    "message": "Manifest validation failed with 1 error(s).",
    "exitCode": 1
  }
}
```

Busy (`429`):

```json
{
  "ok": false,
  "apiVersion": "v1",
  "tool": "generate",
  "error": {
    "code": "service_busy",
    "message": "Service is busy (2/2 active jobs). Retry later."
  }
}
```

## MCP Wrapper Compatibility Notes

- `GET /v1/tools` exposes stable tool metadata and parameter keys.
- `POST /v1/tools/:name` gives deterministic JSON envelopes for tool-call wrappers.
- `POST /v1/generation/requests` provides a canonical mapping layer from service request payloads to manifest planning + generation targets.
- `GET /v1/providers/capabilities` provides provider/model capability introspection for wrapper-side feature gating (`pixel`, `highRes`, `references`).
- `GET /v1/contracts/provider-capabilities` exposes a machine-readable contract for the capabilities endpoint.
- CORS headers are permissive (`*`) for local tool hosts.
