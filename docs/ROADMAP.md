# LootForge Public Release Roadmap

Last updated: 2026-02-21

## Goal

Move LootForge from a strong early foundation (`0.1.x`) to a dependable, public-facing release with:

- controllable generation workflows,
- measurable quality gates,
- predictable artifact contracts,
- clear operational guidance for teams.

## Current Baseline (Shipped in 0.1.x)

- Manifest-driven staged pipeline (`plan -> generate -> process -> atlas -> eval -> review -> select -> package`).
- Path-safety and reliability hardening across pipeline stages.
- Style kits with consistency-group semantics and manifest asset validation.
- OpenAI `edit-first` generation path (edits endpoint, multipart inputs).
- External soft-adapter execution for CLIP/LPIPS/SSIM in eval.
- Weighted candidate ranking using profile weights and adapter score contributions.
- Selection lock + skip-locked generation path for deterministic no-regenerate flows.

## `0.2.0` Progress Snapshot (2026-02-18)

- Added dedicated `lootforge regenerate --edit` flow using approved selection-lock outputs as edit bases.
- Added per-target score-component detail blocks in review output for eval/review explainability parity.
- Added style-kit palette auto-ingest (`styleKits[].palettePath`) when target palette policy is unset.
- Added enforced PR/push CI (`typecheck`, `test`, `build`) plus security workflows (dependency review, `npm audit`, CodeQL).

## Release Principles

- Keep behavior deterministic unless explicitly marked stochastic.
- Every ranking decision should be explainable from report artifacts.
- Treat unsafe pathing and silent fallback behavior as release blockers.
- Keep manifest/schema compatibility explicit and migration-friendly.

## Product Parity Focus (OSS)

- Prioritize functional parity with modern game-asset generators for request semantics, post-processing outputs, and automation interfaces.
- Keep auth/subscription gating and credit metering out of core LootForge scope.
- Prefer composable interfaces (CLI + API + MCP wrapper) over product-specific UI coupling.

## Version Plan

| Version | Codename         | Theme                       | Outcome                                                        |
| ------- | ---------------- | --------------------------- | -------------------------------------------------------------- |
| `0.2.0` | `Emberforge`     | Public Beta Foundation      | Stable quality gates + practical edit workflows for teams      |
| `0.3.0` | `Tempered Steel` | Control and Consistency     | Stronger content control, repeatability, and candidate quality |
| `0.4.0` | `Anvilheart`     | Local Production Path       | Serious local diffusion path (ControlNet/LoRA workflow)        |
| `0.5.0` | `Runesmelter`    | Team Scale and Integrations | CI/regression dashboards + multi-engine packaging maturity     |
| `1.0.0` | `Mythic Foundry` | General Availability        | Public release with compatibility promises and ops docs        |

## `0.2.0` Public Beta Foundation (`Emberforge`)

Focus: close the biggest usability/control gaps for day-to-day production use.

### Scope

- Edit-first UX completion:
  - add a dedicated regen/edit CLI flow (`lootforge regenerate --edit` style path),
  - preserve target lock provenance when regenerating by edit.
- Candidate quality:
  - expose score weighting defaults clearly in init templates/docs,
  - add per-target score breakdown rendering to review output.
- Palette and tile reliability:
  - auto-ingest `styleKits[].palettePath` into quantize defaults when target palette is unset,
  - add optional seam-heal pass for tile-marked targets.
- Eval usability:
  - add adapter health section in eval report (configured, active, failed),
  - document adapter reference implementation format with examples.

### Exit Criteria

- Beta pack can be generated, reviewed, and regenerated via edit-first without manual JSON surgery.
- Eval and review artifacts expose enough detail to explain why a candidate won.
- Tile/palette policies are applied consistently from style kit defaults.

## `0.3.0` Control and Consistency (`Tempered Steel`)

Focus: improve artistic consistency and ranking quality beyond heuristics.

### Scope

- Content-aware ranking expansion:
  - run adapter scoring during candidate generation and eval with shared contract (already partially landed),
  - calibrate score weighting presets by target kind (sprite/tile/background/effect).
- Consistency-group coherence and Identity Stability:
  - add group-level outlier scoring from LPIPS/CLIP metrics across sibling targets,
  - implement cross-frame DINO feature similarity to automatically flag character/geometry drift in animations,
  - surface drift warnings at group level in eval + review.
- Advanced Tiling Contracts and Palette QA:
  - formalize a deterministic Tiling Score (TS) for strict Wang-tile topology validation,
  - add Palette Consistency Score (PCS) to enforce indexed palette constraints on pixel art outputs.
- Cloud provider edit path parity:
  - implement Nano/Gemini edit-first flow equivalent to OpenAI path where supported.
- Scoring profile support:
  - allow manifest scoring profiles to override default per-kind weight presets.
- Auto-Correction via LLM/VLM "Agentic Retry":
  - if a candidate fails the VLM or Edge-Aware QA gates, automatically feed the critique into an edit-first regeneration loop.

### Exit Criteria

- Candidate selection reflects both deterministic gates and content-aware signals.
- Consistency drift is visible and actionable at group and pack levels.
- OpenAI and Nano edit-first flows are both supported and documented.

## `0.4.0` Local Production Path (`Anvilheart`)

Focus: deliver high-control local workflows for repeatable professional packs.

### Scope

- Local diffusion production architecture:
  - explicit ControlNet input contract (pose/edge/depth/segmentation roles),
  - workflow templates for local service endpoints.
- 3D-to-2D Projection & Automating ControlNets:
  - integrate headless 3D rendering (e.g., three.js) to ingest primitive meshes,
  - auto-capture isometric Depth/Normal maps to drive ControlNet, guaranteeing 8-way directional consistency.
- LoRA-ready pack support:
  - manifest metadata for LoRA/model variants per style kit,
  - provenance capture of model/control stack used per output.
- Throughput and queueing:
  - separate GPU generation queue from CPU post-process workers,
  - hard concurrency/rate controls with predictable scheduling.
- Multi-Layer Compositions & Alpha Matting:
  - implement diffusion matting exporters for fringeless alpha extraction,
  - support native multi-layer outputs (e.g., z-index layers or PSD equivalents) for UI and characters.

### Exit Criteria

- Local path can produce repeatable packs with structural controls enabled.
- Provenance is sufficient to reproduce a pack’s generation conditions.

## `0.5.0` Team Scale and Integrations (`Runesmelter`)

Focus: team operations, CI confidence, and runtime integration maturity.

### Scope

- Evaluation harness maturation:
  - fixture packs committed for regression tests,
  - thresholded CI checks for hard gates + selected soft metrics.
- Reporting and dashboards:
  - machine-readable eval trend artifacts for CI history,
  - release quality summary per pack build.
- Runtime export expansion:
  - improve metadata exports (anchors/pivots/nine-slice metadata),
  - add Unity/Godot-oriented output presets.
- Native Vector Generation:
  - use LLM/Diffusion-guided SVG synthesis to generate structured, layer-separated true vector assets,
  - implement style-preserving vector distillation (e.g., IconDM) to expand icon seed sets into massive cohesive packs.
- First-Class Audio Generation Pipeline:
  - add LLM-driven audio manifest generation from text prompts,
  - integrate time-varying control for parameterized SFX (e.g., UI clicks, hits),
  - support timing-directed prompts and loop-aware inference for seamless ambience/music,
  - support multi-track stem generation and enforce ITU-R/EBU loudness compliance QA.
- Generative Dependency DAG ("Asset Lineage"):
  - treat generation targets as a Directed Acyclic Graph,
  - automatically inject approved parent assets as IP-Adapter/Style references into child targets for total pack coherence.
- Native Engine Editor Plugins:
  - build native Unity/Godot Editor plugins communicating via `serve` mode,
  - enable direct text-to-asset hot-swapping directly on GameObjects in-editor.

### Exit Criteria

- CI can reject quality regressions automatically and explain why.
- Pack outputs are straightforward to consume across target engines.

## `1.0.0` General Availability (`Mythic Foundry`)

Focus: stable public contract and operational readiness.

### Scope

- Compatibility and migration:
  - freeze/stabilize manifest contract for GA line,
  - provide schema migration notes and version compatibility matrix.
- Public release operations:
  - harden docs for setup, adapter integration, and troubleshooting,
  - publish release checklist and support policy.
- Security/compliance hygiene:
  - document model/provider licensing considerations,
  - define safe defaults for secrets and external adapter execution.
- The Multimodal Style Bible:
  - expand `styleKits` scheme to encompass both visual constraints and audio constraints (reverb, loudness, sonic palette),
  - enforce the single style bible definitively across the entire generative pack pipeline.
- Temporal Consistency via Video-to-Sprite Inference (Future Focus):
  - implement `video-to-sprite` target mode utilizing frame-interpolation over generated video,
  - deliver drift-free 60fps sprite animation exceeding pure image-diffusion bounds.
- Native 3D Asset Generation (Future Focus):
  - expand target kinds to support `.gltf`/`.glb` 3D mesh generation for engines like Three.js.
  - apply QA validation gates for polygon budgets, clean topology, and PBR material consistency.

### Exit Criteria

- Public users can adopt LootForge without internal tribal knowledge.
- Manifest + output contracts have explicit compatibility guarantees.

## Cross-Version Trackers

These run continuously across versions and should be reviewed per milestone:

- Quality metrics:
  - candidate acceptance pass rate,
  - edit-first success rate,
  - consistency drift incidents,
  - tile seam failure rate.
- Reliability:
  - failed job retry success ratio,
  - adapter failure frequency,
  - deterministic rebuild consistency on locked targets.
- Cost efficiency:
  - provider calls per approved target,
  - candidate count per approved target.
- Operational diagnostics:
  - run failure rate,
  - mean time to diagnose failures from provenance/eval artifacts.
- DX:
  - setup time for first successful pack,
  - number of manual manifest edits required per pack iteration,
  - review minutes per approved target.

## Upcoming (Execution Queue)

These items should be actively planned and ticketed now.

### `0.2.0` Upcoming (Public Beta Foundation / `Emberforge`)

- Scope complete; no remaining upcoming items in `0.2.0`.

Completed 2026-02-18 in this release track:

- Added adapter health section to eval report (`configured`, `active`, `failed`) and shipped adapter contract docs/examples.
- Added optional `seamHeal` processing pass for tileable targets and `wrapGrid` validation checks.
- Added `lootforge regenerate --edit` command path and preserved selection/provenance semantics.
- Added score-component detail blocks to review output.
- Applied `styleKits[].palettePath` defaults when target palette policy is unset.
- Added baseline CI/security workflows for PRs and pushes.

### `0.3.0` Upcoming (Control and Consistency / `Tempered Steel`)

Completed 2026-02-20 in this release track:

- Release-gate coverage hardening:
  - added integration coverage for generate fallback chains, approved lock skip/copy behavior, and candidate replacement selection,
  - added direct unit coverage for generate CLI arg parsing and boolean flag handling,
  - tightened CI test gates to fail on missing unit/integration suites and enforce critical-path coverage thresholds.

- Harden path safety for edit/adapters:
  - enforce in-root normalization for `edit.inputs` paths before provider uploads and adapter payload expansion.
- Add versioned stage-artifact contract tests:
  - define authoritative contract schemas for `targets-index`, run provenance, acceptance report, eval report, and selection lock artifacts,
  - add CI fixture-pack smoke tests that validate contract compatibility end-to-end.
- Make provider configuration an enforced runtime contract:
  - consistently apply manifest/env endpoint, timeout, retry, delay, and concurrency settings across all providers,
  - add capability-claim parity checks so provider feature flags reflect actual runtime behavior.
- Performance reliability follow-ups:
  - eliminate repeated candidate-image decode/stats passes during scoring,
  - run enabled soft adapters in parallel with deterministic result aggregation,
  - reduce repeated PNG decode work for resize variants and auxiliary map derivation.
- Add automated VLM candidate grading gates:
  - add manifest-configurable `generationPolicy.vlmGate` with threshold default `4/5` and optional rubric text,
  - reject below-threshold candidates before final selection and persist per-candidate VLM decisions in provenance,
  - surface VLM score/threshold/reason traceability in eval and review artifacts.
- Add edge-aware quality scoring and hard-gate coverage:
  - added alpha-boundary metrics (`alphaHaloRisk`, `alphaStrayNoise`, `alphaEdgeSharpness`) to candidate scoring and eval acceptance output,
  - enforce configurable hard-gate thresholds from evaluation profiles for halo risk, stray noise, and boundary edge sharpness,
  - surface boundary-focused rejection reasons in candidate score records and acceptance issue diagnostics.
- Expand acceptance from single-image checks to pack-level invariants:
  - enforce runtime/output uniqueness across non-catalog targets and spritesheet atlas-family integrity checks,
  - add spritesheet continuity checks (adjacent-frame silhouette/anchor drift metrics + optional hard-gate thresholds),
  - add optional profile texture-memory budget gates and propagate pack-level summary into acceptance/eval/review artifacts.
- Add optional service mode with stable HTTP generation endpoints and MCP wrapper compatibility:
  - added `lootforge serve` command with stable JSON endpoints (`/v1/health`, `/v1/tools`, `/v1/tools/:name`, `/v1/:name`),
  - added command/tool metadata discovery and deterministic request/response envelopes for wrapper integration,
  - kept core service mode intentionally unauthenticated (no auth/credit layer in core).
- Define a canonical generation request contract and mapping layer between service requests and manifest/pipeline targets:
  - added `POST /v1/generation/requests` contract endpoint that maps canonical service requests into `plan -> generate`,
  - added `GET /v1/contracts/generation-request` schema/field descriptor for wrapper discovery,
  - added inline manifest materialization and normalized request metadata in service response payloads.
- Implement Nano/Gemini edit-first parity (where supported) with tests:
  - added Gemini/Nano edit-first request mapping with role-aware input handling for `base`, `mask`, and `reference` inputs,
  - enforce safe in-root edit input path resolution and explicit Nano edit error codes for unsupported models / unreadable inputs,
  - added deterministic unit coverage for Nano text-mode and edit-first request execution paths.
- Add manifest schema scaffolding for directed synthesis controls:
  - added manifest + planner scaffolding for `targets[].controlImage`, `targets[].controlMode` (`canny|depth|openpose`),
  - added style-kit scaffolding for `styleKits[].styleReferenceImages`, `styleKits[].loraPath`, and `styleKits[].loraStrength`,
  - added generation-policy scaffolding for `generationPolicy.highQuality` and optional `generationPolicy.hiresFix`.
- Implement first-class post-process semantics for pixel-perfect/smart-crop behaviors and explicit variant artifacts:
  - added manifest schema + normalized planner support for `postProcess.operations.smartCrop`, `pixelPerfect`, and `emitVariants`,
  - implemented process-stage semantics for smart-crop behavior and pixel-perfect nearest-neighbor resize handling,
  - added explicit processed artifact emission for `__raw`, `__style_ref`, and `__pixel` variants.
- Harden pixel-perfect quantization behavior:
  - enforce deterministic nearest-color exact-palette mapping with alpha-safe handling (transparent RGB zeroing),
  - add exact-palette strict mode (`palette.strict`) that enforces 100% visible-pixel compliance during process/acceptance/scoring.
- Add manifest policy coverage checks:
  - added machine-checkable policy coverage index (`docs/MANIFEST_POLICY_COVERAGE.md`) for documented manifest policy fields,
  - added `check:manifest-policy` release gate that fails when documented fields are neither `implemented` nor `reserved`,
  - require test evidence for every implemented policy field and emit CI report artifacts at `coverage/manifest-policy-coverage.json`.
- Introduce per-kind scoring presets and manifest-level scoring profile overrides:
  - added deterministic built-in score presets by target kind (`sprite|tile|background|effect|spritesheet`),
  - added optional `scoringProfiles[]` manifest contract with global and per-kind score-weight overrides,
  - resolved target scoring weights via `targets[].scoringProfile` (or `evaluationProfileId` fallback) with explicit validation for unknown profiles.
- Add model capability introspection contract and endpoint for provider feature gating (pixel/high-res/references):
  - added `GET /v1/contracts/provider-capabilities` and `GET /v1/providers/capabilities` for wrapper capability discovery and runtime feature gating,
  - added provider/model query support for introspection (`provider`, `model`) with model-aware Nano edit capability differentiation,
  - added explicit directive-gating capability signals (`pixel`, `highRes`, `references`) with support modes and diagnostics.
- Add template-driven pack orchestration layer with dependency-aware style-reference chaining:
  - added manifest `targetTemplates[]` with target-level `templateId`, `dependsOn`, and `styleReferenceFrom`,
  - added deterministic dependency-aware generate staging with unresolved/cycle validation,
  - added per-job provenance `styleReferenceLineage` records for effective style-reference inputs.
- Add consistency-group drift/outlier scoring with configurable warning and ranking influence controls:
  - added CLIP/LPIPS sibling-group outlier scoring with aggregate warning/outlier summaries in eval/review artifacts,
  - added `evaluationProfiles[].consistencyGroupScoring` controls (`warningThreshold`, `penaltyThreshold`, `penaltyWeight`) for deterministic ranking influence,
  - added selection-lock traceability fields (`evalFinalScore`, `groupSignalTrace`) so group-signal ranking deltas remain auditable.
- Add bounded agentic auto-correction retries for VLM and edge-boundary hard-fails:
  - added optional `generationPolicy.agenticRetry` controls (`enabled`, `maxRetries`) to drive bounded edit-first self-healing loops,
  - auto-generated critique instructions from hard-fail signals (`vlm_gate_below_threshold`, alpha-boundary violations) and retried from selected candidate outputs,
  - persisted attempt-level trigger/delta summaries in run provenance via `agenticRetry` records.

Remaining queued items:

- Add coarse-to-fine candidate promotion controls:
  - run lower-cost candidate generation/scoring first,
  - promote top-K candidates into high-fidelity refinement passes only when quality gates justify extra compute.

#### 2D Investigation Follow-ups (Visual QA + Policy)

- Add machine-checkable visual style-bible policy contracts:
  - extend style constraints beyond palette (line weight, shading rules, UI geometry constraints),
  - enforce policy compliance in validate/eval with explicit per-target diagnostics.
- Add sprite identity + pose adherence QA modules:
  - add frame-to-frame identity drift scoring for animation families,
  - add optional pose-target checks and rejection reasons for frame candidates.
- Expand tile QA from seam-only checks to topology constraints:
  - validate self/one-to-one/many-to-many adjacency compatibility from explicit tile rules,
  - report topology violations separately from texture seam metrics for map assembly reliability.
- Add layered export + matting-assisted alpha QA pipeline:
  - add first-class layered artifacts for sprite/UI/VFX workflows with deterministic export contracts,
  - add matting-derived transparency QA checks (halo/fringe/mask consistency) in eval/review diagnostics.

## Future (After Upcoming)

These are high-impact but should follow once `0.2.0` and `0.3.0` stabilize.

### `0.4.0` Future (Local Production Path / `Anvilheart`)

- Implement first-class ControlNet execution for local diffusion:
  - map `targets[].controlImage` + `targets[].controlMode` to provider payloads for Canny/Depth/OpenPose.
- Add dual-guidance local conditioning workflows:
  - combine structural ControlNet guidance with optional detail/edge guidance priors for boundary fidelity refinement.
- Implement IP-Adapter image-prompt integration for local diffusion:
  - pass `styleKits[].styleReferenceImages` separately from structural ControlNet guide inputs.
- Implement two-pass Hires Fix workflows behind explicit high-quality policy flags:
  - low-res generation -> latent upscale -> high-res denoise pass.
- Implement LoRA loading from style-kit manifest configuration:
  - support `styleKits[].loraPath` and `styleKits[].loraStrength`,
  - capture model/control/LoRA provenance per output for reproducibility.
- Publish local provider payload parity docs for ComfyUI/A1111-compatible mappings:
  - control, style references, hires-fix, and LoRA field mapping expectations.

### `0.5.0` Future (Team Scale and Integrations / `Runesmelter`)

- Add CI fixture packs, regression dashboards, and thresholded quality gates.
- Add quality/latency operating profiles:
  - publish `fast`, `balanced`, and `high-fidelity` presets with explicit candidate-count, refinement-pass, and adapter-eval behavior.
- Add golden-set quality harness and nightly regression gates:
  - maintain curated target/reference packs and detect score-quality regressions across providers/models,
  - add calibration loop outputs for score-weight tuning over time.
- Add provider budget/rate telemetry and draft-vs-final operational controls.
- Harden release-grade CI and supply-chain posture:
  - publish coverage reports with thresholds for critical pipeline modules,
  - pin workflow action revisions and emit SBOM + build provenance artifacts,
  - add policy checks for insecure soft-adapter execution configuration.
- Expand runtime export presets and metadata for Unity/Godot integration.

#### 2D Investigation Follow-ups (Runtime/Export)

- Add first-class autotile runtime contract exports:
  - emit 4-neighbor bitmask metadata (`4 bits -> 16-entry LUT`) for deterministic tile-index selection,
  - support tileset variant blocks (e.g., separate `4x4` banks for water-edge vs cliff-edge families) with runtime selection hints.
  - define canonical neighbor bit ordering, map-boundary behavior, and deterministic variant-picking rules so runtime implementations stay consistent across engines.
- Add vector/layered asset interoperability gates:
  - add first-class SVG target support (generation, validation, review, and package/export stages),
  - validate SVG structure/layer hygiene before packaging and publish deterministic export conventions,
  - define layered-artifact contracts for downstream toolchains that expect editable layered inputs.
- Add asset-license provenance release gates:
  - require machine-readable provenance metadata for visual datasets, reference assets, and model families used per target,
  - fail packaging/release checks when license status is unresolved or violates configured policy.
- Add atlas-capacity planning and multipack spillover safeguards:
  - compute safe atlas frame capacity with padding/extrusion/mip constraints before pack build,
  - warn/fail on atlas overcommit and auto-spill frames to additional atlas pages when enabled.
- Add visual review workspace improvements:
  - thumbnail-first candidate browsing with side-by-side comparison and provenance/decision linkage.

### `1.0.0` Future (General Availability / `Mythic Foundry`)

- Publish compatibility matrix, migration policy, and deprecation process.
- Formalize adapter/plugin compatibility contracts:
  - versioned adapter I/O schema, compatibility guarantees, and deprecation path.
- Publish security/secrets/compliance and licensing documentation.
- Publish release operations playbook (release checklist, support runbook, onboarding path).
- Enforce roadmap delivery traceability:
  - require each release item to map to issue(s), PR(s), tests, and KPI deltas.
