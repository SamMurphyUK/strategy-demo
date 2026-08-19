# AGENTS.md

## Cursor Cloud specific instructions

### Project Overview
This is a Godot 4.6 turn-based strategy war game ("Strategy Demo") using GDScript. It is a single Godot project with no backend, database, or external service dependencies. All game data is JSON-based (in `data/`).

### Prerequisites
- **Godot 4.6 stable** (`godot` binary) must be installed at `/usr/local/bin/godot`. The update script handles this automatically.
- **Xvfb** and Mesa GL libraries are needed for visual (non-headless) runs.

### Running Tests
All tests use the GUT (Godot Unit Testing) addon v9.6.0, already vendored in `addons/gut/`.

```
godot --headless -s addons/gut/gut_cmdln.gd -gdir=res://tests/ -ginclude_subdirs=true
```

Before first test run, you may need to import the project:
```
godot --headless --import
```

### Running the Game
- **Headless** (no display): `godot --headless --path .` (useful for running the main scene script)
- **Visual with Xvfb**: Start Xvfb, then run with `--rendering-method gl_compatibility` since the default Forward Plus renderer requires a real GPU:
  ```
  Xvfb :42 -screen 0 1920x1080x24 -ac &
  DISPLAY=:42 godot --path /workspace --rendering-method gl_compatibility scenes/DemoScene.tscn
  ```
- The main scene (`scan.tscn`) is a diagnostic script; the actual game demo is `scenes/DemoScene.tscn`.
- ALSA audio errors are expected and non-blocking in headless environments.

### Key Directories
- `core/` — Game logic (engine, model, validation, rng)
- `scripts/` — UI controllers
- `scenes/` — Godot scene files
- `data/` — JSON scenario data (demo + minimal scenarios)
- `tests/` — GUT test scripts (19 scripts, 85 tests, ~1333 assertions)
- `addons/gut/` — Vendored GUT test framework
