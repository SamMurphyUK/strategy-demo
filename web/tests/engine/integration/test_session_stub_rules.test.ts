import { beforeEach, describe, expect, it } from "vitest";
import { type Dict, EventSchemaValidator, GameSessionStub } from "../../../src/engine";

function hasEventType(events: Dict[], typeName: string): boolean {
  return events.some((evt) => String(evt.type ?? "") === typeName);
}

function advanceToMobilize(s: GameSessionStub): void {
  for (let i = 0; i < 4; i++) {
    s.applyCommand({
      command_id: `adv_${s.getDemoSeed()}_${i}`,
      player_id: s.state.current_faction_id,
      type: "end_phase",
      payload: {},
    });
  }
  expect(s.state.current_phase).toBe("mobilize");
}

function axisFactoryRegion(s: GameSessionStub): string {
  for (const rid of Object.keys(s.state.regions)) {
    const r = s.state.regions[rid];
    if (r.has_factory && r.owner_faction_id !== s.state.current_faction_id) {
      return rid;
    }
  }
  return "region_2";
}

describe("integration/test_session_stub_rules", () => {
  let demoStub: GameSessionStub;

  beforeEach(() => {
    demoStub = new GameSessionStub();
    demoStub.initializeDemo(12345);
  });

  it("test_snapshot_includes_cost_table_and_applied_event_ids", () => {
    const snap = demoStub.getState();
    expect("cost_table" in snap).toBe(true);
    expect("pending_purchases" in snap).toBe(true);
    expect("applied_event_ids" in snap).toBe(true);
    expect(snap["cost_table"]["infantry"]).toBe(3);
  });

  it("test_rejects_purchase_when_ipc_insufficient", () => {
    demoStub.state.ipc[demoStub.state.current_faction_id] = 2;
    const res = demoStub.applyCommand({
      command_id: "cmd_no_ipc",
      player_id: demoStub.state.current_faction_id,
      type: "purchase_units",
      payload: { purchases: [{ unit_type_id: "infantry", count: 1 }] },
    });
    expect(res["result_type"]).toBe("error");
    expect(res["error"]?.["code"]).toBe("PURCHASE_FAILED");
    expect(res["events"][0]["type"]).toBe("purchasefailed");
    expect(hasEventType(res["events"], "unitspurchased")).toBe(false);
  });

  it("test_successful_purchase_emits_unitspurchased_only", () => {
    const res = demoStub.applyCommand({
      command_id: "cmd_ok",
      player_id: demoStub.state.current_faction_id,
      type: "purchase_units",
      payload: { purchases: [{ unit_type_id: "infantry", count: 1 }] },
    });
    expect(res["result_type"]).toBe("ok");
    expect(hasEventType(res["events"], "unitspurchased")).toBe(true);
    expect(hasEventType(res["events"], "purchasefailed")).toBe(false);
  });

  it("test_duplicate_command_id_returns_prior_result", () => {
    const cmd = {
      command_id: "cmd_dup",
      player_id: demoStub.state.current_faction_id,
      type: "purchase_units",
      payload: { purchases: [{ unit_type_id: "infantry", count: 1 }] },
    };
    const first = demoStub.applyCommand(cmd);
    const ipcAfterFirst = demoStub.getState()["ipc"][demoStub.state.current_faction_id];
    const second = demoStub.applyCommand(cmd);
    expect(first).toEqual(second);
    expect(demoStub.getState()["ipc"][demoStub.state.current_faction_id]).toBe(ipcAfterFirst);
  });

  it("test_place_rejects_unowned_region", () => {
    demoStub.applyCommand({
      command_id: "p1",
      player_id: demoStub.state.current_faction_id,
      type: "purchase_units",
      payload: { purchases: [{ unit_type_id: "infantry", count: 1 }] },
    });
    advanceToMobilize(demoStub);
    const res = demoStub.applyCommand({
      command_id: "pl1",
      player_id: demoStub.state.current_faction_id,
      type: "place_units",
      payload: {
        placements: [{
          region_id: axisFactoryRegion(demoStub),
          units: [{ unit_type_id: "infantry", count: 1 }],
        }],
      },
    });
    expect(res["result_type"]).toBe("error");
    expect(res["error"]?.["code"]).toBe("PLACEMENT_INVALID");
  });

  it("test_mobilize_end_forfeits_pending_and_emits_event", () => {
    demoStub.applyCommand({
      command_id: "p2",
      player_id: demoStub.state.current_faction_id,
      type: "purchase_units",
      payload: { purchases: [{ unit_type_id: "infantry", count: 1 }] },
    });
    advanceToMobilize(demoStub);
    const res = demoStub.applyCommand({
      command_id: "ep1",
      player_id: demoStub.state.current_faction_id,
      type: "end_phase",
      payload: {},
    });
    expect(res["result_type"]).toBe("ok");
    expect(hasEventType(res["events"], "placementforfeited")).toBe(true);
    expect(demoStub.getState()["pending_purchases"][demoStub.state.current_faction_id]).toEqual([]);
  });

  it("test_events_conform_to_schema", () => {
    const res = demoStub.applyCommand({
      command_id: "schema1",
      player_id: demoStub.state.current_faction_id,
      type: "purchase_units",
      payload: { purchases: [{ unit_type_id: "infantry", count: 1 }] },
    });
    for (const evt of res["events"]) {
      expect(EventSchemaValidator.validateEvent(evt)).toBe(true);
      expect(GameSessionStub.validateEventShape(evt)).toBe(true);
      expect(String(evt["event_id"]) === "").toBe(false);
      expect(String(evt["source_command_id"]) === "").toBe(false);
    }
  });

  it("test_deterministic_with_same_seed", () => {
    const a = new GameSessionStub();
    a.initializeDemo(777);
    const b = new GameSessionStub();
    b.initializeDemo(777);
    const cmd = {
      command_id: "d1",
      player_id: demoStub.state.current_faction_id,
      type: "purchase_units",
      payload: { purchases: [{ unit_type_id: "infantry", count: 1 }] },
    };
    const ra = a.applyCommand(cmd);
    const rb = b.applyCommand(cmd);
    expect(ra["events"][0]["type"]).toBe(rb["events"][0]["type"]);
    expect(a.getState()["ipc"]).toEqual(b.getState()["ipc"]);
  });
});
