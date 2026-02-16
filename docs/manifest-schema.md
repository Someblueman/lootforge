# Manifest Schema (v2)

Top-level fields:

- `version` (`2`, `2.0`, `2.0.0`, or `v2`; optional)
- `pack` (required)
  - `id` (string, non-empty)
  - `version` (string, non-empty)
  - `license` (string, non-empty)
  - `author` (string, non-empty)
- `providers` (required)
  - `default` (`openai|nano`)
  - `openai.model` (optional string)
  - `nano.model` (optional string)
- `styleGuide` (optional object)
  - `preset` (optional string; applied as default `prompt.stylePreset` for all targets)
- `targets[]` (required, at least one)

Per target:

- `id` (string, non-empty)
- `kind` (string, non-empty)
- `out` (string, non-empty filename/path)
- `atlasGroup` (optional string)
- `prompt` (string) or structured object with:
  - `primary` (required string)
  - `useCase`, `stylePreset`, `scene`, `subject`, `style`, `composition`,
    `lighting`, `palette`, `materials`, `constraints`, `negative` (all optional strings)
- `provider` (optional `openai|nano`)
- `model` (optional string override)
- `generationPolicy` (optional)
  - `size`, `background`, `outputFormat`, `quality`,
    `draftQuality`, `finalQuality`
- `postProcess` (optional)
  - `resizeTo` (`WIDTHxHEIGHT` or positive integer for square resize)
  - `algorithm` (`nearest` or `lanczos3`)
  - `stripMetadata` (boolean, defaults true)
  - `pngPaletteColors` (2..256, PNG only)
- `acceptance` (optional)
  - `size` (`WIDTHxHEIGHT`)
  - `alpha` (boolean)
  - `maxFileSizeKB` (positive integer)
- `runtimeSpec` (optional)
  - `alphaRequired` (boolean)
  - `previewWidth` (positive integer)
  - `previewHeight` (positive integer)
