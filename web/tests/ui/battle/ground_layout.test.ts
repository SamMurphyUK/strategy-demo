import { describe, expect, it } from "vitest";
import { MILITARY } from "../../../src/ui/theme/militaryPalette";
import {
  BEND_RAMP,
  CRATER_CLEARANCE,
  CRATER_COUNT,
  CRATER_ROWS,
  DEFAULT_CRATERS,
  TRENCH_BOUNDS,
  bendOffset,
  groundLayout,
  paintTrench,
  paintTrenchClusters,
  paintParapet,
} from "../../../src/ui/battle/scenery/groundPerspective";
import { sceneRegionList } from "../../../src/ui/battle/scenery/sceneRegions";
import { sceneSeed } from "../../../src/ui/battle/scenery/regionScene";
import type { Paint } from "../../../src/ui/battle/scenery/sceneryPaint";

const PALETTE = new Set<string>(Object.values(MILITARY));
const land = () => sceneRegionList().filter((r) => r.type === "land").map((r) => r.id);

function recorder() {
  const rects: { x: number; y: number; w: number; h: number; color: string }[] = [];
  const colours = new Set<string>();
  let fillStyle = "#000000";
  let strokeStyle = "#000000";
  const ctx = {
    get fillStyle() {
      return fillStyle;
    },
    set fillStyle(v: string) {
      fillStyle = v;
      colours.add(v);
    },
    get strokeStyle() {
      return strokeStyle;
    },
    set strokeStyle(v: string) {
      strokeStyle = v;
      colours.add(v);
    },
    lineWidth: 1,
    globalAlpha: 1,
    fillRect(x: number, y: number, w: number, h: number) {
      rects.push({ x, y, w, h, color: fillStyle });
    },
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill() {},
    stroke() {},
    arc() {},
    ellipse() {},
    save() {},
    restore() {},
  };
  return { ctx: ctx as unknown as Paint, rects, colours };
}

describe("ground layout", () => {
  it("gives the old fields back with no seed", () => {
    const layout = groundLayout();
    expect(layout.trenches.map((t) => t.centre)).toEqual([470, 810]);
    expect(layout.trenches.every((t) => t.bend === undefined)).toBe(true);
    expect(layout.craters).toEqual([...DEFAULT_CRATERS]);
    expect(layout.craters).toHaveLength(7);
    expect(layout.clusters).toEqual([]);
  });

  it("paints a trench with no bend exactly as before", () => {
    const plain = recorder();
    const bentNone = recorder();
    paintTrench(plain.ctx, 470, false);
    paintTrench(bentNone.ctx, 470, false, undefined);
    expect(plain.rects).toEqual(bentNone.rects);
    const zero = recorder();
    paintTrench(zero.ctx, 470, false, { from: 300, shift: 0 });
    expect(zero.rects).toEqual(plain.rects);
  });

  it("is the same for the same seed", () => {
    for (const id of ["France", "Libya", "Moscow"]) {
      expect(groundLayout(sceneSeed(id))).toEqual(groundLayout(sceneSeed(id)));
    }
  });

  it("gives different regions different trenches and craters", () => {
    const ids = land().slice(0, 40);
    const trenches = new Set(ids.map((id) => JSON.stringify(groundLayout(sceneSeed(id)).trenches)));
    const craters = new Set(ids.map((id) => JSON.stringify(groundLayout(sceneSeed(id)).craters)));
    expect(trenches.size).toBeGreaterThan(ids.length * 0.8);
    expect(craters.size).toBe(ids.length);
    const france = groundLayout(sceneSeed("France"));
    const libya = groundLayout(sceneSeed("Libya"));
    expect(france).not.toEqual(libya);
  });

  it("keeps trenches, doglegs and craters inside the safe middle for every region", () => {
    for (const id of land()) {
      const layout = groundLayout(sceneSeed(id));
      const [left, right] = layout.trenches;
      expect(left.centre).toBeGreaterThanOrEqual(TRENCH_BOUNDS.left.min);
      expect(left.centre).toBeLessThanOrEqual(TRENCH_BOUNDS.left.max);
      expect(right.centre).toBeGreaterThanOrEqual(TRENCH_BOUNDS.right.min);
      expect(right.centre).toBeLessThanOrEqual(TRENCH_BOUNDS.right.max);
      for (const [line, bounds] of [[left, TRENCH_BOUNDS.left], [right, TRENCH_BOUNDS.right]] as const) {
        const far = line.centre + (line.bend?.shift ?? 0);
        expect(far, id).toBeGreaterThanOrEqual(bounds.min);
        expect(far, id).toBeLessThanOrEqual(bounds.max);
        if (line.bend) {
          expect(Math.abs(line.bend.shift)).toBeLessThanOrEqual(26);
          expect(line.bend.from).toBeGreaterThanOrEqual(230);
          expect(line.bend.from + BEND_RAMP).toBeLessThan(520);
        }
      }
      expect(layout.craters.length).toBeGreaterThanOrEqual(CRATER_COUNT.min - 3);
      expect(layout.craters.length).toBeLessThanOrEqual(CRATER_COUNT.max);
      for (const c of layout.craters) {
        expect(c.x, id).toBeGreaterThan(left.centre + CRATER_CLEARANCE - 1);
        expect(c.x, id).toBeLessThan(right.centre - CRATER_CLEARANCE + 1);
        expect(c.y).toBeGreaterThanOrEqual(CRATER_ROWS.min);
        expect(c.y).toBeLessThanOrEqual(CRATER_ROWS.max);
        expect(c.r).toBeGreaterThanOrEqual(9);
        expect(c.r).toBeLessThanOrEqual(21);
      }
    }
  });

  it("varies the number of craters across regions", () => {
    const counts = new Set(land().map((id) => groundLayout(sceneSeed(id)).craters.length));
    expect(counts.size).toBeGreaterThan(1);
  });

  it("keeps the middle of the front lanes free of trench and cluster", () => {
    for (const id of land()) {
      const { ctx, rects } = recorder();
      const layout = groundLayout(sceneSeed(id));
      paintTrench(ctx, layout.trenches[0].centre, false, layout.trenches[0].bend);
      paintTrench(ctx, layout.trenches[1].centre, false, layout.trenches[1].bend);
      paintParapet(ctx, layout.trenches[0].centre, -15, layout.trenches[0].bend);
      paintParapet(ctx, layout.trenches[1].centre, 5, layout.trenches[1].bend);
      paintTrenchClusters(ctx, layout);
      // Lines lean in toward the horizon, so look at the near rows: the front lanes stand there.
      for (const r of rects.filter((rect) => rect.y >= 470)) {
        expect(r.x + r.w > 530 && r.x < 750, `${id} at ${r.x},${r.y}`).toBe(false);
      }
    }
  });

  it("slides a dogleg smoothly from nothing to its full shift", () => {
    const bend = { from: 300, shift: 20 };
    expect(bendOffset(undefined, 400)).toBe(0);
    expect(bendOffset(bend, 250)).toBe(0);
    expect(bendOffset(bend, 300)).toBe(0);
    expect(bendOffset(bend, 300 + BEND_RAMP)).toBeCloseTo(20, 6);
    expect(bendOffset(bend, 520)).toBeCloseTo(20, 6);
    let last = 0;
    for (let plan = 300; plan <= 300 + BEND_RAMP; plan += 1) {
      const next = bendOffset(bend, plan);
      expect(next).toBeGreaterThanOrEqual(last);
      last = next;
    }
  });

  it("moves a bent trench sideways below the bend and not above it", () => {
    const straight = recorder();
    const bent = recorder();
    paintTrench(straight.ctx, 470, false);
    paintTrench(bent.ctx, 470, false, { from: 300, shift: 24 });
    const bed = (rects: { x: number; y: number; w: number; h: number; color: string }[]) => rects.filter((r) => r.color === "#645355" && r.h === 1);
    const a = bed(straight.rects);
    const b = bed(bent.rects);
    expect(a).toHaveLength(b.length);
    const top = Math.min(...a.map((r) => r.y));
    const bottom = Math.max(...a.map((r) => r.y));
    expect(b.find((r) => r.y === top)?.x).toBe(a.find((r) => r.y === top)?.x);
    expect((b.find((r) => r.y === bottom)?.x ?? 0) - (a.find((r) => r.y === bottom)?.x ?? 0)).toBeGreaterThan(18);
  });

  it("paints clusters in the 16 colours only, and the seed adds some", () => {
    let withClusters = 0;
    for (const id of land().slice(0, 60)) {
      const layout = groundLayout(sceneSeed(id));
      const { ctx, colours } = recorder();
      paintTrenchClusters(ctx, layout);
      if (layout.clusters.length > 0) withClusters += 1;
      for (const colour of colours) expect(PALETTE).toContain(colour);
    }
    expect(withClusters).toBeGreaterThan(30);
  });
});
