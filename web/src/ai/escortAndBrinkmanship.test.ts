import { describe, expect, it } from "vitest";
import { Faction, GameSession, GameState, Region, Unit } from "../engine";
import { evaluateSeaZoneEscortSafety } from "./escortSafety";
import { planImmediateFerry, planStagingFerry } from "./ferryPlanner";
import { campaignRuleFlags, shouldRunEvaluator } from "./ruleFlags";
import { Ruleset } from "../engine/rules/ruleset";

function ship(id: string, attack: number, defense: number, cost: number, twoHits = false): Unit {
  const unit = Unit.fromDict({ id, name: id, category: id === "fighter" ? "air" : "sea", attack, defense, movement: 2, cost });
  if (twoHits) {
    unit.special = { takes_two_hits: true };
  }
  if (id === "transport") {
    unit.container = { allowed_cargo_categories: ["land"], capacity: 2 };
  }
  return unit;
}

describe("escort math and campaign flags", () => {
  it("holds a loaded transport until the escort's defense and hull points cover the threat", () => {
    const state = new GameState();
    state.factions.usa = Faction.fromDict({ id: "usa", name: "United States", color: "#360", starting_ipc: 20, team: "allies" });
    state.factions.jap = Faction.fromDict({ id: "jap", name: "Japan", color: "#b70", starting_ipc: 20, team: "axis" });
    state.unit_types.transport = ship("transport", 0, 0, 7);
    state.unit_types.destroyer = ship("destroyer", 2, 2, 8);
    state.unit_types.battleship = ship("battleship", 4, 4, 20, true);
    state.regions.lane = Region.fromDict({ id: "lane", name: "Lane", type: "sea", owner_faction_id: "" });
    state.regions.threat = Region.fromDict({ id: "threat", name: "Threat", type: "sea", owner_faction_id: "" });
    state.adjacency.lane = ["threat"];
    state.adjacency.threat = ["lane"];
    state.region_units.lane = [{ faction_id: "usa", unit_type_id: "transport", count: 1, instance_id: "t1" }];
    state.region_units.threat = [{ faction_id: "jap", unit_type_id: "destroyer", count: 1 }];
    state.transport_instances.t1 = { instance_id: "t1", unit_type_id: "transport", region_id: "lane", cargo: [{ unit_type_id: "infantry", count: 2 }] };
    const held = evaluateSeaZoneEscortSafety(state, "usa", "lane");
    expect(held.safe).toBe(false);
    expect(held.incomingThreatScore).toBeGreaterThan(held.escortScore);
    state.region_units.lane.push({ faction_id: "usa", unit_type_id: "battleship", count: 1 });
    const covered = evaluateSeaZoneEscortSafety(state, "usa", "lane");
    expect(covered.escortScore).toBeGreaterThan(held.escortScore);
    expect(covered.safe).toBe(true);
  });

  it("lets a peacetime United States load and stage without an amphibious unload", () => {
    const state = new GameState();
    state.scenarioId = "SCENARIO_GLOBAL_1940";
    state.game_round = 2;
    state.current_faction_id = "usa";
    state.current_phase = "noncombat_move";
    state.warStatus.usa = "PEACETIME";
    state.factions.usa = Faction.fromDict({ id: "usa", name: "United States", color: "#360", starting_ipc: 20, team: "allies" });
    state.factions.ger = Faction.fromDict({ id: "ger", name: "Germany", color: "#444", starting_ipc: 20, team: "axis" });
    state.unit_types.infantry = Unit.fromDict({ id: "infantry", name: "Infantry", category: "land", attack: 1, defense: 2, movement: 1, cost: 3 });
    state.unit_types.transport = ship("transport", 0, 0, 7);
    state.regions.east = Region.fromDict({ id: "east", name: "Eastern US", type: "land", owner_faction_id: "usa", has_factory: true });
    state.regions.home = Region.fromDict({ id: "home", name: "Home Sea", type: "sea", owner_faction_id: "" });
    state.regions.stage = Region.fromDict({ id: "stage", name: "Mid Atlantic", type: "sea", owner_faction_id: "" });
    state.regions.france = Region.fromDict({ id: "france", name: "France", type: "land", owner_faction_id: "ger" });
    state.adjacency.east = ["home"];
    state.adjacency.home = ["east", "stage"];
    state.adjacency.stage = ["home", "france"];
    state.adjacency.france = ["stage"];
    state.region_units.east = [{ faction_id: "usa", unit_type_id: "infantry", count: 2 }];
    state.region_units.home = [{ faction_id: "usa", unit_type_id: "transport", count: 1, instance_id: "t1" }];
    state.transport_instances.t1 = { instance_id: "t1", unit_type_id: "transport", region_id: "home", cargo: [] };
    const ruleset = new Ruleset();
    ruleset.syncFromState(state);
    const staged = planStagingFerry(state, "usa", ruleset, [], new Set());
    const assault = planImmediateFerry(state, "usa", []);
    expect(staged.loads.length).toBeGreaterThan(0);
    expect(assault.assaults).toEqual([]);
    const session = new GameSession();
    session.bindArena(state, 2);
    state.current_phase = "noncombat_move";
    state.current_faction_id = "usa";
    for (const load of staged.loads) {
      const result = session.applyCommand({
        command_id: `load_${load.unitType}`,
        player_id: "usa",
        type: "load_transport",
        payload: { transport_instance_id: load.transportId, from_region_id: load.from, units: [{ unit_type_id: load.unitType, count: load.count }] },
      });
      expect(result.result_type, result.error?.message ?? "").toBe("ok");
    }
  });

  it("skips 1940-only evaluators when the campaign flags are off", () => {
    const state = new GameState();
    state.scenarioId = "SCENARIO_1942_QUICK";
    const flags = campaignRuleFlags(state);
    expect(flags.enableTerrainModifiers).toBe(false);
    expect(flags.enablePreparatorySuppression).toBe(false);
    expect(flags.enableMobilizationCurve).toBe(false);
    expect(shouldRunEvaluator(flags, "preparatorySuppression")).toBe(false);
    expect(shouldRunEvaluator(flags, "factoryBombing")).toBe(false);
    expect(shouldRunEvaluator(flags, "neutralInvasion")).toBe(false);
    state.scenarioId = "SCENARIO_GLOBAL_1940";
    state.rulesetConfig.terrainModifiers = true;
    state.rulesetConfig.preparatoryBombardment = true;
    state.rulesetConfig.facilitiesAndPatrols = true;
    state.rulesetConfig.nationalObjectivesAndNeutrals = true;
    const global = campaignRuleFlags(state);
    expect(shouldRunEvaluator(global, "preparatorySuppression")).toBe(true);
    expect(shouldRunEvaluator(global, "neutralInvasion")).toBe(false);
  });
});
