# Strategy Demo

[![GUT CI](https://github.com/SamMurphyUK/strategy-demo/actions/workflows/gut-ci.yml/badge.svg)](https://github.com/SamMurphyUK/strategy-demo/actions/workflows/gut-ci.yml)

Godot 4 turn-based strategy demo with a controller-driven game session stub, UI integration via `GameScene.tscn`, and GUT tests.

## Quick start

1. Open the project in **Godot 4.3+**.
2. Run `res://scenes/GameScene.tscn` (F6).
3. Use **Spawn Infantry**, **End Phase**, and region selection to exercise purchase → mobilize → place.

See [docs/DEMO.md](docs/DEMO.md) for factory modes, event schema, and migration notes.

## Running tests locally

Requires Godot 4 on your `PATH` as `godot` (or set `GODOT`).

```bash
# Full integration suite + headless smoke
./tools/run_demo_smoke.sh

# GUT only
godot --headless --path . -s addons/gut/gut_cmdln.gd \
  -gdir=res://tests/integration -gexit -ginclude_subdirs

# Smoke runner only (writes JSON result)
godot --headless --path . -s res://scripts/demo_smoke_runner.gd \
  -- --seed=12345 --output=/tmp/smoke_result.json
```

## CI

Every push/PR runs `.github/workflows/gut-ci.yml`:

- GUT integration tests under `res://tests/integration/`
- Headless demo smoke via `scripts/demo_smoke_runner.gd`

A nightly job runs the smoke script with seed `99999` to catch non-deterministic regressions.
