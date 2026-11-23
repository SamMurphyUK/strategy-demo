import { describe, expect, it } from "vitest";
import { committedMoves, peelHeld } from "../../../src/ui/map/combatRedirect";

describe("combat move redirect", () => {
  it("keeps the units that were not picked up", () => {
    const orders = committedMoves(
      [
        { id: "a", faction: "ussr", fromRegionId: "moscow", unitType: "infantry", count: 3, toRegionId: "poland" },
        { id: "b", faction: "ussr", fromRegionId: "moscow", unitType: "tank", count: 1, toRegionId: "ukraine" },
      ],
      "ussr",
      "moscow",
      "infantry",
      "",
    );
    expect(orders.map((order) => order.id)).toEqual(["a"]);
    expect(peelHeld(orders, 1)).toEqual([{ id: "a", toRegionId: "poland", count: 2, instanceId: "" }]);
    expect(peelHeld(orders, 3)).toEqual([]);
  });
});
