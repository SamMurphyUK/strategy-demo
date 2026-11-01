import { describe, expect, it } from "vitest";
import { Faction, GameState, Region } from "../../../src/engine";
import type { ActiveBattle } from "../../../src/engine/model/battle";
import type { Vec2 } from "../../../src/ui/map/geometry";
import {
  CRATER_PIT,
  CRATER_RIM,
  EMBER,
  SCAR_CLEARANCE,
  SMOKE_ASH,
  SMOKE_SOOT,
  battleScarDescriptors,
  extractHostileFrontlineSegments,
  scarTargets,
  type ReliefRegion,
} from "../../../src/ui/map/terrainRelief";

function square(id: string, x: number, y: number, isSea = false): ReliefRegion {
  return {
    id,
    isSea,
    rings: [
      [
        { x, y },
        { x: x + 10, y },
        { x: x + 10, y: y + 10 },
        { x, y: y + 10 },
      ],
    ],
  };
}

function faction(state: GameState, id: string, team: string): void {
  state.factions[id] = Faction.fromDict({ id, name: id, team });
}

function own(state: GameState, id: string, owner: string, type = "land"): void {
  state.regions[id] = Region.fromDict({ id, type, owner_faction_id: owner });
}

function frontState(): GameState {
  const state = new GameState();
  faction(state, "ger", "axis");
  faction(state, "jap", "axis");
  faction(state, "ussr", "allies");
  faction(state, "uk", "allies");
  faction(state, "spain", "neutral");
  own(state, "axisLand", "ger");
  own(state, "alliedLand", "ussr");
  own(state, "friendLand", "uk");
  own(state, "axisFriend", "jap");
  own(state, "neutralLand", "");
  own(state, "spainLand", "spain");
  own(state, "seaZone", "", "sea");
  return state;
}

describe("hostile frontlines", () => {
  const regions = [
    square("axisLand", 0, 0),
    square("alliedLand", 10, 0),
    square("friendLand", 10, -10),
    square("axisFriend", 0, 10),
    square("neutralLand", -10, 0),
    square("spainLand", 0, -10),
    square("seaZone", 20, 0, true),
  ];

  it("keeps the border between axis and allied land, and drops sea, friendly, and neutral borders", () => {
    const state = frontState();
    expect(extractHostileFrontlineSegments(regions, state)).toEqual([
      { x1: 10, y1: 0, x2: 10, y2: 10 },
    ]);

    state.setRegionOwner("alliedLand", "jap");
    state.setRegionOwner("friendLand", "jap");
    expect(extractHostileFrontlineSegments(regions, state)).toEqual([]);
  });
});

describe("battle scars", () => {
  function scarState(): GameState {
    const state = new GameState();
    faction(state, "ger", "axis");
    faction(state, "ussr", "allies");
    own(state, "east", "ussr");
    own(state, "west", "ger");
    own(state, "home", "ger");
    own(state, "ocean", "", "sea");
    return state;
  }

  function order(id: string, to: string) {
    return {
      id,
      faction: "ger",
      unitType: "infantry",
      count: 1,
      fromRegionId: "west",
      toRegionId: to,
      path: [],
      stepsUsed: 1,
    };
  }

  it("marks incoming combat moves and battles this round, and steps the smoke across four frames", () => {
    const state = scarState();
    state.current_phase = "combat_move";
    state.phase_orders.push(order("attack", "east"));
    state.phase_orders.push(order("shuffle", "home"));
    expect(scarTargets(state)).toEqual([{ regionId: "east", ember: true }]);

    state.current_phase = "noncombat_move";
    expect(scarTargets(state)).toEqual([]);

    state.current_phase = "combat";
    state.phase_orders = [];
    state.active_battle = { region_id: "east" } as ActiveBattle;
    expect(scarTargets(state)).toEqual([{ regionId: "east", ember: true }]);

    state.active_battle = null;
    state.current_phase = "mobilize";
    state.noteTerritoryFought("east");
    state.noteTerritoryFought("ocean");
    expect(scarTargets(state)).toEqual([{ regionId: "east", ember: false }]);

    const anchor = { x: 40, y: 40 };
    const avoid: Vec2[] = [anchor, { x: 52, y: 40 }];
    const frames = battleScarDescriptors("east", anchor, avoid, true);
    expect(frames).toHaveLength(4);
    expect(frames[0].craters.length).toBeGreaterThanOrEqual(2);
    expect(frames[0].craters.length).toBeLessThanOrEqual(3);
    expect(frames[1].craters).toEqual(frames[0].craters);
    expect(frames[2].craters).toEqual(frames[0].craters);
    expect(frames[3].craters).toEqual(frames[0].craters);
    expect(frames[0].smoke.length).toBeGreaterThanOrEqual(3);
    expect(frames[0].smoke.length).toBeLessThanOrEqual(4);
    expect(frames[0].smoke).not.toEqual(frames[1].smoke);
    expect(frames[1].smoke).not.toEqual(frames[2].smoke);
    expect(frames[2].smoke).not.toEqual(frames[3].smoke);
    expect(frames[0].smoke[0].color).toBe(SMOKE_SOOT);
    expect(frames[0].smoke[frames[0].smoke.length - 1].color).toBe(SMOKE_ASH);
    expect(frames[0].craters[0].rim).toBe(CRATER_RIM);
    expect(frames[0].craters[0].pit).toBe(CRATER_PIT);
    expect(frames[0].ember).toEqual({ x: Math.round(frames[0].craters[0].x), y: Math.round(frames[0].craters[0].y - 2), color: EMBER });
    for (const crater of frames[0].craters) {
      for (const point of avoid) {
        expect(Math.hypot(crater.x - point.x, crater.y - point.y)).toBeGreaterThanOrEqual(SCAR_CLEARANCE);
      }
    }
    expect(battleScarDescriptors("east", anchor, avoid, false)[0].ember).toBeNull();
    expect(battleScarDescriptors("east", anchor, avoid, true)).toEqual(frames);
  });
});
