import { describe, expect, it } from "vitest";
import {
  type Dict,
  EventSchemaValidator,
  GameEvent,
  GameEventType,
  GameSessionAdapter,
  GameSessionStub,
} from "../../../src/engine";

function assertNormalized(evt: Dict, expectedSource: string): void {
  expect(GameSessionAdapter.validateEventShape(evt)).toBe(true);
  expect(EventSchemaValidator.validateEvent(evt)).toBe(true);
  expect(evt["source_command_id"]).toBe(expectedSource);
  expect("timestamp" in evt).toBe(true);
  expect(Number.isInteger(evt["timestamp"])).toBe(true);
}

describe("integration/test_session_adapter_normalization", () => {
  it("test_normalizes_stub_event", () => {
    const demoStub = new GameSessionStub();
    demoStub.initializeDemo(42);
    const adapter = GameSessionAdapter.fromSession(demoStub);
    const res = adapter.applyCommand({
      command_id: "norm_stub",
      player_id: demoStub.state.current_faction_id,
      type: "purchase_units",
      payload: { purchases: [{ unit_type_id: "infantry", count: 1 }] },
    });
    const evt: Dict = res["events"][0];
    assertNormalized(evt, "norm_stub");
  });

  it("test_normalizes_full_engine_style_event", () => {
    const adapter = GameSessionAdapter.fromSession(null);
    const raw = GameEvent.create(
      GameEventType.UNITS_PURCHASED,
      { faction_id: "allies", units: [{ unit_type_id: "infantry", count: 1 }], cost: 3 },
      5,
    );
    const normalized = adapter.toCanonicalEvent(raw, "full_cmd_1");
    assertNormalized(normalized, "full_cmd_1");
    expect(normalized["type"]).toBe("unitspurchased");
    expect(normalized["event_id"]).toBe("e00005");
  });

  it("test_normalizes_underscore_event_id", () => {
    const adapter = GameSessionAdapter.fromSession(null);
    const rawDict = {
      event_id: "e_00012",
      sequence: 12,
      type: "units_placed",
      payload: { faction_id: "allies" },
    };
    const normalized = adapter.toCanonicalEvent(rawDict, "cmd_x");
    expect(normalized["event_id"]).toBe("e00012");
    expect(normalized["type"]).toBe("unitsplaced");
    expect(normalized["source_command_id"]).toBe("cmd_x");
  });
});
