import { describe, expect, it } from "vitest";
import {
  carrierDecks,
  fuelRemaining,
  isLanded,
  landingMarks,
  offeredMoveDestinations,
  omitParkedAir,
  planesMustLandMessage,
  sortieCost,
} from "../../../src/engine/air/air_fuel";
import { Faction } from "../../../src/engine/model/faction";
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

  it("lets aircraft attack surface ships when they can still land, and submarines only with a destroyer", () => {
    const builder = new TestStateBuilder();
    builder
      .withRegion("home", true, "red")
      .withRegion("fleet", false, "")
      .withRegion("pack", false, "")
      .withRegion("far", false, "")
      .withAdjacent("home", "fleet")
      .withAdjacent("home", "pack")
      .withAdjacent("fleet", "far");
    builder.withUnitType("fighter", "air", 2);
    builder.withUnitType("destroyer", "sea", 2);
    builder.withUnitType("cruiser", "sea", 2);
    builder.withUnitType("submarine", "sea", 2);
    builder.withStackUnit("fighter", "home", "red");
    builder.withStackUnit("destroyer", "home", "red");
    builder.withStackUnit("cruiser", "fleet", "blue");
    builder.withStackUnit("submarine", "pack", "blue");
    builder.withStackUnit("cruiser", "far", "blue");
    const state = builder.buildState();
    state.unit_types.fighter.special = { can_land_on_carrier: true };
    state.unit_types.destroyer.special = { cancels_submarine_abilities: true };
    state.unit_types.submarine.special = { requires_destroyer_to_be_hit_by_air: true, cannot_hit_air: true };
    state.current_faction_id = "red";
    state.current_phase = "combat_move";

    const ruleset = new TestStateBuilder().buildRuleset();
    const validator = new MovementValidator();
    const dests = validator.getLegalDestinationsForStack("home", "fighter", "red", state, ruleset);
    const offered = offeredMoveDestinations(state, "combat_move", "red", "home", "fighter", dests);
    expect(offered).toContain("fleet");
    expect(offered).not.toContain("pack");
    expect(offered).not.toContain("far");

    state.phase_orders.push({
      id: "dd",
      faction: "red",
      unitType: "destroyer",
      count: 1,
      fromRegionId: "home",
      toRegionId: "pack",
      path: [],
      stepsUsed: 1,
    });
    expect(offeredMoveDestinations(state, "combat_move", "red", "home", "fighter", dests)).toContain("pack");
  });

  it("will not land a plane on territory captured this turn", () => {
    const builder = new TestStateBuilder();
    builder.withRegion("home", true, "red").withRegion("taken", true, "red").withAdjacent("home", "taken");
    builder.withUnitType("fighter", "air", 4);
    builder.withStackUnit("fighter", "home", "red");
    builder.withStackUnit("fighter", "taken", "red");
    const state = builder.buildState();
    state.current_faction_id = "red";
    state.current_phase = "noncombat_move";
    state.territories_captured_this_turn.taken = true;

    expect(isLanded(state, "red", "fighter", "home")).toBe(true);
    expect(isLanded(state, "red", "fighter", "taken")).toBe(false);
    const ruleset = new TestStateBuilder().buildRuleset();
    const validator = new MovementValidator();
    const fromHome = validator.getLegalDestinationsForStack("home", "fighter", "red", state, ruleset);
    expect(offeredMoveDestinations(state, "noncombat_move", "red", "home", "fighter", fromHome)).not.toContain("taken");
    const rejected = validator.validateStackMove("home", "taken", "fighter", "red", 1, state, ruleset);
    expect(rejected.ok).toBe(false);
    expect(rejected.errors[0]?.message).toBe("Aircraft cannot land in territory captured this turn");

    const homeward = validator.validateStackMove("taken", "home", "fighter", "red", 1, state, ruleset);
    expect(homeward.ok).toBe(true);
  });
});

describe("carrier decks and landing marks", () => {
  function deckState(): GameState {
    const builder = new TestStateBuilder();
    builder
      .withRegion("home", true, "red")
      .withRegion("near", true, "red")
      .withRegion("mid", true, "red")
      .withRegion("far", true, "red")
      .withRegion("enemy", true, "blue")
      .withRegion("deck", false, "")
      .withAdjacent("home", "enemy")
      .withAdjacent("enemy", "near")
      .withAdjacent("enemy", "deck")
      .withAdjacent("near", "mid")
      .withAdjacent("mid", "far");
    builder.withUnitType("fighter", "air", 4);
    builder.withUnitType("tactical_bomber", "air", 4);
    builder.withUnitType("strategic_bomber", "air", 6);
    builder.withUnitType("carrier", "sea", 2);
    builder.withUnitType("cruiser", "sea", 2);
    builder.withStackUnit("carrier", "deck", "red");
    builder.withStackUnit("fighter", "deck", "red", 3);
    builder.withStackUnit("tactical_bomber", "deck", "red", 1);
    builder.withStackUnit("strategic_bomber", "deck", "red", 1);
    builder.withStackUnit("fighter", "home", "red");
    const state = builder.buildState();
    state.unit_types.fighter.special = { can_land_on_carrier: true };
    state.unit_types.carrier.special = { fighter_capacity: 2, can_host_fighters: true, can_host_tactical_bombers: true };
    state.current_faction_id = "red";
    state.current_phase = "combat_move";
    return state;
  }

  it("parks fighters ahead of tactical bombers and leaves the overflow on the map", () => {
    const state = deckState();
    expect(carrierDecks(state, "deck")).toEqual([
      {
        carrierUnitType: "carrier",
        carrierFactionId: "red",
        capacity: 2,
        parked: [{ unitType: "fighter", factionId: "red", count: 2 }],
      },
    ]);
    const visible = omitParkedAir(state, "deck", state.region_units.deck);
    const fighters = visible.find((entry) => entry.unit_type_id === "fighter");
    const bomber = visible.find((entry) => entry.unit_type_id === "strategic_bomber");
    const tactical = visible.find((entry) => entry.unit_type_id === "tactical_bomber");
    expect(fighters?.count).toBe(1);
    expect(tactical?.count).toBe(1);
    expect(bomber?.count).toBe(1);
  });

  it("keeps every plane on the map once an enemy ship makes the zone hostile", () => {
    const state = deckState();
    state.region_units.deck.push({ faction_id: "blue", unit_type_id: "cruiser", count: 1 });
    expect(carrierDecks(state, "deck")).toEqual([]);
    expect(omitParkedAir(state, "deck", state.region_units.deck)).toHaveLength(state.region_units.deck.length);
  });

  it("fills the same faction's deck before an allied carrier", () => {
    const state = deckState();
    state.region_units.deck = [
      { faction_id: "us", unit_type_id: "carrier", count: 1 },
      { faction_id: "uk", unit_type_id: "carrier", count: 1 },
      { faction_id: "us", unit_type_id: "fighter", count: 3 },
    ];
    for (const id of ["us", "uk"]) {
      const faction = new Faction();
      faction.id = id;
      faction.team = "allies";
      state.factions[id] = faction;
    }
    const decks = carrierDecks(state, "deck");
    expect(decks).toEqual([
      {
        carrierUnitType: "carrier",
        carrierFactionId: "uk",
        capacity: 2,
        parked: [{ unitType: "fighter", factionId: "us", count: 1 }],
      },
      {
        carrierUnitType: "carrier",
        carrierFactionId: "us",
        capacity: 2,
        parked: [{ unitType: "fighter", factionId: "us", count: 2 }],
      },
    ]);
  });

  it("counts the flight out and the hop back to the nearest deck", () => {
    const state = deckState();
    state.region_units.deck = [
      { faction_id: "red", unit_type_id: "carrier", count: 1 },
      { faction_id: "red", unit_type_id: "fighter", count: 1 },
    ];
    expect(sortieCost(state, "red", "fighter", "home", "enemy")).toBe(2);
    expect(sortieCost(state, "red", "fighter", "home", "deck")).toBe(2);
  });

  it("marks spare airfields safe and a last-point field or a carrier tight", () => {
    const state = deckState();
    state.region_units.deck = [
      { faction_id: "red", unit_type_id: "carrier", count: 1 },
      { faction_id: "red", unit_type_id: "fighter", count: 1 },
    ];
    state.current_phase = "combat_move";
    const marks = landingMarks(state, "red", "fighter", "home", "enemy", "combat_move");
    expect(marks.map((mark) => mark.regionId)).not.toContain("enemy");
    expect(marks).toContainEqual({ regionId: "home", tone: "safe" });
    expect(marks).toContainEqual({ regionId: "near", tone: "safe" });
    expect(marks).toContainEqual({ regionId: "deck", tone: "tight" });
    expect(marks).toContainEqual({ regionId: "far", tone: "tight" });

    state.current_phase = "noncombat_move";
    state.air_movement_spent["red|enemy|fighter"] = 2;
    state.region_units.enemy.push({ faction_id: "red", unit_type_id: "fighter", count: 1 });
    const back = landingMarks(state, "red", "fighter", "enemy", "", "noncombat_move");
    expect(back).toContainEqual({ regionId: "home", tone: "safe" });
    expect(back).toContainEqual({ regionId: "deck", tone: "tight" });
    expect(back).toContainEqual({ regionId: "near", tone: "safe" });
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

function countIn(state: GameState, regionId: string, faction: string, unitType: string): number {
  return (state.region_units[regionId] ?? [])
    .filter((entry) => entry.faction_id === faction && entry.unit_type_id === unitType && entry.instance_id == null)
    .reduce((sum, entry) => sum + Math.trunc(Number(entry.count ?? 0)), 0);
}

function ferryBoard(): GameState {
  const builder = new TestStateBuilder();
  builder
    .withRegion("home", false, "")
    .withRegion("next", false, "")
    .withRegion("land", true, "red")
    .withAdjacent("home", "next")
    .withAdjacent("home", "land");
  builder.withUnitType("fighter", "air", 4).withUnitType("carrier", "sea", 2).withUnitType("cruiser", "sea", 2);
  builder.withStackUnit("carrier", "home", "red").withStackUnit("fighter", "home", "red", 2);
  const state = builder.buildState();
  state.unit_types.fighter.special = { can_land_on_carrier: true };
  state.unit_types.carrier.special = { fighter_capacity: 2, can_host_fighters: true };
  state.current_faction_id = "red";
  state.current_phase = "combat_move";
  return state;
}

function carrierMove(): Command {
  return Command.fromDict({
    player_id: "red",
    type: CommandType.MOVE_UNITS,
    payload: {
      moves: [{ from_region_id: "home", to_region_id: "next", units: [{ unit_type_id: "carrier", count: 1 }] }],
    },
  });
}

describe("carrier ferry", () => {
  it("carries same-faction fighters without spending their fuel", () => {
    const state = ferryBoard();
    beginMovementPhase(state);
    applyRecordedMove(state, carrierMove(), new MovementEngine(state));
    expect(countIn(state, "home", "red", "fighter")).toBe(2);
    expect(state.movableStackCount("red", "home", "fighter")).toBe(0);
    expect(state.phase_orders[0]?.passengers).toEqual([{ unitType: "fighter", count: 2 }]);

    commitCombatAttacks(state);
    expect(countIn(state, "next", "red", "carrier")).toBe(1);
    expect(countIn(state, "next", "red", "fighter")).toBe(2);
    expect(countIn(state, "home", "red", "fighter")).toBe(0);
    expect(fuelRemaining(state, "red", "next", "fighter")).toBe(4);
  });

  it("leaves an allied plane behind and skips a fighter that already has its own order", () => {
    const state = ferryBoard();
    state.region_units.home = [
      { faction_id: "red", unit_type_id: "carrier", count: 1 },
      { faction_id: "red", unit_type_id: "fighter", count: 1 },
      { faction_id: "blue", unit_type_id: "fighter", count: 1 },
    ];
    for (const id of ["red", "blue"]) {
      const faction = new Faction();
      faction.id = id;
      faction.team = "allies";
      state.factions[id] = faction;
    }
    beginMovementPhase(state);
    applyRecordedMove(state, move("home", "land"), new MovementEngine(state));
    applyRecordedMove(state, carrierMove(), new MovementEngine(state));
    const ride = state.phase_orders.find((order) => order.unitType === "carrier");
    expect(ride?.passengers).toBeUndefined();
    expect(state.movableStackCount("blue", "home", "fighter")).toBe(1);

    commitCombatAttacks(state);
    expect(countIn(state, "land", "red", "fighter")).toBe(1);
    expect(countIn(state, "next", "red", "fighter")).toBe(0);
    expect(countIn(state, "home", "blue", "fighter")).toBe(1);
    expect(fuelRemaining(state, "red", "land", "fighter")).toBe(3);
  });

  it("does not ferry planes out of a hostile sea", () => {
    const state = ferryBoard();
    state.region_units.home.push({ faction_id: "blue", unit_type_id: "cruiser", count: 1 });
    beginMovementPhase(state);
    applyRecordedMove(state, carrierMove(), new MovementEngine(state));
    expect(state.phase_orders[0]?.passengers).toBeUndefined();
    commitCombatAttacks(state);
    expect(countIn(state, "next", "red", "carrier")).toBe(1);
    expect(countIn(state, "home", "red", "fighter")).toBe(2);
  });
});
