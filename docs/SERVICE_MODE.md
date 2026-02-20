# Service Mode (`lootforge serve`)

`lootforge serve` runs a local HTTP server for command execution without adding auth/credit controls in core.

## Start

```bash
lootforge serve --host 127.0.0.1 --port 8744
```

Optional defaults:
- `--out <dir>`: default out directory injected when command payload omits `out`
- `LOOTFORGE_SERVICE_HOST`
- `LOOTFORGE_SERVICE_PORT`
- `LOOTFORGE_SERVICE_OUT`

## Endpoints (`v1`)

- `GET /v1/health`
- `GET /v1/tools`
- `POST /v1/tools/:name`
- `POST /v1/:name` (alias for tools endpoint)

Root helper endpoint:
- `GET /`

## Request Shape

Tool execution accepts one of:

1) `params` object (recommended stable interface)
```json
{
  "requestId": "req-123",
  "params": {
    "out": "/abs/path/to/workdir",
    "strict": true
  }
}
```

2) `args` override (raw CLI flag compatibility)
```json
{
  "args": ["--out", "/abs/path/to/workdir", "--strict", "true"]
}
```

`ids` and `runtimes` support string arrays in `params` and are converted to CSV flags.

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

## MCP Wrapper Compatibility Notes

- `GET /v1/tools` exposes stable tool metadata and parameter keys.
- `POST /v1/tools/:name` gives deterministic JSON envelopes for tool-call wrappers.
- CORS headers are permissive (`*`) for local tool hosts.
