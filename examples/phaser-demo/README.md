# Phaser Demo (Generated Assets Only)

`examples/phaser-demo` is a playable top-down survival shooter built with Phaser + Vite.
Every runtime visual in this demo is loaded from committed pipeline outputs under `public/assets`.

![Gameplay screenshot](./docs/gameplay.png)

## Run Immediately (No API Keys)

From repo root:

```bash
npm install --cache .npm-cache
npm run demo:dev
```

Then open `http://localhost:5173`.

Controls:
- `W A S D` or arrow keys: move
- Mouse: aim
- Left click: fire
- `R`, `Enter`, or `Space`: restart on game over
- `F`: toggle fullscreen (`Esc` exits)

## Regenerate Demo Assets (Requires OPENAI_API_KEY)

Demo manifest:
- `examples/phaser-demo/assets/manifest.demo.json`

Regeneration flow:

```bash
npm run demo:assets:plan
npm run demo:assets:generate
npm run demo:assets:atlas
npm run demo:assets:postprocess
```

Outputs consumed by runtime:
- `examples/phaser-demo/public/assets/atlases/manifest.json`
- `examples/phaser-demo/public/assets/atlases/*.json`
- `examples/phaser-demo/public/assets/images/*.png`
- `examples/phaser-demo/public/assets/imagegen/processed/catalog.json`

## Why This Demo Matters

This demo proves the core LootForge value chain end-to-end:
1. Manifest-defined targets become generation jobs.
2. Generated artifacts are transformed into runtime manifests.
3. A real game consumes those manifests directly, with no hand-authored fallback art.

## Validation

From repo root:

```bash
npm run demo:test
```

The demo tests include:
- asset contract checks (required IDs + manifest/file consistency)
- gameplay smoke assertions (projectiles can kill and score increments)
