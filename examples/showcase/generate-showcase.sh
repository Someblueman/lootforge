#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MANIFEST_PATH="$REPO_ROOT/examples/showcase/retro-fantasy/manifest.json"
WORK_DIR="$REPO_ROOT/.tmp/showcase-0.2.0"
CLI=(node "$REPO_ROOT/dist/cli/index.js")

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "OPENAI_API_KEY is required to generate showcase visuals."
  exit 1
fi

if [[ ! -f "$MANIFEST_PATH" ]]; then
  echo "Missing showcase manifest: $MANIFEST_PATH"
  exit 1
fi

echo "Building CLI..."
(cd "$REPO_ROOT" && npm run build)

echo "Preparing workspace at $WORK_DIR"
rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR/showcase/before"

echo "Running initial pipeline..."
"${CLI[@]}" plan --manifest "$MANIFEST_PATH" --out "$WORK_DIR"
"${CLI[@]}" validate --manifest "$MANIFEST_PATH" --out "$WORK_DIR" --strict true
"${CLI[@]}" generate --out "$WORK_DIR" --provider openai
"${CLI[@]}" process --out "$WORK_DIR" --strict true
cp "$WORK_DIR/assets/imagegen/processed/images/hero-idle.png" "$WORK_DIR/showcase/before/hero-idle.png"
cp "$WORK_DIR/assets/imagegen/raw/dungeon-tile.png" "$WORK_DIR/showcase/before/dungeon-tile-raw.png"
"${CLI[@]}" atlas --manifest "$MANIFEST_PATH" --out "$WORK_DIR"
"${CLI[@]}" eval --out "$WORK_DIR" --strict true
"${CLI[@]}" review --out "$WORK_DIR"
"${CLI[@]}" select --out "$WORK_DIR"
cp "$WORK_DIR/checks/eval-report.json" "$WORK_DIR/showcase/before/eval-report-before.json"

echo "Running targeted regenerate edit loop..."
"${CLI[@]}" regenerate --out "$WORK_DIR" --provider openai --edit true --ids hero-idle \
  --preserve-composition false \
  --instruction "Transform this into a premium hero render for key art while keeping core identity. Increase silhouette readability, sharpen material separation, push dramatic torch rim-light, and make the rune blade glow more vivid."
"${CLI[@]}" process --out "$WORK_DIR" --strict true
"${CLI[@]}" atlas --manifest "$MANIFEST_PATH" --out "$WORK_DIR"
"${CLI[@]}" eval --out "$WORK_DIR" --strict true
"${CLI[@]}" review --out "$WORK_DIR"
"${CLI[@]}" select --out "$WORK_DIR"
"${CLI[@]}" package --manifest "$MANIFEST_PATH" --out "$WORK_DIR" --runtimes pixi,unity --strict false

echo "Building README showcase PNGs..."
node "$REPO_ROOT/examples/showcase/build-readme-images.mjs" \
  --out-dir "$WORK_DIR" \
  --dest-dir "$REPO_ROOT/docs/showcase/0.2.0"

echo "Showcase generation complete."
echo "- Working artifacts: $WORK_DIR"
echo "- README images: $REPO_ROOT/docs/showcase/0.2.0"
