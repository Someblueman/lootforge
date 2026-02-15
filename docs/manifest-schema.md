# Manifest Shape (practical)

Top-level fields:

- `version`
- `styleGuide`
- `targets[]`

Per target:

- `id` (string)
- `kind` (`icon|sprite|tile|background`)
- `out` (filename)
- `atlasGroup` (optional)
- `promptSpec.primary` (string)
- `promptSpec.useCase` (optional, defaults to `stylized-concept`)
- `generationPolicy.size` (optional, defaults `1024x1024`)
- `generationPolicy.background` (optional)
- `generationPolicy.outputFormat` (optional, defaults `png`)
- `generationPolicy.draftQuality` (optional, defaults `low`)
- `generationPolicy.finalQuality` (optional, defaults `high`)
- `runtimeSpec.alphaRequired` (optional)
- `runtimeSpec.previewWidth` (optional)
- `runtimeSpec.previewHeight` (optional)
