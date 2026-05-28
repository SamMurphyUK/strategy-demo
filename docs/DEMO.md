# Demo session (controller-driven stub)

[![GUT CI](https://github.com/SamMurphyUK/strategy-demo/actions/workflows/gut-ci.yml/badge.svg)](https://github.com/SamMurphyUK/strategy-demo/actions/workflows/gut-ci.yml)

## Overview

`GameSessionFactory` selects between a lightweight demo stub and the full rules engine:

| Mode | Class | Use |
|------|--------|-----|
| `STUB` (default) | `GameSessionStub` | UI demo, deterministic GUT tests |
| `FULL` | `GameSession` via `GameSceneSessionBuilder` | Full scenario from `newmap.json` |

`GameScene` uses `GameSessionFactory.Mode.STUB` by default.

## Demo rules (stub)

- **IPC / costs**: `UNIT_COSTS` table; purchases rejected when IPC is insufficient (`PURCHASE_FAILED`, no `unitspurchased`).
- **Pending purchases**: tracked per faction in snapshot; merged across multiple purchase commands.
- **Placement**: validated against pending counts and region ownership/factory.
- **Mobilize forfeit**: ending mobilize with unplaced pending emits `placementforfeited` and clears pending.
- **Idempotency**: duplicate `command_id` returns the cached prior result without double-applying.
- **Determinism**: `initialize_demo(seed)` seeds RNG and fixed event timestamps for tests.
- **Snapshot extras**: `cost_table`, `applied_event_ids`, `pending_purchases`, `gameover` alias.

## Toggle factory mode

In `res://scenes/game_scene.gd`:

```gdscript
session = GameSessionFactory.create(GameSessionFactory.Mode.STUB)  # demo
# session = GameSessionFactory.create(GameSessionFactory.Mode.FULL)  # full engine
```

## Command / state API

Both stub and full session expose:

- `apply_command(cmd: Dictionary) -> Dictionary` with `result_type` (`ok` / `error`) and `events[]`
- `get_state() -> Dictionary` (snake_case snapshot)
- `session.state` for UI helpers that read `GameState` directly

### Event schema

Canonical events are defined in [docs/event_schema.json](event_schema.json):

```json
{
  "event_id": "e00001",
  "sequence": 1,
  "type": "unitspurchased",
  "payload": {},
  "source_command_id": "cmd1",
  "timestamp": 1680000000
}
```

Validate in tests with `EventSchemaValidator.validate_event(evt)`.

## Adapter

`GameSessionAdapter` wraps any session and normalizes event dictionaries (canonical `type` without underscores, `source_command_id`, `timestamp`).

```gdscript
var adapter := GameSessionAdapter.from_session(GameSessionFactory.create())
var result := adapter.apply_command({...})
```

## Running tests locally

```bash
./tools/run_demo_smoke.sh
```

Or individually:

```bash
# GUT integration tests
godot --headless --path . -s addons/gut/gut_cmdln.gd \
  -gdir=res://tests/integration -gexit -ginclude_subdirs

# Headless smoke (writes JSON)
godot --headless --path . -s res://scripts/demo_smoke_runner.gd \
  -- --seed=12345 --output=/tmp/smoke_result.json
```

### Integration test files

| File | Purpose |
|------|---------|
| `test_session_stub_purchase.gd` | IPC + purchase event |
| `test_session_stub_place.gd` | Placement consumes pending |
| `test_session_stub_endphase.gd` | Mobilize forfeit |
| `test_session_stub_rules.gd` | Idempotency, schema, affordability |
| `test_session_adapter_normalization.gd` | Adapter canonical output |
| `test_event_schema.gd` | JSON schema validation |
| `test_scene_smoke.gd` | `GameScene.tscn` headless flow |
| `test_session_adapter_integration.gd` | Adapter + scene smoke |

## CI

Workflow: `.github/workflows/gut-ci.yml`

- **On PR/push**: GUT integration suite + smoke runner (seed `12345`)
- **Nightly**: smoke runner with seed `99999`
- **On failure**: uploads `gut.log`, `smoke.log`, and `smoke_result.json`

## Manual demo checklist

1. Open `res://scenes/GameScene.tscn` and run (F6).
2. Confirm EventLog shows state after load.
3. Purchase phase: **Spawn Infantry** → `unitspurchased`, IPC −3.
4. **End Phase** until mobilize; select an owned factory region; **Spawn Infantry** to place.
5. Confirm `unitsplaced` in EventLog and unit icons on the map.

## Migration from direct `GameSession` / builder

Replace:

```gdscript
session = GameSceneSessionBuilder.create_session_from_newmap()
```

with:

```gdscript
session = GameSessionFactory.create(GameSessionFactory.Mode.STUB)
```

Use `Mode.FULL` when you need the unchanged full engine path.

## Purchase phase UI walkthrough

In `GameScene.tscn`, the right panel now includes:

- **Allies IPC / Axis IPC** labels
- **Unit Catalog** rows with a `+` buy button
- **Pending Purchases** rows (`unit_type x count (cost)`), row cancel for staged items, and pending total
- **Confirm Purchase** and **Cancel Pending** buttons
- **Event Log** showing canonical event dictionaries returned by `apply_command`

### Purchase flow

1. During `purchase` phase, use `+` buttons to stage purchases locally.
2. Click **Confirm Purchase** to send one `purchase_units` command with all staged entries.
3. End phases to `mobilize`, select a region, and place via **Spawn Infantry** (existing behavior).
4. End mobilize with leftover pending to trigger `placementforfeited`.

### Test commands

```bash
godot --headless --no-window --path . --import

godot --headless --no-window --path . --script res://addons/gut/gut_cmdln.gd -- \
  -gdir=res://tests/integration -gexit -ginclude_subdirs

godot --headless --no-window --path . --script res://scripts/demo_smoke_runner.gd -- \
  --seed=99999 --output=/tmp/smoke_result.json
```
