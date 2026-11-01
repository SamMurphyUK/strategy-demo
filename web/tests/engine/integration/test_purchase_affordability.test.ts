import { describe, expect, it } from "vitest";
import { GameSessionFactory, SessionMode } from "../../../src/engine";

describe("integration/test_purchase_affordability", () => {
  it("test_purchase_insufficient_ipc", () => {
    const session = GameSessionFactory.create(SessionMode.STUB);
    session.state.ipc[session.state.current_faction_id] = 3;
    const result = session.applyCommand({
      command_id: "test_cmd_001",
      player_id: session.state.current_faction_id,
      type: "purchase_units",
      payload: { purchases: [{ unit_type_id: "infantry", count: 2 }] },
    });
    expect(result.result_type).toBe("error");
    expect(result.error?.code ?? "").toBe("PURCHASE_FAILED");
  });
});
