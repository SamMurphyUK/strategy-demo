import { beforeEach, describe, expect, it } from "vitest";
import { Command, EconomyEngine, Faction, GameEventType, GameState, Region, Unit } from "../../../src/engine";

describe("core/test_economy", () => {
  let state: GameState;
  let economy: EconomyEngine;

  beforeEach(() => {
    state = new GameState();
    state.unit_types["infantry"] = Unit.fromDict({
      id: "infantry", name: "Infantry", category: "land",
      attack: 1, defense: 2, movement: 1, cost: 3,
    });
    state.unit_types["tank"] = Unit.fromDict({
      id: "tank", name: "Tank", category: "land",
      attack: 3, defense: 3, movement: 2, cost: 6,
    });
    state.factions["red"] = Faction.fromDict({ id: "red", name: "Red", color: "#FF0000", starting_ipc: 24 });
    state.ipc["red"] = 24;
    state.pending_purchases["red"] = [];
    state.regions["capital"] = Region.fromDict({
      id: "capital", name: "Capital", type: "land",
      ipc_value: 8, owner_faction_id: "red",
      is_capital: true, has_factory: true,
    });
    state.regions["territory"] = Region.fromDict({
      id: "territory", name: "Territory", type: "land",
      ipc_value: 4, owner_faction_id: "red",
      is_capital: false, has_factory: false,
    });
    economy = new EconomyEngine(state);
  });

  it("test_purchase_deducts_ipc", () => {
    const cmd = Command.fromDict({
      command_id: "c1", player_id: "red", type: "purchase_units",
      payload: { purchases: [{ unit_type_id: "infantry", count: 3 }] },
    });
    economy.processPurchase(cmd);
    expect(state.getFactionIpc("red"), "Should deduct 9 IPC (3 infantry × 3)").toBe(15);
  });

  it("test_purchase_multiple_unit_types", () => {
    const cmd = Command.fromDict({
      command_id: "c1", player_id: "red", type: "purchase_units",
      payload: { purchases: [
        { unit_type_id: "infantry", count: 2 },
        { unit_type_id: "tank", count: 1 },
      ] },
    });
    economy.processPurchase(cmd);
    expect(state.getFactionIpc("red"), "Should deduct 12 IPC").toBe(12);
  });

  it("test_purchase_records_pending", () => {
    const cmd = Command.fromDict({
      command_id: "c1", player_id: "red", type: "purchase_units",
      payload: { purchases: [{ unit_type_id: "infantry", count: 4 }] },
    });
    economy.processPurchase(cmd);
    const pending = state.pending_purchases["red"];
    expect(pending.length, "Should have 1 pending purchase").toBe(1);
    expect(pending[0].unit_type_id).toBe("infantry");
    expect(pending[0].count).toBe(4);
  });

  it("test_purchase_emits_event", () => {
    const cmd = Command.fromDict({
      command_id: "c1", player_id: "red", type: "purchase_units",
      payload: { purchases: [{ unit_type_id: "infantry", count: 2 }] },
    });
    const events = economy.processPurchase(cmd);
    expect(events.length).toBe(1);
    expect(events[0].type).toBe(GameEventType.UNITS_PURCHASED);
    expect(events[0].payload.faction_id).toBe("red");
    expect(events[0].payload.units[0].unit_type_id).toBe("infantry");
    expect(events[0].payload.units[0].count).toBe(2);
    expect(events[0].payload.cost).toBe(6);
  });

  it("test_collect_income_from_owned_land", () => {
    economy.collectIncome("red");
    expect(state.getFactionIpc("red"), "Should add 12 IPC").toBe(36);
  });

  it("test_collect_income_ignores_sea_zones", () => {
    state.regions["sea_1"] = Region.fromDict({
      id: "sea_1", name: "Sea", type: "sea",
      ipc_value: 0, owner_faction_id: "",
      is_capital: false, has_factory: false,
    });
    economy.collectIncome("red");
    expect(state.getFactionIpc("red"), "Sea zones don't affect income").toBe(36);
  });

  it("test_collect_income_ignores_enemy_territory", () => {
    state.regions["enemy"] = Region.fromDict({
      id: "enemy", name: "Enemy", type: "land",
      ipc_value: 6, owner_faction_id: "blue",
      is_capital: false, has_factory: false,
    });
    economy.collectIncome("red");
    expect(state.getFactionIpc("red"), "Enemy territory doesn't count").toBe(36);
  });

  it("test_collect_income_emits_event", () => {
    const events = economy.collectIncome("red");
    expect(events.length).toBe(1);
    expect(events[0].type).toBe(GameEventType.INCOME_COLLECTED);
    expect(events[0].payload.faction_id).toBe("red");
    expect(events[0].payload.amount).toBe(12);
    expect(events[0].payload.new_total).toBe(36);
  });
});
