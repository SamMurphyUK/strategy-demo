# Engine port plan

Port the rules in `core/` and `rules/` into framework-agnostic TypeScript under `src/engine/`. The Vitest suite is a 1:1 port of the GUT tests that exist today. Do not port scenes, the map editor, UI scripts, or the GUT addon.

No Godot files were changed to produce this plan.

## What was actually audited

`tests/**/*.gd` contains **142** `func test_*` methods across 45 files. That is the suite to port. It is not ~1,100 tests. Do not invent the missing cases. If a rule is only described in `data/units.json` `special` and no test or engine branch implements it, list it as a gap and leave it unimplemented until a test is written in both trees.

Headless GUT tests that boot `GameScene.tscn` (`test_scene_smoke.gd`, `test_session_adapter_integration.gd`, inspector visibility, region stack counts) are scene tests. Port their command and snapshot assertions. Do not port Control nodes, CanvasLayers, or drag widgets.

## Target layout

```
src/engine/
  model/          GameState, Region, UnitType, UnitStack, Faction, Command, GameEvent
  rng/            Pcg
  content/        loadScenario()
  turn/           TurnEngine
  economy/        EconomyEngine
  movement/       MovementEngine, MovementValidator
  transport/      TransportLoadValidator, cargo on transport_instances
  air/            PlaneLandingDependencySolver, CarrierConstraintChecker
  combat/         CombatEngine
  placement/      PlacementEngine, PlacementValidator, PurchaseValidator
  amphibious/     AmphibiousEngine
  victory/        VictoryEngine
  rules/          Ruleset
  session/        GameSession, GameSessionStub, GameSessionAdapter
tests/engine/     vitest files, same names as tests/**/*.gd
```

Rules code must not import React, the DOM, Canvas, or Web Audio. `migration/playground_contract.ts` is the shared type surface. The engine should satisfy those interfaces. The playground stubs them.

Public session boundary stays `applyCommand(cmd) -> { result_type, error?, events, new_state }`, matching `GameSession.apply_command`.

## Port order

Each module is done only when its listed Vitest file is green against the TypeScript engine, using the same seeds and the same expected event types as the GUT file.

### 1. PCG

Source: `core/rng/pcg.gd`.

Port `PCG` bit for bit. Multiplier `6364136223846793005`. State is masked with `0x7FFFFFFFFFFFFFFF`. `nextInt`, `rollD6` (rejection sampling), `getState`, `fromSeed`.

Use a `bigint` implementation. JavaScript `number` cannot hold the 64-bit multiply.

Tests: `tests/core/test_pcg.gd` (6).

Gap: `CombatEngine._roll_hits` does **not** call `roll_d6()`. It uses `(rng.next_int() % 6) + 1`. Port that path separately and do not "fix" it during the port. `tests/core/test_determinism.gd` and `tests/integration/test_determinism.gd` lock the current stream.

### 2. Model and content

Sources: `core/model/game_state.gd`, `region.gd`, `unit.gd`, `faction.gd`, `command.gd`, `event.gd`, `core/engine/content_loader.gd`, `data/units.json`, `data/scenarios/`.

State fields to keep, names unchanged:

`game_round`, `current_faction_id`, `current_phase`, `turn_number`, `unit_types`, `factions`, `regions`, `adjacency`, `turn_order`, `rules`, `region_units`, `ipc`, `pending_purchases`, `pending_amphibious_assaults`, `factories_controlled_at_turn_start`, `next_instance_id`, `transport_instances`, `game_over`, `winner_faction_id`, `units_arrived_this_phase`, `units_embarked_this_phase`, `instances_moved_this_phase`.

Region is one type with `type: "land" | "sea"`. Do not split storage into two maps. `Territory` and `SeaZone` in the playground contract are that same object with a narrowed `type`.

`region_units` values are stacks `{ faction_id, unit_type_id, count }` or container instances that also have `instance_id`. Cargo lives on `transport_instances[id].cargo`, not on the stack.

`toSnapshot()` matches `GameState.to_snapshot`: `turn_info` wraps faction, phase, and turn number. The playground `GameState` is the live object, not the snapshot.

JSON unit key `move` becomes `movement` on `UnitType`, which is what `Unit.from_dict` already does.

Tests: `tests/core/test_game_state.gd` (10), `tests/core/test_content_loader.gd` (3).

### 3. Phase state machine

Source: `core/engine/turn_engine.gd`, `core/phases/end_phase_controller.gd`, `core/phases/end_turn_phase_controller.gd`, `core/phases/start_turn_phase_controller.gd`.

Phase order is fixed:

`purchase`, `combat_move`, `combat`, `noncombat_move`, `mobilize`, `collect_income`.

`advancePhase` steps one phase. It does not wrap. `endTurn` emits `turn_ended`, advances `turn_order`, increments `turn_number`, increments `game_round` when the order wraps back to index 0, sets phase to `purchase`, clears movement tracking, and records `factories_controlled_at_turn_start`.

Movement tracking clears when entering `combat_move` from `purchase`, and when leaving `noncombat_move`.

Leaving `combat` runs amphibious resolution (currently a clear) and then `CombatEngine.resolve_all_battles`. Leaving `mobilize` runs `PlacementEngine.check_forfeited`.

`getLegalCommands` in `core/engine/game_session.gd` is the phase allow-list:

| Phase | Commands |
| --- | --- |
| purchase | `purchase_units`, `end_phase` |
| combat_move | `move_units`, `load_transport`, `designate_amphibious`, `end_phase` |
| combat | none from `GameSession`; stub adds `strategic_bomb` |
| noncombat_move | `move_units`, `load_transport`, `unload_transport`, `end_phase` |
| mobilize | `place_units`, `end_phase` |
| collect_income | `end_turn` |

Wrong faction or wrong phase returns `result_type: "error"`.

Tests: `tests/core/test_turn_engine.gd` (8), `tests/core/test_game_session.gd` (2), `tests/integration/test_end_turn_switch.gd` (1), `tests/integration/test_full_turn.gd` (5), `tests/core/test_full_turn.gd` (5), `tests/integration/test_session_stub_endphase.gd` (1).

The two `test_full_turn.gd` files are not duplicates to merge. Port both. They exercise session vs core setup.

### 4. IPC economy

Source: `core/engine/economy.gd`, `core/validation/purchase_validator.gd`, `core/phases/purchase_phase_controller.gd`.

`calculateIncome` sums `ipc_value` of land regions owned by the faction. Sea zones and enemy land add nothing.

`processPurchase` accepts `payload.purchases` or `payload.units`. Each line is `{ unit_type_id, count }`. Cost is `UnitType.cost * count`. Failure emits `purchase_failed` with `reason: "insufficient_ipc"` and does not change IPC. Success subtracts IPC, replaces `pending_purchases[faction]`, and emits `units_purchased`. Purchase does not spawn units.

Tests: `tests/core/test_economy.gd` (8), `tests/validator/test_purchase_validator.gd` (1), `tests/integration/test_purchase_affordability.gd` (1), `tests/integration/test_purchase_staging.gd` (1), `tests/integration/test_session_stub_purchase.gd` (1), plus the purchase cases inside `tests/integration/test_session_stub_rules.gd`.

### 5. Adjacency and movement validation

Sources: `core/engine/movement.gd`, `core/validation/movement_validator.gd`, `rules/ruleset.gd`.

Graph is `adjacency[region_id] -> string[]`, mirrored on `Region.adjacent`. `is_adjacent` is membership in that list. Polygon adjacency used by the map editor (`GameSceneSessionBuilder`, 5px shared vertices) is content import, not a rule. `tests/integration/test_demomap_adjacency.gd` (1) stays a content test: Burma has neighbors after load. Do not reimplement polygon matching inside `src/engine`.

Validator rules already tested:

- Land units do not enter sea regions. Sea units do not path through land.
- Range is `UnitType.movement` via flood fill on `adjacency`.
- Noncombat moves cannot enter a hostile region. Combat moves can.
- A stack that arrived this phase cannot move again. Key is `faction|region|unit_type`.
- Embarked stacks are also subtracted (`units_embarked_this_phase`).
- Container instances move once (`instances_moved_this_phase`).
- Sea units with move 2 can cross two sea zones (`tests/validator/test_sea_unit_rules.gd`).

`commitMove` transfers stacks or instances and emits `units_moved`. Instance moves update `transport_instances[id].region_id`.

Tests: `tests/core/test_movement.gd` (8), `tests/validator/test_movement_validator.gd` (5), `tests/integration/test_session_stub_move_once.gd` (1), sea-movement cases in `tests/validator/test_sea_unit_rules.gd` (2 of 4).

Known gaps, do not implement just because `special` mentions them: blitz, mech-with-tank, artillery attack boost. No GUT test covers them and `MovementEngine` ignores them.

### 6. Transport, carrier, and plane landing

Sources: `core/validation/transport_load_validator.gd`, `core/validation/plane_landing_dependency_solver.gd`, `core/validation/carrier_constraint_checker.gd`, `core/engine/movement.gd` load and unload.

Load: friendly transport in an adjacent sea zone, cargo type allowed, capacity not exceeded, unit has not already moved. Transport capacity is 2 slots (`max_cargo_slots`), one infantry plus one other land unit in the unit `special` block. Emit `transport_loaded`. Record embark on the source stack.

Unload: remove cargo, add a land stack in `to_region_id`, emit `transport_unloaded`.

Carrier: `fighter_capacity: 2`. Noncombat validation must reject a plane with no legal landing (friendly land or a carrier that can host it). `tests/validator/test_carrier_constraint_checker.gd` (1) is the lock.

Tests: `tests/validator/test_transport_load_validator.gd` (2), `tests/integration/test_session_stub_ship_move_load.gd` (2), `tests/integration/test_amphibious.gd` (2), `tests/integration/test_inspector_cargo_display.gd` (3, cargo summary only), carrier test above, load and unload cases in `tests/core/test_movement.gd`.

Gaps: scramble, submerge, and "cannot hit air" are data-only.

### 7. Combat and casualty math

Source: `core/engine/combat.gd`, `core/phases/battle_phase_controller.gd`.

A battle exists where the active faction has a combat unit (attack or defense greater than 0) in a region that also has an enemy combat unit. Transports (0/0) are not combat units. Sea regions are `battle_type: "naval"`, land regions `"land"`.

Each round, every unit rolls `(nextInt() % 6) + 1` once per `count`. Attack uses `attack`, defense uses `defense`. Hit when roll is less than or equal to that stat. Then both sides take casualties simultaneously, cheapest `cost` first. Remove stacks at count 0.

Stop when one side has no combat units, or after 100 rounds. Results: `attacker_won`, `defender_won`, `mutual_destruction`, `draw`. Attacker win on land sets `owner_faction_id`. Sea wins do not change ownership.

Events: `battle_started`, `dice_rolled` `{ region_id, round, attacker_hits, defender_hits }`, `battle_finished` `{ region_id, result, rounds }`.

`resolveCombatRound` in the playground contract is one loop body so the canvas can animate. The engine method to port first is `resolveAllBattles`, because that is what `end_phase` calls and what the tests assert. A round-stepping API can wrap the same function after those tests are green. Do not change casualty order or the die formula to match `PCG.roll_d6`.

Strategic bomb is only on `GameSessionStub`: during `combat`, one bomber at a hostile factory region, damage `(nextInt() % 6) + 1` subtracted from the owner's IPC, bomber count reduced by 1. Port it with the stub tests, not as part of `CombatEngine`.

Tests: `tests/core/test_combat.gd` (10), both determinism files (2 + 2), bomb coverage if present in stub rules tests.

Gaps with no combat branch and no test: artillery boosting infantry to 2, tank and tactical bomber pairing, submarine surprise strike and submerge, destroyer cancelling submarines, battleship two hits, cruiser and battleship shore bombardment, antiair. Leave the `special` dictionary on `UnitType` so data still round-trips. Do not apply those modifiers until a new test specifies them.

### 8. Mobilize and placement

Sources: `core/engine/placement.gd`, `core/validation/placement_validator.gd`, `core/phases/place_units_phase_controller.gd`.

`place_units` payload is `{ placements: [{ region_id, units: [{ unit_type_id, count }] }] }`. Each line consumes `pending_purchases` incrementally. Emit `units_placed`. Transports created by placement get an `instance_id` from `generate_instance_id` (`unitType_faction_###`) and a `transport_instances` entry.

Land units place at a factory the faction owned at turn start and still owns. Sea units place in a sea zone adjacent to such a factory, not on the factory land region. Enemy regions are rejected. Factory capacity is `ipc_value` of the factory region (`PlacementValidator._get_factory_capacity`).

Ending mobilize with leftover pending purchases forfeits them. `PlacementEngine.check_forfeited` emits `placement_forfeited` with `reason: "factory_lost"` when a turn-start factory is no longer owned. The stub also forfeits unplaced units at mobilize end (`reason: "unplaced_at_mobilize_end"`) and records `ipc_lost`. Port both behaviors; they are different tests.

Tests: `tests/core/test_placement.gd` (7), `tests/validator/test_placement_validator.gd` (1), `tests/validator/test_sea_unit_rules.gd` (mobilize cases), `tests/integration/test_session_stub_place.gd` (2), `tests/integration/test_session_stub_sea_mobilize.gd` (2), `tests/integration/test_pending_purchases_and_place.gd` (1), `tests/integration/test_mobilize_forfeit.gd` (1), `tests/integration/test_mobilize_drag_place.gd` (1).

### 9. Amphibious and victory

Sources: `core/engine/amphibious.gd`, `core/engine/victory.gd`.

`designate_amphibious` appends `{ assault_id, transport_instance_id, origin_sea_zone_id, target_region_id, cargo }` and emits `amphibious_declared`. `assault_id` is `amp_###` from the current list length. `resolve_assaults` currently clears `pending_amphibious_assaults` and returns no events. Port that. Do not invent a landing battle.

Victory: if one faction owns every region with `is_capital`, set `game_over`, `winner_faction_id`, emit `game_finished` with `reason: "all_enemy_capitals_captured"`. A second check returns no events.

Tests: `tests/integration/test_amphibious.gd` designate case, `tests/core/test_victory.gd` (5).

### 10. Session facade and events

Sources: `core/engine/game_session.gd`, `core/engine/GameSessionStub.gd`, `core/engine/GameSessionAdapter.gd`, `core/validation/command_validator.gd`, `core/validation/event_schema_validator.gd`, `core/model/event.gd`.

One `applyCommand` switch on `Command.type`, matching `game_session.gd` lines 105-192. Phase controllers are thin. Inline them in the session module unless a test imports them by name. None of the GUT tests instantiate a phase resource except through the session.

Event shape: `{ event_id: "e_%05d", sequence, type, payload }` with type strings from `GameEvent.Type.keys()` lowercased. Adapter normalization (`tests/integration/test_session_adapter_normalization.gd`, `test_adapter_normalization.gd`, `test_event_schema.gd`) must keep the canonical event object. Duplicate `command_id` on the stub returns the prior result (`test_session_stub_rules.gd`).

Income collection on the stub happens inside end-turn (`tests/integration/test_session_stub_collect_income.gd`). The core `EconomyEngine.collect_income` is what that call uses. Wire end-turn to it so both the core economy tests and the stub end-turn test pass.

Tests remaining: `tests/integration/test_session_stub_rules.gd` (8), `tests/integration/test_event_schema.gd` (4), adapter tests (3 + 1 + 2), `tests/integration/test_session_stub_collect_income.gd` (1).

Scene smoke and inspector tests (`test_scene_smoke.gd`, `test_region_inspector_visibility.gd`, `test_region_stack_counts.gd`, `test_region_unit_display.gd`) assert snapshot and display grouping. Port `RegionUnitDisplay` grouping (owned region shows that owner's stacks; hostile region does not merge friendly and enemy) into `src/engine/presentation/region_unit_display.ts` only if those assertions are pure. Drop anything that needs a Godot node.

## Vitest mapping

| GUT | Vitest |
| --- | --- |
| `extends GutTest` | plain `describe` |
| `assert_eq` | `expect(a).toEqual(b)` |
| `assert_true` / `assert_false` | `toBe(true)` / `toBe(false)` |
| `assert_gt` | `toBeGreaterThan` |
| `assert_has` / array membership | `toContain` |
| `before_each` | `beforeEach` |
| Godot `Dictionary` key order | compare objects by field, not by JSON string, except event schema tests that already parse JSON |

File names stay `test_<same>.test.ts`. One GUT file, one Vitest file, same function names. A port is done when the count of `it` blocks equals the count of `func test_*` in the source file.

Run order for CI: pcg, game state, content, turn, economy, movement, transport, combat, placement, victory, session, then integration. Determinism tests run last in their group so a die-formula drift fails in one place.

## Explicit non-goals

- `scripts/MapEditor.gd`, border brush, map JSON editor.
- `scenes/game_scene.gd` camera, HUD, drag controller, unit icons.
- `addons/gut/**`.
- ComfyUI pixel-art workflows.
- Unimplemented unit `special` flags listed in sections 5 and 7.

## Suggested first milestone

Modules 1 through 4, plus `applyCommand` for `purchase_units`, `end_phase`, and `end_turn` only. That covers 10 + 3 + 8 + 8 + 2 state and economy tests and the purchase half of the stub, and it gives the playground a real `advancePhase` and `purchaseUnits` behind `MOCK_INITIAL_STATE` without waiting on combat.
