import { describe, expect, it } from "vitest";
import { PlacementValidator } from "../../../src/engine";
import { TestStateBuilder } from "../helpers/test_state_builder";

describe("validator/test_placement_validator", () => {
  it("test_cannot_place_in_enemy_region", () => {
    const builder = new TestStateBuilder();
    builder.withRegion("A", true, "blue");

    const state = builder.buildState();
    const ruleset = builder.buildRuleset();
    const batch = { placements: [{ region: "A", unit_type: "infantry" }] };

    const validator = new PlacementValidator();
    validator.state = state;
    const result = validator.validatePlacementBatch(batch, ruleset);

    expect(result.ok).toBe(false);
    expect(result.errors.length).toBe(1);
  });
});
