# LootForge Public Release Roadmap

Last updated: 2026-02-17

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

## Release Principles
- Keep behavior deterministic unless explicitly marked stochastic.
- Every ranking decision should be explainable from report artifacts.
- Treat unsafe pathing and silent fallback behavior as release blockers.
- Keep manifest/schema compatibility explicit and migration-friendly.

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
- DX:
  - setup time for first successful pack,
  - number of manual manifest edits required per pack iteration.

## Immediate Next Tasks (post-merge queue)
- Define `0.2.0` issue set from this roadmap and label them in tracker.
- Implement `styleKits[].palettePath` auto-application fallback.
- Add `regen-by-edit` command path with provenance preservation.
- Add seam-heal optional pass for tile targets.
