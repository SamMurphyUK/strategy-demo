import { describe, expect, it } from "vitest";
import { type Dict, GameSessionStub } from "../../../src/engine";

function firstAlliesFactoryRegion(stub: GameSessionStub): string {
  for (const rid of Object.keys(stub.state.regions)) {
    const r = stub.state.regions[rid];
    if (r.owner_faction_id === stub.state.current_faction_id && r.has_factory) {
      return rid;
    }
  }
  return "region_1";
}

function regionHasInfantry(snap: Dict, regionId: string): boolean {
  for (const r of snap.regions ?? []) {
    if (String(r.region_id ?? "") !== regionId) {
      continue;
    }
    for (const u of r.units ?? []) {
      if (String(u.unit_type_id ?? "") === "infantry" && Math.trunc(Number(u.count ?? 0)) > 0) {
        return true;
      }
    }
  }
  return false;
}

function hasEvent(events: Dict[], typeName: string): boolean {
  return events.some((e) => String(e.type ?? "") === typeName);
}

describe("integration/test_mobilize_drag_place", () => {
  it("test_place_units_emits_unitsplaced_and_updates_snapshot", () => {
    const demoStub = new GameSessionStub();
    demoStub.initializeDemo(12345);
    demoStub.applyCommand({
      command_id: "drag_p1",
      player_id: demoStub.state.current_faction_id,
      type: "purchase_units",
      payload: { purchases: [{ unit_type_id: "infantry", count: 1 }] },
    });
    for (let i = 0; i < 4; i++) {
      demoStub.applyCommand({ command_id: `drag_ep_${i}`, player_id: demoStub.state.current_faction_id, type: "end_phase", payload: {} });
    }
    const regionId = firstAlliesFactoryRegion(demoStub);
    const place = demoStub.applyCommand({
      command_id: "drag_place",
      player_id: demoStub.state.current_faction_id,
      type: "place_units",
      payload: { placements: [{ region_id: regionId, units: [{ unit_type_id: "infantry", count: 1 }] }] },
    });
    expect(String(place.result_type ?? "")).toBe("ok");
    expect(hasEvent(place.events ?? [], "unitsplaced")).toBe(true);
    expect(regionHasInfantry(demoStub.getState(), regionId)).toBe(true);
  });
});
