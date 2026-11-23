import { describe, expect, it } from "vitest";
import { Faction, GameState, Region, Unit } from "../../../src/engine";
import { fuelRemaining } from "../../../src/engine/air/air_fuel";
import { endCombatMoveGate } from "../../../src/engine/movement/combat_move_gate";
import { beginMovementPhase } from "../../../src/engine/movement/phase_orders";
import { convoyDrain } from "../../../src/engine/rules/optional/airAndNavalRaiding";
import { runIndustrialBombing } from "../../../src/engine/rules/optional/bombingResolver";
import { airRangeBonus } from "../../../src/engine/rules/optional/facilitiesResolver";
import { globalObjectivePay } from "../../../src/engine/rules/optional/global1940Evaluator";
import { objectiveBonus } from "../../../src/engine/rules/optional/objectives";
import { hasTech } from "../../../src/engine/rules/optional/techTree";
import { declarePreparatoryBombardment } from "../../../src/engine/rules/optional/terrain";
import { movementEnterCost } from "../../../src/engine/rules/optional/terrainResolver";
import { grantVictoryExperience } from "../../../src/engine/rules/optional/veterancyResolver";
import { HOSTILE_COAST_MESSAGE } from "../../../src/engine/transport/cargo_rules";
import {
  DEFAULT_LEGACY_RULESET,
  applyRuleToggle,
  launchForScenario,
  type OptionalRulesetConfig,
} from "../../../src/engine/types/ruleset";
import { canStageAnother, purchasePhaseAdvance } from "../../../src/ui/map/purchaseBasket";
import { draftLaunch, type CampaignDraft } from "../../../src/ui/map/menu/NewCampaignModal";
import { parseCampaignSave } from "../../../src/ui/map/menu/campaignSave";

function rules(patch: Partial<OptionalRulesetConfig>): OptionalRulesetConfig {
  return { ...DEFAULT_LEGACY_RULESET, ...patch };
}

function airBoard(): GameState {
  const state = new GameState();
  state.current_faction_id = "red";
  state.current_phase = "combat_move";
  state.factions.red = Faction.fromDict({ id: "red", name: "Red", color: "#ff0000", starting_ipc: 10 });
  state.unit_types.fighter = Unit.fromDict({
    id: "fighter",
    name: "Fighter",
    category: "air",
    attack: 3,
    defense: 4,
    movement: 1,
    cost: 10,
  });
  state.regions.home = Region.fromDict({ id: "home", name: "Home", type: "land", owner_faction_id: "red" });
  state.regions.enemy = Region.fromDict({ id: "enemy", name: "Enemy", type: "land", owner_faction_id: "blue" });
  state.adjacency.home = ["enemy"];
  state.adjacency.enemy = ["home"];
  state.region_units.enemy = [{ faction_id: "red", unit_type_id: "fighter", count: 1 }];
  state.air_movement_spent["red|enemy|fighter"] = 1;
  return state;
}

function coastBoard(): GameState {
  const state = new GameState();
  state.current_faction_id = "red";
  state.current_phase = "combat_move";
  state.unit_types.transport = Unit.fromDict({
    id: "transport",
    name: "Transport",
    category: "sea",
    attack: 0,
    defense: 0,
    movement: 2,
    cost: 7,
  });
  state.unit_types.infantry = Unit.fromDict({
    id: "infantry",
    name: "Infantry",
    category: "land",
    attack: 1,
    defense: 2,
    movement: 1,
    cost: 3,
  });
  state.regions.coast = Region.fromDict({ id: "coast", name: "Coast", type: "land", owner_faction_id: "red" });
  state.regions.sea = Region.fromDict({ id: "sea", name: "Sea", type: "sea", owner_faction_id: "" });
  state.regions.beach = Region.fromDict({ id: "beach", name: "Beach", type: "land", owner_faction_id: "blue" });
  state.regions.open = Region.fromDict({ id: "open", name: "Open", type: "sea", owner_faction_id: "" });
  state.adjacency.coast = ["sea"];
  state.adjacency.sea = ["coast", "beach", "open"];
  state.adjacency.beach = ["sea"];
  state.adjacency.open = ["sea"];
  state.region_units.sea = [{ faction_id: "red", unit_type_id: "transport", count: 1, instance_id: "t1" }];
  state.transport_instances.t1 = {
    instance_id: "t1",
    unit_type_id: "transport",
    region_id: "sea",
    cargo: [{ unit_type_id: "infantry", count: 1 }],
  };
  beginMovementPhase(state);
  return state;
}

describe("end of combat move", () => {
  it("blocks a plane with no landing zone, and counts an airbase start and Long-Range Aircraft", () => {
    const state = airBoard();
    expect(fuelRemaining(state, "red", "enemy", "fighter")).toBe(0);
    const blocked = endCombatMoveGate(state);
    expect(blocked.advance).toBe(false);
    expect(blocked.regionId).toBe("enemy");
    expect(blocked.code).toBe("PLANES_NO_LANDING");
    expect(blocked.warning).toContain("Fighter");

    state.rulesetConfig = rules({ techTree: true });
    state.researchUnlocked.red = ["long_range_aircraft"];
    expect(fuelRemaining(state, "red", "enemy", "fighter")).toBe(1);
    expect(endCombatMoveGate(state).advance).toBe(true);

    state.researchUnlocked.red = [];
    state.rulesetConfig = rules({ facilitiesAndPatrols: true });
    state.airbase_launch["red|enemy|fighter"] = true;
    expect(airRangeBonus(state, "red", "enemy", "fighter")).toBe(1);
    expect(endCombatMoveGate(state).advance).toBe(true);
  });

  it("blocks a loaded transport beside a hostile coast unless it unloads or raids", () => {
    const state = coastBoard();
    const blocked = endCombatMoveGate(state);
    expect(blocked.advance).toBe(false);
    expect(blocked.regionId).toBe("sea");
    expect(blocked.code).toBe("TRANSPORT_ON_HOSTILE_COAST");
    expect(blocked.warning).toBe(HOSTILE_COAST_MESSAGE);

    state.combatRaids = ["sea"];
    expect(endCombatMoveGate(state).advance).toBe(true);

    state.combatRaids = [];
    state.pending_amphibious_assaults.push({
      transport_instance_id: "t1",
      origin_sea_zone_id: "sea",
      target_region_id: "beach",
    });
    state.transport_instances.t1.cargo = [];
    expect(endCombatMoveGate(state).advance).toBe(true);

    state.pending_amphibious_assaults = [];
    state.transport_instances.t1.cargo = [{ unit_type_id: "infantry", count: 1 }];
    state.transport_instances.t1.region_id = "open";
    state.region_units.sea = [];
    state.region_units.open = [{ faction_id: "red", unit_type_id: "transport", count: 1, instance_id: "t1" }];
    expect(endCombatMoveGate(state).advance).toBe(true);
  });
});

describe("campaign presets and save hydration", () => {
  it("opens each scenario on its preset and keeps bombardment behind terrain", () => {
    const quick = launchForScenario("SCENARIO_1942_QUICK");
    const global = launchForScenario("SCENARIO_GLOBAL_1940");
    expect(quick.ruleset).toEqual(DEFAULT_LEGACY_RULESET);
    expect(global.ruleset.terrainModifiers).toBe(true);
    expect(global.ruleset.nationalObjectivesAndNeutrals).toBe(true);
    expect(global.ruleset.techTree).toBe(false);

    const terrain = applyRuleToggle(DEFAULT_LEGACY_RULESET, "terrainModifiers", true);
    const bomb = applyRuleToggle(terrain, "preparatoryBombardment", true);
    expect(bomb.preparatoryBombardment).toBe(true);
    expect(applyRuleToggle(bomb, "terrainModifiers", false).preparatoryBombardment).toBe(false);

    const draft: CampaignDraft = {
      scenarioId: "SCENARIO_GLOBAL_1940",
      ruleset: global.ruleset,
      mapId: "demo",
      seed: "7",
    };
    expect(draftLaunch(draft)).toEqual({ scenarioId: "SCENARIO_GLOBAL_1940", ruleset: global.ruleset });
  });

  it("hydrates a save with no ruleset as 1942 Quick", () => {
    const save = parseCampaignSave({
      version: 1,
      savedAt: 10,
      label: "Old",
      mapId: "demo",
      mapName: "Demo map",
      seed: 5,
      map: null,
      snapshot: { game_round: 2, turn_info: { current_faction_id: "ger", current_phase: "purchase", turn_number: 3 } },
    });
    expect(save?.launch).toBeUndefined();
    const state = new GameState();
    state.applyCampaignLaunch({ scenarioId: "SCENARIO_GLOBAL_1940", ruleset: { techTree: true } });
    expect(state.rulesetConfig.techTree).toBe(true);
    state.hydrateCampaignLaunch(save?.launch);
    expect(state.scenarioId).toBe("SCENARIO_1942_QUICK");
    expect(state.rulesetConfig).toEqual(DEFAULT_LEGACY_RULESET);
    expect(state.turn_order[0]).toBe("germany");
  });

  it("leaves the new resolvers idle and stops an overspent basket", () => {
    const state = new GameState();
    state.hydrateCampaignLaunch(undefined);
    expect(movementEnterCost(state, "infantry", "a", "b", 2, 0)).toBe(1);
    expect(declarePreparatoryBombardment(state, "a", [])).toBe("Preparatory bombardment needs terrain.");
    expect(airRangeBonus(state, "red", "home", "fighter")).toBe(0);
    expect(runIndustrialBombing(state, "red", "home", 0, () => 1)).toEqual({ error: "Facilities are off" });
    expect(convoyDrain(state, "red")).toBe(0);
    expect(objectiveBonus(state, "red")).toBe(0);
    expect(globalObjectivePay(state, "germany")).toBe(0);
    expect(hasTech(state, "germany", "long_range_aircraft")).toBe(false);
    grantVictoryExperience(state, {
      winner: "attacker",
      attackerLost: 1,
      defenderLost: 1,
      attackerSurvivors: [],
      defenderSurvivors: [],
    });
    expect(state.unitExperience).toEqual({});
    expect(canStageAnother(4, 10, 8)).toBe(false);
    expect(canStageAnother(4, 10, 6)).toBe(true);
    expect(purchasePhaseAdvance(4).advance).toBe(false);
    expect(purchasePhaseAdvance(0).advance).toBe(true);
  });
});
