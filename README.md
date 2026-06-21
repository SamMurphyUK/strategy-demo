# Strategy Demo

[![GUT CI](https://github.com/SamMurphyUK/strategy-demo/actions/workflows/gut-ci.yml/badge.svg)](https://github.com/SamMurphyUK/strategy-demo/actions/workflows/gut-ci.yml)

Godot 4 turn-based strategy demo — Axis & Allies–style region control, IPC economy, unit purchase, movement, combat, and mobilization. Authoritative rules live in `res://core/`; Godot UI in `res://scenes/` and `res://scripts/`.

## Quick start

1. Open the project in **Godot 4.3+**.
2. Run `res://scenes/GameScene.tscn` (F6).
3. Use purchase, **End Phase**, mobilize drag-place, and region selection to exercise the loop.
4. Press **F1** to toggle debug HUD / Inspector overlays.

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

## Related policy docs

- [DEBUG_RULES.md](DEBUG_RULES.md) — debugging policy (no per-frame prints, F1 overlays)
- [docs/event_schema.json](docs/event_schema.json) — event wire shapes

---

# Game invariants

This section is the authoritative contract for **`res://core/`** (rules, state, commands, events, validators, RNG).

Assume all of this is true when working on engine code, tests, and session adapters.

For Godot presentation (`res://scenes/`, `res://scripts/`, `res://debug/`), see **Presentation layer** below. UI may stage or display differently, but **must not mutate authoritative state except through commands**.

## Scope

| Layer | Path | Strictness |
|-------|------|------------|
| **Core (law)** | `res://core/` | Follow every invariant below |
| **Presentation (pragmatic)** | `res://scenes/`, `res://scripts/`, `res://debug/` | May stage UI state; session is authoritative on confirm |
| **Policy** | `DEBUG_RULES.md` | Debug overlays and logging only |

**Game type:** Turn-based, region-control, IPC economy, unit purchase, movement, combat, mobilization/placement.

**Turn phases** (`TurnEngine.PHASES`):

`purchase` → `combat_move` → `combat` → `noncombat_move` → `mobilize` → `collect_income`

## Identity rules

### Type identifiers → `String`

Always use `String` for stable catalog/world keys:

| Concept | Field | Example |
|---------|-------|---------|
| Unit type | `unit_type_id` | `"infantry"`, `"tank"`, `"carrier"` |
| Region | `region_id` / `Region.id` | `"region_1"`, `"sea_1"` |
| Faction | `faction_id` / `Faction.id` | `"allies"`, `"axis"` |
| Command actor | `player_id` | Same as faction id for that command |

### Instance identifiers → hybrid model

The depot uses **two board representations**, not a single global int-id model:

| Representation | When | Shape |
|----------------|------|-------|
| **Stack entry** (default) | Most land/sea units (infantry, tanks, etc.) | `{ faction_id, unit_type_id, count }` — no per-piece id |
| **String instance** | Containers/transports, cargo tracking | `instance_id: String` e.g. `"infantry_allies_001"` via `GameState.generate_instance_id()` |
| **Int instance** | Plane/carrier movement validation paths | `unit_id: int` on `CombatMove` / `NonCombatMove`; `GameState.get_unit(id: int)` |

**Rules:**

- Do **not** give every stack unit a unique int id unless the rules require per-unit tracking.
- Transports and container logic **must** use `instance_id: String` and `state.transport_instances`.
- Validators that move fighters/planes use `unit_id: int` and `get_unit_region(plane_id)`.
- Never compare a region id to a number. Never use faction id where unit type id is expected.

### `Unit` is a type catalog entry, not a board instance

`Unit` describes a **unit type definition**, not a piece on the map.

```gdscript
# core/model/unit.gd — type catalog
var id: String          # unit TYPE id (same as unit_type_id everywhere else)
var name: String
var category: String    # "land", "air", "sea"
var attack: int
var defense: int
var movement: int
var cost: int
```

Combat unit: `u.attack > 0 or u.defense > 0`.

Board presence lives in `state.region_units` entries, not in `Unit` objects.

## Godot preload rule

When loading a custom class:

- **Do not** type the `preload()` result as the class.
- **Do** type the variable you create from it.

```gdscript
const VT := preload("res://core/validation/validation_types.gd")
var result: VT.ValidationResult = VT.ValidationResult.new()

const DraggableStagedIconScript := preload("res://scripts/draggable_staged_icon.gd")
var icon: DraggableStagedIcon = DraggableStagedIconScript.new()
```

## Region model

```gdscript
# core/model/region.gd
var id: String
var name: String
var type: String              # "land" or "sea"
var ipc_value: int
var owner_faction_id: String  # faction id or "" if unowned
var is_capital: bool
var has_factory: bool
var adjacent: Array[String]   # loaded from content; see adjacency below
```

Helpers:

- `region.is_land_region()` → `type == "land"`
- `region.is_sea_region()` → `type == "sea"`

**Adjacency:** Canonical graph is `GameState.adjacency: Dictionary[String, Array]`. Prefer `state.get_adjacent_regions(region_id)` and `state.is_adjacent(from, to)`. `Region.adjacent` may exist from content load but engines should use `GameState.adjacency`.

## Faction model

```gdscript
# core/model/faction.gd
var id: String
var name: String
var color: String             # hex
var starting_ipc: int
var turn_order: int           # used by content loader
```

Demo content uses `"allies"` / `"axis"`; tests may use `"red"` / `"blue"`. All are valid `String` faction ids.

## GameState

`GameState` holds the entire authoritative snapshot.

| Field | Type | Notes |
|-------|------|-------|
| `unit_types` | `Dictionary` | Key: `unit_type_id` (String) → `Unit` |
| `regions` | `Dictionary` | Key: `region_id` (String) → `Region` |
| `factions` | `Dictionary` | Key: `faction_id` (String) → `Faction` |
| `ipc` | `Dictionary` | Key: `faction_id` → current IPC total |
| `region_units` | `Dictionary` | Key: `region_id` → `Array` of unit entries |
| `pending_purchases` | `Dictionary` | Key: `faction_id` → `Array` of purchase lines |
| `adjacency` | `Dictionary` | Key: `region_id` → adjacent region ids |
| `transport_instances` | `Dictionary` | Key: `instance_id` (String) → transport state |
| `current_faction_id` | `String` | Active faction |
| `current_phase` | `String` | Active phase name |

**Canonical IPC accessor:** `state.get_faction_ipc(faction_id: String) -> int`

**IPC mutation:** Should occur only through economy/placement engines and session command handling — not from UI directly.

### `region_units` entry shapes

**Stack entry (default):**

```gdscript
{
  "faction_id": String,
  "unit_type_id": String,
  "count": int
}
```

**Container / transport entry:**

```gdscript
{
  "faction_id": String,
  "unit_type_id": String,
  "count": 1,
  "instance_id": String    # links to state.transport_instances
}
```

Entries may be accessed as dictionaries (`entry["faction_id"]`) or with dot notation in GDScript (`entry.faction_id`). Prefer explicit `str(entry.get(...))` at boundaries.

### Snapshot serialization (`to_snapshot()`)

Wire/snapshot format wraps turn fields:

```gdscript
{
  "turn_info": {
    "current_faction_id": String,
    "current_phase": String,
    "turn_number": int
  },
  "regions": [{ "region_id", "owner_faction_id", "units": [...] }],
  "ipc": { ... },
  "pending_purchases": { ... },
  ...
}
```

UI and adapters read `turn_info`; core engines use flat `state.current_phase` / `state.current_faction_id`.

## Command model

```gdscript
# core/model/command.gd
var command_id: String
var player_id: String       # faction id for this command
var faction_id: String      # defaults to player_id when parsed
var type: Command.Type      # enum internally
var payload: Dictionary
```

**Wire / JSON:** `type` is a **string** (e.g. `"purchase_units"`, `"place_units"`, `"move_units"`, `"end_phase"`). `Command.from_dict()` parses string → enum.

**Purchase payload** (`type == purchase_units`):

```gdscript
cmd.payload.purchases: Array
# each entry: { "unit_type_id": String, "count": int }
```

Economy also accepts legacy `payload.units` with the same entry shape.

**Authoritative path:** UI → `session.apply_command(cmd)` → engines → `GameState` + `GameEvent[]`. Do not skip this for gameplay mutations in core tests.

## GameEvent model

```gdscript
# core/model/event.gd
var event_id: String        # e.g. "e_00001"
var sequence: int           # strictly increasing per engine via _next_seq()
var type: GameEvent.Type
var payload: Dictionary
```

Factory: `GameEvent.create(type, payload, sequence) -> GameEvent`

### Event types (current set)

| Type | Typical payload keys |
|------|----------------------|
| `PHASE_CHANGED` | `faction_id`, `new_phase` |
| `INCOME_COLLECTED` | `faction_id`, `amount`, `new_total` |
| `UNITS_PURCHASED` | `faction_id`, `units`, `cost` |
| `PURCHASE_FAILED` | `faction_id`, `reason` |
| `UNITS_PLACED` | `faction_id`, `placements` |
| `PLACEMENT_FORFEITED` | `faction_id`, ... |
| `UNITS_MOVED` | `faction_id`, `moves` |
| `TRANSPORT_LOADED` / `TRANSPORT_UNLOADED` | `transport_instance_id`, regions, units |
| `AMPHIBIOUS_DECLARED` / `AMPHIBIOUS_CANCELLED` | assault/transport ids |
| `BATTLE_STARTED` | `region_id`, `attacker`, `defender` |
| `DICE_ROLLED` | roll details |
| `UNITS_DESTROYED` / `CARGO_DESTROYED` | casualty details |
| `BATTLE_FINISHED` | battle outcome |
| `REGION_CAPTURED` | region, new owner |
| `TURN_ENDED` | `faction_id`, `turn_number`, `game_round` |
| `GAME_FINISHED` | winner |

## EconomyEngine

```gdscript
class_name EconomyEngine
extends RefCounted
var state: GameState
var _seq: int
```

- `calculate_income(faction_id)` — sum `ipc_value` of owned **land** regions
- `collect_income(faction_id)` — updates `state.ipc`, emits `INCOME_COLLECTED`
- `process_purchase(cmd)` — uses `cmd.player_id` as faction; validates IPC; stores lines in `state.pending_purchases[faction_id]`; emits `UNITS_PURCHASED` or `PURCHASE_FAILED`
- `can_afford(faction_id, unit_type_id, count)` — lookup via `state.unit_types[unit_type_id]`

## CombatEngine

```gdscript
class_name CombatEngine
extends RefCounted
var state: GameState
var rng: PCG
var _seq: int
```

- `_identify_battles(attacker_faction_id)` → battle dicts: `region_id`, `attacker_faction_id`, `defender_faction_id`, `battle_type` (`"land"` | `"naval"`)
- `_get_combat_units(region_id, faction_id)` — entries where type has `attack > 0 or defense > 0`
- Hit roll: `(rng.next_int() % 6) + 1` (equivalent family to `PCG.roll_d6()`)
- `_apply_casualties` — sort by `Unit.cost` ascending, remove cheapest first
- Land capture when attackers remain and defenders do not

## Plane landing & carriers

- `PlaneLandingDependencySolver` — air category units; `unit_id: int` on moves
- Carrier detection: `unit_type_id in ["carrier", "aircraft_carrier"]`
- Capacity: `carrier_count * 2` vs planes in region for that faction
- `carrier_constraint_checker` — ensures carrier moves don't strand fighters

## PCG (RNG)

```gdscript
class_name PCG
extends RefCounted
```

- `next_int() -> int` — 32-bit; use this or `roll_d6()`, not `randi()` in core
- `roll_d6() -> int` — uniform 1–6
- `get_state() -> Dictionary` — `{ "state", "sequence" }`
- `static from_seed(seed_dict) -> PCG`

Combat currently uses `next_int() % 6 + 1`; both are deterministic if PCG state is preserved.

## Presentation layer (non-core)

These are **allowed** in `scenes/` / `scripts/` but are **not** engine invariants:

| Pattern | Example | Rule |
|---------|---------|------|
| UI staging | `game_scene.ui_pending_purchases` | OK before confirm; flush via `purchase_units` command |
| Snapshot nesting | `turn_info.current_phase` | Read for display; core uses `state.current_phase` |
| Godot nodes | `DragLayer`, `MobilizeLayer`, `DebugRoot` | No direct `GameState` mutation |
| Session type | `GameSessionStub` extends `RefCounted` | Pass as `Variant` to debug tools, not `Node` |
| Map scene paths | `layer = 0/Camera2D`, `layer = 0/MapRoot` | Not `$Camera2D` at scene root |
| Debug | F1 overlays under `res://debug/` | Per `DEBUG_RULES.md` — no per-frame prints |

**Drag pipeline (presentation):** `DraggableStagedIcon` → `DragController` → `mobilize_drop_requested` / `movement_drop_requested` → `game_scene` → `session.apply_command`.

## What to enforce strictly vs loosely

### Enforce strictly (core)

- Type ids are always `String`
- Commands mutate state; events record outcomes
- `pending_purchases` / `region_units` / `ipc` shapes
- Phase gating in validators and session
- RNG via `PCG` for determinism
- Stack vs `instance_id` rules for transports
- **Movement budget:** each stack unit may move once per movement window (`combat_move` + `noncombat_move`). Track arrivals in `GameState.units_arrived_this_phase`; reset when entering `combat_move` or leaving `noncombat_move`.
- **Mobilize:** land units at owned factory regions; sea units in sea zones adjacent to a faction factory (not on the factory land region).
- **Sea movement:** sea units traverse sea zones only (no land shortcuts); range from unit type (default 2 for ships).

### Allow looseness (presentation)

- UI layout, camera pan/zoom, drag preview coordinates
- Staging purchases before confirm
- Debug overlays and event-based console logging
- Godot-specific node paths and `CanvasLayer` settings

## Drift prevention

1. **Change `core/`** → update this section and add/adjust tests under `res://tests/`.
2. **Change UI only** → do not change invariants; document in scene comments if needed.
3. **New event or command type** → add to tables above and to `Command` / `GameEvent` enums.
4. **New unit identity need** → choose stack vs `instance_id` vs `unit_id: int` explicitly; do not default to global int ids.
