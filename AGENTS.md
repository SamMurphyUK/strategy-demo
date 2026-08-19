# AGENTS.md

## Cursor Cloud specific instructions

This is a **Godot 4.6 GDScript** turn-based strategy game ("Strategy Demo" / "Murphyland"). It has **no external dependencies** — no databases, no web servers, no package managers, no Docker.

### Godot Engine

- Godot 4.6 (stable) must be installed at `/usr/local/bin/godot`. The update script handles downloading and installing it if missing.
- The project uses **Forward Plus** rendering and **Jolt Physics**.

### Running Tests

All tests use **GUT (Godot Unit Testing) v9.6.0**, bundled in `addons/gut/`. Run the full test suite headlessly:

```bash
godot --headless --import --quit                # one-time: build .godot cache
GODOT_DISABLE_LEAK_CHECKS=1 godot --headless -d \
  --display-driver headless --audio-driver Dummy \
  --disable-render-loop --path . \
  -s res://addons/gut/gut_cmdln.gd \
  -gdir=res://tests -ginclude_subdirs -gexit
```

- The `--import --quit` step is required after a fresh clone (generates `.godot/` cache). It only needs to re-run when resources change significantly.
- `GODOT_DISABLE_LEAK_CHECKS=1` prevents engine shutdown leak warnings from polluting test exit codes.
- 21 test files across `tests/core/`, `tests/validator/`, `tests/integration/` (85 tests, ~1300+ assertions).

### Running the Application

Launch the demo scene (GUI required):

```bash
godot --path . res://scenes/DemoScene.tscn
```

The main scene configured in `project.godot` (`res://scan.tscn`) is a debug/diagnostic script that exits immediately — use `DemoScene.tscn` for the actual game UI.

Other runnable scenes: `scenes/MapEditor.tscn` (map editor).

### Gotchas

- ALSA audio errors are expected in headless/containerized environments and are harmless (Godot falls back to a dummy audio driver).
- The `.godot/` directory is `.gitignore`d and must be regenerated via `--import` after cloning.
- There is no linter for GDScript in this project. Godot's built-in parser catches syntax errors during `--import`.
