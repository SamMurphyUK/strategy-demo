import { describe, expect, it } from "vitest";
import { MovementValidator } from "../../../src/engine";
import { TestStateBuilder } from "../helpers/test_state_builder";

describe("validator/test_sea_unit_rules", () => {
  it("test_sea_unit_cannot_mobilize_at_factory_land", () => {
    const builder = new TestStateBuilder();
    builder.withRegion("factory", true, "red");
    builder.withRegion("sea_1", false, "");
    builder.withAdjacent("factory", "sea_1");
    builder.withUnitType("transport", "sea", 2);

    const state = builder.buildState();
    state.regions["factory"].has_factory = true;
    const ruleset = builder.buildRuleset();

    expect(ruleset.canMobilizeUnitAt("transport", "factory", "red", state)).toBe(false);
    expect(ruleset.canMobilizeUnitAt("transport", "sea_1", "red", state)).toBe(true);
  });

  it("test_land_unit_still_mobilizes_at_owned_factory", () => {
    const builder = new TestStateBuilder();
    builder.withRegion("factory", true, "red");
    builder.withRegion("sea_1", false, "");
    builder.withAdjacent("factory", "sea_1");
    builder.withUnitType("infantry", "land", 1);

    const state = builder.buildState();
    state.regions["factory"].has_factory = true;
    const ruleset = builder.buildRuleset();

    expect(ruleset.canMobilizeUnitAt("infantry", "factory", "red", state)).toBe(true);
    expect(ruleset.canMobilizeUnitAt("infantry", "sea_1", "red", state)).toBe(false);
  });

  it("test_sea_movement_cannot_path_through_land", () => {
    const builder = new TestStateBuilder();
    builder.withRegion("sea_a", false, "");
    builder.withRegion("land_bridge", true, "red");
    builder.withRegion("sea_b", false, "");
    builder.withAdjacent("sea_a", "land_bridge");
    builder.withAdjacent("land_bridge", "sea_b");
    builder.withUnitType("battleship", "sea", 2);
    builder.withStackUnit("battleship", "sea_a", "red");

    const state = builder.buildState();
    state.current_phase = "combat_move";
    const ruleset = builder.buildRuleset();
    const validator = new MovementValidator();

    const legal = validator.getLegalDestinationsForStack("sea_a", "battleship", "red", state, ruleset);
    expect(legal.includes("land_bridge")).toBe(false);
    expect(legal.includes("sea_b"), "Sea units cannot reach sea_b through land_bridge").toBe(false);
  });

  it("test_sea_movement_range_two_sea_zones", () => {
    const builder = new TestStateBuilder();
    builder.withRegion("sea_a", false, "");
    builder.withRegion("sea_b", false, "");
    builder.withRegion("sea_c", false, "");
    builder.withAdjacent("sea_a", "sea_b");
    builder.withAdjacent("sea_b", "sea_c");
    builder.withUnitType("battleship", "sea", 2);
    builder.withStackUnit("battleship", "sea_a", "red");

    const state = builder.buildState();
    state.current_phase = "combat_move";
    const ruleset = builder.buildRuleset();
    const validator = new MovementValidator();

    const legal = validator.getLegalDestinationsForStack("sea_a", "battleship", "red", state, ruleset);
    expect(legal.includes("sea_b")).toBe(true);
    expect(legal.includes("sea_c")).toBe(true);
  });
});
