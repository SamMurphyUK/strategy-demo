import { describe, expect, it } from "vitest";
import { type Dict, GameSessionStub } from "../../../src/engine";

function hasEventType(events: Dict[], typeName: string): boolean {
  return events.some((evt) => String(evt.type ?? "") === typeName);
}

describe("integration/test_session_stub_collect_income", () => {
  it("test_end_turn_collects_income_from_owned_land", () => {
    const stub = new GameSessionStub();
    stub.initializeDemo(12345);
    for (let i = 0; i < 5; i++) {
      stub.applyCommand({ command_id: `ep_${i}`, player_id: "allies", type: "end_phase", payload: {} });
    }
    expect(stub.state.current_phase).toBe("collect_income");

    const expectedIncome = stub.economy.calculateIncome("allies");
    const ipcBefore = stub.state.getFactionIpc("allies");
    expect(expectedIncome, "Demo allies should control land with IPC value").toBeGreaterThan(0);

    const res = stub.applyCommand({ command_id: "turn_end", player_id: "allies", type: "end_turn", payload: {} });
    expect(String(res.result_type ?? "")).toBe("ok");
    expect(hasEventType(res.events ?? [], "incomecollected")).toBe(true);
    expect(stub.state.getFactionIpc("allies")).toBe(ipcBefore + expectedIncome);
    expect(stub.state.current_faction_id).toBe("axis");
  });
});
