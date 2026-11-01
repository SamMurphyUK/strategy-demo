import { describe, expect, it } from "vitest";
import type { GameState } from "../../../src/engine/model/game_state";
import { cancel_phase_order } from "../../../src/engine/movement/phase_orders";
import { GameSessionStub } from "../../../src/engine/session/game_session_stub";
import type { Dict } from "../../../src/engine/model/types";

function territory(id: string, type: "land" | "sea", neighbors: string[]): Dict {
  return {
    polygon: [
      [0, 0],
      [1, 0],
      [0, 1],
    ],
    neighbors,
    metadata: {
      region_id: id,
      name: id,
      faction: "GER",
      ipc: type === "land" ? 1 : 0,
      type,
      victory: false,
      factory: false,
    },
  };
}

function boot(): GameSessionStub {
  const session = new GameSessionStub();
  session.initializeFromMap(
    {
      version: 2,
      coord_space: "svg",
      turn_order: ["ger", "ussr", "uk", "jap", "usa"],
      regions: [
        territory("a", "land", ["b"]),
        territory("b", "land", ["a", "c"]),
        territory("c", "land", ["b"]),
        territory("s1", "sea", ["s2"]),
        territory("s2", "sea", ["s1"]),
      ],
      starting_units: [
        { region_id: "a", faction_id: "ger", unit_type_id: "infantry", count: 3 },
        { region_id: "a", faction_id: "ger", unit_type_id: "tank", count: 1 },
        { region_id: "b", faction_id: "ger", unit_type_id: "infantry", count: 1 },
        { region_id: "s1", faction_id: "ger", unit_type_id: "transport", count: 1 },
      ],
    },
    1,
  );
  return session;
}

function endPhase(session: GameSessionStub, commandId: string): void {
  const result = session.applyCommand({
    command_id: commandId,
    player_id: "ger",
    type: "end_phase",
    payload: {},
  });
  expect(result.result_type).toBe("ok");
}

function move(
  session: GameSessionStub,
  commandId: string,
  from: string,
  to: string,
  unitType: string,
  count: number,
  instanceId = "",
): void {
  const unit: Dict = { unit_type_id: unitType, count };
  if (instanceId !== "") {
    unit.instance_id = instanceId;
  }
  const result = session.applyCommand({
    command_id: commandId,
    player_id: "ger",
    type: "move_units",
    payload: { moves: [{ from_region_id: from, to_region_id: to, units: [unit] }] },
  });
  expect(result.result_type).toBe("ok");
}

function stackCount(state: GameState, regionId: string, unitType: string): number {
  return (state.region_units[regionId] ?? [])
    .filter((entry) => entry.faction_id === "ger" && entry.unit_type_id === unitType && entry.instance_id === undefined)
    .reduce((sum, entry) => sum + entry.count, 0);
}

function shipRegion(state: GameState): string {
  for (const [regionId, units] of Object.entries(state.region_units)) {
    if (units.some((entry) => entry.unit_type_id === "transport")) {
      return regionId;
    }
  }
  return "";
}

function enterCombatMove(session: GameSessionStub): void {
  endPhase(session, "to_combat_move");
  expect(session.state.current_phase).toBe("combat_move");
}

describe("phase-start snapshot replay", () => {
  it("captures a fresh snapshot when a movement phase begins", () => {
    const session = boot();
    expect(session.state.current_phase).toBe("purchase");
    expect(session.state.phase_start_snapshot).toBeNull();
    expect(session.state.phase_orders).toEqual([]);

    enterCombatMove(session);
    const combatStart = session.state.phase_start_snapshot;
    expect(combatStart).not.toBeNull();
    expect(combatStart).not.toBe(session.state);
    expect(combatStart!.current_phase).toBe("combat_move");
    expect(combatStart!.phase_orders).toEqual([]);
    expect(combatStart!.phase_start_snapshot).toBeNull();
    expect(stackCount(combatStart!, "a", "infantry")).toBe(3);
    expect(stackCount(combatStart!, "a", "tank")).toBe(1);

    move(session, "one_step", "a", "b", "infantry", 1);
    expect(stackCount(session.state, "a", "infantry")).toBe(3);
    expect(session.state.phase_orders).toHaveLength(1);
    expect(stackCount(combatStart!, "a", "infantry")).toBe(3);
    expect(combatStart!.phase_orders).toEqual([]);

    endPhase(session, "to_combat");
    expect(session.state.current_phase).toBe("combat");
    expect(session.state.phase_start_snapshot).toBe(combatStart);

    endPhase(session, "to_noncombat");
    expect(session.state.current_phase).toBe("noncombat_move");
    expect(session.state.phase_orders).toEqual([]);
    const noncombatStart = session.state.phase_start_snapshot;
    expect(noncombatStart).not.toBe(combatStart);
    expect(noncombatStart!.current_phase).toBe("noncombat_move");
    expect(stackCount(noncombatStart!, "a", "infantry")).toBe(2);
    expect(stackCount(noncombatStart!, "b", "infantry")).toBe(2);
  });

  it("records each successful move on the phase order list", () => {
    const session = boot();
    enterCombatMove(session);
    const transportId = String(
      session.state.region_units.s1.find((entry) => entry.unit_type_id === "transport")?.instance_id ?? "",
    );
    expect(transportId).not.toBe("");

    move(session, "inf_ab", "a", "b", "infantry", 1);
    move(session, "tank_ac", "a", "c", "tank", 1);
    move(session, "inf_bc", "b", "c", "infantry", 1);
    move(session, "ship", "s1", "s2", "transport", 1, transportId);

    const orders = session.state.phase_orders;
    expect(orders.map((order) => order.id)).toEqual(["ord_1", "ord_2", "ord_3", "ord_4"]);
    expect(orders.map((order) => [order.unitType, order.count, order.fromRegionId, order.toRegionId, order.stepsUsed])).toEqual([
      ["infantry", 1, "a", "b", 1],
      ["tank", 1, "a", "c", 2],
      ["infantry", 1, "b", "c", 1],
      ["transport", 1, "s1", "s2", 1],
    ]);
    const index = (id: string) => Object.keys(session.state.regions).indexOf(id);
    expect(orders[1].path).toEqual([index("a"), index("b"), index("c")]);
    expect(orders[0].shipInstanceIds).toBeUndefined();
    expect(orders[3].faction).toBe("ger");
    expect(orders[3].shipInstanceIds).toEqual([transportId]);
  });

  it("cancels an order out of sequence by restoring the snapshot and replaying the rest", () => {
    const session = boot();
    enterCombatMove(session);
    const combatStart = session.state.phase_start_snapshot;
    const transportId = String(
      session.state.region_units.s1.find((entry) => entry.unit_type_id === "transport")?.instance_id ?? "",
    );
    move(session, "inf_ab", "a", "b", "infantry", 1);
    move(session, "tank_ac", "a", "c", "tank", 1);
    move(session, "inf_bc", "b", "c", "infantry", 1);
    move(session, "ship", "s1", "s2", "transport", 1, transportId);

    const clock = globalThis as unknown as { performance: { now(): number } };
    const started = clock.performance.now();
    cancel_phase_order(session.state, "ord_2");
    expect(clock.performance.now() - started).toBeLessThan(10);

    expect(session.state.phase_start_snapshot).toBe(combatStart);
    expect(stackCount(combatStart!, "a", "tank")).toBe(1);
    expect(stackCount(session.state, "a", "infantry")).toBe(3);
    expect(stackCount(session.state, "a", "tank")).toBe(1);
    expect(stackCount(session.state, "b", "infantry")).toBe(1);
    expect(stackCount(session.state, "c", "infantry")).toBe(0);
    expect(stackCount(session.state, "c", "tank")).toBe(0);
    expect(shipRegion(session.state)).toBe("s1");

    expect(session.state.phase_orders.map((order) => [order.unitType, order.fromRegionId, order.toRegionId])).toEqual([
      ["infantry", "a", "b"],
      ["infantry", "b", "c"],
      ["transport", "s1", "s2"],
    ]);
    expect(session.state.phase_orders.map((order) => order.id)).toEqual(["ord_1", "ord_2", "ord_3"]);
    expect(session.state.phase_orders[2].shipInstanceIds).toEqual([transportId]);
  });

  it("keeps a noncombat move as a cancellable order until the phase ends", () => {
    const session = boot();
    enterCombatMove(session);
    endPhase(session, "to_combat");
    endPhase(session, "to_noncombat");
    expect(session.state.current_phase).toBe("noncombat_move");

    move(session, "inf_ab", "a", "b", "infantry", 1);
    expect(stackCount(session.state, "a", "infantry")).toBe(3);
    expect(stackCount(session.state, "b", "infantry")).toBe(1);
    expect(session.state.phase_orders.map((order) => [order.unitType, order.count, order.fromRegionId, order.toRegionId])).toEqual([
      ["infantry", 1, "a", "b"],
    ]);

    cancel_phase_order(session.state, session.state.phase_orders[0].id);
    expect(session.state.phase_orders).toEqual([]);
    expect(stackCount(session.state, "a", "infantry")).toBe(3);
    expect(stackCount(session.state, "b", "infantry")).toBe(1);

    move(session, "inf_ab_again", "a", "b", "infantry", 1);
    endPhase(session, "to_mobilize");
    expect(session.state.current_phase).toBe("mobilize");
    expect(stackCount(session.state, "a", "infantry")).toBe(2);
    expect(stackCount(session.state, "b", "infantry")).toBe(2);
  });
});
