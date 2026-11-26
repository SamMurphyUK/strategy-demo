import { describe, expect, it } from "vitest";
import {
  applyEdit,
  applyPlacements,
  LANDMARK_NORTH,
  LANDMARK_BASE_ZOOM,
  landmarkBaseShare,
  LANDMARK_SCALE,
  landmarkReveal,
  landmarkRise,
  LANDMARKS,
  NO_EDIT,
  nudge,
  parsePlacements,
  placeLandmarks,
  resize,
  serializePlacements,
  setLocked,
  SIZE_MAX,
  SIZE_MIN,
  turn,
} from "../../../src/ui/viewport3d/placements";
import type { PropInstance, PropPlan } from "../../../src/ui/viewport3d/propPlan";

const tree: PropInstance = { x: 10, y: 20, scale: 2, height: 3, turn: 0.5, tint: [1, 1, 1], snow: 0 };

function planOf(pines: PropInstance[]): PropPlan {
  return {
    props: { pine: pines, broadleaf: [], acacia: [], palm: [], rock: [], dune: [], peak: [], house: [], factory: [] },
    chimneys: [],
  };
}

describe("placement edits", () => {
  it("moves along each axis and keeps the other two", () => {
    const moved = nudge(nudge(nudge(undefined, "x", 1), "y", -0.25), "z", 4);
    expect(moved).toMatchObject({ dx: 1, dy: -0.25, dz: 4, mult: 1 });
    const prop = applyEdit(tree, moved);
    expect(prop).toMatchObject({ x: 11, y: 19.75, lift: 4, scale: 2, height: 3 });
  });

  it("resizes width and height by the same ratio, so a model is never squashed", () => {
    const bigger = applyEdit(tree, resize(resize(undefined, 1), 1));
    expect(bigger.scale / tree.scale).toBeCloseTo(bigger.height / tree.height, 10);
    expect(bigger.scale).toBeGreaterThan(tree.scale);
  });

  it("keeps size within bounds", () => {
    let edit = NO_EDIT as ReturnType<typeof resize>;
    for (let i = 0; i < 200; i++) {
      edit = resize(edit, 1);
    }
    expect(edit.mult).toBeLessThanOrEqual(SIZE_MAX);
    for (let i = 0; i < 400; i++) {
      edit = resize(edit, -1);
    }
    expect(edit.mult).toBeGreaterThanOrEqual(SIZE_MIN);
  });

  it("a locked object does not move, resize, or turn, and can be unlocked", () => {
    const locked = setLocked(nudge(undefined, "x", 2), true);
    expect(nudge(locked, "x", 1).dx).toBe(2);
    expect(resize(locked, 1).mult).toBe(1);
    expect(turn(locked, 1).dturn).toBe(0);
    expect(nudge(setLocked(locked, false), "x", 1).dx).toBe(3);
  });

  it("applies edits by key and leaves a kind with no edit as the same array", () => {
    const plan = planOf([tree, { ...tree, x: 50 }]);
    const out = applyPlacements(plan, { "pine:1": nudge(undefined, "x", 5) });
    expect(out.props.pine[0]).toBe(plan.props.pine[0]);
    expect(out.props.pine[1].x).toBe(55);
    expect(out.props.house).toBe(plan.props.house);
    expect(applyPlacements(plan, {}).props.pine).toBe(plan.props.pine);
  });
});

describe("landmarks", () => {
  it("has the eighteen cities, each with a distinct territory", () => {
    expect(LANDMARKS).toHaveLength(18);
    expect(new Set(LANDMARKS.map((spec) => spec.region)).size).toBe(18);
    expect(new Set(LANDMARKS.map((spec) => spec.id)).size).toBe(18);
  });

  it("stands each in its territory, north of the anchor, and skips a territory the map lacks", () => {
    const anchors: Record<string, { x: number; y: number }> = { France: { x: 100, y: 200 } };
    const placed = placeLandmarks((name) => anchors[name] ?? null, {});
    expect(placed.map((item) => item.id)).toEqual(["paris"]);
    expect(placed[0].instance).toMatchObject({ x: 100, y: 200 - LANDMARK_NORTH, scale: LANDMARK_SCALE, height: LANDMARK_SCALE });
  });

  it("moves a landmark with its edit", () => {
    const placed = placeLandmarks(() => ({ x: 0, y: 0 }), { "landmark:rome": nudge(undefined, "x", 3) });
    const rome = placed.find((item) => item.id === "rome");
    expect(rome?.instance.x).toBe(3);
  });
});

describe("saving", () => {
  it("round-trips, keeping only objects with an edit", () => {
    const file = serializePlacements({ "pine:3": nudge(undefined, "z", 2), "pine:4": NO_EDIT, "landmark:paris": setLocked(undefined, true) });
    expect(Object.keys(file.items)).toEqual(["landmark:paris", "pine:3"]);
    expect(parsePlacements(JSON.parse(JSON.stringify(file)))).toEqual(file.items);
  });

  it("reads a damaged file as far as it can and never throws", () => {
    expect(parsePlacements(null)).toEqual({});
    expect(parsePlacements({ items: [] })).toEqual({});
    const out = parsePlacements({ items: { "pine:1": { dx: "x", mult: 99, locked: true }, "bad key": { dx: 1 }, "pine:2": 5 } });
    expect(Object.keys(out)).toEqual(["pine:1"]);
    expect(out["pine:1"]).toMatchObject({ dx: 0, mult: SIZE_MAX, locked: true });
  });
});

describe("the landmark reveal", () => {
  const FROM = 4.4;
  const TO = 7;

  it("is nothing until the zoom reaches `from`, whole from `to`, and a straight run between", () => {
    expect(landmarkReveal(3.0, FROM, TO)).toBe(0);
    expect(landmarkReveal(FROM, FROM, TO)).toBe(0);
    expect(landmarkReveal((FROM + TO) / 2, FROM, TO)).toBeCloseTo(0.5, 9);
    expect(landmarkReveal(TO, FROM, TO)).toBe(1);
    expect(landmarkReveal(9, FROM, TO)).toBe(1);
  });

  it("starts later than the sprite reveal and does not finish until near the closest zoom", () => {
    expect(FROM).toBeGreaterThan(3.8);
    expect(TO).toBeGreaterThanOrEqual(6.5);
    expect(TO).toBeLessThanOrEqual(7.48);
  });

  it("fades the base in over a fixed bit of zoom, and raises the monument slowly over the rest", () => {
    expect(LANDMARK_BASE_ZOOM).toBeCloseTo(0.4, 9);
    const share = landmarkBaseShare(FROM, TO);
    expect(share * (TO - FROM)).toBeCloseTo(LANDMARK_BASE_ZOOM, 9);
    // A longer window leaves the base as quick and makes the rise slower.
    expect(landmarkBaseShare(FROM, TO + 2)).toBeLessThan(share);
    expect(landmarkRise(landmarkReveal(FROM + LANDMARK_BASE_ZOOM, FROM, TO), share)).toBeCloseTo(0, 9);
    const mid = landmarkRise(landmarkReveal(5.7, FROM, TO), share);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(landmarkRise(landmarkReveal(TO, FROM, TO), share)).toBe(1);
  });

  it("caps the base at half the window, so the rise always has room", () => {
    expect(landmarkBaseShare(4, 4.4)).toBe(0.5);
  });

  it("is whole and solid before the closest zoom, and never runs backward", () => {
    let last = 0;
    for (let k = 1; k <= 7.5; k += 0.05) {
      const reveal = landmarkReveal(k, FROM, TO);
      expect(reveal).toBeGreaterThanOrEqual(last);
      last = reveal;
    }
    expect(landmarkReveal(7.4, FROM, TO)).toBe(1);
  });
});
