import { describe, expect, it } from "vitest";
import { applyTravel, travelProgress, walkPosition, type TravelPlan } from "../../../src/ui/map/battleTravel";
import type { RegionLayout } from "../../../src/ui/map/mapRenderer";

const view = { k: 1, x: 0, y: 0 };

function layout(): RegionLayout {
  const counter = (key: string, faction: string, type: string, x: number, y: number) =>
    ({ regionId: "T", slot: { key, entry: { faction_id: faction, unit_type_id: type, count: 1 }, offset: { x: 0, y: 0 } }, domain: "land", x, y }) as never;
  return {
    region: { id: "T" },
    anchor: { x: 100, y: 100 },
    counters: [counter("a", "GER", "tank", 100, 100), counter("b", "USA", "tank", 120, 100)],
  } as never;
}

const plan: TravelPlan = { regionId: "T", attackerId: "GER", origins: [{ unitType: "tank", from: { x: 0, y: 0 } }], startMs: null, durationMs: 1000 };

describe("battle travel", () => {
  it("stands the attackers at their origin until the fight is opened, and the defenders where they are", () => {
    const [out] = applyTravel([layout()], [plan], view, 500);
    expect(out.counters[0]).toMatchObject({ x: 0, y: 0 });
    expect(out.counters[1]).toMatchObject({ x: 120, y: 100 });
  });
  it("walks them to their place over the duration", () => {
    const running = { ...plan, startMs: 0 };
    const half = applyTravel([layout()], [running], view, 500)[0].counters[0];
    expect(half.x).toBeGreaterThan(0);
    expect(half.x).toBeLessThan(100);
    const done = applyTravel([layout()], [running], view, 1000)[0].counters[0];
    expect(done).toMatchObject({ x: 100, y: 100 });
  });
  it("leaves the layouts alone when nothing travels and never changes a counter in place", () => {
    const original = layout();
    expect(applyTravel([original], [], view, 0)[0]).toBe(original);
    applyTravel([original], [plan], view, 0);
    expect(original.counters[0]).toMatchObject({ x: 100, y: 100 });
  });
  it("eases the progress between 0 and 1", () => {
    expect(travelProgress({ startMs: null, durationMs: 10 }, 5)).toBe(0);
    expect(travelProgress({ startMs: 0, durationMs: 10 }, 5)).toBeCloseTo(0.5, 9);
    expect(travelProgress({ startMs: 0, durationMs: 10 }, 99)).toBe(1);
    expect(walkPosition({ x: 0, y: 0 }, { x: 10, y: 20 }, 0.5)).toEqual({ x: 5, y: 10 });
  });
});
