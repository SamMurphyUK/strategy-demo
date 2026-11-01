import { beforeEach, describe, expect, it } from "vitest";
import { type GameSessionStub } from "../../../src/engine";
import { campaignSession } from "../campaign_session";

function advanceToMobilize(s: GameSessionStub): void {
  for (let i = 0; i < 4; i++) {
    s.applyCommand({ command_id: `adv_${i}`, player_id: s.state.current_faction_id, type: "end_phase", payload: {} });
  }
  expect(s.state.current_phase).toBe("mobilize");
}

function firstAlliesFactoryRegion(s: GameSessionStub): string {
  for (const rid of Object.keys(s.state.regions)) {
    const r = s.state.regions[rid];
    if (r.owner_faction_id === s.state.current_faction_id && r.has_factory) {
      return rid;
    }
  }
  return "region_1";
}

function infantryCountInRegion(s: GameSessionStub, regionId: string): number {
  let total = 0;
  for (const u of s.state.getUnitsInRegion(regionId)) {
    if (String(u.unit_type_id ?? "") === "infantry") {
      total += Math.trunc(Number(u.count ?? 0));
    }
  }
  return total;
}

describe("integration/test_session_stub_place", () => {
  let demoStub: GameSessionStub;

  beforeEach(() => {
    demoStub = campaignSession();
  });

  it("test_place_consumes_pending_and_updates_region_units", () => {
    demoStub.applyCommand({
      command_id: "cmd_purchase",
      player_id: demoStub.state.current_faction_id,
      type: "purchase_units",
      payload: { purchases: [{ unit_type_id: "infantry", count: 1 }] },
    });
    advanceToMobilize(demoStub);

    const regionId = firstAlliesFactoryRegion(demoStub);
    const countBefore = infantryCountInRegion(demoStub, regionId);

    const res = demoStub.applyCommand({
      command_id: "cmd_place",
      player_id: demoStub.state.current_faction_id,
      type: "place_units",
      payload: {
        placements: [{ region_id: regionId, units: [{ unit_type_id: "infantry", count: 1 }] }],
      },
    });
    expect(res["result_type"]).toBe("ok");
    expect(res["events"][0]["type"]).toBe("unitsplaced");
    expect(demoStub.getState()["pending_purchases"][demoStub.state.current_faction_id]).toEqual([]);
    expect(infantryCountInRegion(demoStub, regionId)).toBe(countBefore + 1);
  });

  it("test_place_one_of_many_leaves_remaining_pending", () => {
    demoStub.applyCommand({
      command_id: "cmd_purchase",
      player_id: demoStub.state.current_faction_id,
      type: "purchase_units",
      payload: { purchases: [{ unit_type_id: "infantry", count: 3 }] },
    });
    advanceToMobilize(demoStub);
    const regionId = firstAlliesFactoryRegion(demoStub);
    const res = demoStub.applyCommand({
      command_id: "cmd_place",
      player_id: demoStub.state.current_faction_id,
      type: "place_units",
      payload: {
        placements: [{ region_id: regionId, units: [{ unit_type_id: "infantry", count: 1 }] }],
      },
    });
    expect(res["result_type"]).toBe("ok");
    const pending = demoStub.getState()["pending_purchases"][demoStub.state.current_faction_id];
    expect(pending.length).toBe(1);
    expect(Math.trunc(pending[0].count)).toBe(2);
  });
});
