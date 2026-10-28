import { describe, expect, it } from "vitest";
import { MovementValidator } from "../../../src/engine";
import { TestStateBuilder } from "../helpers/test_state_builder";

describe("validator/test_movement_validator", () => {
  it("test_basic_movement_range", () => {
    const builder = new TestStateBuilder();
    builder.withRegion("A").withRegion("B").withRegion("C");
    builder.withAdjacent("A", "B").withAdjacent("B", "C");
    builder.withUnitType("infantry", "land", 2);
    builder.withUnit(1, "infantry", "A");

    const state = builder.buildState();
    const ruleset = builder.buildRuleset();
    ruleset.unit_move_ranges = { infantry: 2 };

    const validator = new MovementValidator();
    const preview = validator.getLegalMovesForUnit(1, state, ruleset);
    expect(preview.legal_regions.includes("B")).toBe(true);
    expect(preview.legal_regions.includes("C")).toBe(true);
  });

  it("test_land_unit_cannot_enter_sea_region", () => {
    const builder = new TestStateBuilder();
    builder.withRegion("land_a", true, "red");
    builder.withRegion("sea_1", false, "");
    builder.withAdjacent("land_a", "sea_1");
    builder.withUnitType("infantry", "land", 1);
    builder.withStackUnit("infantry", "land_a", "red");

    const state = builder.buildState();
    state.current_phase = "combat_move";
    state.current_faction_id = "red";
    const ruleset = builder.buildRuleset();
    const validator = new MovementValidator();

    const result = validator.validateStackMove("land_a", "sea_1", "infantry", "red", 1, state, ruleset);
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe("MOVE_ILLEGAL_DESTINATION");

    const legal = validator.getLegalDestinationsForStack("land_a", "infantry", "red", state, ruleset);
    expect(legal.includes("sea_1")).toBe(false);
  });

  it("test_noncombat_move_cannot_enter_hostile_region", () => {
    const builder = new TestStateBuilder();
    builder.withRegion("home", true, "red");
    builder.withRegion("enemy", true, "blue");
    builder.withAdjacent("home", "enemy");
    builder.withUnitType("infantry", "land", 1);
    builder.withStackUnit("infantry", "home", "red");

    const state = builder.buildState();
    state.current_phase = "noncombat_move";
    state.current_faction_id = "red";
    const ruleset = builder.buildRuleset();
    const validator = new MovementValidator();

    const result = validator.validateStackMove("home", "enemy", "infantry", "red", 1, state, ruleset);
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe("MOVE_ILLEGAL_DESTINATION");
  });

  it("test_combat_move_can_enter_hostile_region", () => {
    const builder = new TestStateBuilder();
    builder.withRegion("home", true, "red");
    builder.withRegion("enemy", true, "blue");
    builder.withAdjacent("home", "enemy");
    builder.withUnitType("infantry", "land", 1);
    builder.withStackUnit("infantry", "home", "red");

    const state = builder.buildState();
    state.current_phase = "combat_move";
    state.current_faction_id = "red";
    const ruleset = builder.buildRuleset();
    const validator = new MovementValidator();

    const result = validator.validateStackMove("home", "enemy", "infantry", "red", 1, state, ruleset);
    expect(result.ok, "Expected combat move into hostile region to be legal").toBe(true);
  });

  it("test_cannot_move_units_that_arrived_this_phase", () => {
    const builder = new TestStateBuilder();
    builder.withRegion("home", true, "red");
    builder.withRegion("forward", true, "red");
    builder.withAdjacent("home", "forward");
    builder.withUnitType("infantry", "land", 1);
    builder.withStackUnit("infantry", "home", "red", 2);

    const state = builder.buildState();
    state.current_phase = "combat_move";
    state.current_faction_id = "red";
    const ruleset = builder.buildRuleset();
    const validator = new MovementValidator();

    const first = validator.validateStackMove("home", "forward", "infantry", "red", 1, state, ruleset);
    expect(first.ok).toBe(true);
    state.recordStackArrival("red", "forward", "infantry", 1);
    state.region_units["home"] = [{ faction_id: "red", unit_type_id: "infantry", count: 1 }];
    state.region_units["forward"] = [{ faction_id: "red", unit_type_id: "infantry", count: 1 }];

    const second = validator.validateStackMove("forward", "home", "infantry", "red", 1, state, ruleset);
    expect(second.ok).toBe(false);
    expect(second.errors[0].code).toBe("MOVE_ALREADY_MOVED");

    const third = validator.validateStackMove("home", "forward", "infantry", "red", 1, state, ruleset);
    expect(third.ok, "Unmoved stack at source should still be movable").toBe(true);
  });
});
