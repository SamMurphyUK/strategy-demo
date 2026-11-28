import { describe, expect, it } from "vitest";
import { GameSession, GameState, Region, Unit } from "../../../src/engine";
import { activePatrols, patrolEligible, patrolReach, togglePatrol } from "../../../src/engine/rules/optional/airAndNavalRaiding";

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

function unitType(state: GameState, id: string, category: "land" | "sea" | "air"): void {
  state.unit_types[id] = Unit.fromDict({ id, name: id, category, attack: 2, defense: 2, movement: 4, cost: 10, special: {} });
}

function session(phase: string): { session: GameSession; state: GameState } {
  const built = new GameState();
  built.rulesetConfig.facilitiesAndPatrols = true;
  built.turn_order = ["red", "blue"];
  unitType(built, "strategic_bomber", "air");
  unitType(built, "tactical_bomber", "air");
  unitType(built, "fighter", "air");
  const game = new GameSession();
  game.bindArena(built, 11);
  game.state.current_faction_id = "red";
  game.state.current_phase = phase;
  return { session: game, state: game.state };
}

describe("bombing, as the engine offers it", () => {
  function city(): { session: GameSession; state: GameState } {
    const built = session("combat");
    const target = region(built.state, "city", true, "blue");
    target.major_factory = true;
    target.has_factory = true;
    target.airbase = true;
    built.state.region_units.city = [
      { faction_id: "red", unit_type_id: "strategic_bomber", count: 2 },
      { faction_id: "red", unit_type_id: "fighter", count: 1 },
    ];
    return built;
  }

  it("offers the industrial raid on a major factory, with the escorts it could take", () => {
    const { session: game } = city();
    const options = game.getBombOptions("red", "city");
    expect(options.find((item) => item.facility === "factory")).toEqual({ facility: "factory", maxEscorts: 1 });
    // The airbase is a tactical bomber's target, and there are none here.
    expect(options.some((item) => item.facility === "airbase")).toBe(false);
  });

  it("offers nothing outside the combat phase, or without the optional rule", () => {
    const { session: game, state } = city();
    state.current_phase = "combat_move";
    expect(game.getBombOptions("red", "city")).toEqual([]);
    state.current_phase = "combat";
    state.rulesetConfig.facilitiesAndPatrols = false;
    expect(game.getBombOptions("red", "city")).toEqual([]);
  });

  it("reports the raid's own figures on the event", () => {
    const { session: game } = city();
    const result = game.applyCommand({ command_id: "bomb_1", player_id: "red", type: "strategic_bomb", payload: { region_id: "city", escorts: 1 } });
    expect(String(result.result_type)).toBe("ok");
    const report = (result.events as { payload?: Record<string, unknown> }[]).find((item) => item.payload?.reason === "strategic_bomb")?.payload;
    expect(report?.facility).toBe("factory");
    for (const key of ["bomber_losses", "escort_losses", "interceptor_losses", "damage", "tokens"]) {
      expect(typeof report?.[key], key).toBe("number");
    }
  });

  it("offers an interdiction of an airbase to tactical bombers", () => {
    const { session: game, state } = city();
    state.region_units.city = [{ faction_id: "red", unit_type_id: "tactical_bomber", count: 1 }];
    const options = game.getBombOptions("red", "city");
    expect(options.map((item) => item.facility)).toContain("airbase");
    const result = game.applyCommand({ command_id: "bomb_2", player_id: "red", type: "strategic_bomb", payload: { region_id: "city", facility: "airbase" } });
    const report = (result.events as { payload?: Record<string, unknown> }[]).find((item) => item.payload?.reason === "tactical_interdiction")?.payload;
    expect(report?.facility).toBe("airbase");
    expect(typeof report?.hits).toBe("number");
  });
});

describe("air patrols, as the engine allows them", () => {
  function station(): { state: GameState } {
    const { state } = session("noncombat_move");
    const base = region(state, "base", true, "red");
    base.airbase = true;
    region(state, "sea", false);
    region(state, "inland", true, "red");
    link(state, "base", "sea");
    link(state, "base", "inland");
    state.region_units.base = [{ faction_id: "red", unit_type_id: "fighter", count: 4 }];
    state.region_units.inland = [{ faction_id: "red", unit_type_id: "fighter", count: 2 }];
    return { state };
  }

  it("is possible only from an operational airbase or a carrier, up to three fighters", () => {
    const { state } = station();
    expect(patrolEligible(state, "red", "base")).toEqual({ max: 3, current: 0 });
    expect(patrolEligible(state, "red", "inland")).toBeNull();
  });

  it("is only set in the faction's non-combat move", () => {
    const { state } = station();
    state.current_phase = "combat_move";
    expect(patrolEligible(state, "red", "base")).toBeNull();
    state.current_phase = "noncombat_move";
    state.current_faction_id = "blue";
    expect(patrolEligible(state, "red", "base")).toBeNull();
  });

  it("follows what togglePatrol wrote: the count, the active patrol, and the zones it reacts to", () => {
    const { state } = station();
    expect(togglePatrol(state, "red", "base", 2)).toBeNull();
    expect(patrolEligible(state, "red", "base")).toEqual({ max: 3, current: 2 });
    expect(activePatrols(state, "red")).toEqual([{ station: "base", count: 2 }]);
    expect(patrolReach(state, "base")).toEqual(["base", "sea"]);
  });

  it("counts only the fighters still on the station", () => {
    const { state } = station();
    togglePatrol(state, "red", "base", 3);
    state.region_units.base = [{ faction_id: "red", unit_type_id: "fighter", count: 1 }];
    expect(activePatrols(state, "red")).toEqual([{ station: "base", count: 1 }]);
  });
});
