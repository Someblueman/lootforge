# Manifest Schema (v2)

Top-level fields:

- `version` (`2`, `2.0`, `2.0.0`, or `v2`; optional)
- `pack` (required)
  - `id` (string, non-empty)
  - `version` (string, non-empty)
  - `license` (string, non-empty)
  - `author` (string, non-empty)
- `providers` (required)
  - `default` (`openai|nano|local`)
  - `openai` (optional)
  - `nano` (optional)
  - `local` (optional)
    - `model`, `endpoint`, `baseUrl`, `timeoutMs`, `maxRetries`, `minDelayMs`, `defaultConcurrency`
- `styleGuide` (optional object)
  - `preset` (optional string; applied as default `prompt.stylePreset`)
- `atlas` (optional)
  - `padding`, `trim`, `bleed`, `multipack`, `maxWidth`, `maxHeight`
  - `groups` (optional map of per-atlas-group overrides)
- `targets[]` (required, at least one)

Per target:

- `id` (string, non-empty)
- `kind` (string, non-empty)
- `out` (string, non-empty filename/path)
- `atlasGroup` (optional string)
- `prompt` (string) or structured object with:
  - `primary` (required string)
  - optional: `useCase`, `stylePreset`, `scene`, `subject`, `style`, `composition`,
    `lighting`, `palette`, `materials`, `constraints`, `negative`
- `provider` (optional `openai|nano|local`)
- `model` (optional string override)
- `generationPolicy` (optional)
  - `size`, `background`, `outputFormat`, `quality`, `draftQuality`, `finalQuality`
  - `candidates` (int >= 1)
  - `maxRetries` (int >= 0)
  - `fallbackProviders` (array of provider names)
  - `providerConcurrency` (int > 0)
  - `rateLimitPerMinute` (int > 0)
- `postProcess` (optional)
  - legacy compatible:
    - `resizeTo` (`WIDTHxHEIGHT` or positive integer)
    - `algorithm` (`nearest|lanczos3`)
    - `stripMetadata` (boolean)
    - `pngPaletteColors` (2..256)
  - `operations` (optional)
    - `trim`: `{ enabled?, threshold? }`
    - `pad`: `{ pixels, extrude?, background? }`
    - `quantize`: `{ colors, dither? }`
    - `outline`: `{ size, color? }`
    - `resizeVariants`: `[{ name, size, algorithm? }]`
- `acceptance` (optional)
  - `size` (`WIDTHxHEIGHT`)
  - `alpha` (boolean)
  - `maxFileSizeKB` (positive integer)
- `runtimeSpec` (optional)
  - `alphaRequired` (boolean)
  - `previewWidth` (positive integer)
  - `previewHeight` (positive integer)
- `edit` (optional; P2 schema support)
  - `mode` (`edit|iterate`)
  - `instruction`
  - `inputs`: `[{ path, role?, fidelity? }]`
  - `preserveComposition`
- `auxiliaryMaps` (optional; P2 schema support)
  - `normalFromHeight`
  - `specularFromLuma`
  - `aoFromLuma`

Notes:

- `jpg` is normalized to `jpeg` during provider policy normalization.
- Alpha-required targets should use alpha-capable formats (`png`/`webp`).
- `generate` writes `raw/`; `process` writes `processed/images/` and compatibility mirror assets.
