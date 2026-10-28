import { describe, expect, it } from "vitest";
import { TransportLoadValidator } from "../../../src/engine";
import { TestStateBuilder } from "../helpers/test_state_builder";

describe("validator/test_transport_load_validator", () => {
  it("test_cannot_load_if_unit_already_moved", () => {
    const builder = new TestStateBuilder();
    builder.withRegion("coast", true, "red");
    builder.withRegion("sea_1", false, "");
    builder.withAdjacent("coast", "sea_1");
    builder.withUnitType("infantry", "land", 1);
    builder.withUnitType("transport", "sea", 2);
    builder.withStackUnit("infantry", "coast", "red", 2);

    const state = builder.buildState();
    state.regions["coast"].has_factory = false;
    state.current_phase = "combat_move";
    state.recordStackEmbark("red", "coast", "infantry", 1);
    state.transport_instances["transport_red_001"] = {
      instance_id: "transport_red_001",
      unit_type_id: "transport",
      region_id: "sea_1",
      cargo: [],
    };
    state.region_units["sea_1"] = [{
      faction_id: "red",
      unit_type_id: "transport",
      instance_id: "transport_red_001",
      count: 1,
    }];

    const validator = new TransportLoadValidator();
    expect(validator.canLoadUnits(
      "transport_red_001",
      "coast",
      [{ unit_type_id: "infantry", count: 1 }],
      "red",
      state,
    )).toBe(false);
  });

  it("test_transport_cargo_capacity_rules", () => {
    const builder = new TestStateBuilder();
    builder.withRegion("coast", true, "red");
    builder.withRegion("sea_1", false, "");
    builder.withAdjacent("coast", "sea_1");
    builder.withUnitType("infantry", "land", 1);
    builder.withUnitType("artillery", "land", 1);
    builder.withUnitType("transport", "sea", 2);
    builder.withStackUnit("infantry", "coast", "red", 2);
    builder.withStackUnit("artillery", "coast", "red", 1);

    const state = builder.buildState();
    state.current_phase = "combat_move";
    state.transport_instances["transport_red_001"] = {
      instance_id: "transport_red_001",
      unit_type_id: "transport",
      region_id: "sea_1",
      cargo: [
        { unit_type_id: "infantry", count: 1 },
        { unit_type_id: "artillery", count: 1 },
      ],
    };
    state.region_units["sea_1"] = [{
      faction_id: "red",
      unit_type_id: "transport",
      instance_id: "transport_red_001",
      count: 1,
    }];

    const validator = new TransportLoadValidator();
    expect(validator.canLoadUnits(
      "transport_red_001", "coast", [{ unit_type_id: "infantry", count: 1 }], "red", state,
    )).toBe(false);
  });
});
