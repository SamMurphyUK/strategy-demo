# Demo session (controller-driven stub)

## Overview

`GameSessionFactory` selects between a lightweight demo stub and the full rules engine:

| Mode | Class | Use |
|------|--------|-----|
| `STUB` (default) | `GameSessionStub` | UI demo, deterministic GUT tests |
| `FULL` | `GameSession` via `GameSceneSessionBuilder` | Full scenario from `newmap.json` |

`GameScene` uses `GameSessionFactory.Mode.STUB` by default.

## Toggle factory mode

In `res://scenes/game_scene.gd`:

```gdscript
session = GameSessionFactory.create(GameSessionFactory.Mode.STUB)  # demo
# session = GameSessionFactory.create(GameSessionFactory.Mode.FULL)  # full engine
```

Or from code:

```gdscript
var session = GameSessionFactory.create(GameSessionFactory.Mode.FULL)
```

## Command / state API

Both stub and full session expose:

- `apply_command(cmd: Dictionary) -> Dictionary` with `result_type` (`ok` / `error`) and `events[]`
- `get_state() -> Dictionary` (snake_case snapshot: `turn_info`, `regions`, `ipc`, `pending_purchases`, `gameover`, …)
- `session.state` for UI helpers that read `GameState` directly

Event dict shape:

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

## Adapter

`GameSessionAdapter` wraps any session and normalizes event dictionaries (canonical `type` without underscores, `source_command_id`, `timestamp`).

```gdscript
var adapter := GameSessionAdapter.wrap(GameSessionFactory.create())
var result := adapter.apply_command({...})
```

## Running tests

```bash
godot --headless -s addons/gut/gut_cmdln.gd \
  -gdir=res://tests/integration -gexit -ginclude_subdirs
```

Integration tests under `res://tests/integration/`:

- `test_session_stub_purchase.gd`
- `test_session_stub_place.gd`
- `test_session_stub_endphase.gd`
- `test_session_adapter_integration.gd` (includes `GameScene.tscn` smoke test)

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
