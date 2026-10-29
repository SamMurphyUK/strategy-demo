import { beforeEach, describe, expect, it } from "vitest";
import { GameSessionStub, MovementValidator, Ruleset } from "../../../src/engine";

function findAlliesInfantryMovePair(s: GameSessionStub): { from: string; to: string } | null {
  const validator = new MovementValidator();
  for (const regionId of Object.keys(s.state.region_units)) {
    if (s.state.movableStackCount(s.state.current_faction_id, regionId, "infantry") <= 0) {
      continue;
    }
    const legal = validator.getLegalDestinationsForStack(
      regionId, "infantry", s.state.current_faction_id, s.state, s.ruleset as Ruleset,
    );
    if (legal.length === 0) {
      continue;
    }
    return { from: regionId, to: String(legal[0]) };
  }
  return null;
}

describe("integration/test_session_stub_move_once", () => {
  let session: GameSessionStub;

  beforeEach(() => {
    session = new GameSessionStub();
    session.initializeDemo(12345);
    session.applyCommand({ command_id: "to_combat", player_id: session.state.current_faction_id, type: "end_phase", payload: {} });
  });

  it("test_second_move_from_destination_rejected", () => {
    const pair = findAlliesInfantryMovePair(session);
    expect(pair === null, "Need adjacent allied region with infantry for move-once test").toBe(false);

    const fromRegion = pair!.from;
    const toRegion = pair!.to;

    const first = session.applyCommand({
      command_id: "move_1",
      player_id: session.state.current_faction_id,
      type: "move_units",
      payload: { moves: [{
        from_region_id: fromRegion,
        to_region_id: toRegion,
        units: [{ unit_type_id: "infantry", count: 1 }],
      }] },
    });
    expect(String(first.result_type)).toBe("ok");

    const second = session.applyCommand({
      command_id: "move_2",
      player_id: session.state.current_faction_id,
      type: "move_units",
      payload: { moves: [{
        from_region_id: toRegion,
        to_region_id: fromRegion,
        units: [{ unit_type_id: "infantry", count: 1 }],
      }] },
    });
    expect(String(second.result_type)).toBe("error");
    expect(String(second.error?.code)).toBe("MOVE_ALREADY_MOVED");
  });
});
