import { describe, expect, it } from "vitest";
import {
  CombatEngine,
  GameState,
  MovementValidator,
  PCG,
  Region,
  Ruleset,
  TransportLoadValidator,
  TurnEngine,
  Unit,
} from "../../../src/engine";
import { canReturnAfter, fuelRemaining, noteAirArrival } from "../../../src/engine/air/air_fuel";
import type { UnitStackEntry } from "../../../src/engine/model/types";

function region(state: GameState, id: string, land: boolean, owner = ""): Region {
  const next = new Region();
  next.id = id;
  next.name = id;
  next.type = land ? "land" : "sea";
  next.owner_faction_id = owner;
  state.regions[id] = next;
  state.region_units[id] = [];
  state.adjacency[id] = [];
  return next;
}

function link(state: GameState, a: string, b: string): void {
  state.adjacency[a].push(b);
  state.adjacency[b].push(a);
}

function unit(id: string, category: "land" | "sea" | "air", attack: number, defense: number, movement: number): Unit {
  return Unit.fromDict({
    id,
    name: id,
    category,
    attack,
    defense,
    movement,
    cost: 3,
    special: id === "battleship" || id === "carrier" ? { takes_two_hits: true } : {},
    container:
      id === "transport"
        ? { allowed_cargo_categories: ["land"], capacity: 2, max_per_type: { infantry: 2 } }
        : {},
  });
}

function stack(faction_id: string, unit_type_id: string, count: number): UnitStackEntry {
  return { faction_id, unit_type_id, count };
}

function scripted(rolls: number[]): PCG {
  const rng = new PCG(1, 1);
  let index = 0;
  rng.rollD6 = () => rolls[index++] ?? 6;
  return rng;
}

function countOf(state: GameState, regionId: string, faction: string, unitType: string): number {
  return (state.region_units[regionId] ?? [])
    .filter((entry) => entry.faction_id === faction && entry.unit_type_id === unitType && entry.instance_id == null)
    .reduce((sum, entry) => sum + entry.count, 0);
}

describe("airbase and harbor facilities", () => {
  it("leaves range, fuel, loads, and hulls unchanged when facilities are off", () => {
    const state = new GameState();
    state.current_faction_id = "red";
    state.turn_order = ["red"];
    state.current_phase = "combat_move";
    state.unit_types.fighter = unit("fighter", "air", 3, 4, 1);
    state.unit_types.destroyer = unit("destroyer", "sea", 2, 2, 2);
    state.unit_types.battleship = unit("battleship", "sea", 4, 4, 2);
    const field = region(state, "field", true, "red");
    field.airbase = true;
    const port = region(state, "port", true, "red");
    port.harbor = true;
    region(state, "s1", false);
    region(state, "s2", false);
    region(state, "s3", false);
    region(state, "s4", false);
    region(state, "nest", true, "red");
    link(state, "field", "s1");
    link(state, "s1", "s2");
    link(state, "s2", "s3");
    link(state, "s3", "s4");
    link(state, "s1", "nest");
    link(state, "port", "s1");
    state.region_units.s1 = [stack("red", "destroyer", 1), { ...stack("red", "battleship", 1), damage: 1 }];

    expect(fuelRemaining(state, "red", "field", "fighter")).toBe(1);
    expect(canReturnAfter(state, "red", "fighter", "field", "s1")).toBe(false);
    const rules = new Ruleset();
    const moves = new MovementValidator().getLegalDestinationsForStack("s1", "destroyer", "red", state, rules);
    expect(moves).toContain("s2");
    expect(moves).toContain("s3");
    expect(moves).not.toContain("s4");
    expect(state.region_units.s1.find((entry) => entry.unit_type_id === "battleship")?.damage).toBe(1);
    new TurnEngine(state).endTurn();
    expect(state.region_units.s1.find((entry) => entry.unit_type_id === "battleship")?.damage).toBe(1);
    expect(field.toDict()).not.toHaveProperty("airbase_disabled_until");
    expect(port.toDict()).not.toHaveProperty("harbor_disabled_until");
  });

  it("gives an air unit that starts on an operational airbase one extra range and still checks landing", () => {
    const state = new GameState();
    state.rulesetConfig.facilitiesAndPatrols = true;
    state.current_faction_id = "red";
    state.current_phase = "combat_move";
    state.unit_types.fighter = unit("fighter", "air", 3, 4, 1);
    state.unit_types.bomber = unit("bomber", "air", 4, 1, 1);
    const field = region(state, "field", true, "red");
    field.airbase = true;
    region(state, "s1", false);
    region(state, "s2", false);
    region(state, "nest", true, "red");
    link(state, "field", "s1");
    link(state, "s1", "s2");
    link(state, "s1", "nest");

    expect(fuelRemaining(state, "red", "field", "fighter")).toBe(2);
    expect(fuelRemaining(state, "red", "field", "bomber")).toBe(2);
    expect(canReturnAfter(state, "red", "fighter", "field", "s2")).toBe(false);
    expect(canReturnAfter(state, "red", "fighter", "field", "s1")).toBe(true);

    noteAirArrival(state, "red", "field", "s1", "fighter", 1);
    expect(state.airbase_launch["red|s1|fighter"]).toBe(true);
    expect(fuelRemaining(state, "red", "s1", "fighter")).toBe(1);

    const elsewhere = new GameState();
    elsewhere.rulesetConfig.facilitiesAndPatrols = true;
    elsewhere.unit_types.fighter = unit("fighter", "air", 3, 4, 4);
    region(elsewhere, "plain", true, "red");
    const strip = region(elsewhere, "strip", true, "red");
    strip.airbase = true;
    region(elsewhere, "far", true, "red");
    noteAirArrival(elsewhere, "red", "plain", "strip", "fighter", 1);
    noteAirArrival(elsewhere, "red", "strip", "far", "fighter", 1);
    expect(elsewhere.airbase_launch["red|far|fighter"]).toBeUndefined();
    expect(fuelRemaining(elsewhere, "red", "far", "fighter")).toBe(2);

    field.airbase_disabled_until = state.game_round;
    const closed = new GameState();
    closed.rulesetConfig.facilitiesAndPatrols = true;
    closed.game_round = 1;
    closed.unit_types.fighter = state.unit_types.fighter;
    const shut = region(closed, "field", true, "red");
    shut.airbase = true;
    shut.airbase_disabled_until = 1;
    expect(fuelRemaining(closed, "red", "field", "fighter")).toBe(1);
  });

  it("scrambles at most three fighters or tactical bombers and sends survivors home", () => {
    const state = new GameState();
    state.rulesetConfig.facilitiesAndPatrols = true;
    state.current_faction_id = "red";
    state.unit_types.fighter = unit("fighter", "air", 3, 4, 4);
    state.unit_types.tactical_bomber = unit("tactical_bomber", "air", 3, 3, 4);
    state.unit_types.bomber = unit("bomber", "air", 4, 1, 6);
    state.unit_types.destroyer = unit("destroyer", "sea", 2, 2, 2);
    const base = region(state, "base", true, "blue");
    base.airbase = true;
    region(state, "sea", false);
    region(state, "safe", false);
    link(state, "base", "sea");
    link(state, "sea", "safe");
    state.region_units.base = [stack("blue", "fighter", 4), stack("blue", "tactical_bomber", 1), stack("blue", "bomber", 1)];
    state.region_units.sea = [stack("red", "fighter", 1), stack("blue", "destroyer", 1)];

    const combat = new CombatEngine(state, scripted([6, 6, 6, 6, 6, 6]));
    expect(combat.startBattle("sea", "red").ok).toBe(true);
    expect(state.active_battle?.defenders).toHaveLength(1);

    const tooMany = combat.scramble("blue", [{ fromRegionId: "base", unitTypeId: "fighter", count: 4 }]);
    expect(tooMany.ok).toBe(false);
    expect(countOf(state, "base", "blue", "fighter")).toBe(4);

    const bomber = combat.scramble("blue", [{ fromRegionId: "base", unitTypeId: "bomber", count: 1 }]);
    expect(bomber.ok).toBe(false);

    const sent = combat.scramble("blue", [
      { fromRegionId: "base", unitTypeId: "fighter", count: 2 },
      { fromRegionId: "base", unitTypeId: "tactical_bomber", count: 1 },
    ]);
    expect(sent.ok).toBe(true);
    expect(state.active_battle?.defenders.filter((piece) => piece.scramble_from === "base")).toHaveLength(3);
    expect(countOf(state, "base", "blue", "fighter")).toBe(2);

    const lost = state.active_battle?.defenders.find((piece) => piece.unit_type_id === "fighter" && piece.scramble_from);
    if (lost) {
      lost.hp = 0;
    }
    expect(combat.rollRound("red").ok).toBe(true);
    expect(combat.retreat("red", "safe").ok).toBe(true);
    expect(countOf(state, "base", "blue", "fighter")).toBe(3);
    expect(countOf(state, "base", "blue", "tactical_bomber")).toBe(1);
    expect(countOf(state, "sea", "blue", "fighter")).toBe(0);
  });

  it("refuses a scramble when facilities are off or the territory is not friendly", () => {
    const state = new GameState();
    state.unit_types.infantry = unit("infantry", "land", 1, 2, 1);
    state.unit_types.fighter = unit("fighter", "air", 3, 4, 4);
    const town = region(state, "town", true, "red");
    const base = region(state, "base", true, "blue");
    base.airbase = true;
    link(state, "town", "base");
    state.region_units.town = [stack("red", "infantry", 1), stack("blue", "infantry", 1)];
    state.region_units.base = [stack("blue", "fighter", 2)];
    const combat = new CombatEngine(state, new PCG(1, 1));
    expect(combat.startBattle("town", "red").ok).toBe(true);
    const closed = combat.scramble("blue", [{ fromRegionId: "base", unitTypeId: "fighter", count: 1 }]);
    expect(closed.ok).toBe(false);
    expect(countOf(state, "base", "blue", "fighter")).toBe(2);

    state.rulesetConfig.facilitiesAndPatrols = true;
    state.active_battle = null;
    expect(combat.startBattle("town", "red").ok).toBe(true);
    const hostile = combat.scramble("blue", [{ fromRegionId: "base", unitTypeId: "fighter", count: 1 }]);
    expect(hostile.ok).toBe(false);
    town.owner_faction_id = "blue";
    const home = combat.scramble("blue", [{ fromRegionId: "base", unitTypeId: "fighter", count: 1 }]);
    expect(home.ok).toBe(true);
    expect(countOf(state, "base", "blue", "fighter")).toBe(1);
  });

  it("adds one sea movement beside a friendly operational harbor", () => {
    const state = new GameState();
    state.rulesetConfig.facilitiesAndPatrols = true;
    state.current_faction_id = "red";
    state.current_phase = "combat_move";
    state.unit_types.destroyer = unit("destroyer", "sea", 2, 2, 2);
    state.unit_types.transport = unit("transport", "sea", 0, 0, 2);
    const port = region(state, "port", true, "red");
    port.harbor = true;
    for (const id of ["z0", "z1", "z2", "z3"]) {
      region(state, id, false);
    }
    link(state, "port", "z0");
    link(state, "z0", "z1");
    link(state, "z1", "z2");
    link(state, "z2", "z3");
    state.region_units.z0 = [stack("red", "destroyer", 1), stack("red", "transport", 1)];
    const rules = new Ruleset();
    const validator = new MovementValidator();
    expect(validator.getLegalDestinationsForStack("z0", "destroyer", "red", state, rules)).toContain("z3");
    expect(validator.getLegalDestinationsForStack("z0", "transport", "red", state, rules)).toContain("z3");

    port.owner_faction_id = "blue";
    expect(validator.getLegalDestinationsForStack("z0", "destroyer", "red", state, rules)).not.toContain("z3");
    port.owner_faction_id = "red";
    port.harbor_disabled_until = state.game_round;
    expect(validator.getLegalDestinationsForStack("z0", "destroyer", "red", state, rules)).not.toContain("z3");
  });

  it("repairs a damaged battleship or carrier to full HP at the start of the owner's turn", () => {
    const state = new GameState();
    state.rulesetConfig.facilitiesAndPatrols = true;
    state.turn_order = ["red", "blue"];
    state.current_faction_id = "red";
    state.unit_types.fighter = unit("fighter", "air", 3, 4, 4);
    state.unit_types.battleship = unit("battleship", "sea", 4, 4, 2);
    state.unit_types.carrier = unit("carrier", "sea", 0, 2, 2);
    const port = region(state, "port", true, "blue");
    port.harbor = true;
    region(state, "sea", false);
    region(state, "safe", false);
    region(state, "far", false);
    link(state, "port", "sea");
    link(state, "sea", "safe");
    state.region_units.sea = [stack("red", "fighter", 1), { ...stack("blue", "battleship", 1), damage: 1 }];
    state.region_units.far = [{ ...stack("blue", "carrier", 1), damage: 1 }];

    const combat = new CombatEngine(state, scripted([6, 6, 6, 6]));
    expect(combat.startBattle("sea", "red").ok).toBe(true);
    expect(state.active_battle?.defenders[0].hp).toBe(1);
    expect(state.active_battle?.defenders[0].max_hp).toBe(2);
    expect(combat.rollRound("red").ok).toBe(true);
    expect(combat.retreat("red", "safe").ok).toBe(true);
    expect(state.region_units.sea.find((entry) => entry.unit_type_id === "battleship")?.damage).toBe(1);

    const events = new TurnEngine(state).endTurn();
    expect(events.map((event) => event.type)).toEqual(["turn_ended", "phase_changed"]);
    expect(state.current_faction_id).toBe("blue");
    expect(state.region_units.sea.find((entry) => entry.unit_type_id === "battleship")?.damage).toBeUndefined();
    expect(state.region_units.far.find((entry) => entry.unit_type_id === "carrier")?.damage).toBe(1);
  });

  it("lets a transport at an operational harbor embark from the port or one connected friendly land", () => {
    const state = new GameState();
    state.current_faction_id = "red";
    state.current_phase = "combat_move";
    state.unit_types.infantry = unit("infantry", "land", 1, 2, 1);
    state.unit_types.transport = unit("transport", "sea", 0, 0, 2);
    const port = region(state, "port", true, "red");
    port.harbor = true;
    region(state, "inland", true, "red");
    region(state, "sea", false);
    link(state, "port", "inland");
    link(state, "port", "sea");
    state.region_units.sea = [{ faction_id: "red", unit_type_id: "transport", count: 1, instance_id: "t1" }];
    state.transport_instances.t1 = { instance_id: "t1", unit_type_id: "transport", region_id: "sea", cargo: [] };
    state.region_units.inland = [stack("red", "infantry", 1)];
    state.region_units.port = [stack("red", "infantry", 1)];
    const loads = new TransportLoadValidator();
    const cargo = [{ unit_type_id: "infantry", count: 1 }];
    expect(loads.canLoadUnits("t1", "port", cargo, "red", state)).toBe(true);
    expect(loads.canLoadUnits("t1", "inland", cargo, "red", state)).toBe(false);
    expect(loads.getLegalLoadDestinations("inland", "infantry", "red", state)).not.toContain("sea");

    state.rulesetConfig.facilitiesAndPatrols = true;
    expect(loads.canLoadUnits("t1", "inland", cargo, "red", state)).toBe(true);
    expect(loads.getLegalLoadDestinations("inland", "infantry", "red", state)).toContain("sea");
    port.harbor_disabled_until = state.game_round;
    expect(loads.canLoadUnits("t1", "inland", cargo, "red", state)).toBe(false);
  });
});
