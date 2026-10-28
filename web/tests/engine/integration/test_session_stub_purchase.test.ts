import { beforeEach, describe, expect, it } from "vitest";
import { GameSessionStub } from "../../../src/engine";

describe("integration/test_session_stub_purchase", () => {
  let demoStub: GameSessionStub;

  beforeEach(() => {
    demoStub = new GameSessionStub();
    demoStub.initializeDemo(12345);
  });

  it("test_purchase_reduces_ipc_and_emits_event", () => {
    const initialIpc = demoStub.getState()["ipc"]["allies"];
    const res = demoStub.applyCommand({
      command_id: "cmd1",
      player_id: "allies",
      type: "purchase_units",
      payload: { purchases: [{ unit_type_id: "infantry", count: 1 }] },
    });
    expect(res["result_type"]).toBe("ok");
    expect(res["events"].length).toBeGreaterThan(0);
    expect(res["events"][0]["type"]).toBe("unitspurchased");
    expect(GameSessionStub.validateEventShape(res["events"][0])).toBe(true);
    expect(demoStub.getState()["ipc"]["allies"]).toBe(initialIpc - 3);
  });
});
