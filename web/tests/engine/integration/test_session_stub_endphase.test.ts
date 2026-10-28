import { beforeEach, describe, expect, it } from "vitest";
import { GameSessionStub } from "../../../src/engine";

function advanceToMobilize(s: GameSessionStub): void {
  for (let i = 0; i < 4; i++) {
    s.applyCommand({ command_id: `adv_${i}`, player_id: "allies", type: "end_phase", payload: {} });
  }
  expect(s.state.current_phase).toBe("mobilize");
}

describe("integration/test_session_stub_endphase", () => {
  let demoStub: GameSessionStub;

  beforeEach(() => {
    demoStub = new GameSessionStub();
    demoStub.initializeDemo(12345);
  });

  it("test_mobilize_end_phase_forfeits_pending_purchases", () => {
    demoStub.applyCommand({
      command_id: "cmd_purchase",
      player_id: "allies",
      type: "purchase_units",
      payload: { purchases: [{ unit_type_id: "infantry", count: 2 }] },
    });
    advanceToMobilize(demoStub);
    expect(demoStub.getState()["pending_purchases"]["allies"].length).toBeGreaterThan(0);

    const res = demoStub.applyCommand({
      command_id: "cmd_end_mobilize",
      player_id: "allies",
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
    expect(demoStub.getState()["pending_purchases"]["allies"]).toEqual([]);
  });
});
