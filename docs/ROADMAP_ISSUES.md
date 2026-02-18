# LootForge Prioritized Issue Backlog

Last updated: 2026-02-18

This list translates `docs/ROADMAP.md` into issue-ready work items with explicit acceptance criteria.

## P0 (Immediate: `0.3.0`)

### 1) Stage Artifact Contract Schemas and Compatibility Tests
- **Release target:** `0.3.0`
- **Why now:** Prevent stage drift and make artifacts safely reusable across pipeline runs.
- **Acceptance criteria:**
  - JSON schema or equivalent validators exist for `targets-index`, `provenance/run`, `acceptance-report`, `eval-report`, and `selection-lock`.
  - A fixture-pack CI smoke test runs `plan -> generate -> process -> eval -> review -> select` and validates all emitted artifacts against the schemas.
  - Contract failures produce clear error codes and file/field-level diagnostics.

### 2) Provider Runtime Contract Enforcement
- **Release target:** `0.3.0`
- **Why now:** Provider config in manifest/env must be operational, not advisory.
- **Acceptance criteria:**
  - Endpoint, timeout, retry, min-delay, concurrency, and rate-limit settings are applied uniformly for OpenAI, Nano, and Local providers.
  - Provider capability assertions (`supportsControlNet`, edit support, transparency support, candidate support) are verified by tests against real request-shape behavior.
  - Unsupported feature requests fail with explicit diagnostics and no silent fallback.

### 3) VLM Candidate Gating and Traceability
- **Release target:** `0.3.0`
- **Why now:** Raise floor quality and reduce human review load.
- **Acceptance criteria:**
  - Manifest-configurable VLM gate supports thresholding (default `4/5`) and optional per-target rubric text.
  - Candidates below threshold are excluded before final selection.
  - Eval/review outputs include per-candidate VLM score, threshold, and rejection reason.

### 4) Edge-Aware Boundary Quality Gates
- **Release target:** `0.3.0`
- **Why now:** Boundary artifacts are a top runtime-quality failure mode for sprites.
- **Acceptance criteria:**
  - Candidate scoring and eval include alpha-boundary metrics (halo/bleed risk, stray-pixel noise, edge sharpness).
  - Boundary failures are surfaced as structured reasons in score records.
  - Hard-gate mode can reject outputs above configured boundary-artifact thresholds.

### 5) Pack-Level Invariants and Spritesheet Continuity
- **Release target:** `0.3.0`
- **Why now:** Single-image checks are insufficient for production packs.
- **Acceptance criteria:**
  - Pack checks enforce normalized runtime/output uniqueness and atlas-group integrity.
  - Spritesheet continuity checks flag frame-to-frame silhouette/anchor drift.
  - Optional texture budget gate reports total pack memory and fails when over threshold.

### 6) Manifest Policy Coverage Gate
- **Release target:** `0.3.0`
- **Why now:** Keep schema/docs and implementation in sync.
- **Acceptance criteria:**
  - Release checks fail when documented manifest policy fields are neither implemented nor explicitly marked `reserved`.
  - A policy coverage report is generated in CI.
  - New manifest fields require tests before merge.

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

### 10) Coarse-to-Fine Candidate Promotion
- **Release target:** `0.3.0` to `0.4.0` bridge
- **Why now:** Improve quality-per-cost by refining only promising candidates.
- **Acceptance criteria:**
  - Pipeline supports low-cost first pass and top-K promotion into high-fidelity refinement.
  - Promotion decisions and discarded candidates are recorded in provenance.
  - Benchmarks show reduced provider cost per approved asset for equivalent acceptance rate.

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

### 17) Roadmap-to-Delivery Traceability Policy
- **Release target:** `1.0.0`
- **Why now:** Keep roadmap trustworthy as scope expands.
- **Acceptance criteria:**
  - Every roadmap item maps to issue(s), PR(s), test IDs, and KPI deltas.
  - Release notes include traceability matrix for completed items.
  - CI validates that merged milestone PRs reference a tracked roadmap issue.
