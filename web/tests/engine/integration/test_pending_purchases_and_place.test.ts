import { describe, expect, it } from "vitest";
import { type GameSessionStub } from "../../../src/engine";
import { campaignSession } from "../campaign_session";

function firstAlliesFactoryRegion(session: GameSessionStub): string {
  for (const rid of Object.keys(session.state.regions)) {
    const r = session.state.regions[rid];
    if (r.owner_faction_id === session.state.current_faction_id && r.has_factory) {
      return rid;
    }
  }
  return "";
}

describe("integration/test_pending_purchases_and_place", () => {
  it("test_pending_purchases_then_place_updates_region", () => {
    const session = campaignSession();
    session.applyCommand({
      command_id: "pp1",
      player_id: session.state.current_faction_id,
      type: "purchase_units",
      payload: { purchases: [{ unit_type_id: "infantry", count: 1 }] },
    });
    for (let i = 0; i < 4; i++) {
      session.applyCommand({ command_id: `pp_adv_${i}`, player_id: session.state.current_faction_id, type: "end_phase", payload: {} });
    }
    const regionId = firstAlliesFactoryRegion(session);
    expect(regionId === "", "Expected an allies factory region in demo map").toBe(false);
    const r = session.applyCommand({
      command_id: "pp_place",
      player_id: session.state.current_faction_id,
      type: "place_units",
      payload: { placements: [{ region_id: regionId, units: [{ unit_type_id: "infantry", count: 1 }] }] },
    });
    expect(r.result_type).toBe("ok");
    expect(session.getState()["pending_purchases"][session.state.current_faction_id]).toEqual([]);
  });
});
