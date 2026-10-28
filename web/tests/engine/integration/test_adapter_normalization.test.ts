import { describe, expect, it } from "vitest";
import { GameSessionAdapter, GameSessionFactory, SessionMode } from "../../../src/engine";

describe("integration/test_adapter_normalization", () => {
  it("test_adapter_normalization_shape", () => {
    const session = GameSessionFactory.create(SessionMode.STUB);
    const adapter = GameSessionAdapter.fromSession(session);
    const result = adapter.applyCommand({
      command_id: "an1",
      player_id: "allies",
      type: "purchase_units",
      payload: { purchases: [{ unit_type_id: "infantry", count: 1 }] },
    });
    expect(result.result_type).toBe("ok");
    expect(GameSessionAdapter.validateEventShape(result.events[0])).toBe(true);
  });
});
