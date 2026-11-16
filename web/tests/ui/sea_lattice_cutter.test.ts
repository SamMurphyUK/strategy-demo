import { describe, expect, it } from "vitest";
import { pointInPolygon, type Vec2 } from "../../src/ui/map/geometry";
import {
  dissolveLatticeCellsToRings,
  editLatticeZones,
  rasterizeRings,
  type LatticeCell,
  type LatticeZone,
} from "../../src/ui/map/editor/seaLattice";

function full(col: number, row: number): LatticeCell {
  return { col, row, fill: "FULL" };
}

function samePoints(ring: Vec2[], expected: Vec2[]): boolean {
  if (ring.length !== expected.length) {
    return false;
  }
  const key = (p: Vec2) => `${p.x},${p.y}`;
  const got = new Set(ring.map(key));
  return expected.every((point) => got.has(key(point)));
}

function hasEdge(ring: Vec2[], a: Vec2, b: Vec2): boolean {
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    if ((p.x === a.x && p.y === a.y && q.x === b.x && q.y === b.y) || (p.x === b.x && p.y === b.y && q.x === a.x && q.y === a.y)) {
      return true;
    }
  }
  return false;
}

describe("sea lattice cutter", () => {
  it("cancels the internal edges of a 2×2 block and of two facing wedges", () => {
    const block = dissolveLatticeCellsToRings([full(0, 0), full(1, 0), full(0, 1), full(1, 1)]);
    expect(block.extra).toEqual([]);
    expect(block.polygon).toHaveLength(4);
    expect(samePoints(block.polygon, [
      { x: 0, y: 0 },
      { x: 16, y: 0 },
      { x: 16, y: 16 },
      { x: 0, y: 16 },
    ])).toBe(true);

    const diamond = dissolveLatticeCellsToRings([
      { col: 0, row: 0, fill: ["E"] },
      { col: 1, row: 0, fill: ["W"] },
    ]);
    expect(diamond.extra).toEqual([]);
    expect(diamond.polygon).toHaveLength(4);
    expect(samePoints(diamond.polygon, [
      { x: 4, y: 4 },
      { x: 8, y: 0 },
      { x: 12, y: 4 },
      { x: 8, y: 8 },
    ])).toBe(true);
    expect(diamond.polygon.some((point) => point.x === 8 && point.y === 4)).toBe(false);
  });

  it("moves a wedge onto the other sea zone and leaves one shared border", () => {
    const zones: LatticeZone[] = [
      { id: "A", cells: [full(0, 0)] },
      { id: "B", cells: [] },
    ];
    const next = editLatticeZones(zones, "B", [{ col: 0, row: 0, part: "E", originX: 0 }], false);
    const a = next.find((zone) => zone.id === "A");
    const b = next.find((zone) => zone.id === "B");
    expect(a?.cells).toEqual([{ col: 0, row: 0, fill: ["N", "S", "W"] }]);
    expect(b?.cells).toEqual([{ col: 0, row: 0, fill: ["E"] }]);

    const ringsA = dissolveLatticeCellsToRings(a?.cells ?? []);
    const ringsB = dissolveLatticeCellsToRings(b?.cells ?? []);
    expect(ringsA.extra).toEqual([]);
    expect(ringsB.extra).toEqual([]);
    expect(hasEdge(ringsA.polygon, { x: 8, y: 0 }, { x: 4, y: 4 })).toBe(true);
    expect(hasEdge(ringsB.polygon, { x: 8, y: 0 }, { x: 4, y: 4 })).toBe(true);
    expect(hasEdge(ringsA.polygon, { x: 8, y: 8 }, { x: 4, y: 4 })).toBe(true);
    expect(hasEdge(ringsB.polygon, { x: 8, y: 8 }, { x: 4, y: 4 })).toBe(true);
    expect(pointInPolygon({ x: 6, y: 4 }, ringsA.polygon)).toBe(false);
    expect(pointInPolygon({ x: 6, y: 4 }, ringsB.polygon)).toBe(true);
    expect(pointInPolygon({ x: 2, y: 4 }, ringsA.polygon)).toBe(true);
    expect(pointInPolygon({ x: 2, y: 4 }, ringsB.polygon)).toBe(false);
  });

  it("bridges a hole into the outline so the zone inside is not covered twice", () => {
    const ringCells: LatticeCell[] = [];
    for (let col = 0; col < 3; col++) {
      for (let row = 0; row < 3; row++) {
        if (col !== 1 || row !== 1) {
          ringCells.push(full(col, row));
        }
      }
    }
    const rings = dissolveLatticeCellsToRings(ringCells);
    expect(rings.extra).toEqual([]);
    expect(pointInPolygon({ x: 12, y: 12 }, rings.polygon)).toBe(false);
    expect(pointInPolygon({ x: 4, y: 4 }, rings.polygon)).toBe(true);
    expect(pointInPolygon({ x: 20, y: 12 }, rings.polygon)).toBe(true);
    expect(pointInPolygon({ x: 12, y: 4 }, rings.polygon)).toBe(true);
  });

  it("reads a drawn rectangle back as the full squares that cover it", () => {
    const cells = rasterizeRings([
      { x: 0, y: 0 },
      { x: 16, y: 0 },
      { x: 16, y: 16 },
      { x: 0, y: 16 },
    ]);
    expect(cells).toEqual([full(0, 0), full(1, 0), full(0, 1), full(1, 1)]);
  });

  it("keeps col 0 and col 99 as separate rings across the dateline", () => {
    const rings = dissolveLatticeCellsToRings([full(0, 0), full(99, 0)]);
    expect(rings.polygon.length).toBeGreaterThanOrEqual(3);
    expect(rings.extra).toHaveLength(1);
    for (const ring of [rings.polygon, rings.extra[0]]) {
      const xs = ring.map((point) => point.x);
      const onLeft = xs.some((x) => x <= 8);
      const onRight = xs.some((x) => x >= 792);
      expect(onLeft && onRight).toBe(false);
    }
    const covered = [rings.polygon, rings.extra[0]];
    expect(covered.some((ring) => ring.every((point) => point.x <= 8))).toBe(true);
    expect(covered.some((ring) => ring.every((point) => point.x >= 792))).toBe(true);
  });
});
