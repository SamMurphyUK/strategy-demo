import { describe, expect, it } from "vitest";
import {
  paintCrater,
  paintGrid,
  paintGroundHaze,
  paintParapet,
  paintTrench,
  paintWire,
  squashPaint,
} from "../../../src/ui/battle/scenery/groundPerspective";
import {
  CRATER_RATIO,
  FIELD_BOTTOM,
  HAZE_ALPHA,
  RAY_FLOOR,
  LANE_SCALE_BACK,
  LANE_SCALE_FRONT,
  SHORE_Y,
  VANISH,
  BATTLE_UNIT_BOOST,
  battleUnitScale,
  decalRadii,
  hazeBands,
  laneScale,
  rayScale,
  rayX,
  squashY,
  trackWidth,
  unsquashY,
} from "../../../src/ui/battle/scenery/perspective";
import { LAND_GRID_ALPHA, type Paint } from "../../../src/ui/battle/scenery/sceneryPaint";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  alpha: number;
}

interface Oval {
  x: number;
  y: number;
  rx: number;
  ry: number;
  color: string;
}

function recorder() {
  const rects: Rect[] = [];
  const ovals: Oval[] = [];
  const ctx = {
    fillStyle: "#000000",
    strokeStyle: "#000000",
    lineWidth: 1,
    globalAlpha: 1,
    fillRect(x: number, y: number, w: number, h: number) {
      rects.push({ x, y, w, h, color: String(this.fillStyle), alpha: this.globalAlpha });
    },
    ellipse(x: number, y: number, rx: number, ry: number) {
      ovals.push({ x, y, rx, ry, color: String(this.fillStyle) });
    },
    arc() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill() {},
    stroke() {},
    save() {},
    restore() {},
  };
  return { ctx: ctx as unknown as Paint, rects, ovals };
}

describe("one-point perspective", () => {
  it("keeps the horizon and the bottom edge where they were, and squeezes the rows between", () => {
    expect(squashY(VANISH.y)).toBe(VANISH.y);
    expect(squashY(FIELD_BOTTOM)).toBe(FIELD_BOTTOM);
    const middle = (VANISH.y + FIELD_BOTTOM) / 2;
    expect(squashY(middle)).toBeLessThan(middle);
    let last = squashY(VANISH.y);
    for (let y = VANISH.y + 1; y <= FIELD_BOTTOM; y += 1) {
      const next = squashY(y);
      expect(next).toBeGreaterThanOrEqual(last);
      last = next;
    }
  });

  it("gives rows near the horizon less room than rows near the viewer", () => {
    const far = squashY(VANISH.y + 60) - squashY(VANISH.y);
    const near = squashY(FIELD_BOTTOM) - squashY(FIELD_BOTTOM - 60);
    expect(far).toBeLessThan(near / 2);
  });

  it("puts a row back where it started when the squeeze is undone", () => {
    for (const y of [120, 200, 298, 400, 500]) {
      expect(unsquashY(squashY(y))).toBeCloseTo(y, 6);
    }
  });

  it("leans every receding line inward, 20% less steeply than a point on the horizon", () => {
    expect(rayX(300, FIELD_BOTTOM)).toBe(300);
    expect(RAY_FLOOR).toBe(0.2);
    // At the horizon a line keeps a fifth of its offset, so it does not close to a point.
    expect(rayX(300, VANISH.y)).toBeCloseTo(VANISH.x + (300 - VANISH.x) * 0.2, 6);
    expect(rayX(1200, VANISH.y)).toBeCloseTo(VANISH.x + (1200 - VANISH.x) * 0.2, 6);
    // The slope is 0.8 of what it was: the same drop in x over the same climb.
    const oldDrift = (VANISH.x - 300) / (FIELD_BOTTOM - VANISH.y);
    const drift = (rayX(300, VANISH.y) - rayX(300, FIELD_BOTTOM)) / (FIELD_BOTTOM - VANISH.y);
    expect(drift / oldDrift).toBeCloseTo(0.8, 6);
    let left = rayX(300, FIELD_BOTTOM);
    let right = rayX(1000, FIELD_BOTTOM);
    for (let y = FIELD_BOTTOM - 20; y >= VANISH.y; y -= 20) {
      expect(rayX(300, y)).toBeGreaterThan(left);
      expect(rayX(1000, y)).toBeLessThan(right);
      left = rayX(300, y);
      right = rayX(1000, y);
    }
    expect(rayScale(VANISH.y)).toBeCloseTo(RAY_FLOOR, 6);
    expect(rayScale(FIELD_BOTTOM)).toBe(1);
  });

  it("keeps a trench 10 pixels wide at the horizon and 12 at the bottom edge", () => {
    expect(trackWidth(VANISH.y)).toBe(10);
    expect(trackWidth(FIELD_BOTTOM)).toBe(12);
    expect(trackWidth(300)).toBeGreaterThan(10);
    expect(trackWidth(300)).toBeLessThan(12);
  });

  it("scales a unit 0.85 on the back lane up to 1.05 at the shore", () => {
    expect(laneScale(VANISH.y)).toBeCloseTo(LANE_SCALE_BACK, 6);
    expect(laneScale(SHORE_Y)).toBeCloseTo(LANE_SCALE_FRONT, 6);
    expect(LANE_SCALE_BACK).toBe(0.85);
    expect(LANE_SCALE_FRONT).toBe(1.05);
    expect(laneScale(0)).toBe(LANE_SCALE_BACK);
    expect(laneScale(700)).toBe(LANE_SCALE_FRONT);
    expect(laneScale(160)).toBeLessThan(laneScale(298));
    expect(laneScale(298)).toBeLessThan(laneScale(480));
    expect(BATTLE_UNIT_BOOST).toBe(1.2);
    expect(battleUnitScale(SHORE_Y)).toBeCloseTo(1.2 * LANE_SCALE_FRONT, 6);
    expect(battleUnitScale(VANISH.y)).toBeLessThan(battleUnitScale(SHORE_Y));
  });

  it("draws a round decal as an ellipse 0.42 as tall as it is wide, larger toward the viewer", () => {
    expect(CRATER_RATIO).toBe(0.42);
    for (const y of [130, 300, 500]) {
      const { rx, ry } = decalRadii(20, y);
      expect(ry / rx).toBeCloseTo(0.42, 6);
    }
    expect(decalRadii(20, 500).rx).toBeGreaterThan(decalRadii(20, 130).rx);
  });

  it("fades the haze away from the horizon line", () => {
    const bands = hazeBands(110, HAZE_ALPHA);
    expect(bands[0]?.y).toBe(VANISH.y);
    expect(bands[0]?.alpha).toBeCloseTo(HAZE_ALPHA, 6);
    for (let i = 1; i < bands.length; i += 1) {
      expect(bands[i]?.alpha ?? 1).toBeLessThan(bands[i - 1]?.alpha ?? 0);
      expect(bands[i]?.y ?? 0).toBeGreaterThan(bands[i - 1]?.y ?? 0);
    }
    const sky = hazeBands(26, 0.3, 4, -1);
    expect(sky[0]?.y).toBe(VANISH.y - 4);
    expect((sky[0]?.alpha ?? 0) > (sky[sky.length - 1]?.alpha ?? 1)).toBe(true);
  });
});

describe("ground furniture on the rays", () => {
  it("slants a trench inward from bottom to top", () => {
    const { ctx, rects } = recorder();
    paintTrench(ctx, 470, false);
    const bed = rects.filter((r) => r.color === "#645355" && r.h === 1);
    const lowest = bed.reduce((a, b) => (b.y > a.y ? b : a));
    const highest = bed.reduce((a, b) => (b.y < a.y ? b : a));
    expect(Math.abs(lowest.x + lowest.w / 2 - 470)).toBeLessThan(10);
    expect(highest.x).toBeGreaterThan(lowest.x + 100);
    expect(highest.x).toBeLessThan(VANISH.x);
    expect(highest.w).toBeLessThan(lowest.w);
    // It never closes to a point: every row of the trench is at least 10 pixels wide.
    expect(Math.min(...bed.map((r) => r.w))).toBeGreaterThanOrEqual(10);
    expect(highest.w).toBe(10);
    const right = recorder();
    paintTrench(right.ctx, 810, false);
    const rightTop = right.rects.filter((r) => r.color === "#645355").reduce((a, b) => (b.y < a.y ? b : a));
    expect(rightTop.x).toBeLessThan(810);
    expect(rightTop.x).toBeGreaterThan(VANISH.x);
  });

  it("slants the sandbag parapet and shrinks its bags toward the horizon", () => {
    const { ctx, rects } = recorder();
    paintParapet(ctx, 470, -15);
    const bags = rects.filter((r) => r.color === "#CCA87B");
    const near = bags[bags.length - 1];
    const far = bags[0];
    expect(near?.x).toBeCloseTo(455, -1);
    expect(far?.x ?? 0).toBeGreaterThan((near?.x ?? 0) + 100);
    expect(far?.w ?? 99).toBeLessThan(near?.w ?? 0);
    expect(far?.w ?? 0).toBeGreaterThanOrEqual(5);
  });

  it("stands the wire posts on rays", () => {
    const { ctx, rects } = recorder();
    paintWire(ctx);
    const posts = rects.filter((r) => r.color === "#846D59");
    expect(posts.length).toBe(10);
    const gaps = [];
    for (let i = 0; i < posts.length; i += 2) {
      gaps.push((posts[i + 1]?.x ?? 0) - (posts[i]?.x ?? 0));
    }
    for (let i = 1; i < gaps.length; i += 1) {
      expect(gaps[i] ?? 0).toBeGreaterThan(gaps[i - 1] ?? 99);
    }
  });

  it("keeps the grid at or under 0.22 and draws it over the whole field", () => {
    expect(LAND_GRID_ALPHA).toBeLessThanOrEqual(0.22);
    const { ctx, rects } = recorder();
    paintGrid(ctx, 1280, "#645355", LAND_GRID_ALPHA);
    expect(rects.length).toBeGreaterThan(100);
    expect(Math.max(...rects.map((r) => r.alpha))).toBeLessThanOrEqual(0.22);
    expect(rects.every((r) => r.x >= 0 && r.x < 1280)).toBe(true);
    // The lines are closer together toward the horizon.
    const dots = rects.filter((r) => r.w === 1);
    const topRow = Math.min(...dots.map((r) => r.y));
    const bottomRow = Math.max(...dots.map((r) => r.y));
    const spacing = (row: number) => {
      const xs = dots.filter((r) => r.y === row).map((r) => r.x).sort((a, b) => a - b);
      return (xs[xs.length - 1] - xs[0]) / (xs.length - 1);
    };
    expect(spacing(topRow)).toBeLessThan(spacing(bottomRow) / 2);
  });

  it("lays the craters as flat ellipses", () => {
    const { ctx, ovals } = recorder();
    paintCrater(ctx, 640, 440, 20, "#846D59");
    const pit = ovals[1];
    expect(pit?.color).toBe("#645355");
    expect((pit?.ry ?? 0) / (pit?.rx ?? 1)).toBeCloseTo(0.42, 2);
    const far = recorder();
    paintCrater(far.ctx, 640, 150, 20, "#846D59");
    expect(far.ovals[1]?.rx ?? 99).toBeLessThan(pit?.rx ?? 0);
  });

  it("lays the haze thickest on the horizon and never past 0.4", () => {
    const { ctx, rects } = recorder();
    paintGroundHaze(ctx, 1280);
    expect(rects[0]?.y).toBe(VANISH.y);
    expect(rects[0]?.alpha).toBeCloseTo(HAZE_ALPHA, 6);
    expect(Math.max(...rects.map((r) => r.alpha))).toBeLessThanOrEqual(0.4);
    expect(rects[rects.length - 1]?.alpha ?? 1).toBeLessThan(0.05);
  });
});

describe("squashPaint", () => {
  it("squeezes rects and ovals toward the horizon and leaves a full-field fill alone", () => {
    const { ctx, rects, ovals } = recorder();
    const flat = squashPaint(ctx);
    flat.fillStyle = "#8E9F7D";
    flat.fillRect(0, 114, 1280, 416);
    flat.fillRect(100, 200, 40, 20);
    expect(rects[0]).toMatchObject({ y: 114, h: 416, color: "#8E9F7D" });
    expect(rects[1]?.y ?? 0).toBeLessThan(200);
    expect(rects[1]?.h ?? 99).toBeLessThan(20);
    flat.ellipse(300, 200, 10, 10, 0, 0, Math.PI * 2);
    expect(ovals[0]?.y ?? 999).toBeLessThan(200);
    expect(ovals[0]?.ry ?? 99).toBeLessThan(10);
    expect(ovals[0]?.rx).toBe(10);
  });

  it("passes state through to the real painter", () => {
    const { ctx } = recorder();
    const flat = squashPaint(ctx);
    flat.globalAlpha = 0.5;
    expect(ctx.globalAlpha).toBe(0.5);
  });
});
