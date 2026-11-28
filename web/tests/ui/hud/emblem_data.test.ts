import { describe, expect, it } from "vitest";
import { Region } from "../../../src/engine/model/region";
import { regionEmblems } from "../../../src/ui/hud/emblemData";

/** Just the state the emblems read. */
function state(round: number, repair: Record<string, number> = {}) {
  return { game_round: round, repairTokens: repair, scenarioId: "SCENARIO_GLOBAL_1940" } as never;
}

function land(patch: Record<string, unknown>): Region {
  return Region.fromDict({ id: "r", name: "R", type: "land", ipc_value: 6, owner_faction_id: "germany", ...patch });
}

describe("a territory's emblems", () => {
  it("has none on a sea zone or a bare territory", () => {
    expect(regionEmblems(state(1), Region.fromDict({ id: "s", name: "S", type: "sea" }))).toEqual([]);
    expect(regionEmblems(state(1), land({}))).toEqual([]);
  });

  it("lists capital, factory, port and airbase, in that order", () => {
    const emblems = regionEmblems(state(1), land({ is_capital: true, has_factory: true, major_factory: true, harbor: true, airbase: true }));
    expect(emblems.map((item) => item.id)).toEqual(["capital", "factory", "port", "airbase"]);
    expect(emblems[1].major).toBe(true);
  });

  it("says what a factory builds and when it is damaged", () => {
    const [plain] = regionEmblems(state(1), land({ has_factory: true }));
    expect(plain.detail).toMatch(/^Minor factory: builds up to 3 units a turn, undamaged$/);
    const [hurt] = regionEmblems(state(1, { r: 2 }), land({ has_factory: true, major_factory: true }));
    expect(hurt.detail).toMatch(/Major factory: builds up to 8 units a turn, 2 slots out of action/);
    expect(hurt.impaired).toBe(true);
  });

  it("says when a port or airbase is closed, and for how long", () => {
    const [open] = regionEmblems(state(3), land({ harbor: true }));
    expect(open.detail).toBe("Port: harbor open");
    const [shut] = regionEmblems(state(3), land({ harbor: true, harbor_disabled_until: 5 }));
    expect(shut.detail).toBe("Port: closed through round 5");
    expect(shut.impaired).toBe(true);
    const [past] = regionEmblems(state(6), land({ airbase: true, airbase_disabled_until: 5 }));
    expect(past.impaired).toBe(false);
  });

  it("notes a captured capital", () => {
    const [capital] = regionEmblems(state(1), land({ is_capital: true, original_owner_id: "france", owner_faction_id: "germany" }));
    expect(capital.detail).toMatch(/^Capital of .+, held by .+$/);
    expect(capital.impaired).toBe(true);
  });
});
