import { describe, expect, it } from "vitest";
import { GameSessionStub } from "../../../src/engine";

describe("integration/test_end_turn_switch", () => {
  it("test_end_turn_switches_faction_and_resets_phase", () => {
    const demoStub = new GameSessionStub();
    demoStub.initializeDemo(12345);
    for (let i = 0; i < 5; i++) {
      demoStub.applyCommand({ command_id: `turn_ep_${i}`, player_id: demoStub.state.current_faction_id, type: "end_phase", payload: {} });
    }
    const before = { ...(demoStub.getState().turn_info ?? {}) };
    const res = demoStub.applyCommand({ command_id: "turn_end", player_id: demoStub.state.current_faction_id, type: "end_turn", payload: {} });
    const after = demoStub.getState().turn_info ?? {};
    expect(String(res.result_type ?? "")).toBe("ok");
    expect(String(before.current_faction_id ?? "")).not.toBe(String(after.current_faction_id ?? ""));
    expect(String(after.current_phase ?? "")).toBe("purchase");
  });
});
