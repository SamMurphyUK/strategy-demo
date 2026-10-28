import { describe, expect, it } from "vitest";
import { PurchaseValidator } from "../../../src/engine";
import { TestStateBuilder } from "../helpers/test_state_builder";

describe("validator/test_purchase_validator", () => {
  it("test_purchase_exceeds_ipc", () => {
    const builder = new TestStateBuilder();
    const state = builder.buildState();
    state.ipc[state.current_faction_id] = 5;

    const ruleset = builder.buildRuleset();
    ruleset.unit_defs = { tank: { cost: 6 } };

    const batch = { items: [{ unit_type: "tank", count: 1 }] };
    const validator = new PurchaseValidator();
    const result = validator.validatePurchaseBatch(batch, state, ruleset);

    expect(result.ok).toBe(false);
    expect(result.errors.length).toBe(1);
  });
});
