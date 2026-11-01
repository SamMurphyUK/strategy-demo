import { describe, expect, it } from "vitest";
import {
  CarrierConstraintChecker,
  NonCombatMove,
  NonCombatMovementBatch,
  PlaneLandingRequirement,
} from "../../../src/engine";
import { TestStateBuilder } from "../helpers/test_state_builder";

describe("validator/test_carrier_constraint_checker", () => {
  it("test_plane_stranded_without_carrier", () => {
    const builder = new TestStateBuilder();
    builder.withRegion("Sea1", false).withRegion("Sea2", false);
    builder.withAdjacent("Sea1", "Sea2");
    builder.withUnit(1, "fighter", "Sea1");
    builder.withUnit(2, "carrier", "Sea2");

    const state = builder.buildState();
    builder.buildRuleset();

    const batch = new NonCombatMovementBatch();
    const move = new NonCombatMove();
    move.unit_id = 2;
    move.from_region = "Sea2";
    move.to_region = "Sea2";
    batch.moves.push(move);

    const p = new PlaneLandingRequirement();
    const deps = { "1": p };
    p.possible_landing_regions = [];

    const checker = new CarrierConstraintChecker();
    const result = checker.validateCarrierMovesWithPlaneDependencies(batch, state, deps);

    expect(result.ok).toBe(false);
    expect(result.errors.length).toBe(1);
  });
});
