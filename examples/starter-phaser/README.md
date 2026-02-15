# starter-phaser

Minimal Phaser starter that consumes `manifest/phaser.json` from a packaged asset output.

## Run

```bash
npm install
npm run dev
```

By default it tries to fetch `/manifest/phaser.json` and then renders the first available image/sprite.
When no manifest is present, it displays a message in-canvas.

