import { describe, expect, it } from "vitest";
import { GameSessionFactory, SessionMode } from "../../../src/engine";

describe("integration/test_mobilize_forfeit", () => {
  it("test_mobilize_forfeit_clears_pending", () => {
    const session = GameSessionFactory.create(SessionMode.STUB);
    const r1 = session.applyCommand({
      command_id: "test_cmd_002",
      player_id: session.state.current_faction_id,
      type: "purchase_units",
      payload: { purchases: [{ unit_type_id: "infantry", count: 1 }] },
    });
    expect(r1.result_type).toBe("ok");
    for (let i = 0; i < 5; i++) {
      session.applyCommand({
        command_id: `test_cmd_${String(3 + i).padStart(3, "0")}`,
        player_id: session.state.current_faction_id,
        type: "end_phase",
        payload: {},
      });
    }
    const snapshot = session.getState();
    expect(snapshot["pending_purchases"][session.state.current_faction_id]).toEqual([]);
  });
});
