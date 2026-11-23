import { describe, expect, it } from "vitest";
import { Command, EconomyEngine, GameState, MovementEngine, PlacementValidator, Region, Unit, VictoryEngine } from "../../../src/engine";
import { neutralDomino } from "../../../src/engine/rules/optional/objectives";
import {
  advanceGlobalRound,
  declareOffensive,
  globalObjectivePay,
  UNITED_STATES,
} from "../../../src/engine/rules/optional/global1940Evaluator";
import { buyResearch, hasTech, rollResearchPhase } from "../../../src/engine/rules/optional/techTree";

function land(id: string, owner: string, ipc = 0): Region {
  return Region.fromDict({
    id,
    name: id,
    type: "land",
    ipc_value: ipc,
    owner_faction_id: owner,
  });
}

function campaign(objectives = true, tech = false): GameState {
  const state = new GameState();
  state.applyCampaignLaunch({
    scenarioId: "SCENARIO_GLOBAL_1940",
    ruleset: { nationalObjectivesAndNeutrals: objectives, techTree: tech },
  });
  return state;
}

describe("1940 campaign", () => {
  it("starts seven powers, with the Soviet Union and the United States at peace", () => {
    const state = campaign();
    expect(state.turn_order).toEqual([
      "germany",
      "soviet_union",
      "japan",
      "united_kingdom",
      "italy",
      "china",
      "united_states",
    ]);
    expect(state.current_faction_id).toBe("germany");
    expect(state.ipc.soviet_union).toBe(28);
    expect(state.ipc.united_states).toBe(26);
    expect(state.warStatus.soviet_union).toBe("PEACETIME");
    expect(state.warStatus.united_states).toBe("PEACETIME");
    expect(state.wartimeBonusRound.soviet_union).toBe(3);
    expect(state.neutralBlocs.map((bloc) => bloc.id)).toEqual([
      "BLOC_IBERIA",
      "BLOC_NORDIC",
      "BLOC_TURKEY",
      "BLOC_SOUTH_AMERICA",
    ]);
    expect(state.playedBy.china).toBe("united_states");
    expect(state.playedBy.anzac).toBe("united_kingdom");
  });

  it("pays named objectives only while the flag is on", () => {
    const quiet = campaign(false);
    quiet.regions.caucasus = land("caucasus", "germany");
    expect(globalObjectivePay(quiet, "germany")).toBe(0);

    const state = campaign();
    state.regions.caucasus = land("caucasus", "germany", 4);
    state.regions.sea = Region.fromDict({ id: "sea", name: "Sea", type: "sea", owner_faction_id: "" });
    state.region_units.sea = [{ faction_id: "germany", unit_type_id: "submarine", count: 3 }];
    expect(globalObjectivePay(state, "germany")).toBe(10);

    for (const id of ["sumatra", "java", "borneo"]) {
      state.regions[id] = land(id, "japan");
    }
    expect(globalObjectivePay(state, "japan")).toBe(0);
    state.regions.celebes = land("celebes", "japan");
    state.regions.malaya = land("malaya", "japan");
    state.regions.philippines = land("philippines", "japan");
    expect(globalObjectivePay(state, "japan")).toBe(10);

    for (const id of ["egypt", "greece", "gibraltar"]) {
      state.regions[id] = land(id, "italy");
    }
    expect(globalObjectivePay(state, "italy")).toBe(5);
    state.regions.arkhangelsk = land("arkhangelsk", "soviet_union");
    for (const id of ["moscow", "leningrad", "stalingrad"]) {
      state.regions[id] = land(id, "soviet_union");
    }
    expect(globalObjectivePay(state, "soviet_union")).toBe(10);
    state.regions.gibraltar.owner_faction_id = "united_kingdom";
    state.regions.egypt.owner_faction_id = "united_kingdom";
    for (const id of ["canada", "south_africa", "india"]) {
      state.regions[id] = land(id, "united_kingdom");
    }
    state.regions.australia = land("australia", "anzac");
    state.regions.new_zealand = land("new_zealand", "anzac");
    expect(globalObjectivePay(state, "united_kingdom")).toBe(10);

    const income = new EconomyEngine(state).collectIncome("germany");
    expect(income[0].payload.amount).toBe(14);
  });

  it("flips the rest of a bloc and garrisons it when one member is invaded", () => {
    const state = campaign();
    state.regions.spain = land("spain", "");
    state.regions.portugal = land("portugal", "");
    expect(neutralDomino(state, "spain", "germany")).toEqual(["portugal"]);
    expect(state.regions.portugal.owner_faction_id).toBe("united_kingdom");
    expect(state.region_units.portugal).toEqual([{ faction_id: "united_kingdom", unit_type_id: "infantry", count: 1 }]);

    const other = campaign();
    other.regions.spain = land("spain", "");
    other.regions.portugal = land("portugal", "");
    expect(neutralDomino(other, "spain", "united_kingdom")).toEqual(["portugal"]);
    expect(other.regions.portugal.owner_faction_id).toBe("germany");
  });

  it("adds ANZAC income to Britain and lets Britain move those units", () => {
    const state = campaign(false);
    state.regions.sydney = land("sydney", "anzac", 4);
    state.regions.home = land("home", "united_kingdom", 2);
    state.adjacency.sydney = ["home"];
    state.region_units.sydney = [{ faction_id: "anzac", unit_type_id: "infantry", count: 2 }];
    expect(new EconomyEngine(state).collectIncome("united_kingdom")[0].payload.amount).toBe(6);
    expect(state.movableStackCount("united_kingdom", "sydney", "infantry")).toBe(2);
    new MovementEngine(state).processMove(
      Command.fromDict({
        command_id: "c1",
        player_id: "united_kingdom",
        type: "move_units",
        payload: {
          moves: [{ from_region_id: "sydney", to_region_id: "home", units: [{ unit_type_id: "infantry", count: 2 }] }],
        },
      }),
    );
    expect(state.getFactionUnitsInRegion("home", "anzac")[0].count).toBe(2);
    expect(state.getFactionUnitsInRegion("sydney", "anzac")).toEqual([]);
  });

  it("absorbs Free France on round 2 and pays the wartime stipend from round 3", () => {
    const state = campaign(false);
    state.regions.syria = land("syria", "free_france");
    state.region_units.syria = [{ faction_id: "free_france", unit_type_id: "infantry", count: 1 }];
    state.ipc.free_france = 4;
    state.game_round = 2;
    advanceGlobalRound(state);
    expect(state.regions.syria.owner_faction_id).toBe("united_kingdom");
    expect(state.region_units.syria[0].faction_id).toBe("united_kingdom");
    expect(state.ipc.united_kingdom).toBe(4);
    expect(state.freeFranceAbsorbed).toBe(true);

    expect(new EconomyEngine(state).collectIncome("soviet_union")[0].payload.amount).toBe(0);
    state.game_round = 3;
    advanceGlobalRound(state);
    expect(state.warStatus.soviet_union).toBe("WARTIME");
    expect(new EconomyEngine(state).collectIncome("soviet_union")[0].payload.amount).toBe(10);
    expect(new EconomyEngine(state).collectIncome("united_states")[0].payload.amount).toBe(26);
  });

  it("withholds the wartime stipend until round 5 after an early offensive", () => {
    const state = campaign(false);
    declareOffensive(state, "soviet_union");
    expect(state.warStatus.soviet_union).toBe("WARTIME");
    expect(state.wartimeBonusRound.soviet_union).toBe(5);
    state.game_round = 3;
    expect(new EconomyEngine(state).collectIncome("soviet_union")[0].payload.amount).toBe(0);
    state.game_round = 5;
    expect(new EconomyEngine(state).collectIncome("soviet_union")[0].payload.amount).toBe(10);
  });

  it("scores victory cities at the end of the round", () => {
    const early = campaign(false);
    for (let i = 0; i < 9; i += 1) {
      const id = ["berlin", "rome", "paris", "warsaw", "london", "moscow", "cairo", "tokyo", "shanghai"][i];
      early.regions[id] = land(id, "germany");
    }
    expect(new VictoryEngine(early).checkVictory()).toEqual([]);
    expect(early.game_over).toBe(false);

    early.current_faction_id = UNITED_STATES;
    const won = new VictoryEngine(early).checkVictory();
    expect(early.game_over).toBe(true);
    expect(early.winner_faction_id).toBe("germany");
    expect(won[0].payload.reason).toBe("victory_cities");

    const allies = campaign(false);
    for (const id of ["berlin", "rome", "tokyo"]) {
      allies.regions[id] = land(id, "united_kingdom");
    }
    allies.current_faction_id = UNITED_STATES;
    const capitals = new VictoryEngine(allies).checkVictory();
    expect(allies.winner_faction_id).toBe("united_states");
    expect(capitals[0].payload.reason).toBe("axis_capitals");
  });

  it("caps Chinese guerrillas at two and gates artillery on the Burma Road", () => {
    const state = campaign(false);
    state.regions.yunnan = land("yunnan", "china", 2);
    state.regions.peking = land("peking", "china");
    const placement = new PlacementValidator(state);
    expect(placement.validatePlacement("china", "yunnan", "guerrilla", 2).valid).toBe(true);
    state.region_units.yunnan = [{ faction_id: "china", unit_type_id: "guerrilla", count: 2 }];
    expect(placement.validatePlacement("china", "yunnan", "guerrilla", 1).errors).toContain("A core tile holds two guerrillas.");
    expect(placement.validatePlacement("china", "peking", "guerrilla", 1).errors).toContain("Guerrillas deploy on a Chinese core tile.");
    expect(placement.validatePlacement("china", "yunnan", "artillery", 1).errors).toContain("The Burma Road is closed.");

    state.regions.india = land("india", "united_kingdom");
    state.regions.burma = land("burma", "united_kingdom");
    state.regions.yunnan.has_factory = true;
    state.unit_types.artillery = Unit.fromDict({
      id: "artillery",
      name: "Artillery",
      category: "land",
      attack: 2,
      defense: 2,
      movement: 1,
      cost: 4,
    });
    expect(placement.validatePlacement("china", "yunnan", "artillery", 1).valid).toBe(true);
  });

  it("buys research for 5 and carries one pity pip for a failed turn", () => {
    const off = new GameState();
    expect(buyResearch(off, "germany", [{ tech: "heavy_bombers", count: 1 }])).toBe("Research is off.");

    const state = campaign(false, true);
    state.ipc.germany = 15;
    expect(buyResearch(state, "germany", [{ tech: "heavy_bombers", count: 1 }])).toBeNull();
    expect(state.ipc.germany).toBe(10);
    expect(rollResearchPhase(state, "germany", () => 5)).toEqual([]);
    expect(state.researchPity.germany).toBe(1);
    expect(hasTech(state, "germany", "heavy_bombers")).toBe(false);

    state.researchPending.germany = ["heavy_bombers"];
    expect(rollResearchPhase(state, "germany", () => 5)).toEqual(["heavy_bombers"]);
    expect(state.researchPity.germany).toBe(0);
    expect(hasTech(state, "germany", "heavy_bombers")).toBe(true);

    state.researchUnlocked.germany = [];
    state.researchPity.germany = 0;
    state.ipc.germany = 10;
    expect(buyResearch(state, "germany", [{ tech: "jet_fighters", count: 2 }])).toBeNull();
    expect(rollResearchPhase(state, "germany", () => 1)).toEqual([]);
    expect(state.researchPity.germany).toBe(1);
  });

  it("puts the seven powers back on a resumed game without moving the clock", () => {
    const live = campaign();
    live.game_round = 4;
    live.turn_number = 11;
    live.current_faction_id = "japan";
    live.current_phase = "combat_move";
    live.ipc.soviet_union = 40;
    const saved = live.toSnapshot();
    const resumed = new GameState();
    resumed.turn_order = ["ussr", "ger", "uk", "jap", "usa"];
    resumed.current_faction_id = "ussr";
    resumed.game_round = saved.game_round;
    resumed.current_phase = saved.turn_info.current_phase;
    resumed.current_faction_id = saved.turn_info.current_faction_id;
    resumed.turn_number = saved.turn_info.turn_number;
    resumed.ipc = { ...saved.ipc };
    resumed.hydrateCampaignLaunch({
      scenarioId: "SCENARIO_GLOBAL_1940",
      ruleset: live.rulesetConfig,
    });
    expect(resumed.turn_order).toContain("china");
    expect(resumed.turn_order).toContain("italy");
    expect(resumed.current_faction_id).toBe("japan");
    expect(resumed.current_phase).toBe("combat_move");
    expect(resumed.game_round).toBe(4);
    expect(resumed.turn_number).toBe(11);
    expect(resumed.ipc.soviet_union).toBe(40);
    expect(resumed.factions.germany.team).toBe("axis");
    expect(resumed.factions.united_kingdom.team).toBe("allies");
    expect(resumed.neutralBlocs.length).toBeGreaterThan(0);
    expect(resumed.warStatus.soviet_union).toBe("WARTIME");
  });
});
