import { describe, expect, it } from "vitest";
import {
  addRegionFromPolygon,
  edgeSharers,
  type EditorMap,
  editorFromMapJson,
  findRegion,
  nearestSharedEdge,
  roughenEdge,
} from "../../../src/ui/map/editor/editorModel";
import { chaikin, prepareStroke, rdp, removeLoops, splitPolygonInto, strokePreview } from "../../../src/ui/map/editor/slicing";
import type { Vec2 } from "../../../src/ui/map/geometry";
import { ringArea } from "../../../src/ui/map/regionClip";

const square = (x: number, y: number, s: number): Vec2[] => [
  { x, y },
  { x: x + s, y },
  { x: x + s, y: y + s },
  { x, y: y + s },
];
const area = (poly: Vec2[]) => ringArea(poly.map((p) => [p.x, p.y]));
const same = (a: Vec2, b: Vec2) => a.x === b.x && a.y === b.y;

/** A small repeatable random source. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A hand-drawn S across a 100 square: about 300 samples, a little jitter, from top to bottom. */
function wobblyStroke(samples = 300, jitter = 0.4): Vec2[] {
  const rand = seeded(7);
  return Array.from({ length: samples }, (_, i) => {
    const t = i / (samples - 1);
    return {
      x: 50 + 18 * Math.sin(t * Math.PI * 2) + (rand() - 0.5) * jitter,
      y: -10 + 120 * t,
    };
  });
}

const selfCrosses = (pts: Vec2[]): boolean => {
  const cross = (a: Vec2, b: Vec2, c: Vec2) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  for (let i = 0; i + 1 < pts.length; i++) {
    for (let j = i + 2; j + 1 < pts.length; j++) {
      const d1 = cross(pts[i], pts[i + 1], pts[j]);
      const d2 = cross(pts[i], pts[i + 1], pts[j + 1]);
      const d3 = cross(pts[j], pts[j + 1], pts[i]);
      const d4 = cross(pts[j], pts[j + 1], pts[i + 1]);
      if (d1 * d2 < 0 && d3 * d4 < 0) {
        return true;
      }
    }
  }
  return false;
};

describe("freehand stroke cleanup", () => {
  it("cuts a tremor loop out and keeps the line's ends", () => {
    const stroke: Vec2[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 24, y: 6 },
      { x: 18, y: 6 },
      { x: 18, y: -4 }, // doubles back over the line: a loop
      { x: 28, y: -4 },
      { x: 40, y: 0 },
    ];
    expect(selfCrosses(stroke)).toBe(true);
    const clean = removeLoops(stroke);
    expect(selfCrosses(clean)).toBe(false);
    expect(clean[0]).toEqual(stroke[0]);
    expect(clean[clean.length - 1]).toEqual(stroke[stroke.length - 1]);
    expect(clean.length).toBeLessThan(stroke.length);
  });

  it("leaves a clean stroke alone", () => {
    const line = [
      { x: 0, y: 0 },
      { x: 5, y: 3 },
      { x: 10, y: 0 },
    ];
    expect(removeLoops(line)).toEqual(line);
  });

  it("RDP turns 300 samples into a short polyline within tolerance, and a bigger tolerance keeps fewer", () => {
    const raw = wobblyStroke();
    const fine = rdp(raw, 1.5);
    const smooth = rdp(raw, 5);
    expect(fine.length).toBeGreaterThanOrEqual(3);
    expect(fine.length).toBeLessThanOrEqual(25);
    expect(smooth.length).toBeLessThanOrEqual(fine.length);
    expect(fine[0]).toEqual(raw[0]);
    expect(fine[fine.length - 1]).toEqual(raw[raw.length - 1]);
    // Every dropped sample stays near the simplified line.
    for (const p of raw) {
      const d = Math.min(
        ...fine.slice(0, -1).map((a, i) => {
          const b = fine[i + 1];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
          return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
        }),
      );
      expect(d).toBeLessThanOrEqual(1.5 + 1e-9);
    }
  });

  it("Chaikin keeps the ends and cuts every corner", () => {
    const corner = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    const once = chaikin(corner, 1);
    expect(once).toHaveLength(6);
    expect(once[0]).toEqual(corner[0]);
    expect(once[once.length - 1]).toEqual(corner[2]);
    expect(once.some((p) => p.x === 10 && p.y === 0)).toBe(false);
    expect(strokePreview(corner).length).toBeGreaterThan(once.length);
  });

  it("prepares a ~300 sample stroke as a clean 8 to 20 point line in every tolerance", () => {
    for (const tolerance of [1.5, 3, 5]) {
      const prepared = prepareStroke(wobblyStroke(), { tolerance, smooth: true, tangentSpan: 18, closeDist: 20, minLoop: 12 });
      expect(prepared).not.toBeNull();
      const n = prepared!.line.length;
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(20);
      expect(selfCrosses(prepared!.line)).toBe(false);
    }
    const fine = prepareStroke(wobblyStroke(), { tolerance: 1.5, smooth: true, tangentSpan: 18, closeDist: 20, minLoop: 12 })!;
    expect(fine.line.length).toBeGreaterThanOrEqual(8);
  });

  it("rejects a stroke that never went anywhere", () => {
    expect(prepareStroke([{ x: 1, y: 1 }], { tolerance: 3, smooth: true, tangentSpan: 18, closeDist: 20, minLoop: 12 })).toBeNull();
    expect(
      prepareStroke(
        [
          { x: 1, y: 1 },
          { x: 1, y: 1 },
        ],
        { tolerance: 3, smooth: true, tangentSpan: 18, closeDist: 20, minLoop: 12 },
      ),
    ).toBeNull();
  });
});

describe("freehand cuts", () => {
  it("slices a square along a hand-drawn S into two pieces that tile it and share their cut vertices", () => {
    const sq = square(0, 0, 100);
    const prepared = prepareStroke(wobblyStroke(), { tolerance: 3, smooth: true, tangentSpan: 18, closeDist: 20, minLoop: 12 })!;
    const cut = splitPolygonInto(sq, prepared.line, { ends: prepared.ends });
    if (!cut.ok) {
      throw new Error(cut.error);
    }
    expect(cut.pieces).toHaveLength(2);
    expect(area(cut.pieces[0]) + area(cut.pieces[1])).toBeCloseTo(10000, 4);
    const shared = cut.pieces[0].filter((v) => cut.pieces[1].some((w) => same(v, w)));
    expect(shared.length).toBeGreaterThanOrEqual(prepared.line.length - 2);
  });

  it("untangles a stroke with a micro-loop instead of refusing the cut", () => {
    const raw: Vec2[] = [
      { x: 40, y: -10 },
      { x: 40, y: 20 },
      { x: 44, y: 30 },
      { x: 36, y: 32 },
      { x: 42, y: 24 }, // the hand wobbled back across the line
      { x: 42, y: 50 },
      { x: 40, y: 80 },
      { x: 40, y: 110 },
    ];
    const prepared = prepareStroke(raw, { tolerance: 1.5, smooth: false, tangentSpan: 18, closeDist: 20, minLoop: 12 })!;
    const cut = splitPolygonInto(square(0, 0, 100), prepared.line, { ends: prepared.ends });
    if (!cut.ok) {
      throw new Error(cut.error);
    }
    expect(cut.pieces).toHaveLength(2);
    expect(area(cut.pieces[0]) + area(cut.pieces[1])).toBeCloseTo(10000, 4);
  });

  it("aims the end rays along the averaged tangent, not the last twitch of the mouse", () => {
    // Straight down, then a 2 unit sideways hook on release.
    const raw: Vec2[] = [];
    for (let y = -10; y <= 110; y += 3) {
      raw.push({ x: 50, y });
    }
    raw.push({ x: 52.5, y: 110.4 });
    const prepared = prepareStroke(raw, { tolerance: 1.5, smooth: false, tangentSpan: 18, closeDist: 20, minLoop: 12 })!;
    expect(prepared.ends.tail.y).toBeGreaterThan(0.98);
    expect(Math.abs(prepared.ends.tail.x)).toBeLessThan(0.2);
    expect(prepared.ends.head.y).toBeLessThan(-0.99);
    const cut = splitPolygonInto(square(0, 0, 100), prepared.line, { ends: prepared.ends });
    expect(cut.ok).toBe(true);
  });

  it("cuts when the stroke already starts and ends outside a concave region without bending back through it", () => {
    // A C shape opening to the right, cut by a horizontal stroke that begins and ends outside it.
    const C: Vec2[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 30 },
      { x: 30, y: 30 },
      { x: 30, y: 70 },
      { x: 100, y: 70 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const raw: Vec2[] = [];
    for (let x = -20; x <= 20; x += 3) {
      raw.push({ x, y: 15 + 0.05 * x });
    }
    for (let x = 20; x <= 120; x += 3) {
      raw.push({ x, y: 15 + 0.05 * x });
    }
    const prepared = prepareStroke(raw, { tolerance: 3, smooth: true, tangentSpan: 18, closeDist: 20, minLoop: 12 })!;
    const cut = splitPolygonInto(C, prepared.line, { ends: prepared.ends });
    if (!cut.ok) {
      throw new Error(cut.error);
    }
    expect(cut.pieces).toHaveLength(2);
    expect(cut.pieces.reduce((n, piece) => n + area(piece), 0)).toBeCloseTo(area(C), 4);
  });
});

describe("roughen a shared border", () => {
  const base = (): EditorMap => {
    let map = editorFromMapJson({ regions: [], starting_units: [] });
    map = addRegionFromPolygon(map, square(0, 0, 100), false).map;
    map = addRegionFromPolygon(map, [{ x: 100, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 100, y: 100 }], false).map;
    return map;
  };

  it("finds the shared edge, and not a coast", () => {
    const map = base();
    expect(edgeSharers(map, "Territory 1", 1)).toEqual(["Territory 2"]);
    expect(edgeSharers(map, "Territory 1", 0)).toEqual([]);
    expect(nearestSharedEdge(map, "Territory 1", { x: 101, y: 50 }, 4)).toBe(1);
    expect(nearestSharedEdge(map, "Territory 1", { x: 50, y: 1 }, 4)).toBe(-1);
  });

  it("subdivides it into 5 to 7 winding points that both regions list, so nothing opens up", () => {
    const map = base();
    for (let seed = 1; seed <= 12; seed++) {
      const out = roughenEdge(map, "Territory 1", 1, seeded(seed));
      expect(out).not.toBeNull();
      expect(out!.added).toBeGreaterThanOrEqual(5);
      expect(out!.added).toBeLessThanOrEqual(7);
      const a = findRegion(out!.map, "Territory 1")!;
      const b = findRegion(out!.map, "Territory 2")!;
      expect(a.polygon).toHaveLength(4 + out!.added);
      expect(b.polygon).toHaveLength(4 + out!.added);
      // The new points are in both outlines, bit for bit.
      const fresh = a.polygon.filter((v) => v.x !== 0 && v.y !== 0 && !(v.x === 100 && (v.y === 0 || v.y === 100)));
      expect(fresh).toHaveLength(out!.added);
      for (const v of fresh) {
        expect(b.polygon.some((w) => same(v, w))).toBe(true);
      }
      // The border really winds, and the two areas still add up exactly.
      expect(fresh.some((v) => v.x !== 100)).toBe(true);
      expect(area(a.polygon) + area(b.polygon)).toBeCloseTo(20000, 6);
      for (const v of fresh) {
        expect(Math.abs(v.x - 100)).toBeLessThanOrEqual(8 + 1e-9);
      }
    }
  });

  it("refuses an edge nobody shares or one that is too short", () => {
    const map = base();
    expect(roughenEdge(map, "Territory 1", 0, seeded(1))).toBeNull();
    let tiny = editorFromMapJson({ regions: [], starting_units: [] });
    tiny = addRegionFromPolygon(tiny, square(0, 0, 4), false).map;
    tiny = addRegionFromPolygon(tiny, [{ x: 4, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 4 }, { x: 4, y: 4 }], false).map;
    expect(roughenEdge(tiny, "Territory 1", 1, seeded(1))).toBeNull();
  });
});
