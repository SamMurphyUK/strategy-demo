import { describe, expect, it } from "vitest";
import { type Dict, GameSceneController, GameSessionAdapter, GameSessionStub } from "../../../src/engine";

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

function firstAlliesFactoryRegion(session: GameSessionStub): string {
  for (const rid of Object.keys(session.state.regions)) {
    const r = session.state.regions[rid];
    if (r.owner_faction_id === session.state.current_faction_id && r.has_factory) {
      return rid;
    }
  }
  return "region_1";
}

describe("integration/test_session_adapter_integration", () => {
  it("test_adapter_wraps_stub_commands", () => {
    const demoStub = new GameSessionStub();
    demoStub.initializeDemo(99);
    const adapter = GameSessionAdapter.fromSession(demoStub);
    const res = adapter.applyCommand({
      command_id: "a1",
      player_id: demoStub.state.current_faction_id,
      type: "purchase_units",
      payload: { purchases: [{ unit_type_id: "infantry", count: 1 }] },
    });
    expect(res["result_type"]).toBe("ok");
    expect(res["events"][0]["type"]).toBe("unitspurchased");
    expect(GameSessionAdapter.validateEventShape(res["events"][0])).toBe(true);
  });

  it("test_game_scene_smoke_purchase_mobilize_place", () => {
    const scene = new GameSceneController();
    expect(scene.session, "GameScene should have a session").not.toBeNull();
    expect(scene.session instanceof GameSessionStub).toBe(true);

    scene.onSpawnInfantryPressed();
    expect(String(scene.session.state.current_phase)).toBe("purchase");

    for (let i = 0; i < 4; i++) {
      scene.onEndPhasePressed();
    }
    expect(String(scene.session.state.current_phase)).toBe("mobilize");

    const regionId = firstAlliesFactoryRegion(scene.session);
    scene.mapRoot.selectedRegionId = regionId;

    scene.onSpawnInfantryPressed();

    expect(String(scene.session.state.current_phase)).toBe("mobilize");
    const pending = scene.session.getState()["pending_purchases"][scene.session.state.current_faction_id];
    expect(pending).toEqual([]);
    const snap = scene.session.getState();
    expect(regionHasInfantry(snap, regionId)).toBe(true);
  });
});
