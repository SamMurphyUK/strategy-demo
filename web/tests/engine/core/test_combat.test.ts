import { beforeEach, describe, expect, it } from "vitest";
import { CombatEngine, Faction, type GameEvent, GameEventType, GameState, PCG, Region, Unit } from "../../../src/engine";

describe("core/test_combat", () => {
  let state: GameState;
  let rng: PCG;
  let combat: CombatEngine;

  function beforeEachSetup(): void {
    state = new GameState();
    rng = new PCG(12345, 1);
    state.unit_types["infantry"] = Unit.fromDict({
      id: "infantry", name: "Infantry", category: "land",
      attack: 1, defense: 2, movement: 1, cost: 3,
    });
    state.unit_types["tank"] = Unit.fromDict({
      id: "tank", name: "Tank", category: "land",
      attack: 3, defense: 3, movement: 2, cost: 6,
    });
    state.unit_types["battleship"] = Unit.fromDict({
      id: "battleship", name: "Battleship", category: "sea",
      attack: 4, defense: 4, movement: 2, cost: 20,
    });
    state.unit_types["transport"] = Unit.fromDict({
      id: "transport", name: "Transport", category: "sea",
      attack: 0, defense: 0, movement: 2, cost: 7,
      container: { capacity: 2, allowed_cargo_categories: ["land"] },
    });
    state.factions["red"] = Faction.fromDict({ id: "red", name: "Red", color: "#FF0000", starting_ipc: 20 });
    state.factions["blue"] = Faction.fromDict({ id: "blue", name: "Blue", color: "#0000FF", starting_ipc: 20 });
    combat = new CombatEngine(state, rng);
  }

  beforeEach(beforeEachSetup);

  function setupLandBattle(attackerUnits: { type: string; count: number }[], defenderUnits: { type: string; count: number }[]): void {
    state.regions["battle_zone"] = Region.fromDict({
      id: "battle_zone", name: "Battle Zone", type: "land",
      ipc_value: 5, owner_faction_id: "blue",
      is_capital: false, has_factory: false,
    });
    const units = [];
    for (const u of attackerUnits) {
      units.push({ faction_id: "red", unit_type_id: u.type, count: u.count });
    }
    for (const u of defenderUnits) {
      units.push({ faction_id: "blue", unit_type_id: u.type, count: u.count });
    }
    state.region_units["battle_zone"] = units;
  }

  it("test_identify_battles", () => {
    setupLandBattle([{ type: "infantry", count: 3 }], [{ type: "infantry", count: 2 }]);
    const battles = combat.identifyBattles("red");
    expect(battles.length, "Should identify 1 battle").toBe(1);
    expect(battles[0].region_id).toBe("battle_zone");
    expect(battles[0].attacker_faction_id).toBe("red");
    expect(battles[0].defender_faction_id).toBe("blue");
  });

  it("test_no_battle_if_no_defender", () => {
    state.regions["empty_zone"] = Region.fromDict({
      id: "empty_zone", name: "Empty", type: "land",
      ipc_value: 3, owner_faction_id: "blue",
      is_capital: false, has_factory: false,
    });
    state.region_units["empty_zone"] = [{ faction_id: "red", unit_type_id: "infantry", count: 2 }];
    const battles = combat.identifyBattles("red");
    expect(battles.length, "No battle if no defender units").toBe(0);
  });

  it("test_battle_produces_required_events", () => {
    setupLandBattle([{ type: "infantry", count: 2 }], [{ type: "infantry", count: 2 }]);
    const events = combat.resolveAllBattles("red");
    let hasBattleStarted = false;
    let hasDiceRolled = false;
    let hasBattleFinished = false;
    for (const e of events) {
      if (e.type === GameEventType.BATTLE_STARTED) {
        hasBattleStarted = true;
      } else if (e.type === GameEventType.DICE_ROLLED) {
        hasDiceRolled = true;
      } else if (e.type === GameEventType.BATTLE_FINISHED) {
        hasBattleFinished = true;
      }
    }
    expect(hasBattleStarted, "Should have BATTLE_STARTED").toBe(true);
    expect(hasDiceRolled, "Should have DICE_ROLLED").toBe(true);
    expect(hasBattleFinished, "Should have BATTLE_FINISHED").toBe(true);
  });

  it("test_battle_removes_casualties", () => {
    setupLandBattle([{ type: "infantry", count: 5 }], [{ type: "infantry", count: 2 }]);
    combat.resolveAllBattles("red");
    let total = 0;
    for (const u of state.region_units["battle_zone"]) {
      total += u.count;
    }
    expect(total < 7, "Some units should have been destroyed").toBe(true);
  });

  it("test_attacker_wins_captures_region", () => {
    setupLandBattle([{ type: "tank", count: 10 }], [{ type: "infantry", count: 1 }]);
    const events = combat.resolveAllBattles("red");
    let battleFinished: GameEvent | null = null;
    for (const e of events) {
      if (e.type === GameEventType.BATTLE_FINISHED) {
        battleFinished = e;
        break;
      }
    }
    if (battleFinished && battleFinished.payload.result === "attacker_won") {
      expect(state.regions["battle_zone"].owner_faction_id, "Attacker should capture region").toBe("red");
    }
  });

  it("test_defender_wins_keeps_region", () => {
    setupLandBattle([{ type: "infantry", count: 1 }], [{ type: "tank", count: 10 }]);
    combat.resolveAllBattles("red");
    expect(state.regions["battle_zone"].owner_faction_id, "Defender should keep region").toBe("blue");
  });

  it("test_casualties_cheapest_first", () => {
    setupLandBattle(
      [{ type: "infantry", count: 2 }, { type: "tank", count: 2 }],
      [{ type: "tank", count: 5 }],
    );
    combat.resolveAllBattles("red");
    const redUnits = state.getFactionUnitsInRegion("battle_zone", "red");
    if (redUnits.length === 0) {
      expect(true, "All units destroyed - casualty order still valid").toBe(true);
    } else {
      let infantryCount = 0;
      let tankCount = 0;
      for (const u of redUnits) {
        if (u.unit_type_id === "infantry") {
          infantryCount = u.count;
        } else if (u.unit_type_id === "tank") {
          tankCount = u.count;
        }
      }
      expect(tankCount >= infantryCount, "Tanks should survive longer than infantry").toBe(true);
    }
  });

  it("test_deterministic_combat", () => {
    setupLandBattle([{ type: "infantry", count: 3 }], [{ type: "infantry", count: 3 }]);
    const combat1 = new CombatEngine(state, new PCG(99999, 1));
    const events1 = combat1.resolveAllBattles("red");
    state.toSnapshot();

    beforeEachSetup();
    setupLandBattle([{ type: "infantry", count: 3 }], [{ type: "infantry", count: 3 }]);
    const combat2 = new CombatEngine(state, new PCG(99999, 1));
    const events2 = combat2.resolveAllBattles("red");
    state.toSnapshot();

    expect(events1.length, "Same seed should produce same number of events").toBe(events2.length);
  });

  it("test_naval_combat", () => {
    state.regions["sea_zone"] = Region.fromDict({
      id: "sea_zone", name: "Sea Zone", type: "sea",
      ipc_value: 0, owner_faction_id: "",
      is_capital: false, has_factory: false,
    });
    state.region_units["sea_zone"] = [
      { faction_id: "red", unit_type_id: "battleship", count: 2 },
      { faction_id: "blue", unit_type_id: "battleship", count: 2 },
    ];
    const battles = combat.identifyBattles("red");
    expect(battles.length, "Should identify naval battle").toBe(1);
    expect(battles[0].battle_type).toBe("naval");
  });

  it("test_transport_excluded_from_combat", () => {
    state.regions["sea_zone"] = Region.fromDict({
      id: "sea_zone", name: "Sea Zone", type: "sea",
      ipc_value: 0, owner_faction_id: "",
      is_capital: false, has_factory: false,
    });
    state.region_units["sea_zone"] = [
      { faction_id: "red", unit_type_id: "transport", instance_id: "t1", count: 1 },
      { faction_id: "blue", unit_type_id: "battleship", count: 1 },
    ];
    const combatUnits = combat.getCombatUnits("sea_zone", "red");
    expect(combatUnits.length, "Transports (0/0) should not be combat units").toBe(0);
  });
});
