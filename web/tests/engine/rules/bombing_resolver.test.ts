import { describe, expect, it } from "vitest";
import { CombatEngine, GameState, PCG, PlacementValidator, Region, Unit } from "../../../src/engine";
import type { BattleUnitState } from "../../../src/engine/model/battle";
import { airRangeBonus } from "../../../src/engine/rules/optional/facilitiesResolver";
import { declarePreparatoryBombardment } from "../../../src/engine/rules/optional/terrain";
import {
  assignEscort,
  factoryBuildCap,
  planPreparatorySuppression,
  purchaseRepair,
  runIndustrialBombing,
  runInterdiction,
} from "../../../src/engine/rules/optional/bombingResolver";

function piece(id: string, unitTypeId: string, factionId: string): BattleUnitState {
  return { id, faction_id: factionId, unit_type_id: unitTypeId, hp: 1, max_hp: 1 };
}

function faces(rolls: number[]): () => number {
  let index = 0;
  return () => rolls[index++] ?? 6;
}

function scripted(rolls: number[]): PCG {
  const rng = new PCG(1, 1);
  let index = 0;
  rng.rollD6 = () => rolls[index++] ?? 6;
  return rng;
}

function land(state: GameState, id: string, owner: string): Region {
  const region = new Region();
  region.id = id;
  region.name = id;
  region.type = "land";
  region.owner_faction_id = owner;
  state.regions[id] = region;
  state.region_units[id] = state.region_units[id] ?? [];
  state.adjacency[id] = state.adjacency[id] ?? [];
  return region;
}

describe("bombing resolver", () => {
  it("keeps the classic round when preparatory bombardment is off", () => {
    const state = new GameState();
    state.current_faction_id = "red";
    const city = land(state, "city", "blue");
    city.land_cover = "URBAN";
    state.unit_types.artillery = Unit.fromDict({ id: "artillery", name: "Artillery", category: "land", attack: 2, defense: 2, movement: 1, cost: 4 });
    state.unit_types.infantry = Unit.fromDict({ id: "infantry", name: "Infantry", category: "land", attack: 1, defense: 2, movement: 1, cost: 3 });
    state.region_units.city = [
      { faction_id: "red", unit_type_id: "artillery", count: 1 },
      { faction_id: "blue", unit_type_id: "infantry", count: 1 },
    ];
    const combat = new CombatEngine(state, scripted([1, 6]));
    expect(combat.startBattle("city", "red").ok).toBe(true);
    const gun = state.active_battle?.attackers[0];
    expect(declarePreparatoryBombardment(state, "city", [gun?.id ?? "gun"])).toBe("Preparatory bombardment needs terrain.");
    expect(combat.rollRound("red").ok).toBe(true);
    expect(state.active_battle).toBeNull();
    expect(state.terrainSuppressed.city).toBeUndefined();
  });

  it("suppresses a city only after a preparatory hit, and a miss leaves it open", () => {
    const state = battleState();
    const combat = new CombatEngine(state, scripted([2, 6, 6]));
    expect(combat.startBattle("city", "red").ok).toBe(true);
    const gun = state.active_battle?.attackers[0];
    expect(declarePreparatoryBombardment(state, "city", [gun?.id ?? ""])).toBe("");
    expect(combat.rollRound("red").ok).toBe(true);
    expect(state.terrainSuppressed.city).toBe(state.game_round);
    expect(state.active_battle?.attackers[0].hp).toBe(1);
    expect(state.active_battle?.defenders[0].hp).toBe(1);

    const missed = battleState();
    const quiet = new CombatEngine(missed, scripted([6, 6, 6]));
    expect(quiet.startBattle("city", "red").ok).toBe(true);
    declarePreparatoryBombardment(missed, "city", [missed.active_battle?.attackers[0].id ?? ""]);
    expect(quiet.rollRound("red").ok).toBe(true);
    expect(missed.terrainSuppressed.city).toBeUndefined();
  });

  it("fires AA at suppression bombers, then a one-round escort, then the suppression roll", () => {
    const state = new GameState();
    state.rulesetConfig.terrainModifiers = true;
    state.rulesetConfig.preparatoryBombardment = true;
    const wood = land(state, "wood", "blue");
    wood.land_cover = "FOREST";
    state.unit_types.aa = Unit.fromDict({ id: "aa", name: "AA", category: "land", attack: 0, defense: 1, movement: 1, cost: 5, special: { is_aa: true } });
    const veteranBomber = piece("bomber-vet", "bomber", "red");
    const freshBomber = piece("bomber-new", "bomber", "red");
    const escort = piece("escort", "fighter", "red");
    const gun = piece("gun", "artillery", "red");
    const defender = piece("cap", "fighter", "blue");
    const flak = piece("flak", "aa", "blue");
    state.forfeitOpening[veteranBomber.id] = true;
    state.forfeitOpening[freshBomber.id] = true;
    state.forfeitOpening[gun.id] = true;
    state.unitExperience[veteranBomber.id] = { xp: 2, veteran: true };
    assignEscort(state, [escort.id]);
    const planned = planPreparatorySuppression(
      state,
      "wood",
      [veteranBomber, freshBomber, escort, gun],
      [defender, flak],
      faces([1, 6, 1, 2, 1, 2, 6]),
    );
    expect(planned.casualties.map((loss) => loss.unitId)).toEqual(["bomber-new", "cap", "escort"]);
    expect(planned.suppressed).toBe(true);
    const suppression = planned.dice.filter((die) => die.kind === "suppression");
    expect(suppression.map((die) => die.rank)).toEqual([2, 1]);
    expect(suppression.map((die) => die.hit)).toEqual([true, false]);
  });

  it("adds factory repair tokens from heavy bombers and spends Industrial Output to clear them", () => {
    const state = new GameState();
    state.rulesetConfig.facilitiesAndPatrols = true;
    state.ipc.red = 4;
    state.unit_types.bomber = Unit.fromDict({ id: "bomber", name: "Bomber", category: "air", attack: 4, defense: 1, movement: 6, cost: 12 });
    state.unit_types.fighter = Unit.fromDict({ id: "fighter", name: "Fighter", category: "air", attack: 3, defense: 4, movement: 4, cost: 10 });
    const plant = land(state, "plant", "blue");
    plant.has_factory = true;
    plant.major_factory = true;
    plant.base_output = 3;
    plant.airbase = true;
    state.region_units.plant = [
      { faction_id: "red", unit_type_id: "bomber", count: 1 },
      { faction_id: "red", unit_type_id: "fighter", count: 1 },
      { faction_id: "blue", unit_type_id: "fighter", count: 1 },
    ];
    state.patrolCounts["blue|plant"] = 1;
    const raid = runIndustrialBombing(state, "red", "plant", 1, faces([6, 1, 2, 4]));
    expect("error" in raid).toBe(false);
    if ("error" in raid) {
      return;
    }
    expect(raid.bomberLosses).toBe(0);
    expect(raid.escortLosses).toBe(1);
    expect(raid.interceptorLosses).toBe(1);
    expect(raid.tokens).toBe(4);
    expect(factoryBuildCap(state, plant)).toBe(0);

    state.rulesetConfig.techTree = true;
    state.researchUnlocked.red = ["heavy_bombers"];
    state.region_units.plant = [{ faction_id: "red", unit_type_id: "bomber", count: 1 }];
    state.repairTokens.plant = 0;
    const heavy = runIndustrialBombing(state, "red", "plant", 0, faces([6, 3, 2]));
    expect("tokens" in heavy && heavy.tokens).toBe(5);

    expect(purchaseRepair(state, "red", "plant", 2)).toBe("That factory is not yours.");
    expect(state.getFactionIpc("red")).toBe(4);
    state.ipc.blue = 4;
    expect(purchaseRepair(state, "blue", "plant", 2)).toBe("");
    expect(state.getFactionIpc("blue")).toBe(2);
    expect(state.repairTokens.plant).toBe(3);
    expect(purchaseRepair(state, "blue", "plant", 4)).toBe("Not enough Industrial Output.");
    expect(state.repairTokens.plant).toBe(3);

    state.rulesetConfig.techTree = false;
    state.region_units.plant = [
      { faction_id: "red", unit_type_id: "bomber", count: 1 },
      { faction_id: "blue", unit_type_id: "fighter", count: 1 },
    ];
    state.patrolCounts["blue|plant"] = 1;
    state.repairTokens.plant = 0;
    const unescorted = runIndustrialBombing(state, "red", "plant", 0, faces([6, 1, 3]));
    expect("bomberLosses" in unescorted && unescorted.bomberLosses).toBe(0);
    expect("interceptorLosses" in unescorted && unescorted.interceptorLosses).toBe(0);
    expect("tokens" in unescorted && unescorted.tokens).toBe(3);
    expect(state.region_units.plant.find((entry) => entry.faction_id === "blue")?.count).toBe(1);
  });

  it("closes an airbase, harbor, or depot through the next round when a tactical bomber hits", () => {
    const state = new GameState();
    state.rulesetConfig.facilitiesAndPatrols = true;
    state.rulesetConfig.terrainModifiers = true;
    state.rulesetConfig.preparatoryBombardment = true;
    state.game_round = 2;
    state.current_faction_id = "red";
    state.unit_types.tactical_bomber = Unit.fromDict({
      id: "tactical_bomber",
      name: "Tactical bomber",
      category: "air",
      attack: 4,
      defense: 3,
      movement: 4,
      cost: 11,
    });
    state.unit_types.fighter = Unit.fromDict({ id: "fighter", name: "Fighter", category: "air", attack: 3, defense: 4, movement: 4, cost: 10 });
    const field = land(state, "field", "blue");
    field.airbase = true;
    field.harbor = true;
    field.forward_depot = true;
    field.has_factory = true;
    state.adjacency.field = ["sea"];
    state.adjacency.sea = ["field"];
    const sea = new Region();
    sea.id = "sea";
    sea.type = "sea";
    state.regions.sea = sea;
    state.region_units.field = [
      { faction_id: "red", unit_type_id: "tactical_bomber", count: 1 },
      { faction_id: "blue", unit_type_id: "fighter", count: 1 },
    ];
    expect(runInterdiction(state, "red", "field", "airbase", faces([5])).hits).toBe(0);
    expect(field.airbase_disabled_until).toBe(0);
    expect(runInterdiction(state, "red", "field", "airbase", faces([4])).disabledUntil).toBe(3);
    expect(airRangeBonus(state, "blue", "field", "fighter")).toBe(0);
    expect(runInterdiction(state, "red", "field", "harbor", faces([1])).disabledUntil).toBe(3);
    expect(field.harbor_disabled_until).toBe(3);
    expect(runInterdiction(state, "red", "field", "depot", faces([1])).hits).toBe(1);
    const placement = new PlacementValidator(state);
    expect(placement.validatePlacement("blue", "field", "infantry").errors[0]).toContain("Depot is disabled");
  });

  it("leaves factory capacity alone while facilities are off", () => {
    const state = new GameState();
    const plant = land(state, "plant", "red");
    plant.has_factory = true;
    plant.major_factory = true;
    plant.ipc_value = 5;
    plant.base_output = 5;
    state.repairTokens.plant = 4;
    state.unit_types.infantry = Unit.fromDict({ id: "infantry", name: "Infantry", category: "land", attack: 1, defense: 2, movement: 1, cost: 3 });
    const placement = new PlacementValidator(state);
    expect(placement.validatePlacement("red", "plant", "infantry", 5).valid).toBe(true);
    state.rulesetConfig.facilitiesAndPatrols = true;
    expect(placement.validatePlacement("red", "plant", "infantry", 2).valid).toBe(false);
    expect(factoryBuildCap(state, plant)).toBe(1);
  });
});

function battleState(): GameState {
  const state = new GameState();
  state.rulesetConfig.terrainModifiers = true;
  state.rulesetConfig.preparatoryBombardment = true;
  state.current_faction_id = "red";
  const city = land(state, "city", "blue");
  city.land_cover = "URBAN";
  state.unit_types.artillery = Unit.fromDict({ id: "artillery", name: "Artillery", category: "land", attack: 2, defense: 2, movement: 1, cost: 4 });
  state.unit_types.infantry = Unit.fromDict({ id: "infantry", name: "Infantry", category: "land", attack: 1, defense: 2, movement: 1, cost: 3 });
  state.region_units.city = [
    { faction_id: "red", unit_type_id: "artillery", count: 1 },
    { faction_id: "blue", unit_type_id: "infantry", count: 1 },
  ];
  return state;
}
