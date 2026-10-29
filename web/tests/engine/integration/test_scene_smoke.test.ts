import { describe, expect, it } from "vitest";
import { type Dict, GameSceneController, GameSessionStub } from "../../../src/engine";

function regionHasInfantry(snap: Dict, regionId: string): boolean {
  for (const regionEntry of snap.regions ?? []) {
    if (String(regionEntry.region_id ?? "") !== regionId) {
      continue;
    }
    for (const u of regionEntry.units ?? []) {
      if (String(u.unit_type_id ?? "") === "infantry") {
        return Math.trunc(Number(u.count ?? 0)) > 0;
      }
    }
  }
  return false;
}

function firstAlliesFactoryRegion(stub: GameSessionStub): string {
  for (const rid of Object.keys(stub.state.regions)) {
    const r = stub.state.regions[rid];
    if (r.owner_faction_id === stub.state.current_faction_id && r.has_factory) {
      return rid;
    }
  }
  return "region_1";
}

describe("integration/test_scene_smoke", () => {
  it("test_headless_scene_smoke_flow", () => {
    const scene = new GameSceneController();
    expect(scene.session).not.toBeNull();
    expect(scene.session instanceof GameSessionStub).toBe(true);

    const stub = scene.session;
    const regionId = firstAlliesFactoryRegion(stub);

    scene.onSpawnInfantryPressed();
    expect(Math.trunc(scene.uiPendingPurchases["infantry"] ?? 0)).toBe(1);

    for (let i = 0; i < 4; i++) {
      scene.onEndPhasePressed();
    }
    expect(String(stub.state.current_phase)).toBe("mobilize");

    scene.mapRoot.selectedRegionId = regionId;
    scene.onSpawnInfantryPressed();

    const snap = stub.getState();
    expect(snap["pending_purchases"][stub.state.current_faction_id]).toEqual([]);
    expect(regionHasInfantry(snap, regionId)).toBe(true);
  });
});
