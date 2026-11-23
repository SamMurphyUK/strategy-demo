import { describe, expect, it } from "vitest";
import { Faction, GameState, Region, Unit } from "../../src/engine";
import { evaluateBoardState, snapshotBoard } from "../../src/ai/beamSearchPlanner";
import { combatCandidates } from "../../src/ai/combatMoveGen";
import { beamSearch } from "../../src/ai/beamSearchPlanner";
import { capitalCaptureOdds, planPurchase } from "../../src/ai/purchasePlanner";
import { keepLowOddsTrade } from "../../src/ai/combatMoveGen";
import { threatMap } from "../../src/ai/threatMap";
import { AI_DIFFICULTY_PROFILES, personaFor } from "../../src/ai/types/aiTypes";
import { Ruleset } from "../../src/engine/rules/ruleset";

function unit(id: string, attack: number, defense: number, movement: number, cost: number, category = "land"): Unit {
  return Unit.fromDict({ id, name: id, category, attack, defense, movement, cost });
}

function land(id: string, owner: string, ipc: number, extra: Record<string, unknown> = {}): Region {
  return Region.fromDict({ id, name: id, type: "land", ipc_value: ipc, owner_faction_id: owner, ...extra });
}

function duel(): GameState {
  const state = new GameState();
  state.factions.red = Faction.fromDict({ id: "red", name: "Red", color: "#ff0000", starting_ipc: 30, team: "axis" });
  state.factions.blue = Faction.fromDict({ id: "blue", name: "Blue", color: "#0000ff", starting_ipc: 10, team: "allies" });
  state.ipc.red = 30;
  state.turn_order = ["red", "blue"];
  state.current_faction_id = "red";
  state.current_phase = "combat_move";
  state.unit_types.infantry = unit("infantry", 1, 2, 1, 3);
  state.unit_types.artillery = unit("artillery", 2, 2, 1, 4);
  state.unit_types.tank = unit("tank", 3, 3, 2, 6);
  state.regions.home = land("home", "red", 4, { has_factory: true, is_capital: true });
  state.regions.away = land("away", "blue", 2);
  state.regions.flank = land("flank", "blue", 1);
  state.adjacency.home = ["away"];
  state.adjacency.away = ["home", "flank"];
  state.adjacency.flank = ["away"];
  return state;
}

describe("combat packages and purchase", () => {
  it("keeps armor out of a dead zone and marks suppression artillery", () => {
    const state = duel();
    state.region_units.home = [
      { faction_id: "red", unit_type_id: "infantry", count: 2 },
      { faction_id: "red", unit_type_id: "artillery", count: 1 },
      { faction_id: "red", unit_type_id: "tank", count: 1 },
    ];
    state.region_units.away = [{ faction_id: "blue", unit_type_id: "infantry", count: 1 }];
    state.region_units.flank = [{ faction_id: "blue", unit_type_id: "infantry", count: 8 }];
    const ruleset = new Ruleset();
    ruleset.syncFromState(state);
    const tiles = threatMap(state, "red", false);
    expect(tiles.find((tile) => tile.regionId === "away")?.zoneClassification).toBe("DEAD_ZONE");
    const packages = combatCandidates(state, "red", ruleset, AI_DIFFICULTY_PROFILES.EASY, personaFor("red"), tiles, 4);
    const aimed = packages.filter((pack) => pack.to === "away");
    expect(aimed.length).toBeGreaterThan(0);
    for (const pack of aimed) {
      expect(pack.stacks.every((line) => line.unitType !== "tank")).toBe(true);
      expect(pack.expectedTuvSwing).toBeTypeOf("number");
      expect(pack.survivingAttackers).toBeGreaterThan(0);
    }

    state.rulesetConfig.terrainModifiers = true;
    state.rulesetConfig.preparatoryBombardment = true;
    state.regions.away = land("away", "blue", 2, { land_cover: "URBAN" });
    state.region_units.away = [{ faction_id: "blue", unit_type_id: "infantry", count: 2 }];
    state.region_units.flank = [];
    state.region_units.home = [
      { faction_id: "red", unit_type_id: "infantry", count: 6 },
      { faction_id: "red", unit_type_id: "artillery", count: 2 },
    ];
    const suppressed = combatCandidates(
      state,
      "red",
      ruleset,
      AI_DIFFICULTY_PROFILES.EASY,
      personaFor("red"),
      threatMap(state, "red", false),
      4,
    ).filter((pack) => pack.kind === "suppression");
    expect(suppressed.length).toBeGreaterThan(0);
    expect(suppressed[0].stacks.some((line) => line.unitType === "artillery" && line.assignedToSuppression === true)).toBe(true);
  });

  it("sends one shared tank to only one of two battles", () => {
    const state = duel();
    state.unit_types.militia = unit("militia", 1, 1, 1, 2);
    state.regions.flank = land("flank", "blue", 2);
    state.adjacency.home = ["away", "flank"];
    state.adjacency.away = ["home"];
    state.adjacency.flank = ["home"];
    state.region_units.home = [{ faction_id: "red", unit_type_id: "tank", count: 2 }];
    state.region_units.away = [{ faction_id: "blue", unit_type_id: "militia", count: 1 }];
    state.region_units.flank = [{ faction_id: "blue", unit_type_id: "militia", count: 1 }];
    const ruleset = new Ruleset();
    ruleset.syncFromState(state);
    const tiles = threatMap(state, "red", false);
    const packages = combatCandidates(state, "red", ruleset, AI_DIFFICULTY_PROFILES.EASY, personaFor("red"), tiles, 2);
    const chosen = beamSearch(state, "red", packages, tiles, AI_DIFFICULTY_PROFILES.EASY, personaFor("red"), 2);
    expect(packages.filter((pack) => pack.stacks.some((line) => line.unitType === "tank")).length).toBeGreaterThan(1);
    const tanks = chosen.best.attacks.reduce(
      (sum, attack) => sum + attack.stacks.filter((line) => line.unitType === "tank").reduce((inner, line) => inner + line.count, 0),
      0,
    );
    expect(tanks).toBe(2);
  });

  it("fills a threatened capital with infantry and buys a research token when the treasury can spare one", () => {
    const state = duel();
    state.current_phase = "purchase";
    state.region_units.home = [];
    state.region_units.away = [{ faction_id: "blue", unit_type_id: "infantry", count: 6 }];
    state.adjacency.home = ["away"];
    state.adjacency.away = ["home"];
    const tiles = threatMap(state, "red", false);
    expect(capitalCaptureOdds(state, "red")).toBeGreaterThan(0.5);
    const locked = planPurchase(state, "red", personaFor("red"), tiles);
    expect(locked.purchases.every((line) => line.unit_type_id === "infantry")).toBe(true);
    expect(locked.purchases.reduce((sum, line) => sum + line.count, 0)).toBeGreaterThan(0);

    state.region_units.away = [];
    state.rulesetConfig.techTree = true;
    state.ipc.red = 30;
    const open = planPurchase(state, "red", personaFor("germany"), threatMap(state, "red", false));
    expect(open.research).toEqual([{ tech: "improved_artillery", count: 1 }]);
    expect(open.spent).toBeLessThanOrEqual(30);

    const board = snapshotBoard(state);
    const score = evaluateBoardState(state, board, "red", personaFor("red"));
    expect(score).toBeGreaterThan(0);
  });

  it("drops a low-odds attack unless the exchange pays 1.25 times the risk", () => {
    expect(keepLowOddsTrade(0.3, 10, 10)).toBe(false);
    expect(keepLowOddsTrade(0.3, 13, 10)).toBe(true);
    expect(keepLowOddsTrade(0.5, 1, 10)).toBe(true);
  });

  it("sends a ship after an idle enemy transport", () => {
    const state = duel();
    state.unit_types.destroyer = unit("destroyer", 2, 2, 2, 8, "sea");
    state.unit_types.transport = unit("transport", 0, 0, 2, 7, "sea");
    state.regions.homeSea = Region.fromDict({ id: "homeSea", name: "Home Sea", type: "sea", owner_faction_id: "" });
    state.regions.awaySea = Region.fromDict({ id: "awaySea", name: "Away Sea", type: "sea", owner_faction_id: "" });
    state.adjacency.home = ["homeSea"];
    state.adjacency.homeSea = ["home", "awaySea"];
    state.adjacency.awaySea = ["homeSea", "away"];
    state.adjacency.away = ["awaySea"];
    state.region_units.homeSea = [{ faction_id: "red", unit_type_id: "destroyer", count: 1 }];
    state.region_units.awaySea = [{ faction_id: "blue", unit_type_id: "transport", count: 1, instance_id: "t1" }];
    state.transport_instances.t1 = { instance_id: "t1", unit_type_id: "transport", region_id: "awaySea", cargo: [] };
    const ruleset = new Ruleset();
    ruleset.syncFromState(state);
    const packages = combatCandidates(state, "red", ruleset, AI_DIFFICULTY_PROFILES.EASY, personaFor("red"), threatMap(state, "red", false), 3);
    expect(packages.some((pack) => pack.kind === "naval" && pack.to === "awaySea")).toBe(true);
  });

  it("buys cargo with a British transport and places the ship at sea", () => {
    const state = duel();
    state.factions.uk = Faction.fromDict({ id: "uk", name: "Britain", color: "#124", starting_ipc: 40, team: "allies" });
    state.ipc.uk = 40;
    state.current_faction_id = "uk";
    state.unit_types.transport = unit("transport", 0, 0, 2, 7, "sea");
    state.unit_types.destroyer = unit("destroyer", 2, 2, 2, 8, "sea");
    state.regions.london = land("london", "uk", 8, { has_factory: true, is_capital: true });
    state.regions.channel = Region.fromDict({ id: "channel", name: "Channel", type: "sea", owner_faction_id: "" });
    state.adjacency.london = ["channel"];
    state.adjacency.channel = ["london"];
    const bought = planPurchase(state, "uk", personaFor("uk"), threatMap(state, "uk", false));
    const count = (id: string) => bought.purchases.find((line) => line.unit_type_id === id)?.count ?? 0;
    expect(count("transport")).toBeGreaterThan(0);
    expect(count("infantry") + count("artillery")).toBeGreaterThanOrEqual(2);
    expect(bought.placements.some((row) => row.region_id === "channel" && row.units.some((line) => line.unit_type_id === "transport"))).toBe(true);
  });
});
