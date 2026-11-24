import { beforeEach, describe, expect, it } from "vitest";
import { GameSession } from "../../../src/engine";

describe("integration/test_session_stub_purchase", () => {
  let demoStub: GameSession;

  beforeEach(() => {
    demoStub = new GameSession();
    demoStub.initializeDemo(12345);
  });

  it("test_purchase_reduces_ipc_and_emits_event", () => {
    const initialIpc = demoStub.getState()["ipc"][demoStub.state.current_faction_id];
    const res = demoStub.applyCommand({
      command_id: "cmd1",
      player_id: demoStub.state.current_faction_id,
      type: "purchase_units",
      payload: { purchases: [{ unit_type_id: "infantry", count: 1 }] },
    });
    expect(res["result_type"]).toBe("ok");
    expect(res["events"].length).toBeGreaterThan(0);
    expect(res["events"][0]["type"]).toBe("unitspurchased");
    expect(GameSession.validateEventShape(res["events"][0])).toBe(true);
    expect(demoStub.getState()["ipc"][demoStub.state.current_faction_id]).toBe(initialIpc - 3);
  });
});
