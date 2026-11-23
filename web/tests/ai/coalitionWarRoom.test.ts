import { describe, expect, it } from "vitest";
import { Faction, GameState, Region, Unit } from "../../src/engine";
import { evaluateAllianceWarPlan, registerReinforcementNode } from "../../src/ai/coalitionWarRoom";
import { planNonCombat } from "../../src/ai/nonCombatPlanner";
import { postureById, selectPosture } from "../../src/ai/theaterPostures";
import { Ruleset } from "../../src/engine/rules/ruleset";

function piece(id: string, category: string, cost: number, movement = 1): Unit {
  const unit = Unit.fromDict({ id, name: id, category, attack: 1, defense: 2, movement, cost });
  if (id === "fighter") {
    unit.special = { can_land_on_carrier: true };
  }
  return unit;
}

function land(id: string, owner: string, extra: Record<string, unknown> = {}): Region {
  return Region.fromDict({ id, name: id, type: "land", ipc_value: 2, owner_faction_id: owner, ...extra });
}

describe("coalition war room", () => {
  it("asks Britain to land fighters on a coast the United States just took", () => {
    const state = new GameState();
    state.current_faction_id = "uk";
    state.current_phase = "noncombat_move";
    state.factions.usa = Faction.fromDict({ id: "usa", name: "United States", color: "#360", starting_ipc: 20, team: "allies" });
    state.factions.uk = Faction.fromDict({ id: "uk", name: "Britain", color: "#124", starting_ipc: 20, team: "allies" });
    state.factions.ger = Faction.fromDict({ id: "ger", name: "Germany", color: "#444", starting_ipc: 20, team: "axis" });
    state.unit_types.infantry = piece("infantry", "land", 3);
    state.unit_types.tank = piece("tank", "land", 6, 2);
    state.unit_types.fighter = piece("fighter", "air", 10, 4);
    state.regions.beach = land("beach", "usa");
    state.regions.field = land("field", "uk");
    state.regions.prussia = land("prussia", "ger");
    state.regions.sea = Region.fromDict({ id: "sea", name: "Sea", type: "sea", owner_faction_id: "" });
    state.adjacency.beach = ["sea", "prussia"];
    state.adjacency.prussia = ["beach"];
    state.adjacency.sea = ["beach", "field"];
    state.adjacency.field = ["sea"];
    state.region_units.beach = [{ faction_id: "usa", unit_type_id: "infantry", count: 1 }];
    state.region_units.prussia = [{ faction_id: "ger", unit_type_id: "tank", count: 4 }];
    state.region_units.sea = [{ faction_id: "uk", unit_type_id: "fighter", count: 1 }];
    const node = registerReinforcementNode(state, "beach", "usa");
    expect(node?.territoryId).toBe("beach");
    const ruleset = new Ruleset();
    ruleset.syncFromState(state);
    const plan = planNonCombat(state, "uk", ruleset, [], false, []);
    expect(plan.moves).toContainEqual({ from: "sea", to: "beach", unitType: "fighter", count: 1 });
  });

  it("puts Germany and Italy on the Mediterranean when Egypt and the Italian objective are open", () => {
    const state = new GameState();
    state.factions.germany = Faction.fromDict({ id: "germany", name: "Germany", color: "#444", starting_ipc: 20, team: "axis" });
    state.factions.italy = Faction.fromDict({ id: "italy", name: "Italy", color: "#262", starting_ipc: 10, team: "axis" });
    state.factions.uk = Faction.fromDict({ id: "uk", name: "Britain", color: "#124", starting_ipc: 20, team: "allies" });
    state.unit_types.infantry = piece("infantry", "land", 3);
    state.regions.egypt = land("egypt", "uk");
    state.regions.berlin = land("berlin", "germany", { is_capital: true });
    state.region_units.egypt = [{ faction_id: "uk", unit_type_id: "infantry", count: 6 }];
    state.nationalObjectives = [{ id: "NO_ITA_MARE_NOSTRUM", factionId: "italy", production: 5, holds: ["egypt", "greece", "gibraltar"] }];
    const plan = evaluateAllianceWarPlan(state, "axis");
    expect(plan.primaryTheater).toBe("THEATER_MED_AFRICA");
    expect(postureById(plan.factionPostures.germany as "POSTURE_CAUCASUS_OIL")?.theaterId).toBe("THEATER_MED_AFRICA");
    expect(postureById(plan.factionPostures.italy as "POSTURE_MARE_NOSTRUM")?.theaterId).toBe("THEATER_MED_AFRICA");
  });

  it("moves the United States from the Mediterranean to the Pacific when that ocean holds the enemy fleet", () => {
    const state = new GameState();
    state.factions.united_states = Faction.fromDict({ id: "united_states", name: "United States", color: "#360", starting_ipc: 30, team: "allies" });
    state.factions.japan = Faction.fromDict({ id: "japan", name: "Japan", color: "#b70", starting_ipc: 20, team: "axis" });
    state.unit_types.tank = piece("tank", "land", 6, 2);
    state.regions.egypt = land("egypt", "japan");
    state.regions.philippines = land("philippines", "japan");
    state.regions.washington = land("washington", "united_states", { is_capital: true });
    state.region_units.egypt = [{ faction_id: "japan", unit_type_id: "tank", count: 6 }];
    const med = evaluateAllianceWarPlan(state, "allies");
    expect(selectPosture(state, "united_states", med)?.id).toBe("POSTURE_TORCH_MED_INVASION");
    state.region_units.egypt = [];
    state.region_units.philippines = [{ faction_id: "japan", unit_type_id: "tank", count: 8 }];
    const pacific = evaluateAllianceWarPlan(state, "allies");
    expect(selectPosture(state, "united_states", pacific)?.id).toBe("POSTURE_PACIFIC_ISLAND_HOP");
  });
});
