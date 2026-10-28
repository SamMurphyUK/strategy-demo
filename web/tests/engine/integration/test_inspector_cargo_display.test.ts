import { describe, expect, it } from "vitest";
import { RegionUnitDisplay } from "../../../src/engine";
import { TestStateBuilder } from "../helpers/test_state_builder";

describe("integration/test_inspector_cargo_display", () => {
  it("test_cargo_summary_empty_transport", () => {
    const state = new TestStateBuilder().withUnitType("transport", "sea", 2).buildState();
    state.transport_instances["transport_allies_001"] = {
      instance_id: "transport_allies_001",
      unit_type_id: "transport",
      cargo: [],
      region_id: "sea_1",
    };
    const lines = RegionUnitDisplay.cargoSummaryLines(state, "transport_allies_001");
    expect(lines.length).toBe(1);
    expect(String(lines[0])).toBe("Empty");
  });

  it("test_cargo_summary_lists_loaded_units", () => {
    const state = new TestStateBuilder().withUnitType("transport", "sea", 2).buildState();
    state.transport_instances["transport_allies_001"] = {
      instance_id: "transport_allies_001",
      unit_type_id: "transport",
      cargo: [
        { unit_type_id: "infantry", count: 2 },
        { unit_type_id: "tank", count: 1 },
      ],
      region_id: "sea_1",
    };
    const lines = RegionUnitDisplay.cargoSummaryLines(state, "transport_allies_001");
    expect(lines.length).toBe(2);
    expect(lines.includes("Infantry × 2")).toBe(true);
    expect(lines.includes("Tank × 1")).toBe(true);
  });

  it("test_is_container_unit_detects_transport", () => {
    const state = new TestStateBuilder()
      .withUnitType("transport", "sea", 2)
      .withUnitType("infantry", "land", 1)
      .buildState();
    state.unit_types["transport"].container = { capacity: 2 };
    expect(RegionUnitDisplay.isContainerUnit(state, "transport")).toBe(true);
    expect(RegionUnitDisplay.isContainerUnit(state, "infantry")).toBe(false);
  });
});
