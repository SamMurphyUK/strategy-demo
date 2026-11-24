import { beforeEach, describe, expect, it } from "vitest";
import { GameSession } from "../../../src/engine";

function advanceToMobilize(s: GameSession): void {
  for (let i = 0; i < 4; i++) {
    s.applyCommand({ command_id: `adv_${i}`, player_id: s.state.current_faction_id, type: "end_phase", payload: {} });
  }
  expect(s.state.current_phase).toBe("mobilize");
}

describe("integration/test_session_stub_endphase", () => {
  let demoStub: GameSession;

  beforeEach(() => {
    demoStub = new GameSession();
    demoStub.initializeDemo(12345);
  });

  it("test_mobilize_end_phase_forfeits_pending_purchases", () => {
    demoStub.applyCommand({
      command_id: "cmd_purchase",
      player_id: demoStub.state.current_faction_id,
      type: "purchase_units",
      payload: { purchases: [{ unit_type_id: "infantry", count: 2 }] },
    });
    advanceToMobilize(demoStub);
    expect(demoStub.getState()["pending_purchases"][demoStub.state.current_faction_id].length).toBeGreaterThan(0);

    const res = demoStub.applyCommand({
      command_id: "cmd_end_mobilize",
      player_id: demoStub.state.current_faction_id,
      type: "end_phase",
      payload: {},
    });
    expect(res["result_type"]).toBe("ok");
    let foundForfeit = false;
    for (const evt of res["events"]) {
      if (String(evt.type ?? "") === "placementforfeited") {
        foundForfeit = true;
        break;
      }
    }
    expect(foundForfeit, "Expected placementforfeited event").toBe(true);
    expect(demoStub.getState()["pending_purchases"][demoStub.state.current_faction_id]).toEqual([]);
  });
});
