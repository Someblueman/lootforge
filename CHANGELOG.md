# Changelog

All notable changes to LootForge are documented in this file.

Format rules:

- Release headings use `## [<semver>] - <YYYY-MM-DD> - <Codename>`.
- Codenames are documentation labels only; semver remains authoritative.
- Keep entries grouped under: `Added`, `Changed`, `Fixed`, `Docs`, `CI/Security`.

## [Unreleased] - TBD - TBD

### Added

- None yet.

### Changed

- None yet.

### Fixed

- None yet.

### Docs

- None yet.

### CI/Security

- None yet.

## [0.2.0] - 2026-02-18 - Emberforge

### Added

- Added `lootforge regenerate --edit` as a dedicated edit-first regeneration flow using approved selection-lock outputs as edit bases.
- Added optional `seamHeal` processing support for tileable targets and `wrapGrid` acceptance checks.
- Added adapter health telemetry in eval reports (`configured`, `active`, `failed`, plus per-adapter attempt/success/fail detail).

### Changed

- Applied `styleKits[].palettePath` defaults when target palette policy is unset.
- Expanded review output to include per-target score-component breakdown blocks (candidate + adapter contributions).

### Fixed

- Hardened release gate behavior and reliability around path-safe, manifest-driven pipeline execution.

### Docs

- Added adapter contract documentation and runnable adapter examples.
- Added visual showcase pipeline/docs (`examples/showcase/*`, `docs/showcase/0.2.0/*`).
- Added release codename scheme across roadmap/readme/changelog documentation.

### CI/Security

- Added required PR/push CI workflow (`typecheck`, `test`, `build`).
- Added security workflows: dependency review, `npm audit` (high+), and CodeQL.
