# Manifest Policy Coverage Index

This index is machine-checked by `npm run check:manifest-policy`.

Rules enforced by the gate:
- Every documented policy field must be marked as `implemented` or `reserved`.
- `implemented` fields must cite implementation paths and test paths.
- The gate fails if referenced implementation/test files do not exist.

| Field | Status | Implementation | Tests | Notes |
| --- | --- | --- | --- | --- |
| `providers.openai.endpoint` | implemented | `src/providers/types.ts` | `test/unit/provider-runtime-config.test.ts` | runtime endpoint override |
| `providers.nano.endpoint` | implemented | `src/providers/types.ts` | `test/unit/provider-runtime-config.test.ts` | runtime endpoint override |
| `providers.local.endpoint` | implemented | `src/providers/types.ts` | `test/unit/provider-runtime-config.test.ts` | runtime endpoint override |
| `providers.local.baseUrl` | implemented | `src/providers/types.ts` | `test/unit/provider-runtime-config.test.ts` | alias normalization |
| `providers.openai.timeoutMs` | implemented | `src/providers/types.ts` | `test/unit/provider-runtime-config.test.ts` | provider timeout contract |
| `providers.nano.timeoutMs` | implemented | `src/providers/types.ts` | `test/unit/provider-runtime-config.test.ts` | provider timeout contract |
| `providers.local.timeoutMs` | implemented | `src/providers/types.ts` | `test/unit/provider-runtime-config.test.ts` | provider timeout contract |
| `providers.openai.maxRetries` | implemented | `src/providers/types.ts` | `test/unit/provider-runtime-config.test.ts` | provider retry contract |
| `providers.nano.maxRetries` | implemented | `src/providers/types.ts` | `test/unit/provider-runtime-config.test.ts` | provider retry contract |
| `providers.local.maxRetries` | implemented | `src/providers/types.ts` | `test/unit/provider-runtime-config.test.ts` | provider retry contract |
| `providers.openai.minDelayMs` | implemented | `src/providers/types.ts` | `test/integration/generate-safety.test.ts` | provider spacing contract |
| `providers.nano.minDelayMs` | implemented | `src/providers/types.ts` | `test/integration/generate-safety.test.ts` | provider spacing contract |
| `providers.local.minDelayMs` | implemented | `src/providers/types.ts` | `test/integration/generate-safety.test.ts` | provider spacing contract |
| `providers.openai.defaultConcurrency` | implemented | `src/providers/types.ts` | `test/unit/provider-runtime-config.test.ts` | provider concurrency contract |
| `providers.nano.defaultConcurrency` | implemented | `src/providers/types.ts` | `test/unit/provider-runtime-config.test.ts` | provider concurrency contract |
| `providers.local.defaultConcurrency` | implemented | `src/providers/types.ts` | `test/unit/provider-runtime-config.test.ts` | provider concurrency contract |
| `styleKits[].styleReferenceImages` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts` | `test/unit/manifest-validate.test.ts` | directed style scaffolding |
| `styleKits[].loraPath` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts` | `test/unit/manifest-validate.test.ts` | local lora path contract |
| `styleKits[].loraStrength` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts` | `test/unit/manifest-validate.test.ts` | local lora strength contract |
| `targets[].generationMode` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts` | `test/integration/generate-safety.test.ts` | text/edit-first mode |
| `targets[].scoringProfile` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts` | `test/unit/manifest-validate.test.ts` | scoring profile override |
| `targets[].tileable` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/checks/candidateScore.ts` | `test/unit/image-acceptance.test.ts` | seam-aware behavior |
| `targets[].seamThreshold` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/checks/candidateScore.ts` | `test/unit/image-acceptance.test.ts` | seam hard gate |
| `targets[].seamStripPx` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/checks/candidateScore.ts` | `test/unit/image-acceptance.test.ts` | seam strip width |
| `targets[].seamHeal.enabled` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/pipeline/seamHeal.ts` | `test/unit/seam-heal.test.ts` | tile seam-heal gate |
| `targets[].seamHeal.stripPx` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/pipeline/seamHeal.ts` | `test/unit/seam-heal.test.ts` | tile seam-heal strip |
| `targets[].seamHeal.strength` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/pipeline/seamHeal.ts` | `test/unit/seam-heal.test.ts` | tile seam-heal blend |
| `targets[].wrapGrid.columns` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts` | `test/unit/manifest-validate.test.ts` | wrap-grid policy |
| `targets[].wrapGrid.rows` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts` | `test/unit/manifest-validate.test.ts` | wrap-grid policy |
| `targets[].wrapGrid.seamThreshold` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts` | `test/unit/manifest-validate.test.ts` | wrap-grid seam override |
| `targets[].wrapGrid.seamStripPx` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts` | `test/unit/manifest-validate.test.ts` | wrap-grid seam strip override |
| `targets[].palette.mode` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/checks/candidateScore.ts` | `test/unit/manifest-validate.test.ts` | palette mode contract |
| `targets[].palette.colors` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/checks/candidateScore.ts` | `test/unit/manifest-validate.test.ts` | exact palette colors |
| `targets[].palette.maxColors` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/checks/candidateScore.ts` | `test/unit/manifest-validate.test.ts` | max-color policy |
| `targets[].palette.dither` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/checks/candidateScore.ts` | `test/unit/manifest-validate.test.ts` | dither policy |
| `targets[].palette.strict` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/checks/candidateScore.ts` | `test/unit/manifest-validate.test.ts` | strict exact palette compliance |
| `targets[].generationPolicy.size` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/providers/types.ts` | `test/unit/manifest-validate.test.ts` | size policy normalization |
| `targets[].generationPolicy.background` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/providers/types.ts` | `test/integration/generate-safety.test.ts` | background capability gate |
| `targets[].generationPolicy.outputFormat` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/providers/types.ts` | `test/integration/generate-safety.test.ts` | output format capability gate |
| `targets[].generationPolicy.quality` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/providers/types.ts` | `test/unit/manifest-validate.test.ts` | quality normalization |
| `targets[].generationPolicy.highQuality` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/providers/types.ts` | `test/unit/manifest-validate.test.ts` | directed-synthesis scaffold |
| `targets[].generationPolicy.hiresFix.enabled` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/providers/types.ts` | `test/unit/manifest-validate.test.ts` | hires-fix scaffold |
| `targets[].generationPolicy.hiresFix.upscale` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/providers/types.ts` | `test/unit/manifest-validate.test.ts` | hires-fix scaffold |
| `targets[].generationPolicy.hiresFix.denoiseStrength` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/providers/types.ts` | `test/unit/manifest-validate.test.ts` | hires-fix scaffold |
| `targets[].generationPolicy.draftQuality` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/pipeline/generate.ts` | `test/unit/manifest-validate.test.ts` | coarse-to-fine draft pass |
| `targets[].generationPolicy.finalQuality` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/pipeline/generate.ts` | `test/unit/manifest-validate.test.ts` | coarse-to-fine refine pass |
| `targets[].generationPolicy.candidates` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/pipeline/generate.ts` | `test/integration/generate-safety.test.ts` | multi-candidate policy |
| `targets[].generationPolicy.maxRetries` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/providers/types.ts` | `test/unit/provider-runtime-config.test.ts` | retry policy |
| `targets[].generationPolicy.fallbackProviders` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/pipeline/generate.ts` | `test/integration/generate-safety.test.ts` | fallback chain policy |
| `targets[].generationPolicy.providerConcurrency` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/providers/types.ts` | `test/unit/provider-runtime-config.test.ts` | per-target concurrency override |
| `targets[].generationPolicy.rateLimitPerMinute` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/providers/types.ts` | `test/unit/provider-runtime-config.test.ts` | per-target rate policy |
| `targets[].generationPolicy.vlmGate.threshold` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/checks/vlmGate.ts` | `test/unit/candidate-score.test.ts` | VLM threshold gate |
| `targets[].generationPolicy.vlmGate.rubric` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/checks/vlmGate.ts` | `test/unit/candidate-score.test.ts` | VLM rubric propagation |
| `targets[].generationPolicy.coarseToFine.enabled` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/pipeline/generate.ts` | `test/unit/manifest-validate.test.ts` | coarse-to-fine enablement |
| `targets[].generationPolicy.coarseToFine.promoteTopK` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/pipeline/generate.ts` | `test/unit/manifest-validate.test.ts` | coarse-to-fine promotion count |
| `targets[].generationPolicy.coarseToFine.minDraftScore` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/pipeline/generate.ts` | `test/unit/manifest-validate.test.ts` | coarse-to-fine threshold |
| `targets[].generationPolicy.coarseToFine.requireDraftAcceptance` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/pipeline/generate.ts` | `test/unit/manifest-validate.test.ts` | coarse-to-fine acceptance precondition |
| `targets[].postProcess.resizeTo` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/pipeline/process.ts` | `test/integration/process-pipeline.test.ts` | resize contract |
| `targets[].postProcess.algorithm` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/pipeline/process.ts` | `test/integration/process-pipeline.test.ts` | resize algorithm contract |
| `targets[].postProcess.stripMetadata` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/pipeline/process.ts` | `test/integration/process-pipeline.test.ts` | metadata stripping contract |
| `targets[].postProcess.pngPaletteColors` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/pipeline/process.ts` | `test/integration/process-pipeline.test.ts` | png palette cap |
| `targets[].postProcess.operations.smartCrop.enabled` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/pipeline/process.ts` | `test/integration/process-pipeline.test.ts` | smart-crop policy |
| `targets[].postProcess.operations.smartCrop.mode` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/pipeline/process.ts` | `test/integration/process-pipeline.test.ts` | smart-crop mode |
| `targets[].postProcess.operations.smartCrop.padding` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/pipeline/process.ts` | `test/integration/process-pipeline.test.ts` | smart-crop padding |
| `targets[].postProcess.operations.pixelPerfect.enabled` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/pipeline/process.ts` | `test/integration/process-pipeline.test.ts` | pixel-perfect policy |
| `targets[].postProcess.operations.pixelPerfect.scale` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/pipeline/process.ts` | `test/integration/process-pipeline.test.ts` | pixel-perfect scale |
| `targets[].postProcess.operations.emitVariants.raw` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/pipeline/process.ts` | `test/integration/process-pipeline.test.ts` | explicit raw variant output |
| `targets[].postProcess.operations.emitVariants.pixel` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/pipeline/process.ts` | `test/integration/process-pipeline.test.ts` | explicit pixel variant output |
| `targets[].postProcess.operations.emitVariants.styleRef` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/pipeline/process.ts` | `test/integration/process-pipeline.test.ts` | explicit style-ref variant output |
| `targets[].controlImage` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts` | `test/unit/manifest-validate.test.ts` | control image path gate |
| `targets[].controlMode` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts` | `test/unit/manifest-validate.test.ts` | control mode enum gate |
| `evaluationProfiles[].hardGates.requireAlpha` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts` | `test/unit/image-acceptance.test.ts` | alpha hard gate |
| `evaluationProfiles[].hardGates.maxFileSizeKB` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts` | `test/unit/image-acceptance.test.ts` | file size hard gate |
| `evaluationProfiles[].hardGates.seamThreshold` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts` | `test/unit/image-acceptance.test.ts` | seam threshold gate |
| `evaluationProfiles[].hardGates.seamStripPx` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts` | `test/unit/image-acceptance.test.ts` | seam strip gate |
| `evaluationProfiles[].hardGates.paletteComplianceMin` | reserved | - | - | documented compatibility placeholder for upcoming gate tuning |
| `evaluationProfiles[].hardGates.alphaHaloRiskMax` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/checks/candidateScore.ts` | `test/unit/candidate-score.test.ts` | edge-aware halo gate |
| `evaluationProfiles[].hardGates.alphaStrayNoiseMax` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/checks/candidateScore.ts` | `test/unit/candidate-score.test.ts` | edge-aware stray noise gate |
| `evaluationProfiles[].hardGates.alphaEdgeSharpnessMin` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/checks/candidateScore.ts` | `test/unit/candidate-score.test.ts` | edge-aware sharpness gate |
| `evaluationProfiles[].hardGates.packTextureBudgetMB` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/checks/packInvariants.ts` | `test/unit/image-acceptance.test.ts` | pack memory hard gate |
| `evaluationProfiles[].hardGates.spritesheetSilhouetteDriftMax` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/checks/packInvariants.ts` | `test/unit/image-acceptance.test.ts` | spritesheet continuity hard gate |
| `evaluationProfiles[].hardGates.spritesheetAnchorDriftMax` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts`, `src/checks/packInvariants.ts` | `test/unit/image-acceptance.test.ts` | spritesheet continuity hard gate |
| `evaluationProfiles[].scoreWeights.readability` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts` | `test/unit/manifest-validate.test.ts` | score weight profile |
| `evaluationProfiles[].scoreWeights.fileSize` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts` | `test/unit/manifest-validate.test.ts` | score weight profile |
| `evaluationProfiles[].scoreWeights.consistency` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts` | `test/unit/manifest-validate.test.ts` | score weight profile |
| `evaluationProfiles[].scoreWeights.clip` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts` | `test/unit/manifest-validate.test.ts` | score weight profile |
| `evaluationProfiles[].scoreWeights.lpips` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts` | `test/unit/manifest-validate.test.ts` | score weight profile |
| `evaluationProfiles[].scoreWeights.ssim` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts` | `test/unit/manifest-validate.test.ts` | score weight profile |
| `scoringProfiles[].scoreWeights.readability` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts` | `test/unit/manifest-validate.test.ts` | scoring profile override |
| `scoringProfiles[].scoreWeights.fileSize` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts` | `test/unit/manifest-validate.test.ts` | scoring profile override |
| `scoringProfiles[].scoreWeights.consistency` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts` | `test/unit/manifest-validate.test.ts` | scoring profile override |
| `scoringProfiles[].scoreWeights.clip` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts` | `test/unit/manifest-validate.test.ts` | scoring profile override |
| `scoringProfiles[].scoreWeights.lpips` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts` | `test/unit/manifest-validate.test.ts` | scoring profile override |
| `scoringProfiles[].scoreWeights.ssim` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts` | `test/unit/manifest-validate.test.ts` | scoring profile override |
| `scoringProfiles[].kindScoreWeights.<kind>.<weight>` | implemented | `src/manifest/schema.ts`, `src/manifest/validate.ts` | `test/unit/manifest-validate.test.ts` | per-kind scoring profile override |
