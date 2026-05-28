#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

GODOT="${GODOT:-godot}"
SEED="${SMOKE_SEED:-12345}"
OUTPUT="${SMOKE_OUTPUT:-/tmp/smoke_result.json}"

if ! command -v "$GODOT" >/dev/null 2>&1; then
  echo "Godot not found. Set GODOT to your Godot 4 binary." >&2
  exit 127
fi

echo "== GUT integration tests =="
"$GODOT" --headless --path "$ROOT" -s addons/gut/gut_cmdln.gd \
  -gdir=res://tests/integration \
  -gexit \
  -ginclude_subdirs

echo "== Demo smoke runner (seed=$SEED) =="
"$GODOT" --headless --path "$ROOT" -s res://scripts/demo_smoke_runner.gd \
  -- --seed="$SEED" --output="$OUTPUT"

echo "Smoke result:"
cat "$OUTPUT"
echo ""
echo "All checks passed."
