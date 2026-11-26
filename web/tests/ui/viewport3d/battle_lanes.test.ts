import { describe, expect, it } from "vitest";
import {
  STAGE_HALF,
  airPose,
  depthDesat,
  depthMist,
  depthScale,
  desaturate,
  groundShadow,
  columnOf,
  rankSlot,
  laneOf,
  layoutLanes,
  toWorld,
  type LaneUnit,
} from "../../../src/ui/viewport3d/battle/battleLanes";
import { DEFAULT_BATTLE_VISUALS } from "../../../src/ui/viewport3d/skins/battleVisualConfig";

const roster = (side: "attacker" | "defender"): LaneUnit[] => [
  { uid: `${side}-i1`, type: "infantry", side },
  { uid: `${side}-i2`, type: "infantry", side },
  { uid: `${side}-m1`, type: "mech_infantry", side },
  { uid: `${side}-t1`, type: "tank", side },
  { uid: `${side}-a1`, type: "artillery", side },
  { uid: `${side}-aa1`, type: "aa", side },
  { uid: `${side}-f1`, type: "fighter", side },
  { uid: `${side}-b1`, type: "strategic_bomber", side },
];

describe("lane assignment", () => {
  it("puts infantry, mechanized and tanks in the front, artillery and AA behind, aircraft in the air", () => {
    expect(["infantry", "mech_infantry", "tank", "armor"].map(laneOf)).toEqual(["front", "front", "front", "front"]);
    expect(["artillery", "aa", "aaa"].map(laneOf)).toEqual(["rear", "rear", "rear"]);
    expect(["fighter", "tactical_bomber", "strategic_bomber"].map(laneOf)).toEqual(["air", "air", "air"]);
  });
});

describe("depth scale and desaturation", () => {
  it("scales the rear lane back to 0.78 to 0.85 by default, and leaves the front alone", () => {
    expect(depthScale("front", DEFAULT_BATTLE_VISUALS)).toBe(1);
    const rear = depthScale("rear", DEFAULT_BATTLE_VISUALS);
    expect(rear).toBeGreaterThanOrEqual(0.78);
    expect(rear).toBeLessThanOrEqual(0.85);
  });

  it("follows the slider and keeps the airspace between the rear and the front", () => {
    expect(depthScale("rear", { battleDepthScale: 0.7 })).toBe(0.7);
    expect(depthScale("rear", { battleDepthScale: 9 })).toBe(1);
    const air = depthScale("air", { battleDepthScale: 0.7 });
    expect(air).toBeGreaterThan(0.7);
    expect(air).toBeLessThan(1);
  });

  it("draws 20 to 30 percent of the colour out of the rear lanes and none out of the front", () => {
    expect(depthDesat("front", DEFAULT_BATTLE_VISUALS)).toBe(0);
    const rear = depthDesat("rear", DEFAULT_BATTLE_VISUALS);
    expect(rear).toBeGreaterThanOrEqual(0.2);
    expect(rear).toBeLessThanOrEqual(0.3);
    expect(depthMist("front", DEFAULT_BATTLE_VISUALS)).toBe(0);
    expect(depthMist("rear", DEFAULT_BATTLE_VISUALS)).toBeGreaterThan(0);
  });

  it("desaturates toward luma and leaves greys unchanged", () => {
    const grey = desaturate([0.5, 0.5, 0.5], 0.3);
    expect(grey[0]).toBeCloseTo(0.5, 6);
    const [r, g, b] = desaturate([1, 0, 0], 1);
    expect(r).toBeCloseTo(g, 6);
    expect(g).toBeCloseTo(b, 6);
    const d = desaturate([0.8, 0.2, 0.2], 0.25);
    expect(d[0] - d[1]).toBeLessThan(0.6);
  });
});

describe("lane layout", () => {
  const slots = layoutLanes([...roster("attacker"), ...roster("defender")]);
  const by = (uid: string) => slots.find((s) => s.uid === uid)!;

  it("gives every unit one slot", () => {
    expect(slots).toHaveLength(16);
    expect(new Set(slots.map((s) => s.uid)).size).toBe(16);
  });

  it("stands the attacker on the left facing right and the defender on the right facing left", () => {
    for (const s of slots.filter((s) => s.lane !== "air")) {
      expect(s.side === "attacker" ? s.x < 0 : s.x > 0).toBe(true);
      expect(s.facing).toBe(s.side === "attacker" ? 1 : -1);
    }
  });

  it("keeps the airspace high and ground units on the ground", () => {
    expect(by("attacker-f1").y).toBeGreaterThan(2);
    expect(by("attacker-t1").y).toBe(0);
  });

  it("steps the rank columns outward from the trench line, rank I nearest, the attacker left and the defender mirrored", () => {
    expect([1, 2, 3, 4].map((r) => columnOf("attacker", r))).toEqual([3, 2, 1, 0]);
    expect([1, 2, 3, 4].map((r) => columnOf("defender", r))).toEqual([0, 1, 2, 3]);
    const mk = (side: "attacker" | "defender", rank: number, uid: string) => ({ uid, type: "infantry", side, effectiveRank: rank, rowIndex: 0 });
    const s = layoutLanes([mk("attacker", 4, "a4"), mk("attacker", 1, "a1"), mk("defender", 1, "d1"), mk("defender", 4, "d4")]);
    const x = (u: string) => s.find((q) => q.uid === u)!.x;
    expect(x("a4")).toBeLessThan(x("a1"));
    expect(x("a1")).toBeLessThan(0);
    expect(x("d1")).toBeLessThan(x("d4"));
    expect(x("d1")).toBeGreaterThan(0);
    // The rank I columns stand outside the trench lines, so no man's land between them is empty of units.
    expect(x("d1") - x("a1")).toBeGreaterThan(2 * 3);
  });

  it("stacks units of one rank as rows in their column, and keeps the rows apart", () => {
    const s = layoutLanes([0, 1, 2].map((i) => ({ uid: `u${i}`, type: "infantry", side: "attacker" as const, effectiveRank: 1, colIndex: 3, rowIndex: i })));
    expect(new Set(s.map((q) => q.d)).size).toBe(3);
    expect(rankSlot("attacker", 3, 0).d).toBeLessThan(rankSlot("attacker", 3, 2).d);
  });

  it("stands a paired artillery piece beside its infantry", () => {
    const s = layoutLanes([
      { uid: "i", type: "infantry", side: "attacker", effectiveRank: 2, pairedWithUid: "g" },
      { uid: "g", type: "artillery", side: "attacker", effectiveRank: 2, pairedWithUid: "i" },
    ]);
    const i = s.find((q) => q.uid === "i")!;
    const g = s.find((q) => q.uid === "g")!;
    expect(Math.abs(g.x - i.x)).toBeLessThan(1);
    expect(g.lane).toBe("rear");
  });

  it("keeps every ground unit on the stage and no two on the same spot", () => {
    const ground = slots.filter((s) => s.lane !== "air");
    for (const s of ground) {
      expect(Math.abs(s.x)).toBeLessThan(STAGE_HALF);
    }
    const seen = new Set(ground.map((s) => `${s.x.toFixed(3)}:${s.d.toFixed(3)}`));
    expect(seen.size).toBe(ground.length);
  });

  it("holds a unit's place when another is lost", () => {
    const fewer = layoutLanes([...roster("attacker").filter((u) => u.uid !== "attacker-i1"), ...roster("defender")]);
    expect(fewer.find((s) => s.uid === "attacker-t1")).toBeDefined();
  });
});

describe("air lane", () => {
  it("banks over the stage and stays aloft", () => {
    let maxBank = 0;
    for (let t = 0; t < 30; t += 0.5) {
      const p = airPose("attacker", 0, 2, t);
      expect(p.y).toBeGreaterThan(3);
      expect(p.d).toBeGreaterThan(0.2);
      expect(p.d).toBeLessThan(0.9);
      maxBank = Math.max(maxBank, Math.abs(p.bank));
    }
    expect(maxBank).toBeGreaterThan(0.2);
  });

  it("casts a shadow on the ground below and away from the sun", () => {
    const s = groundShadow(0, 0.5, 4, [-0.45, 0.4, 0.8]);
    expect(s.x).toBeGreaterThan(0);
    expect(s.d).toBeLessThan(0.5);
    expect(groundShadow(1, 0.5, 0, [-0.45, 0.4, 0.8])).toEqual({ x: 1, d: 0.5 });
  });

  it("maps stage depth to world y, z up, with the front lip nearest the camera", () => {
    expect(toWorld(2, 0)[1]).toBeLessThan(toWorld(2, 1)[1]);
    expect(toWorld(2, 0.5)[1]).toBe(0);
    expect(toWorld(2, 0.5, 3)[2]).toBe(3);
  });
});
