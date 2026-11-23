import { describe, expect, it } from "vitest";
import { CombatEngine, EconomyEngine, GameState, MovementValidator, PCG, Region, Ruleset, TurnEngine, Unit } from "../../../src/engine";
import { airCannotStrike } from "../../../src/engine/air/air_fuel";
import type { UnitStackEntry } from "../../../src/engine/model/types";
import {
  airTransitCost,
  convoyDrain,
  patrolIntel,
  resolveNavalRaid,
  resolveTransitIntercept,
  standDownPatrols,
  subSurpriseBlocked,
  togglePatrol,
} from "../../../src/engine/rules/optional/airAndNavalRaiding";
import { convoyRaidLoss } from "../../../src/engine/rules/optional/facilities";

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

function unit(id: string, category: "land" | "sea" | "air", attack: number, defense: number, movement: number, cost = 3): Unit {
  return Unit.fromDict({ id, name: id, category, attack, defense, movement, cost, special: {} });
}

function stack(faction_id: string, unit_type_id: string, count: number): UnitStackEntry {
  return { faction_id, unit_type_id, count };
}

function countOf(state: GameState, regionId: string, factionId: string, unitTypeId: string): number {
  return (state.region_units[regionId] ?? [])
    .filter((entry) => entry.faction_id === factionId && entry.unit_type_id === unitTypeId)
    .reduce((sum, entry) => sum + entry.count, 0);
}

describe("air patrols, naval raids, and convoy drain", () => {
  it("does nothing to income, patrols, or submarine stealth while facilities are off", () => {
    const state = new GameState();
    state.current_faction_id = "red";
    state.current_phase = "noncombat_move";
    const coast = region(state, "coast", true, "red");
    coast.ipc_value = 8;
    const sea = region(state, "sea", false);
    sea.is_convoy_zone = true;
    link(state, "coast", "sea");
    state.unit_types.submarine = unit("submarine", "sea", 2, 1, 2);
    state.unit_types.submarine.special = { requires_destroyer_to_be_hit_by_air: true };
    state.region_units.sea = [stack("blue", "submarine", 2)];
    expect(togglePatrol(state, "red", "coast", 1)).toBe("Facilities are off.");
    expect(convoyDrain(state, "red")).toBe(0);
    expect(convoyRaidLoss(state, "red")).toBe(0);
    expect(subSurpriseBlocked(state, "sea", "blue")).toBe(false);
    expect(airTransitCost(state, "red", "coast", "sea")).toBeNull();
    expect("is_convoy_zone" in coast.toDict()).toBe(false);
    expect(sea.toDict().is_convoy_zone).toBe(true);
  });

  it("sets three fighters from an airbase or a carrier and locks them until purchase", () => {
    const state = new GameState();
    state.rulesetConfig.facilitiesAndPatrols = true;
    state.current_faction_id = "red";
    state.current_phase = "noncombat_move";
    state.turn_order = ["red", "blue"];
    state.unit_types.fighter = unit("fighter", "air", 3, 4, 4);
    state.unit_types.carrier = unit("carrier", "sea", 0, 2, 2);
    const base = region(state, "base", true, "red");
    base.airbase = true;
    const deck = region(state, "deck", false);
    state.region_units.base = [stack("red", "fighter", 4)];
    state.region_units.deck = [stack("red", "carrier", 1), stack("red", "fighter", 2)];
    expect(togglePatrol(state, "red", "base", 4)).toBe("A patrol is three fighters.");
    expect(togglePatrol(state, "red", "base", 3)).toBeNull();
    expect(state.patrolCounts["red|base"]).toBe(3);
    expect(togglePatrol(state, "red", "deck", 2)).toBeNull();
    base.airbase = false;
    expect(togglePatrol(state, "red", "base", 1)).toBe("Patrols fly from an airbase or a carrier.");
    base.airbase = true;

    new TurnEngine(state).endTurn();
    expect(state.patrolLock.red).toBe(true);
    expect(togglePatrol(state, "red", "base", 1)).toBe("Patrols are set in noncombat.");
    state.current_faction_id = "red";
    state.current_phase = "purchase";
    expect(standDownPatrols(state, "red")).toBeNull();
    expect(state.patrolCounts["red|base"]).toBeUndefined();
    expect(state.patrolLock.red).toBeUndefined();
  });

  it("charges one extra move to fly through a patrol unless the aircraft fight one round", () => {
    const state = new GameState();
    state.rulesetConfig.facilitiesAndPatrols = true;
    state.current_faction_id = "red";
    state.current_phase = "combat_move";
    state.unit_types.fighter = unit("fighter", "air", 3, 4, 1);
    const redland = region(state, "redland", true, "red");
    const sea = region(state, "sea", false);
    const blueland = region(state, "blueland", true, "blue");
    blueland.airbase = true;
    link(state, "redland", "sea");
    link(state, "sea", "blueland");
    state.region_units.redland = [stack("red", "fighter", 1)];
    state.region_units.blueland = [stack("blue", "fighter", 1)];
    const moves = new MovementValidator();
    const ruleset = new Ruleset();
    expect(moves.getLegalDestinationsForStack("redland", "fighter", "red", state, ruleset)).toContain("sea");
    state.current_faction_id = "blue";
    state.current_phase = "noncombat_move";
    expect(togglePatrol(state, "blue", "blueland", 1)).toBeNull();
    state.current_faction_id = "red";
    state.current_phase = "combat_move";
    expect(airTransitCost(state, "red", "redland", "sea")).toBe(2);
    expect(moves.getLegalDestinationsForStack("redland", "fighter", "red", state, ruleset)).not.toContain("sea");
    state.unit_types.fighter.movement = 2;
    expect(moves.getLegalDestinationsForStack("redland", "fighter", "red", state, ruleset)).toContain("sea");

    const fought = resolveTransitIntercept(state, "red", "redland", "sea", () => 6);
    expect(fought.ok).toBe(true);
    expect(fought.transitLosses).toBe(0);
    state.unit_types.fighter.movement = 1;
    expect(airTransitCost(state, "red", "redland", "sea")).toBe(1);
    expect(patrolIntel(state, "blue", "sea")).not.toBeNull();
    expect(patrolIntel(state, "blue", "redland")).toBeNull();
  });

  it("grounds locked fighters and shows cargo in a zone the patrol can see", () => {
    const state = new GameState();
    state.rulesetConfig.facilitiesAndPatrols = true;
    state.current_faction_id = "red";
    state.current_phase = "noncombat_move";
    state.turn_order = ["red", "blue"];
    state.unit_types.fighter = unit("fighter", "air", 3, 4, 4);
    const base = region(state, "base", true, "red");
    base.airbase = true;
    const sea = region(state, "sea", false);
    link(state, "base", "sea");
    state.region_units.base = [stack("red", "fighter", 1)];
    state.transport_instances.t1 = { region_id: "sea", cargo: [{ unit_type_id: "infantry", count: 2 }] };
    expect(togglePatrol(state, "red", "base", 1)).toBeNull();
    new TurnEngine(state).endTurn();
    const moves = new MovementValidator();
    expect(moves.getLegalDestinationsForStack("base", "fighter", "red", state, new Ruleset())).toEqual([]);
    const seen = patrolIntel(state, "red", "sea");
    expect(seen?.cargo).toEqual([{ unitTypeId: "infantry", count: 2 }]);
  });

  it("joins a sea battle from the patrolling airbase and cancels submarine stealth there", () => {
    const state = new GameState();
    state.rulesetConfig.facilitiesAndPatrols = true;
    state.unit_types.destroyer = unit("destroyer", "sea", 2, 2, 2);
    state.unit_types.fighter = unit("fighter", "air", 3, 4, 4);
    state.unit_types.submarine = unit("submarine", "sea", 2, 1, 2);
    state.unit_types.submarine.special = { requires_destroyer_to_be_hit_by_air: true, has_surprise_strike: true };
    const sea = region(state, "sea", false);
    const base = region(state, "base", true, "blue");
    base.airbase = true;
    link(state, "sea", "base");
    state.region_units.sea = [stack("red", "submarine", 1)];
    state.region_units.base = [stack("blue", "fighter", 1)];
    state.current_faction_id = "blue";
    state.current_phase = "noncombat_move";
    expect(togglePatrol(state, "blue", "base", 1)).toBeNull();
    expect(subSurpriseBlocked(state, "sea", "red")).toBe(true);
    expect(airCannotStrike(state, "blue", "sea")).toBe(false);
    state.patrolCounts = {};
    expect(airCannotStrike(state, "blue", "sea")).toBe(true);
    state.region_units.sea = [stack("red", "destroyer", 1), stack("blue", "destroyer", 1)];
    state.patrolCounts["blue|base"] = 1;
    const combat = new CombatEngine(state, new PCG(1, 1));
    expect(combat.startBattle("sea", "red").ok).toBe(true);
    expect(state.active_battle?.defenders.some((piece) => piece.scramble_from === "base")).toBe(true);
    expect(countOf(state, "base", "blue", "fighter")).toBe(0);
  });

  it("withdraws a one-round raid, disables an empty harbor, and pins on a destroyer", () => {
    const state = new GameState();
    state.rulesetConfig.facilitiesAndPatrols = true;
    state.current_faction_id = "red";
    state.current_phase = "combat_move";
    state.game_round = 2;
    state.unit_types.destroyer = unit("destroyer", "sea", 2, 2, 2, 8);
    state.unit_types.artillery = unit("artillery", "land", 2, 2, 1, 4);
    const from = region(state, "from", false);
    const sea = region(state, "sea", false);
    const port = region(state, "port", true, "blue");
    port.harbor = true;
    link(state, "from", "sea");
    link(state, "sea", "port");
    state.region_units.from = [stack("red", "destroyer", 1)];
    const quiet = resolveNavalRaid(state, "red", "from", "sea", () => 6);
    expect(quiet.ok).toBe(true);
    expect(quiet.pinned).toBe(false);
    expect(quiet.harborDisabled).toBe(true);
    expect(port.harbor_disabled_until).toBe(3);
    expect(countOf(state, "from", "red", "destroyer")).toBe(1);

    port.harbor_disabled_until = 0;
    state.region_units.port = [stack("blue", "artillery", 1)];
    const shot = resolveNavalRaid(state, "red", "from", "sea", () => 1);
    expect(shot.raiderLosses).toBe(1);
    expect(shot.harborDisabled).toBe(true);
    expect(countOf(state, "from", "red", "destroyer")).toBe(0);

    state.region_units.from = [stack("red", "destroyer", 1)];
    state.region_units.sea = [stack("blue", "destroyer", 1)];
    port.harbor_disabled_until = 0;
    const pinned = resolveNavalRaid(state, "red", "from", "sea", () => 1);
    expect(pinned.pinned).toBe(true);
    expect(pinned.harborDisabled).toBe(false);
    expect(port.harbor_disabled_until).toBe(0);
    expect(countOf(state, "sea", "red", "destroyer")).toBe(1);
    expect(countOf(state, "from", "red", "destroyer")).toBe(0);
  });

  it("drains one per submarine in a convoy zone, capped at the highest owned coast", () => {
    const state = new GameState();
    state.rulesetConfig.facilitiesAndPatrols = true;
    state.unit_types.submarine = unit("submarine", "sea", 2, 1, 2);
    const rich = region(state, "rich", true, "red");
    rich.ipc_value = 8;
    rich.base_output = 4;
    const poor = region(state, "poor", true, "red");
    poor.ipc_value = 2;
    const other = region(state, "other", true, "blue");
    other.ipc_value = 9;
    const convoy = region(state, "convoy", false);
    convoy.is_convoy_zone = true;
    const open = region(state, "open", false);
    link(state, "convoy", "rich");
    link(state, "convoy", "poor");
    link(state, "convoy", "other");
    link(state, "open", "rich");
    state.region_units.convoy = [stack("blue", "submarine", 10)];
    state.region_units.open = [stack("blue", "submarine", 10)];
    expect(convoyDrain(state, "red")).toBe(4);
    expect(convoyRaidLoss(state, "red")).toBe(4);
    const economy = new EconomyEngine(state);
    expect(economy.collectIncome("red")[0].payload.amount).toBe(6);
    state.rulesetConfig.facilitiesAndPatrols = false;
    expect(convoyDrain(state, "red")).toBe(0);
  });
});
