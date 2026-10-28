import { describe, expect, it } from "vitest";
import { EventSchemaValidator, GameSessionFactory, GameSessionStub } from "../../../src/engine";

const SCHEMA_PATH = "res://docs/event_schema.json";

describe("integration/test_event_schema", () => {
  it("test_event_schema_file_loads", () => {
    const schema = GameSessionFactory.loadJson(SCHEMA_PATH);
    expect(Object.keys(schema).length === 0).toBe(false);
    expect("required" in schema).toBe(true);
    expect(schema["required"].includes("event_id")).toBe(true);
  });

  it("test_valid_event_passes_schema", () => {
    const evt = {
      event_id: "e00001",
      sequence: 1,
      type: "unitspurchased",
      payload: { faction_id: "allies" },
      source_command_id: "cmd1",
      timestamp: 1680000000,
    };
    expect(EventSchemaValidator.validateEvent(evt)).toBe(true);
  });

  it("test_missing_field_fails_schema", () => {
    const evt = {
      event_id: "e00001",
      sequence: 1,
      type: "unitspurchased",
      payload: {},
    };
    expect(EventSchemaValidator.validateEvent(evt)).toBe(false);
  });

  it("test_stub_emitted_events_match_schema", () => {
    const stub = new GameSessionStub();
    stub.initializeDemo(12345);
    const res = stub.applyCommand({
      command_id: "schema_cmd",
      player_id: "allies",
      type: "purchase_units",
      payload: { purchases: [{ unit_type_id: "infantry", count: 1 }] },
    });
    expect(EventSchemaValidator.validateEvents(res.events)).toBe(true);
  });
});
