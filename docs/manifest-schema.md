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
- `targets[]` (required, at least one)

Per target:

- `id` (string, non-empty)
- `kind` (string, non-empty)
- `out` (string, non-empty filename/path)
- `atlasGroup` (optional string)
- `prompt` (string) or structured object with:
  - `primary` (required string)
  - `useCase`, `scene`, `subject`, `style`, `composition`,
    `lighting`, `palette`, `materials`, `constraints`, `negative` (all optional strings)
- `provider` (optional `openai|nano`)
- `model` (optional string override)
- `generationPolicy` (optional)
  - `size`, `background`, `outputFormat`, `quality`,
    `draftQuality`, `finalQuality`
- `acceptance` (optional)
  - `size` (`WIDTHxHEIGHT`)
  - `alpha` (boolean)
  - `maxFileSizeKB` (positive integer)
- `runtimeSpec` (optional)
  - `alphaRequired` (boolean)
  - `previewWidth` (positive integer)
  - `previewHeight` (positive integer)
