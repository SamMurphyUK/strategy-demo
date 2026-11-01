import { describe, expect, it } from "vitest";
import { GameState } from "../../../src/engine/model/game_state";
import { Unit } from "../../../src/engine/model/unit";
import { mustPlaceMessage } from "../../../src/engine/placement/unplaced";
import { isActiveFaction } from "../../../src/ui/map/tokenStyle";

describe("mobilize pool and faction identity", () => {
  it("names the units still waiting to be placed", () => {
    const state = new GameState();
    state.unit_types.infantry = Unit.fromDict({ id: "infantry", name: "Infantry", category: "land", cost: 3 });
    state.pending_purchases.ger = [{ unit_type_id: "infantry", count: 2 }];
    expect(mustPlaceMessage(state, "ger")).toBe("Place purchased units before ending the phase: 2 Infantry.");
    expect(mustPlaceMessage(state, "uk")).toBe("");
  });

  it("treats a German stack drawn as axis as Germany's unit", () => {
    expect(isActiveFaction("axis", "ger")).toBe(true);
    expect(isActiveFaction("uk", "ger")).toBe(false);
    expect(isActiveFaction("jap", "jap")).toBe(true);
    expect(isActiveFaction("usa", "usa")).toBe(true);
    expect(isActiveFaction("ussr", "ussr")).toBe(true);
  });
});
