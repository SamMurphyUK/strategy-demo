import { describe, expect, it } from "vitest";
import {
  fuelRemaining,
  isLanded,
  offeredMoveDestinations,
  planesMustLandMessage,
} from "../../../src/engine/air/air_fuel";
import { Command, CommandType } from "../../../src/engine/model/command";
import { applyRecordedMove, beginMovementPhase, commitCombatAttacks } from "../../../src/engine/movement/phase_orders";
import { MovementEngine } from "../../../src/engine/movement/movement";
import { MovementValidator } from "../../../src/engine/movement/movement_validator";
import type { GameState } from "../../../src/engine/model/game_state";
import { processEndPhase } from "../../../src/engine/turn/phase_controllers";
import { TurnEngine } from "../../../src/engine/turn/turn_engine";
import { TestStateBuilder } from "../helpers/test_state_builder";

function board(): GameState {
  const builder = new TestStateBuilder();
  builder
    .withRegion("home", true, "red")
    .withRegion("own", true, "red")
    .withRegion("enemy", true, "blue")
    .withRegion("past", true, "red")
    .withAdjacent("home", "own")
    .withAdjacent("home", "enemy")
    .withAdjacent("enemy", "past");
  builder.withUnitType("infantry", "land", 2);
  builder.withUnitType("fighter", "air", 4);
  builder.withStackUnit("infantry", "home", "red");
  builder.withStackUnit("fighter", "home", "red");
  builder.withStackUnit("infantry", "enemy", "blue");
  const state = builder.buildState();
  state.unit_types.fighter.special = { can_land_on_carrier: true };
  state.unit_types.fighter.name = "Fighter";
  state.current_faction_id = "red";
  state.current_phase = "combat_move";
  return state;
}

describe("air fuel and combat-move targets", () => {
  it("keeps enemy territory and drops friendly territory with no enemy units", () => {
    const state = board();
    const ruleset = new TestStateBuilder().buildRuleset();
    const validator = new MovementValidator();
    const infantry = validator.getLegalDestinationsForStack("home", "infantry", "red", state, ruleset);
    const fighters = validator.getLegalDestinationsForStack("home", "fighter", "red", state, ruleset);

    expect(infantry).toContain("enemy");
    expect(infantry).not.toContain("past");
    expect(fighters).toContain("enemy");
    expect(fighters).toContain("past");

    expect(offeredMoveDestinations(state, "combat_move", "red", "home", "infantry", infantry)).toEqual(["enemy"]);
    expect(offeredMoveDestinations(state, "combat_move", "red", "home", "fighter", fighters).sort()).toEqual(["enemy"]);

    builderEnemyOnOwn(state);
    const withEnemy = validator.getLegalDestinationsForStack("home", "infantry", "red", state, ruleset);
    expect(offeredMoveDestinations(state, "combat_move", "red", "home", "infantry", withEnemy).sort()).toEqual([
      "enemy",
      "own",
    ]);
  });

  it("spends fuel on the flight and keeps it for the landing", () => {
    const state = board();
    const ruleset = new TestStateBuilder().buildRuleset();
    beginMovementPhase(state);
    const movement = new MovementEngine(state);
    applyRecordedMove(state, move("home", "enemy"), movement);
    expect(state.air_movement_spent["red|enemy|fighter"]).toBeUndefined();
    expect(fuelRemaining(state, "red", "home", "fighter")).toBe(3);

    commitCombatAttacks(state);
    expect(fuelRemaining(state, "red", "enemy", "fighter")).toBe(3);
    expect(isLanded(state, "red", "fighter", "enemy")).toBe(false);
    expect(planesMustLandMessage(state, "red")).toContain("Fighter in enemy (3 fuel)");

    const turn = new TurnEngine(state);
    turn.advancePhase();
    expect(state.current_phase).toBe("combat");
    expect(state.units_arrived_this_phase["red|enemy|fighter"]).toBe(1);
    turn.advancePhase();
    expect(state.current_phase).toBe("noncombat_move");
    expect(state.units_arrived_this_phase["red|enemy|fighter"]).toBeUndefined();
    const back = new MovementValidator().getLegalDestinationsForStack("enemy", "fighter", "red", state, ruleset);
    const offered = offeredMoveDestinations(state, "noncombat_move", "red", "enemy", "fighter", back);
    expect(offered.sort()).toEqual(["home", "own", "past"]);
  });

  it("removes a plane that cannot reach a landing spot and leaves one that can", () => {
    const state = board();
    state.current_phase = "noncombat_move";
    state.region_units.home = state.region_units.home.filter((entry) => entry.unit_type_id !== "fighter");
    state.region_units.enemy.push({ faction_id: "red", unit_type_id: "fighter", count: 1 });
    state.air_movement_spent["red|enemy|fighter"] = 4;
    state.region_units.past.push({ faction_id: "red", unit_type_id: "fighter", count: 1 });

    processEndPhase("noncombat_move", state, new TurnEngine(state), null!, null!, null!, (events) => events);

    expect(state.current_phase).toBe("mobilize");
    const enemyFighters = (state.region_units.enemy ?? []).filter((entry) => entry.unit_type_id === "fighter");
    const pastFighters = (state.region_units.past ?? []).filter((entry) => entry.unit_type_id === "fighter");
    expect(enemyFighters).toEqual([]);
    expect(pastFighters).toEqual([{ faction_id: "red", unit_type_id: "fighter", count: 1 }]);
  });

  it("lets a fighter end noncombat on a friendly carrier and nowhere else at sea", () => {
    const builder = new TestStateBuilder();
    builder
      .withRegion("home", true, "red")
      .withRegion("neutral", true, "")
      .withRegion("open", false, "")
      .withRegion("deck", false, "")
      .withAdjacent("home", "neutral")
      .withAdjacent("home", "open")
      .withAdjacent("home", "deck");
    builder.withUnitType("fighter", "air", 4);
    builder.withUnitType("tactical_bomber", "air", 4);
    builder.withUnitType("strategic_bomber", "air", 6);
    builder.withUnitType("carrier", "sea", 2);
    builder.withStackUnit("fighter", "home", "red");
    builder.withStackUnit("tactical_bomber", "home", "red");
    builder.withStackUnit("strategic_bomber", "home", "red");
    builder.withStackUnit("carrier", "deck", "red");
    const state = builder.buildState();
    state.unit_types.fighter.special = { can_land_on_carrier: true };
    state.unit_types.carrier.special = { fighter_capacity: 2, can_host_fighters: true, can_host_tactical_bombers: true };
    state.current_faction_id = "red";
    state.current_phase = "noncombat_move";

    const dests = ["neutral", "open", "deck"];
    expect(offeredMoveDestinations(state, "noncombat_move", "red", "home", "fighter", dests)).toEqual(["deck"]);
    expect(offeredMoveDestinations(state, "noncombat_move", "red", "home", "tactical_bomber", dests)).toEqual(["deck"]);
    expect(offeredMoveDestinations(state, "noncombat_move", "red", "home", "strategic_bomber", dests)).toEqual([]);
    expect(isLanded(state, "red", "fighter", "home")).toBe(true);
  });
});

function builderEnemyOnOwn(state: GameState): void {
  state.region_units.own.push({ faction_id: "blue", unit_type_id: "infantry", count: 1 });
}

function move(from: string, to: string): Command {
  return Command.fromDict({
    player_id: "red",
    type: CommandType.MOVE_UNITS,
    payload: {
      moves: [{ from_region_id: from, to_region_id: to, units: [{ unit_type_id: "fighter", count: 1 }] }],
    },
  });
}
