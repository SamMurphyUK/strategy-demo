import { describe, expect, it } from "vitest";
import { TestStateBuilder } from "../../engine/helpers/test_state_builder";
import type { GameState } from "../../../src/engine/model/game_state";
import { stackKey } from "../../../src/ui/map/geometry";
import { holdCircleCenters, holdMarks, presentRegionUnits } from "../../../src/ui/map/shipHold";

function seaBoard(): GameState {
  const builder = new TestStateBuilder();
  builder
    .withRegion("sea", false, "")
    .withRegion("land", true, "uk")
    .withAdjacent("sea", "land");
  builder
    .withUnitType("infantry", "land", 1)
    .withUnitType("tank", "land", 2)
    .withUnitType("fighter", "air", 4)
    .withUnitType("transport", "sea", 2)
    .withUnitType("carrier", "sea", 2)
    .withUnitType("destroyer", "sea", 2);
  builder.withStackUnit("carrier", "sea", "uk").withStackUnit("destroyer", "sea", "uk");
  const state = builder.buildState();
  state.unit_types.fighter.special = { can_land_on_carrier: true };
  state.unit_types.carrier.special = { fighter_capacity: 2, can_host_fighters: true };
  state.region_units.sea.push({ faction_id: "uk", unit_type_id: "transport", count: 1, instance_id: "t1" });
  state.transport_instances.t1 = { instance_id: "t1", unit_type_id: "transport", region_id: "sea", cargo: [] };
  state.current_faction_id = "uk";
  state.current_phase = "combat_move";
  return state;
}

const transport = { unit_type_id: "transport", faction_id: "uk", count: 1, instance_id: "t1" };
const carrier = { unit_type_id: "carrier", faction_id: "uk", count: 1 };

describe("ship hold circles", () => {
  it("draws two circles under a token and an upright hull", () => {
    const [left, right] = holdCircleCenters(100, 200, 32, false);
    expect(left.y).toBeGreaterThan(200);
    expect(right.y).toBe(left.y);
    expect(left.x).toBeLessThan(100);
    expect(right.x).toBeGreaterThan(100);
    const standing = holdCircleCenters(0, 40, 32, true);
    expect(standing).toHaveLength(2);
    expect(standing[0].y).toBeGreaterThan(40);
  });

  it("fills a transport from its cargo and never grows a third circle", () => {
    const state = seaBoard();
    expect(holdMarks(state, "sea", transport)).toEqual([]);
    expect(holdMarks(state, "sea", { unit_type_id: "destroyer", faction_id: "uk", count: 1 })).toBeNull();

    state.transport_instances.t1.cargo = [{ unit_type_id: "infantry", count: 1 }];
    expect(holdMarks(state, "sea", transport)).toEqual([
      { unitType: "infantry", factionId: "uk", transportId: "t1", pending: false },
    ]);

    state.transport_instances.t1.cargo = [{ unit_type_id: "infantry", count: 2 }];
    expect(holdMarks(state, "sea", transport)?.map((mark) => mark.unitType)).toEqual(["infantry", "infantry"]);

    state.transport_instances.t1.cargo = [{ unit_type_id: "tank", count: 1 }];
    expect(holdMarks(state, "sea", transport)).toEqual([
      { unitType: "tank", factionId: "uk", transportId: "t1", pending: false },
    ]);
    expect(stackKey({ unit_type_id: "infantry", faction_id: "uk", count: 1, cargoOf: "t1" })).toBe("cargo|t1|infantry");
  });

  it("fills a carrier from parked fighters and caps the drawing at two", () => {
    const state = seaBoard();
    expect(holdMarks(state, "sea", carrier)).toEqual([]);
    state.region_units.sea.push({ faction_id: "uk", unit_type_id: "fighter", count: 3 });
    expect(holdMarks(state, "sea", carrier)).toHaveLength(2);
    const visible = presentRegionUnits(state, "sea", state.region_units.sea);
    expect(visible.find((entry) => entry.unit_type_id === "fighter")?.count).toBe(1);
  });

  it("opens a circle when a parked plane launches and fills one when a plane is ordered aboard", () => {
    const state = seaBoard();
    state.region_units.sea.push({ faction_id: "uk", unit_type_id: "fighter", count: 2 });
    state.phase_orders.push({
      id: "ord_1",
      faction: "uk",
      unitType: "fighter",
      count: 1,
      fromRegionId: "sea",
      toRegionId: "land",
      path: [],
      stepsUsed: 1,
    });
    expect(holdMarks(state, "sea", carrier)).toHaveLength(1);
    expect(presentRegionUnits(state, "sea", state.region_units.sea).find((entry) => entry.unit_type_id === "fighter")?.count).toBe(1);

    state.phase_orders = [
      {
        id: "ord_2",
        faction: "uk",
        unitType: "fighter",
        count: 1,
        fromRegionId: "land",
        toRegionId: "sea",
        path: [],
        stepsUsed: 1,
      },
    ];
    state.region_units.land = [{ faction_id: "uk", unit_type_id: "fighter", count: 1 }];
    state.region_units.sea = state.region_units.sea.filter((entry) => entry.unit_type_id !== "fighter");
    expect(presentRegionUnits(state, "land", state.region_units.land)).toEqual([]);
    expect(holdMarks(state, "sea", carrier)).toEqual([
      { unitType: "fighter", factionId: "uk", transportId: "", pending: true },
    ]);
  });

  it("matches a carrier token whose faction is drawn under the display name", () => {
    const state = seaBoard();
    state.region_units.sea = [
      { faction_id: "ger", unit_type_id: "carrier", count: 1 },
      { faction_id: "ger", unit_type_id: "fighter", count: 1 },
    ];
    expect(holdMarks(state, "sea", { unit_type_id: "carrier", faction_id: "axis", count: 1 })).toEqual([
      { unitType: "fighter", factionId: "ger", transportId: "", pending: false },
    ]);
  });
});
