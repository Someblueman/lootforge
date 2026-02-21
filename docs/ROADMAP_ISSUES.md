# LootForge Prioritized Issue Backlog

Last updated: 2026-02-21

This list translates `docs/ROADMAP.md` into issue-ready work items with explicit acceptance criteria.

Recent completion (2026-02-20):

- Implemented stage-artifact contract schema coverage and fixture-pack compatibility checks.
- Implemented provider runtime contract enforcement across OpenAI/Nano/Local with capability parity checks.
- Implemented automated VLM candidate grading gates with score/threshold/reason traceability in eval/review.
- Implemented edge-aware alpha-boundary scoring and configurable hard-gate rejection thresholds.
- Implemented pack-level acceptance invariants, spritesheet continuity checks, and optional texture-memory budget gates.
- Implemented Manifest Policy Coverage Gate:
  - added machine-checkable policy index (`docs/MANIFEST_POLICY_COVERAGE.md`),
  - added release gate script (`npm run check:manifest-policy`) that enforces `implemented|reserved` status and test evidence for implemented fields,
  - added CI report artifact output (`coverage/manifest-policy-coverage.json`).
- Implemented per-kind scoring presets and manifest-level scoring profile overrides:
  - added deterministic default score-weight presets by target kind,
  - added optional manifest `scoringProfiles[]` contract with per-kind overrides,
  - validated `targets[].scoringProfile` references and normalized scoring resolution into planned targets.
- Implemented model capability introspection contract and endpoint for provider feature gating:
  - added service discovery contract endpoint (`GET /v1/contracts/provider-capabilities`),
  - added runtime introspection endpoint (`GET /v1/providers/capabilities`) with provider/model query support,
  - exposed explicit provider-gating signals for `pixel`, `highRes`, and `references`.

Recent completion (2026-02-21):

- Implemented template-driven pack orchestration and dependency-aware style-reference chaining:
  - added manifest `targetTemplates[]` contract with target-level `templateId`, `dependsOn`, and `styleReferenceFrom`,
  - enforced deterministic dependency-aware execution stages with unresolved/cycle validation,
  - recorded effective style-reference lineage in run provenance for each generated target.
- Implemented consistency-group drift/outlier scoring with deterministic ranking influence:
  - added group-level CLIP/LPIPS outlier scoring across sibling targets with robust median/MAD-style normalization,
  - emitted per-target diagnostics (`score`, `penalty`, reasons, metric deltas) in eval/review artifacts,
  - applied deterministic outlier penalties to final ranking scores and emitted aggregate group summaries.
- Implemented aggregate consistency-group warning controls and selection traceability:
  - added `evaluationProfiles[].consistencyGroupScoring` controls for warning threshold, penalty threshold, and penalty weight,
  - emitted aggregate group warning/outlier summaries (counts, warned/outlier target ids, max score, total penalty) in eval/review artifacts,
  - added selection-lock trace fields (`evalFinalScore`, `groupSignalTrace`) so group-level ranking effects are auditable in downstream decisions.
- Implemented bounded agentic auto-correction retries for VLM/edge hard-fails:
  - added optional `generationPolicy.agenticRetry` controls (`enabled`, `maxRetries`) to trigger edit-first self-healing loops from failed candidates,
  - generated critique instructions directly from VLM and edge-boundary hard-fail reasons and ran bounded edit-first regeneration attempts,
  - recorded attempt-level before/after deltas and trigger reasons in provenance (`agenticRetry`) for deterministic auditability.
- Implemented coarse-to-fine benchmark evidence tooling:
  - added stage-weighted cost model utilities for run-level cost-per-approved analysis,
  - added integration benchmark coverage proving reduced cost-per-approved at equivalent acceptance using coarse-to-fine promotion,
  - added `npm run benchmark:coarse-to-fine` script to compare baseline/coarse provenance runs.

## P0 (Immediate: `0.3.0`)

### 5) 2D Visual QA + Policy Follow-up Pack

- **Release target:** `0.3.0` stretch / `0.4.0` bridge
- **Why now:** Remaining visual QA gaps are still a source of production-quality drift.
- **Acceptance criteria:**
  - Visual style-bible policy checks are machine-checkable (line/shading/UI geometry) with explicit validate/eval diagnostics.
  - Sprite identity and optional pose adherence checks can score/reject animation-frame drift.
  - Tile QA validates topology rules (self/one-to-one/many-to-many adjacency) separately from seam metrics.
  - Layered export and matting-assisted alpha QA are covered by deterministic artifact contracts and eval diagnostics.

## P1 (Next: `0.4.0`)

### 7) Directed Synthesis Schema + Capability Gating

- **Release target:** `0.3.0` to `0.4.0` bridge
- **Why now:** Unlock deterministic control without breaking non-local providers.
- **Acceptance criteria:**
  - Manifest supports `targets[].controlImage`, `targets[].controlMode`, `styleKits[].styleReferenceImages`, `styleKits[].loraPath`, `styleKits[].loraStrength`, and high-quality flags.
  - Validation enforces path safety and enum/range constraints.
  - Non-supporting providers emit explicit unsupported-feature warnings/errors.

### 8) Local ControlNet + Dual Guidance Integration

- **Release target:** `0.4.0`
- **Why now:** Structural fidelity and edge/detail control are key differentiators.
- **Acceptance criteria:**
  - Local provider maps control fields to payload for Canny/Depth/OpenPose.
  - Optional detail/edge guidance path can run alongside structural guidance.
  - Provenance captures full control stack used per output.

### 9) IP-Adapter + LoRA Local Workflow

- **Release target:** `0.4.0`
- **Why now:** Style consistency across large packs requires stronger conditioning than prompt text.
- **Acceptance criteria:**
  - Style reference images are sent as IP-Adapter conditioning separate from ControlNet controls.
  - LoRA path/strength is included in local request payload and validation.
  - Provenance captures model, IP-Adapter references, LoRA identity, and strength.

### 10) 3D-to-2D Projection & Automating ControlNets

- **Release target:** `0.4.0`
- **Why now:** Drawing or gathering boundary maps manually for ControlNet scales poorly.
- **Acceptance criteria:**
  - Node ingest layer handles `.obj` or voxel primitives and headless rendering scripts.
  - Configurable isometric 8-way camera array directly outputs precise Depth/Normal rasterized maps to the pipeline's ControlNet payload queue.
  - Target output perfectly preserves the 3D footprint constraint.

## P2 (Scale-up: `0.5.0` and `1.0.0`)

### 11) Quality/Latency Operating Profiles

- **Release target:** `0.5.0`
- **Why now:** Teams need predictable throughput/quality tradeoffs.
- **Acceptance criteria:**
  - Presets `fast`, `balanced`, and `high-fidelity` are exposed in CLI/manifest.
  - Each preset defines candidate count, adapter pass behavior, and refinement policy.
  - Preset behavior is documented and covered by integration tests.

### 12) Golden-Set Regression Harness

- **Release target:** `0.5.0`
- **Why now:** Prevent silent quality regressions over time.
- **Acceptance criteria:**
  - Curated golden targets and reference expectations are versioned in repo.
  - Nightly job computes score deltas and fails on configured regressions.
  - Output includes calibration data for score weight tuning.

### 13) Release-Grade CI and Supply-Chain Hardening

- **Release target:** `0.5.0`
- **Why now:** Public adoption requires reproducibility and security evidence.
- **Acceptance criteria:**
  - Coverage thresholds enforced on critical pipeline modules.
  - Workflow actions pinned and audited.
  - SBOM and build provenance artifacts produced for release builds.
  - Adapter security policy checks run in CI.

### 14) Visual Review Workspace

- **Release target:** `0.5.0`
- **Why now:** Human-in-loop review is a bottleneck for pack production.
- **Acceptance criteria:**
  - Review UI supports thumbnail grids, side-by-side candidate comparison, and quick approve/reject flows.
  - Decisions link back to provenance, metrics, and VLM/adapters rationale.
  - Bulk actions exist for approve-passing and reject-outlier workflows.

### 15) Atlas Capacity Planning and Multipack Spillover

- **Release target:** `0.5.0`
- **Why now:** Prevent runtime sampling artifacts and failed pack builds from overfilled atlases.
- **Acceptance criteria:**
  - Atlas planner computes safe frame capacity using target size, padding/extrusion, and mip requirements.
  - Pre-build validation warns or fails on frame-count overcommit for each atlas group.
  - Optional auto-spill mode distributes overflow frames into deterministic additional atlas pages.
  - Packaging outputs include atlas-page mapping metadata for spilled frames.

### 16) Adapter/Plugin Compatibility Contract

- **Release target:** `1.0.0`
- **Why now:** Ensure long-term adapter ecosystem stability.
- **Acceptance criteria:**
  - Versioned adapter I/O schema and compatibility guarantees are published.
  - Deprecation policy includes grace periods and migration guidance.
  - Conformance tests validate adapter implementations against contract versions.

### 17) First-Class Audio Generation Pipeline

- **Release target:** `0.5.0`
- **Why now:** Games need unified aesthetics spanning both visual and auditory spheres.
- **Acceptance criteria:**
  - Audio Target specifications support text prompts, timing instructions, and stem definitions.
  - Pipeline connects to audio generation logic (SFX parameterized models + loop models).
  - Implements ITU-R BS.1770 / EBU R128 loudness and true peak compliance QA.
  - Automated loop seam Click/Warble anomaly detectors.
  - Introduce LLM-driven generation to automatically create structured audio manifests.

### 18) Generative Dependency DAG ("Asset Lineage")

- **Release target:** `0.5.0`
- **Why now:** True collection-level coherence requires downstream assets to inherit their predecessors perfectly.
- **Acceptance criteria:**
  - Support execution DAG where target dependencies physically block child generators until the parent target is "Locked/Approved".
  - Auto-injection of Parent Lock artifacts into Child inference (e.g., as IP-Adapter styling).

### 19) Native Engine Editor Plugins

- **Release target:** `0.5.0`
- **Why now:** Reduce workflow friction between generating an asset and verifying it physically fits a map scene.
- **Acceptance criteria:**
  - Godot and Unity plugins that wrap `/v1/` `serve` module endpoints.
  - Developers can type prompts per-GameObject and directly fetch/auto-apply materials/sprites to the scene graph.

### 20) Native SVG & UI Generation

- **Release target:** `0.5.0`
- **Why now:** Real UI components require cleanly separated vector layers, not just edge-traced bitmaps.
- **Acceptance criteria:**
  - Diffusion-driven SVG tools (e.g., LayerTracer) explicitly emit manipulatable, grouped path files.
  - Implementation of style-reference set distillation rules for icon packs mapping.

### 21) The Multimodal Style Bible

- **Release target:** `1.0.0`
- **Why now:** Massive projects require absolute guardrails guaranteeing consistency across teams.
- **Acceptance criteria:**
  - `styleKits` expands schema validating visual layout, palette rules, and global acoustic footprints.
  - Validation physically halts runs whose generated artifacts violate the style bible assertions.

### 22) Native 3D Asset Generation (`.gltf` / Three.js)

- **Release target:** `Post-1.0`
- **Why now:** Broaden the LootForge paradigm from purely 2D/Audio space into the lightweight web 3D ecosystem.
- **Acceptance criteria:**
  - Supports structural definitions and LLM parsing to synthesize 3D models directly from prompt boundaries.
  - Pipeline explicitly emits standard web-ready formats (e.g. `.gltf` or `.glb`).
  - Validation metrics actively enforce polygon limits, detect broken UV layouts, and ensure standardized PBR materials.

### 23) Roadmap-to-Delivery Traceability Policy

- **Release target:** `1.0.0`
- **Why now:** Keep roadmap trustworthy as scope expands.
- **Acceptance criteria:**
  - Every roadmap item maps to issue(s), PR(s), test IDs, and KPI deltas.
  - Release notes include traceability matrix for completed items.
  - CI validates that merged milestone PRs reference a tracked roadmap issue.
