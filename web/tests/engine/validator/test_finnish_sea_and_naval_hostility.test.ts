import { describe, expect, it } from "vitest";
import { GameSessionStub, MovementValidator } from "../../../src/engine";
import { RegionUnitDisplay } from "../../../src/engine/presentation/region_unit_display";
import { concealNeutralGarrison } from "../../../src/ui/map/neutralGarrison";
import { TestStateBuilder } from "../helpers/test_state_builder";

describe("Finnish sea zone and naval targets", () => {
  it("keeps Sea Zone 11 as sea, lets ships leave, and refuses a tank", () => {
    const session = new GameSessionStub();
    session.initializeDemo(1);
    const state = session.state;
    const zone = state.regions["Sea Zone 11"];
    expect(zone?.type).toBe("sea");
    expect(zone?.isSeaRegion()).toBe(true);

    for (const other of ["Sea Zone 10", "Sea Zone 14"]) {
      expect(state.isAdjacent("Sea Zone 11", other)).toBe(true);
      expect(state.isAdjacent(other, "Sea Zone 11")).toBe(true);
      expect(state.regions[other]?.isSeaRegion()).toBe(true);
    }

    state.current_phase = "combat_move";
    state.current_faction_id = "ger";
    state.region_units["Finland"] = [{ faction_id: "ger", unit_type_id: "tank", count: 1 }];
    const ruleset = session.ruleset!;
    const validator = new MovementValidator();
    const tank = validator.validateStackMove("Finland", "Sea Zone 11", "tank", "ger", 1, state, ruleset);
    expect(tank.ok).toBe(false);
    expect(tank.errors[0]?.code).toBe("MOVE_ILLEGAL_DESTINATION");
    expect(validator.getLegalDestinationsForStack("Finland", "tank", "ger", state, ruleset).includes("Sea Zone 11")).toBe(false);

    state.region_units["Sea Zone 11"] = [{ faction_id: "ger", unit_type_id: "cruiser", count: 1 }];
    const seas = validator.getLegalDestinationsForStack("Sea Zone 11", "cruiser", "ger", state, ruleset);
    expect(seas.includes("Sea Zone 10")).toBe(true);
  });

  it("marks a sea zone hostile only when an enemy ship is in it", () => {
    const builder = new TestStateBuilder();
    builder.withRegion("empty", false, "blue");
    builder.withRegion("coast", false, "");
    builder.withRegion("fleet", false, "");
    builder.withRegion("troops", false, "");
    builder.withUnitType("battleship", "sea", 2);
    builder.withUnitType("infantry", "land", 1);
    builder.withStackUnit("battleship", "fleet", "blue");
    builder.withStackUnit("infantry", "troops", "blue");
    const state = builder.buildState();

    expect(state.holdsEnemyNavalUnit("empty", "red")).toBe(false);
    expect(state.holdsEnemyNavalUnit("coast", "red")).toBe(false);
    expect(state.holdsEnemyNavalUnit("troops", "red")).toBe(false);
    expect(state.holdsEnemyNavalUnit("fleet", "red")).toBe(true);
    expect(state.holdsEnemyNavalUnit("fleet", "blue")).toBe(false);
  });

  it("hides a peaceful neutral garrison on the map and still lists it for the inspector", () => {
    const units = [{ faction_id: "neutral", unit_type_id: "infantry", count: 2 }];
    expect(concealNeutralGarrison("", true, false)).toBe(true);
    expect(concealNeutralGarrison("neutral", true, false)).toBe(true);
    expect(concealNeutralGarrison("", true, true)).toBe(false);
    expect(concealNeutralGarrison("", false, false)).toBe(false);
    expect(concealNeutralGarrison("ger", true, false)).toBe(false);
    const shown = RegionUnitDisplay.buildDisplayEntries(units);
    expect(shown.map((entry) => entry.unit_type_id)).toEqual(["infantry"]);
    expect(shown[0]?.count).toBe(2);
  });
});
