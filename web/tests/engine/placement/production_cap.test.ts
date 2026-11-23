import { describe, expect, it } from "vitest";
import { GameState, Region, TurnEngine } from "../../../src/engine";
import { factorySlots, maxAffordable, purchaseUnitCap, snapshotProduction } from "../../../src/engine/placement/productionCap";

function land(id: string, owner: string, ipc: number, major = false): Region {
  return Region.fromDict({
    id,
    name: id,
    type: "land",
    owner_faction_id: owner,
    ipc_value: ipc,
    has_factory: true,
    major_factory: major,
  });
}

describe("production cap", () => {
  it("sums the Industrial Output of occupied factories on a quick map", () => {
    const state = new GameState();
    state.scenarioId = "SCENARIO_1942_QUICK";
    state.regions.moscow = land("moscow", "ussr", 8);
    state.regions.karelia = land("karelia", "ussr", 2);
    state.regions.berlin = land("berlin", "ger", 10);
    expect(purchaseUnitCap(state, "ussr")).toBe(10);
    expect(factorySlots(state, state.regions.moscow)).toBe(8);
  });

  it("uses 10 for a major and 3 for a minor on Global 1940", () => {
    const state = new GameState();
    state.scenarioId = "SCENARIO_GLOBAL_1940";
    state.regions.moscow = land("moscow", "soviet_union", 8, true);
    state.regions.karelia = land("karelia", "soviet_union", 2, false);
    expect(purchaseUnitCap(state, "soviet_union")).toBe(13);
  });

  it("freezes the cap when mobilize ends, then keeps it after a factory is lost", () => {
    const state = new GameState();
    state.current_faction_id = "ussr";
    state.current_phase = "mobilize";
    state.turn_order = ["ussr"];
    state.regions.moscow = land("moscow", "ussr", 8);
    const turn = new TurnEngine(state);
    turn.advancePhase();
    expect(state.current_phase).toBe("collect_income");
    expect(state.turnBuildCapacity.ussr).toEqual({ maxUnits: 8, breakdown: [{ territoryId: "moscow", slots: 8 }] });
    state.regions.moscow.owner_faction_id = "ger";
    expect(purchaseUnitCap(state, "ussr")).toBe(8);
    snapshotProduction(state, "ussr");
    expect(purchaseUnitCap(state, "ussr")).toBe(0);
  });

  it("subtracts repair damage and ignores a factory captured after the snapshot", () => {
    const quick = new GameState();
    quick.scenarioId = "SCENARIO_1942_QUICK";
    quick.regions.moscow = land("moscow", "ussr", 8);
    quick.repairTokens.moscow = 2;
    expect(factorySlots(quick, quick.regions.moscow)).toBe(6);

    const global = new GameState();
    global.scenarioId = "SCENARIO_GLOBAL_1940";
    global.current_faction_id = "soviet_union";
    global.current_phase = "mobilize";
    global.turn_order = ["soviet_union"];
    global.regions.moscow = land("moscow", "soviet_union", 8, true);
    global.regions.karelia = land("karelia", "soviet_union", 2, false);
    global.repairTokens.moscow = 2;
    global.repairTokens.karelia = 1;
    const turn = new TurnEngine(global);
    turn.advancePhase();
    expect(global.turnBuildCapacity.soviet_union).toEqual({
      maxUnits: 10,
      breakdown: [
        { territoryId: "karelia", slots: 2 },
        { territoryId: "moscow", slots: 8 },
      ],
    });
    global.regions.berlin = land("berlin", "soviet_union", 10, true);
    expect(purchaseUnitCap(global, "soviet_union")).toBe(10);
  });

  it("limits a unit by the Industrial Output and the slots that remain", () => {
    expect(maxAffordable(3, 15, 14)).toBe(5);
    expect(maxAffordable(6, 15, 2)).toBe(2);
    expect(maxAffordable(0, 15, 14)).toBe(0);
  });
});
