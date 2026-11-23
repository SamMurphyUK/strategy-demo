import { describe, expect, it } from "vitest";
import { GameSessionStub, GameState, Region, Ruleset } from "../../../src/engine";
import {
  factoryBlockReason,
  factoryPrice,
  factorySites,
  factoryRoom,
} from "../../../src/engine/placement/factoryRules";

function land(id: string, owner: string, ipc: number, factory = false, major = false, origin = owner): Region {
  return Region.fromDict({
    id,
    name: id,
    type: "land",
    owner_faction_id: owner,
    original_owner_id: origin,
    ipc_value: ipc,
    has_factory: factory,
    major_factory: major,
  });
}

describe("factory purchases", () => {
  it("prices a quick complex at two-thirds of the Global cost", () => {
    const quick = new GameState();
    quick.scenarioId = "SCENARIO_1942_QUICK";
    const global = new GameState();
    global.scenarioId = "SCENARIO_GLOBAL_1940";
    expect(factoryPrice(global, "minor_factory")).toBe(12);
    expect(factoryPrice(global, "major_factory")).toBe(30);
    expect(factoryPrice(global, "factory_upgrade")).toBe(20);
    expect(factoryPrice(quick, "minor_factory")).toBe(8);
    expect(factoryPrice(quick, "major_factory")).toBe(20);
    expect(factoryPrice(quick, "factory_upgrade")).toBe(13);
  });

  it("allows a minor from 2 Industrial Output and a major only on a territory you started with", () => {
    const state = new GameState();
    state.scenarioId = "SCENARIO_GLOBAL_1940";
    state.regions.poor = land("poor", "ussr", 1);
    state.regions.open = land("open", "ussr", 2);
    state.regions.home = land("home", "ussr", 4);
    state.regions.held = land("held", "ussr", 4, false, false, "ger");
    state.regions.minor = land("minor", "ussr", 4, true, false);
    expect(factorySites(state, "ussr", "minor_factory").sort()).toEqual(["held", "home", "open"]);
    expect(factorySites(state, "ussr", "major_factory")).toEqual(["home"]);
    expect(factorySites(state, "ussr", "factory_upgrade")).toEqual(["minor"]);
    expect(factoryBlockReason(state, "ger", "minor_factory")).toMatch(/2 Industrial Output/);
    state.territories_captured_this_turn.open = true;
    expect(factorySites(state, "ussr", "minor_factory").sort()).toEqual(["held", "home"]);
  });

  it("keeps a new major from using the only territory a minor could also take", () => {
    const state = new GameState();
    state.regions.home = land("home", "ussr", 4);
    expect(factoryRoom(state, "ussr", "minor_factory", {})).toBe(1);
    expect(factoryRoom(state, "ussr", "major_factory", { major_factory: 1 })).toBe(0);
    expect(factoryRoom(state, "ussr", "minor_factory", { major_factory: 1 })).toBe(0);
  });

  it("buys a minor and places it on an open territory", () => {
    const session = new GameSessionStub();
    session.initializeDemo(12345);
    const faction = session.state.current_faction_id;
    session.state.ipc[faction] = 40;
    const bought = session.applyCommand({
      command_id: "buy-minor",
      player_id: faction,
      type: "purchase_units",
      payload: { purchases: [{ unit_type_id: "minor_factory", count: 1 }] },
    });
    expect(bought.result_type).toBe("ok");
    session.state.current_phase = "mobilize";
    const rules = new Ruleset();
    const sites = rules.getLegalMobilizeRegions(faction, "minor_factory", session.state);
    expect(sites.length).toBeGreaterThan(0);
    const placed = session.applyCommand({
      command_id: "place-minor",
      player_id: faction,
      type: "place_units",
      payload: { placements: [{ region_id: sites[0], units: [{ unit_type_id: "minor_factory", count: 1 }] }] },
    });
    expect(placed.result_type).toBe("ok");
    expect(session.state.regions[sites[0]!]?.has_factory).toBe(true);
    expect(session.state.regions[sites[0]!]?.major_factory).toBe(false);
    expect(session.state.region_units[sites[0]!]?.some((unit) => unit.unit_type_id === "minor_factory")).toBe(false);
  });
});
