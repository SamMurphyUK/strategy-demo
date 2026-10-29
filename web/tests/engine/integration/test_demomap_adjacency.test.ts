import { describe, expect, it } from "vitest";
import { GameSessionFactory, SessionMode } from "../../../src/engine";

describe("integration/test_demomap_adjacency", () => {
  it("boots the blank board as neutral master blocks, one per landmass and ocean", () => {
    const session = GameSessionFactory.create(SessionMode.STUB);
    const state = session.state;
    const ids = Object.keys(state.regions);
    const seas = ids.filter((id) => state.regions[id].isSeaRegion());
    const lands = ids.filter((id) => state.regions[id].isLandRegion());
    expect(seas.length).toBeGreaterThanOrEqual(1);
    expect(lands.length).toBeGreaterThanOrEqual(1);
    expect(new Set(ids).size).toBe(ids.length);

    for (const id of ids) {
      expect(state.regions[id].owner_faction_id).toBe("");
      expect(state.regions[id].is_capital).toBe(false);
    }

    // Every adjacency names a real region and is mutual, whatever the map has been sliced into.
    for (const id of ids) {
      for (const other of state.getAdjacentRegions(id)) {
        expect(ids, `${id} -> ${other}`).toContain(other);
        expect(state.getAdjacentRegions(other), `${other} -> ${id}`).toContain(id);
      }
    }
    expect(state.turn_order).toEqual(["ussr", "ger", "uk", "jap", "usa"]);
    expect(Object.values(state.region_units).every((units) => units.length === 0)).toBe(true);
  });
});
