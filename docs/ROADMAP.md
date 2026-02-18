# LootForge Public Release Roadmap

Last updated: 2026-02-18

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
| Version | Theme | Outcome |
|---|---|---|
| `0.2.0` | Public Beta Foundation | Stable quality gates + practical edit workflows for teams |
| `0.3.0` | Control and Consistency | Stronger content control, repeatability, and candidate quality |
| `0.4.0` | Local Production Path | Serious local diffusion path (ControlNet/LoRA workflow) |
| `0.5.0` | Team Scale and Integrations | CI/regression dashboards + multi-engine packaging maturity |
| `1.0.0` | General Availability | Public release with compatibility promises and ops docs |

## `0.2.0` Public Beta Foundation
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

## `0.3.0` Control and Consistency
Focus: improve artistic consistency and ranking quality beyond heuristics.

### Scope
- Content-aware ranking expansion:
  - run adapter scoring during candidate generation and eval with shared contract (already partially landed),
  - calibrate score weighting presets by target kind (sprite/tile/background/effect).
- Consistency-group coherence:
  - add group-level outlier scoring from LPIPS/CLIP metrics across sibling targets,
  - surface drift warnings at group level in eval + review.
- Cloud provider edit path parity:
  - implement Nano/Gemini edit-first flow equivalent to OpenAI path where supported.
- Scoring profile support:
  - allow manifest scoring profiles to override default per-kind weight presets.

### Exit Criteria
- Candidate selection reflects both deterministic gates and content-aware signals.
- Consistency drift is visible and actionable at group and pack levels.
- OpenAI and Nano edit-first flows are both supported and documented.

## `0.4.0` Local Production Path
Focus: deliver high-control local workflows for repeatable professional packs.

### Scope
- Local diffusion production architecture:
  - explicit ControlNet input contract (pose/edge/depth/segmentation roles),
  - workflow templates for local service endpoints.
- LoRA-ready pack support:
  - manifest metadata for LoRA/model variants per style kit,
  - provenance capture of model/control stack used per output.
- Throughput and queueing:
  - separate GPU generation queue from CPU post-process workers,
  - hard concurrency/rate controls with predictable scheduling.

### Exit Criteria
- Local path can produce repeatable packs with structural controls enabled.
- Provenance is sufficient to reproduce a pack’s generation conditions.

## `0.5.0` Team Scale and Integrations
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

### Exit Criteria
- CI can reject quality regressions automatically and explain why.
- Pack outputs are straightforward to consume across target engines.

## `1.0.0` General Availability
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

### `0.2.0` Upcoming (Public Beta Foundation)
- Scope complete; no remaining upcoming items in `0.2.0`.

Completed 2026-02-18 in this release track:
- Added adapter health section to eval report (`configured`, `active`, `failed`) and shipped adapter contract docs/examples.
- Added optional `seamHeal` processing pass for tileable targets and `wrapGrid` validation checks.
- Added `lootforge regenerate --edit` command path and preserved selection/provenance semantics.
- Added score-component detail blocks to review output.
- Applied `styleKits[].palettePath` defaults when target palette policy is unset.
- Added baseline CI/security workflows for PRs and pushes.

### `0.3.0` Upcoming (Control and Consistency)
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
- Release-gate coverage hardening:
  - add integration tests for generate fallback chains, approved lock skip/copy behavior, and candidate replacement selection,
  - add direct unit coverage for generate CLI argument parsing and boolean flag handling,
  - tighten CI test gates (fail if suites are missing, add coverage thresholds for critical paths).
- Add optional service mode with stable HTTP generation endpoints and MCP wrapper compatibility (no auth/credit layer in core).
- Define a canonical generation request contract and mapping layer between service requests and manifest/pipeline targets.
- Implement Nano/Gemini edit-first parity (where supported) with tests.
- Add automated VLM candidate grading gates:
  - score candidates for silhouette clarity, framing/cutoff, and structural fidelity,
  - discard candidates below manifest threshold (default `4/5`) before review output.
- Add edge-aware quality scoring and hard-gate coverage:
  - measure alpha-boundary sharpness, halo/bleed risk, and stray-pixel noise on transparent outputs,
  - surface boundary-focused failure reasons in candidate scoring, eval, and review artifacts.
- Expand acceptance from single-image checks to pack-level invariants:
  - enforce pack-level runtime/output uniqueness and atlas grouping integrity checks,
  - add spritesheet continuity checks (frame-to-frame silhouette/anchor drift),
  - add optional texture-memory budget gates for pack outputs.
- Add manifest schema scaffolding for directed synthesis controls:
  - `targets[].controlImage`, `targets[].controlMode` (`canny|depth|openpose`),
  - `styleKits[].styleReferenceImages`, `styleKits[].loraPath`, `styleKits[].loraStrength`,
  - `generationPolicy.highQuality` and optional `generationPolicy.hiresFix` controls.
- Implement first-class post-process semantics for pixel-perfect/smart-crop behaviors and emit explicit `raw`/`pixel`/`style_ref` artifact variants.
- Harden pixel-perfect quantization behavior:
  - deterministic nearest-color exact-palette mapping with alpha-safe handling,
  - strict palette-enforcement mode for low-color sprite/pixel-art outputs.
- Add coarse-to-fine candidate promotion controls:
  - run lower-cost candidate generation/scoring first,
  - promote top-K candidates into high-fidelity refinement passes only when quality gates justify extra compute.
- Extend eval/review artifacts with VLM grade traceability:
  - include per-candidate VLM rubric output, threshold decision, and rejection reasons.
- Add manifest policy coverage checks:
  - fail release gates when documented manifest policy fields are neither implemented nor marked as reserved.
- Add model capability introspection contract and endpoint for provider feature gating (pixel/high-res/references).
- Add template-driven pack orchestration layer with dependency-aware style-reference chaining across generated assets.
- Add consistency-group drift/outlier scoring using CLIP/LPIPS signals.
- Introduce per-kind scoring presets and manifest-level scoring profile overrides.
- Add aggregate group-level review/eval warnings and ranking influence controls.

## Future (After Upcoming)
These are high-impact but should follow once `0.2.0` and `0.3.0` stabilize.

### `0.4.0` Future (Local Production Path)
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

### `0.5.0` Future (Team Scale and Integrations)
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
- Add atlas-capacity planning and multipack spillover safeguards:
  - compute safe atlas frame capacity with padding/extrusion/mip constraints before pack build,
  - warn/fail on atlas overcommit and auto-spill frames to additional atlas pages when enabled.
- Add visual review workspace improvements:
  - thumbnail-first candidate browsing with side-by-side comparison and provenance/decision linkage.

### `1.0.0` Future (General Availability)
- Publish compatibility matrix, migration policy, and deprecation process.
- Formalize adapter/plugin compatibility contracts:
  - versioned adapter I/O schema, compatibility guarantees, and deprecation path.
- Publish security/secrets/compliance and licensing documentation.
- Publish release operations playbook (release checklist, support runbook, onboarding path).
- Enforce roadmap delivery traceability:
  - require each release item to map to issue(s), PR(s), tests, and KPI deltas.
