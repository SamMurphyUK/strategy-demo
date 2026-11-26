import { describe, expect, it } from "vitest";
import {
  FRAME,
  HitStop,
  addGroundMark,
  cameraThud,
  curl,
  isHeavyHit,
  muzzleFrame,
  muzzleLight,
  recoilKick,
  recoilPitch,
  smokeAlpha,
  smokeColor,
  stepSmoke,
  type GroundMark,
  type SmokePuff,
} from "../../../src/ui/viewport3d/battle/battleFx";
import { diffSnapshots, pickTarget, snapshotOf, type FeedUnit } from "../../../src/ui/viewport3d/battle/battleFeed";
import { lumaOf } from "../../../src/ui/viewport3d/skins/battleSkin";

describe("recoil and muzzle", () => {
  it("kicks back at the shot and rings down to nothing", () => {
    expect(recoilPitch(0)).toBeCloseTo(0.16, 5);
    expect(Math.abs(recoilPitch(1))).toBeLessThan(0.001);
    expect(recoilPitch(0, 0)).toBe(0);
    expect(recoilKick(0.5)).toBeLessThan(recoilKick(0));
    expect(recoilKick(-1)).toBe(0);
  });

  it("flashes a warm light for under 100 ms and a burst of four pixel frames", () => {
    expect(muzzleLight(0)).toBe(1);
    expect(muzzleLight(0.05)).toBeLessThan(0.4);
    expect(muzzleLight(0.1)).toBe(0);
    expect([0, 0.03, 0.06, 0.09, 0.11].map(muzzleFrame)).toEqual([0, 1, 2, 3, -1]);
  });
});

describe("hit-stop and thud", () => {
  it("holds the clock for the asked frames, then runs again", () => {
    const stop = new HitStop();
    stop.trigger(3);
    const moved: number[] = [];
    for (let i = 0; i < 6; i++) {
      moved.push(stop.advance(FRAME));
    }
    const held = moved.filter((m) => m === 0).length;
    expect(held).toBeGreaterThanOrEqual(3);
    expect(held).toBeLessThanOrEqual(4);
    expect(moved[5]).toBe(FRAME);
    expect(stop.holding).toBe(false);
  });

  it("classes a destroyed unit or a tank as a heavy hit and a light infantry hit as not", () => {
    expect(isHeavyHit("infantry", 1, false)).toBe(false);
    expect(isHeavyHit("infantry", 1, true)).toBe(true);
    expect(isHeavyHit("tank", 1, false)).toBe(true);
    expect(isHeavyHit("infantry", 2, false)).toBe(true);
  });

  it("dips the camera and damps back to rest", () => {
    expect(cameraThud(0)).toBeLessThan(0);
    expect(Math.abs(cameraThud(1))).toBeLessThan(0.001);
    expect(cameraThud(0.1, 0)).toBe(0);
  });
});

describe("smoke", () => {
  it("curls: the field is finite and varies with place", () => {
    const [a, b] = curl(1.3, 2.1, 0);
    const [c] = curl(5.7, 0.4, 0);
    expect(Number.isFinite(a) && Number.isFinite(b)).toBe(true);
    expect(c).not.toBe(a);
  });

  it("rises and widens as a puff ages, and fades in and out", () => {
    const p: SmokePuff = { x: 0, y: 0, z: 0, age: 0, life: 20, size: 1, dark: 1 };
    for (let i = 0; i < 600; i++) {
      stepSmoke(p, FRAME, i * FRAME);
    }
    expect(p.y).toBeGreaterThan(0.5);
    expect(p.size).toBeGreaterThan(1);
    expect(smokeAlpha({ age: 0, life: 20 }, 1)).toBe(0);
    expect(smokeAlpha({ age: 2, life: 20 }, 1)).toBeGreaterThan(0.2);
    expect(smokeAlpha({ age: 20, life: 20 }, 1)).toBe(0);
    expect(smokeAlpha({ age: 2, life: 20 }, 0)).toBe(0);
  });

  it("never exceeds the 0.88 smoke luminance", () => {
    for (const dark of [0, 0.5, 1]) {
      expect(lumaOf(smokeColor(dark, 0.88))).toBeLessThanOrEqual(0.88);
    }
    expect(lumaOf(smokeColor(0, 0.4))).toBeLessThanOrEqual(0.4 + 1e-6);
  });

  it("carries ground marks across rounds and drops the oldest past the cap", () => {
    let marks: GroundMark[] = [];
    for (let i = 0; i < 12; i++) {
      marks = addGroundMark(marks, { x: i, d: 0.3, radius: 0.3, kind: 1, turn: 0 }, 10);
    }
    expect(marks).toHaveLength(10);
    expect(marks[0].x).toBe(2);
    expect(marks[9].x).toBe(11);
  });
});

const unit = (over: Partial<FeedUnit> & { uid: string }): FeedUnit => ({
  type: "infantry",
  side: "attacker",
  currentHp: 1,
  maxHp: 1,
  status: "alive",
  isDestroyed: false,
  ...over,
});
const tank = () => unit({ uid: "d1", side: "defender", type: "tank", currentHp: 2, maxHp: 2 });

describe("the feed", () => {
  const a = snapshotOf([unit({ uid: "a1" }), tank()]);

  it("raises nothing the first time it sees a unit", () => {
    expect(diffSnapshots(null, a)).toEqual([]);
  });

  it("sees a shot on the recoil rising edge and on hasFiredThisRound, once", () => {
    const b = snapshotOf([unit({ uid: "a1", animRecoil: 0.9 }), tank()]);
    expect(diffSnapshots(a, b).map((e) => e.kind)).toEqual(["fire"]);
    const c = snapshotOf([unit({ uid: "a1", hasFiredThisRound: true }), tank()]);
    expect(diffSnapshots(a, c).map((e) => e.kind)).toEqual(["fire"]);
    expect(diffSnapshots(b, b)).toEqual([]);
  });

  it("sees damage, destruction and promotion", () => {
    const b = snapshotOf([unit({ uid: "a1", promoted: true }), unit({ uid: "d1", side: "defender", type: "tank", currentHp: 1, maxHp: 2 })]);
    expect(diffSnapshots(a, b).map((e) => e.kind).sort()).toEqual(["hit", "promotion"]);
    const dead = snapshotOf([unit({ uid: "a1", status: "dead", isDestroyed: true, currentHp: 0 }), tank()]);
    const hit = diffSnapshots(a, dead).find((e) => e.kind === "hit");
    expect(hit && hit.kind === "hit" && hit.destroyed && hit.heavy).toBe(true);
  });

  it("aims at a live unit of the other side, the same way every time, and at nothing when none is left", () => {
    const shooter = { uid: "a1", side: "attacker" as const, type: "infantry" };
    expect(pickTarget(a, shooter, 1)?.uid).toBe("d1");
    expect(pickTarget(a, shooter, 1)).toEqual(pickTarget(a, shooter, 1));
    expect(pickTarget(snapshotOf([unit({ uid: "a1" })]), shooter, 1)).toBeNull();
  });
});
