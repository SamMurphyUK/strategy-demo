import { describe, expect, it } from "vitest";
import { GameState } from "../../../src/engine";
import { medallionRank, territoryStatus } from "../../../src/ui/hud/medallionOrder";

function board(): GameState {
  const state = new GameState();
  state.factions.ussr = { id: "ussr", team: "allies" } as GameState["factions"][string];
  state.factions.uk = { id: "uk", team: "allies" } as GameState["factions"][string];
  state.factions.ger = { id: "ger", team: "axis" } as GameState["factions"][string];
  return state;
}

describe("region inspector order", () => {
  it("puts movable units ahead of spent, allied, and hostile stacks", () => {
    const state = board();
    const ranks = [
      medallionRank(state, "ussr", false, { unit_type_id: "infantry", faction_id: "ussr", count: 2 }),
      medallionRank(state, "ussr", true, { unit_type_id: "tank", faction_id: "ussr", count: 1 }),
      medallionRank(state, "ussr", false, { unit_type_id: "infantry", faction_id: "uk", count: 1 }),
      medallionRank(state, "ussr", false, { unit_type_id: "infantry", faction_id: "ger", count: 3 }),
    ];
    expect(ranks).toEqual([1, 0, 2, 3]);
  });

  it("calls a mixed territory contested", () => {
    const state = board();
    expect(
      territoryStatus(state, "ussr", "ussr", [
        { unit_type_id: "infantry", faction_id: "ussr", count: 1 },
        { unit_type_id: "infantry", faction_id: "ger", count: 1 },
      ]),
    ).toBe("CONTESTED");
  });
});
