import { beforeEach, describe, expect, it } from "vitest";
import {
  CombatEngine,
  cheapestCasualties,
  type Dict,
  firingRanks,
  GameSessionStub,
  GameState,
  loadJson,
  PCG,
  Region,
  Unit,
  type UnitStackEntry,
} from "../../../src/engine";

function newState(): GameState {
  const state = new GameState();
  for (const data of loadJson("res://data/units.json").units as Dict[]) {
    state.unit_types[data.id] = Unit.fromDict(data);
  }
  return state;
}

function addRegion(state: GameState, id: string, type: "land" | "sea", owner: string, units: UnitStackEntry[] = []): void {
  state.regions[id] = Region.fromDict({ id, name: id, type, owner_faction_id: owner });
  state.region_units[id] = units;
  state.adjacency[id] = state.adjacency[id] ?? [];
}

function link(state: GameState, a: string, b: string): void {
  state.adjacency[a].push(b);
  state.adjacency[b].push(a);
}

const stack = (faction_id: string, unit_type_id: string, count: number): UnitStackEntry => ({
  faction_id,
  unit_type_id,
  count,
});

function mustOk<T extends { ok: boolean }>(result: T): T & { ok: true } {
  if (!result.ok) {
    throw new Error(JSON.stringify(result));
  }
  return result as T & { ok: true };
}

describe("core/test_battle", () => {
  let state: GameState;
  let combat: CombatEngine;

  beforeEach(() => {
    state = newState();
    combat = new CombatEngine(state, new PCG(4242, 1));
  });

  it("expands stacks into one piece per unit and gives battleships two hits", () => {
    addRegion(state, "Sea", "sea", "", [stack("red", "destroyer", 2), stack("blue", "battleship", 1)]);
    mustOk(combat.startBattle("Sea", "red"));
    const battle = state.active_battle!;
    expect(battle.stage).toBe("awaiting_roll");
    expect(battle.attackers.map((u) => u.id)).toEqual(["red.destroyer.1", "red.destroyer.2"]);
    expect(battle.defenders).toEqual([
      { id: "blue.battleship.1", faction_id: "blue", unit_type_id: "battleship", hp: 2, max_hp: 2 },
    ]);
  });

  it("refuses a region with no battle and a second battle while one is open", () => {
    addRegion(state, "A", "land", "blue", [stack("red", "infantry", 1), stack("blue", "infantry", 1)]);
    addRegion(state, "B", "land", "blue", [stack("red", "infantry", 1)]);
    expect(combat.startBattle("B", "red")).toMatchObject({ ok: false, error: { code: "NO_BATTLE" } });
    mustOk(combat.startBattle("A", "red"));
    expect(combat.startBattle("A", "red")).toMatchObject({ ok: false, error: { code: "BATTLE_IN_PROGRESS" } });
  });

  it("rolls one die per living unit and replays with the same seed", () => {
    const run = () => {
      const s = newState();
      addRegion(s, "A", "land", "blue", [stack("red", "infantry", 3), stack("blue", "infantry", 2)]);
      const c = new CombatEngine(s, new PCG(77, 1));
      mustOk(c.startBattle("A", "red"));
      mustOk(c.rollRound("red"));
      return s.active_battle?.last_dice ?? [];
    };
    const first = run();
    expect(first).toHaveLength(5);
    expect(first.every((d) => d.roll >= 1 && d.roll <= 6 && d.hit === d.roll <= d.rank)).toBe(true);
    expect(run()).toEqual(first);
  });

  it("spends hits on the cheapest unit, and damages a battleship before sinking it", () => {
    addRegion(state, "Sea", "sea", "", [
      stack("red", "destroyer", 1),
      stack("blue", "battleship", 1),
      stack("blue", "destroyer", 1),
    ]);
    mustOk(combat.startBattle("Sea", "red"));
    const defenders = state.active_battle!.defenders;
    const ranks = firingRanks(defenders, "defender", state.unit_types);
    expect(cheapestCasualties(defenders, 3, "defender", state.unit_types, ranks)).toEqual([
      { unit_id: "blue.destroyer.1", side: "defender", result: "destroyed" },
      { unit_id: "blue.battleship.1", side: "defender", result: "damaged" },
      { unit_id: "blue.battleship.1", side: "defender", result: "destroyed" },
    ]);
  });

  it("only accepts exactly the hits owed, and a battleship needs two to sink", () => {
    addRegion(state, "Sea", "sea", "", [stack("red", "battleship", 1), stack("red", "destroyer", 1)]);
    addRegion(state, "Home", "sea", "");
    state.region_units.Sea.push(stack("blue", "destroyer", 1));
    mustOk(combat.startBattle("Sea", "red"));
    const battle = state.active_battle!;
    battle.stage = "awaiting_casualties";
    battle.attacker_hits_to_take = 2;
    expect(combat.assignAttackerCasualties("red", ["red.battleship.1"])).toMatchObject({
      ok: false,
      error: { code: "INVALID_CASUALTIES" },
    });
    mustOk(combat.assignAttackerCasualties("red", ["red.battleship.1", "red.battleship.1"]));
    expect(battle.attackers.find((u) => u.id === "red.battleship.1")?.hp).toBe(0);
    expect(battle.attackers.find((u) => u.id === "red.destroyer.1")?.hp).toBe(1);
  });

  it("captures land when a land unit survives, and writes survivors back as stacks", () => {
    addRegion(state, "A", "land", "blue", [stack("red", "infantry", 2), stack("blue", "infantry", 1)]);
    mustOk(combat.startBattle("A", "red"));
    const battle = state.active_battle!;
    battle.defenders[0].hp = 0;
    battle.attackers[1].hp = 0;
    battle.stage = "awaiting_casualties";
    battle.attacker_hits_to_take = 0;
    const result = mustOk(combat.assignAttackerCasualties("red", []));
    expect(result.events.map((e) => e.type)).toEqual(["units_destroyed", "region_captured", "battle_finished"]);
    expect(state.active_battle).toBeNull();
    expect(state.regions.A.owner_faction_id).toBe("red");
    expect(state.region_units.A).toEqual([stack("red", "infantry", 1)]);
  });

  it("does not capture land with only aircraft left", () => {
    addRegion(state, "A", "land", "blue", [stack("red", "fighter", 1), stack("blue", "infantry", 1)]);
    mustOk(combat.startBattle("A", "red"));
    const battle = state.active_battle!;
    battle.defenders[0].hp = 0;
    battle.stage = "awaiting_casualties";
    mustOk(combat.assignAttackerCasualties("red", []));
    expect(state.regions.A.owner_faction_id).toBe("blue");
    expect(state.region_units.A).toEqual([stack("red", "fighter", 1)]);
  });

  it("retreats only to adjacent friendly land and moves the survivors there", () => {
    addRegion(state, "A", "land", "blue", [stack("red", "infantry", 2), stack("blue", "infantry", 2)]);
    addRegion(state, "Home", "land", "red");
    addRegion(state, "Enemy", "land", "blue");
    link(state, "A", "Home");
    link(state, "A", "Enemy");
    mustOk(combat.startBattle("A", "red"));
    const battle = state.active_battle!;
    battle.stage = "awaiting_decision";
    expect(combat.legalRetreats()).toEqual(["Home"]);
    expect(combat.retreat("red", "Enemy")).toMatchObject({ ok: false, error: { code: "INVALID_RETREAT" } });
    const result = mustOk(combat.retreat("red", "Home"));
    expect(result.events.at(-1)?.payload).toMatchObject({ result: "attacker_retreated", retreat_to: "Home" });
    expect(state.region_units.A).toEqual([stack("blue", "infantry", 2)]);
    expect(state.region_units.Home).toEqual([stack("red", "infantry", 2)]);
    expect(state.regions.A.owner_faction_id).toBe("blue");
  });

  it("lets submarines strike first unless the enemy has a destroyer", () => {
    addRegion(state, "Sea", "sea", "", [stack("red", "submarine", 2), stack("blue", "battleship", 1)]);
    mustOk(combat.startBattle("Sea", "red"));
    mustOk(combat.rollRound("red"));
    const surprise = state.active_battle?.last_dice.filter((d) => d.surprise) ?? [];
    expect(surprise.map((d) => d.unit_id).sort()).toEqual(["red.submarine.1", "red.submarine.2"]);
    const surpriseHits = surprise.filter((d) => d.hit).length;
    const flagged = state.active_battle?.last_casualties.filter((c) => c.surprise) ?? [];
    expect(flagged.length).toBe(Math.min(surpriseHits, 2));
    expect(flagged.every((c) => c.side === "defender")).toBe(true);

    const other = newState();
    addRegion(other, "Sea", "sea", "", [stack("red", "submarine", 2), stack("blue", "destroyer", 1)]);
    const c = new CombatEngine(other, new PCG(4242, 1));
    mustOk(c.startBattle("Sea", "red"));
    mustOk(c.rollRound("red"));
    expect((other.active_battle?.last_dice ?? []).some((d) => d.surprise)).toBe(false);
  });

  it("boosts infantry and tactical bombers on attack only", () => {
    addRegion(state, "A", "land", "blue", [
      stack("red", "infantry", 2),
      stack("red", "artillery", 1),
      stack("red", "tactical_bomber", 1),
      stack("red", "tank", 1),
      stack("blue", "infantry", 1),
    ]);
    mustOk(combat.startBattle("A", "red"));
    const ranks = firingRanks(state.active_battle!.attackers, "attacker", state.unit_types);
    expect(ranks.get("red.infantry.1")).toBe(2);
    expect(ranks.get("red.infantry.2")).toBe(1);
    expect(ranks.get("red.tactical_bomber.1")).toBe(4);
    const defending = firingRanks(state.active_battle!.attackers, "defender", state.unit_types);
    expect(defending.get("red.tactical_bomber.1")).toBe(3);
  });

  it("auto-resolves every battle to a finish", () => {
    addRegion(state, "A", "land", "blue", [stack("red", "infantry", 4), stack("blue", "infantry", 3)]);
    combat.resolveAllBattles("red");
    expect(state.active_battle).toBeNull();
    const factions = new Set(state.region_units.A.map((e) => e.faction_id));
    expect(factions.size).toBeLessThanOrEqual(1);
  });
});

describe("session battle commands", () => {
  function demoInCombat(): { s: GameSessionStub; send: (type: string, payload?: Dict) => ReturnType<GameSessionStub["applyCommand"]> } {
    const s = new GameSessionStub();
    s.initializeDemo(12345);
    let n = 0;
    const send = (type: string, payload: Dict = {}) =>
      s.applyCommand({ command_id: `t${++n}`, player_id: s.state.current_faction_id, type, payload });
    send("end_phase");
    send("move_units", {
      moves: [{ from_region_id: "Burma", to_region_id: "India", units: [{ unit_type_id: "infantry", count: 2 }] }],
    });
    send("end_phase");
    return { s, send };
  }

  it("fights a map battle through commands and refuses to end the phase mid-battle", () => {
    const { s, send } = demoInCombat();
    expect(s.getLegalCommands("allies")).toContain("start_battle");
    expect(send("start_battle", { region_id: "India" }).result_type).toBe("ok");
    expect(send("end_phase")).toMatchObject({ result_type: "error", error: { code: "BATTLE_IN_PROGRESS" } });

    let guard = 0;
    while (s.state.active_battle != null && guard++ < 200) {
      const legal = s.getLegalCommands("allies");
      const type = legal.includes("battle_casualties") ? "battle_casualties" : "battle_roll";
      expect(send(type).result_type).toBe("ok");
    }
    expect(s.state.active_battle).toBeNull();
    expect(s.getPendingBattles("allies")).toHaveLength(0);
    expect(send("end_phase").result_type).toBe("ok");
  });

  it("auto-resolves unfought battles when the phase ends", () => {
    const { s, send } = demoInCombat();
    const result = send("end_phase");
    expect(result.result_type).toBe("ok");
    expect(result.events.some((e) => e.type === "battlefinished")).toBe(true);
    expect(s.state.current_phase).toBe("noncombat_move");
  });
});
