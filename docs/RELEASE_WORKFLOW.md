# Release Workflow

This workflow keeps release docs, changelog entries, and showcase images consistent.

## Branch Strategy (`0.3.0`)

Use a release-train branch model so `main` stays stable until release cut:
- `main` is release-only (no feature merges while `0.3.0` is in flight).
- `release/0.3` is the integration branch for all `0.3.0` work.
- Feature branches are short-lived and branch from `release/0.3`.
- PR targets should be `release/0.3` until release readiness.

Cut `0.3.0` with:
1. Freeze `release/0.3` and ensure release checks pass.
2. Open a release PR from `release/0.3` to `main`.
3. Merge the release PR and tag `v0.3.0` from `main`.

Recommended branch protection:
- `main`: block direct pushes, require PR + required checks.
- `release/0.3`: block direct pushes, require PR + required checks.

## Codename Policy

Codenames are docs-only labels. Semver remains authoritative for npm/git releases.

Current codename map:
- `0.2.0` -> `Emberforge`
- `0.3.0` -> `Tempered Steel`
- `0.4.0` -> `Anvilheart`
- `0.5.0` -> `Runesmelter`
- `1.0.0` -> `Mythic Foundry`

If you add a new planned version, assign its codename in:
- `docs/ROADMAP.md`
- `README.md` (Status / Roadmap)
- `CHANGELOG.md` release heading

## Changelog Update Pattern

For each release:
1. Collect completed items from roadmap/progress and group by:
   - `Added`
   - `Changed`
   - `Fixed`
   - `Docs`
   - `CI/Security`
2. Move relevant entries from `Unreleased` to a new heading:
   - `## [<semver>] - <YYYY-MM-DD> - <Codename>`
3. Reset `Unreleased` to the empty template placeholders.
4. Keep entries concrete and user-visible (avoid internal-only noise).

## Showcase Image Pattern

Showcase images are versioned under `docs/showcase/<version>/`.

Current `0.2.0` flow:
- Inputs + manifest: `examples/showcase/retro-fantasy/`
- Generator: `examples/showcase/generate-showcase.sh`
- Image composer: `examples/showcase/build-readme-images.mjs`
- Outputs:
  - `docs/showcase/0.2.0/01-edit-loop.png`
  - `docs/showcase/0.2.0/02-seam-heal.png`
  - `docs/showcase/0.2.0/03-pack-preview.png`

To refresh `0.2.0` showcase assets:
```bash
bash examples/showcase/generate-showcase.sh
```

When creating a new release showcase:
1. Copy/update the manifest/style assets under `examples/showcase/`.
2. Generate artifacts into `.tmp/showcase-<version>/`.
3. Render final PNGs into `docs/showcase/<version>/`.
4. Update README image links to point at the new version folder when appropriate.

## Release Validation Checklist

Run before cutting a release:
```bash
npm run typecheck
npm test
npm run build
```

Then verify:
- README image links exist and render.
- Codename references match across `README.md`, `docs/ROADMAP.md`, `CHANGELOG.md`.
- `CHANGELOG.md` heading format remains consistent.
