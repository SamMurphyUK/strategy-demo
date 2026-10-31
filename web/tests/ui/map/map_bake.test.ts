import { describe, expect, it } from "vitest";
import {
  BakeCache,
  type BakeKey,
  bakeScaleFor,
  grainTile,
  isSeamEdge,
  MAX_BAKE_SCALE,
  ownersSignature,
  type Pt,
  ringRuns,
  sharedEdges,
} from "../../../src/ui/map/mapBakeMath";
import {
  BORDER_PASSES,
  BURN_PASSES,
  COAST_INK,
  COAST_SHADOW,
  FACTION_TINT,
  highlightLandFill,
  highlightSeaFill,
  landTint,
  SEA_BASE_COLOR,
  SEA_SEAM_COLOR,
} from "../../../src/ui/map/mapStyle";
import type { MultiPolygon } from "../../../src/ui/map/regionClip";
import { visibleCopies, wrapView, wrapWorldX } from "../../../src/ui/map/viewMath";

const WORLD = { x: 0, y: 0, w: 800, h: 504 };
const SEAM = { left: 0, right: 800 };
const rect = (x: number, y: number, w: number, h: number): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
const shape = (...rings: Pt[][]): MultiPolygon => rings.map((r) => [r]) as MultiPolygon;

describe("the wrap seam", () => {
  it("recognises edges lying on the left or right edge of the world", () => {
    expect(isSeamEdge([0, 10], [0, 90], SEAM)).toBe(true);
    expect(isSeamEdge([800, 10], [800, 90], SEAM)).toBe(true);
    expect(isSeamEdge([0, 10], [20, 90], SEAM)).toBe(false);
    expect(isSeamEdge([0, 10], [800, 10], SEAM)).toBe(false);
    expect(isSeamEdge([400, 0], [400, 90], SEAM)).toBe(false);
  });

  it("closes a ring that touches no seam into one run", () => {
    const runs = ringRuns(rect(100, 100, 50, 50), SEAM);
    expect(runs).toHaveLength(1);
    expect(runs[0][0]).toEqual(runs[0][runs[0].length - 1]);
    expect(runs[0]).toHaveLength(5);
  });

  it("drops the seam edge of land cut at the world's edge, and keeps the coast", () => {
    // A block against the right edge: its right side is the seam.
    const runs = ringRuns(rect(700, 100, 100, 50), SEAM);
    expect(runs).toHaveLength(1);
    const points = runs[0];
    expect(points.some(([x]) => x === 800)).toBe(true);
    // No stroked segment runs along x = 800.
    for (let i = 0; i + 1 < points.length; i++) {
      expect(isSeamEdge(points[i], points[i + 1], SEAM)).toBe(false);
    }
    expect(points).toHaveLength(4); // top, left and bottom edges
  });

  it("keeps a run whole even when the ring starts in the middle of it", () => {
    // Seam edge is the last one of the ring as written.
    const ring: Pt[] = [[800, 100], [700, 100], [700, 150], [800, 150], [800, 100]];
    const runs = ringRuns(ring, SEAM);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toEqual([[800, 100], [700, 100], [700, 150], [800, 150]]);
  });

  it("leaves a ring that sits on both seams in separate runs", () => {
    const runs = ringRuns(rect(0, 0, 800, 100), SEAM);
    expect(runs).toHaveLength(2); // top edge and bottom edge
  });

  it("has no runs for a degenerate ring", () => {
    expect(ringRuns([[1, 1]], SEAM)).toEqual([]);
    expect(ringRuns([], null)).toEqual([]);
  });
});

describe("shared territory borders", () => {
  it("finds the edge two neighbours share, once", () => {
    const edges = sharedEdges([shape(rect(0, 0, 100, 100)), shape(rect(100, 0, 100, 100))], null);
    expect(edges).toHaveLength(1);
    const [x1, , x2] = edges[0];
    expect(x1).toBe(100);
    expect(x2).toBe(100);
  });

  it("matches edges drawn in opposite directions", () => {
    const a = shape(rect(0, 0, 100, 100));
    const reversed = shape([[100, 0], [200, 0], [200, 100], [100, 100], [100, 0]]);
    expect(sharedEdges([a, reversed], null)).toHaveLength(1);
  });

  it("ignores coast edges that only one territory has", () => {
    expect(sharedEdges([shape(rect(0, 0, 100, 100)), shape(rect(300, 0, 100, 100))], null)).toEqual([]);
  });

  it("counts an edge a single territory lists twice (a hairline) only once", () => {
    const hairline: Pt[] = [[0, 0], [50, 0], [50, 50], [50, 0], [100, 0], [100, 100], [0, 100], [0, 0]];
    expect(sharedEdges([shape(hairline)], null)).toEqual([]);
  });

  it("with a minimum of one lists every distinct edge", () => {
    expect(sharedEdges([shape(rect(0, 0, 100, 100))], null, 1)).toHaveLength(4);
  });

  it("never lists a border lying on the seam", () => {
    const left = shape(rect(0, 0, 50, 50));
    const alsoLeft = shape(rect(0, 0, 50, 50));
    const edges = sharedEdges([left, alsoLeft], SEAM);
    expect(edges.every(([x1, , x2]) => !(x1 === 0 && x2 === 0))).toBe(true);
    expect(edges).toHaveLength(3);
  });

  it("matches vertices that differ by rounding noise", () => {
    const a = shape(rect(0, 0, 100, 100));
    const b = shape([[100.0000001, 0], [200, 0], [200, 100], [99.9999999, 100], [100.0000001, 0]]);
    expect(sharedEdges([a, b], null)).toHaveLength(1);
  });
});

describe("the parchment grain tile", () => {
  const size = 128;
  const tile = grainTile(size, 7);
  const value = (x: number, y: number) => tile[(y * size + x) * 4];

  it("is an opaque greyscale tile of the requested size", () => {
    expect(tile).toHaveLength(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      expect(tile[i * 4 + 3]).toBe(255);
      expect(tile[i * 4]).toBe(tile[i * 4 + 1]);
      expect(tile[i * 4]).toBe(tile[i * 4 + 2]);
    }
  });

  it("is repeatable from its seed, and different for another", () => {
    expect(Array.from(grainTile(size, 7).slice(0, 400))).toEqual(Array.from(tile.slice(0, 400)));
    expect(Array.from(grainTile(size, 8).slice(0, 400))).not.toEqual(Array.from(tile.slice(0, 400)));
  });

  it("is light paper with fine variation, so multiplying it only ages the colour", () => {
    let sum = 0;
    let min = 255;
    for (let i = 0; i < size * size; i++) {
      sum += tile[i * 4];
      min = Math.min(min, tile[i * 4]);
    }
    const mean = sum / (size * size);
    let variance = 0;
    for (let i = 0; i < size * size; i++) {
      variance += (tile[i * 4] - mean) ** 2;
    }
    expect(mean).toBeGreaterThan(215);
    expect(mean).toBeLessThan(250);
    expect(Math.sqrt(variance / (size * size))).toBeGreaterThan(2);
    expect(min).toBeGreaterThan(80);
  });

  it("tiles without a seam: its opposite edges differ no more than neighbouring columns do", () => {
    const columnGap = (xa: number, xb: number) => {
      let total = 0;
      for (let y = 0; y < size; y++) {
        total += Math.abs(value(xa, y) - value(xb, y));
      }
      return total / size;
    };
    const rowGap = (ya: number, yb: number) => {
      let total = 0;
      for (let x = 0; x < size; x++) {
        total += Math.abs(value(x, ya) - value(x, yb));
      }
      return total / size;
    };
    let neighbours = 0;
    for (let x = 0; x < size - 1; x++) {
      neighbours += columnGap(x, x + 1);
    }
    neighbours /= size - 1;
    expect(columnGap(size - 1, 0)).toBeLessThan(neighbours * 1.5);
    let rows = 0;
    for (let y = 0; y < size - 1; y++) {
      rows += rowGap(y, y + 1);
    }
    rows /= size - 1;
    expect(rowGap(size - 1, 0)).toBeLessThan(rows * 1.5);
  });
});

describe("when the base map is rebuilt", () => {
  const regions = [
    { id: "L1", type: "land" },
    { id: "L2", type: "land" },
    { id: "S1", type: "sea" },
  ];
  const paths = new Map<string, unknown>();
  const land = {};
  const keyFor = (owners: Record<string, string>, over: Partial<BakeKey> = {}): BakeKey => ({
    regions,
    paths,
    land,
    exact: true,
    owners: ownersSignature(regions, owners),
    bounds: "0,0,800,504",
    ...over,
  });
  const cache = () => new BakeCache<null, { scale: number }>((_input, scale) => ({ scale }));

  it("builds once and then reuses the bitmap through any amount of panning and hovering", () => {
    const c = cache();
    const key = keyFor({ L1: "ussr" });
    const first = c.get(key, 1.4, null).value;
    for (let i = 0; i < 100; i++) {
      expect(c.get(keyFor({ L1: "ussr" }), 1.4, null).value).toBe(first);
    }
    expect(c.builds).toBe(1);
  });

  it("rebuilds when a territory changes hands", () => {
    const c = cache();
    c.get(keyFor({ L1: "ussr" }), 1.4, null);
    c.get(keyFor({ L1: "ger" }), 1.4, null);
    expect(c.builds).toBe(2);
  });

  it("rebuilds when the geometry changes (an editor slice, merge or vertex edit)", () => {
    const c = cache();
    c.get(keyFor({}), 1.4, null);
    c.get(keyFor({}, { regions: [...regions] }), 1.4, null);
    c.get(keyFor({}, { paths: new Map() }), 1.4, null);
    c.get(keyFor({}, { land: {} }), 1.4, null);
    c.get(keyFor({}, { exact: false }), 1.4, null);
    expect(c.builds).toBe(5);
  });

  it("does not rebuild for a change nobody sees: an owner of a sea zone", () => {
    const c = cache();
    c.get(keyFor({ L1: "ussr" }), 1.4, null);
    c.get(keyFor({ L1: "ussr", S1: "ussr" }), 1.4, null);
    expect(c.builds).toBe(1);
  });

  it("rebuilds finer as the user zooms in, but not for small zooms inside the same step", () => {
    const c = cache();
    expect(c.get(keyFor({}), 1.2, null).scale).toBe(2);
    c.get(keyFor({}), 1.9, null);
    expect(c.builds).toBe(1);
    expect(c.get(keyFor({}), 2.4, null).scale).toBe(3);
    expect(c.builds).toBe(2);
  });

  it("keeps a finer bake one step after zooming out, and drops it two steps after", () => {
    const c = cache();
    c.get(keyFor({}), 3.5, null); // scale 4
    c.get(keyFor({}), 2.5, null); // wants 3, one step down: keep
    expect(c.builds).toBe(1);
    expect(c.get(keyFor({}), 1.2, null).scale).toBe(2); // wants 2: rebuild
    expect(c.builds).toBe(2);
  });

  it("can be invalidated by hand", () => {
    const c = cache();
    c.get(keyFor({}), 1.4, null);
    c.invalidate();
    c.get(keyFor({}), 1.4, null);
    expect(c.builds).toBe(2);
  });

  it("caps the bake resolution", () => {
    expect(bakeScaleFor(0.3)).toBe(1);
    expect(bakeScaleFor(1)).toBe(1);
    expect(bakeScaleFor(1.01)).toBe(2);
    expect(bakeScaleFor(500)).toBe(MAX_BAKE_SCALE);
  });

  it("signs only land ownership", () => {
    expect(ownersSignature(regions, { L1: "ussr", L2: "" })).toBe("L1:ussr|L2:|");
    expect(ownersSignature(regions, {})).toBe("L1:|L2:|");
  });
});

describe("the war-room palette", () => {
  it("tints land by owner with the specified colours", () => {
    expect(FACTION_TINT).toEqual({
      JAP: "#C8BE9E",
      USSR: "#B59482",
      GER: "#98A4A6",
      UK: "#CEBE98",
      US: "#9EB092",
      NEUTRAL: "#D8D2C5",
    });
    expect(landTint("jap")).toBe("#C8BE9E");
    expect(landTint("JAP")).toBe("#C8BE9E");
    expect(landTint("ussr")).toBe("#B59482");
    expect(landTint("ger")).toBe("#98A4A6");
    expect(landTint("uk")).toBe("#CEBE98");
    expect(landTint("usa")).toBe("#9EB092");
  });

  it("leaves unowned, neutral and unknown land sun-bleached parchment", () => {
    expect(landTint("")).toBe("#D8D2C5");
    expect(landTint("Neutral")).toBe("#D8D2C5");
    expect(landTint("martians")).toBe("#D8D2C5");
  });

  it("carries the specified ocean, shadow, burn, border and coast ink", () => {
    expect(SEA_BASE_COLOR).toBe("#B6C4CC");
    expect(SEA_SEAM_COLOR).toBe("rgba(235, 245, 250, 0.75)");
    expect(COAST_SHADOW).toEqual({ color: "rgba(20, 30, 35, 0.35)", blur: 5, offset: 2 });
    expect(BURN_PASSES.map((p) => [p.color, p.width])).toEqual([
      ["rgba(35, 28, 18, 0.18)", 8],
      ["rgba(35, 28, 18, 0.15)", 4],
    ]);
    expect(BORDER_PASSES.map((p) => [p.color, p.width])).toEqual([
      ["rgba(45, 38, 28, 0.25)", 4],
      ["#2B2620", 1.2],
    ]);
    expect(COAST_INK).toEqual({ color: "#1A1815", width: 1.6 });
  });
});

describe("highlights drawn over the baked map", () => {
  it("draws nothing without a move or mobilize highlight", () => {
    expect(highlightLandFill("a", "ussr", { kind: "none" })).toBeNull();
    expect(highlightSeaFill("s", { kind: "none" })).toBeNull();
  });

  it("tints only the origin and the legal targets of a move", () => {
    const mode = { kind: "move" as const, from: "a", legal: ["b"], hover: "b" };
    expect(highlightLandFill("a", "ussr", mode)).not.toBeNull();
    expect(highlightLandFill("b", "", mode)).toContain("242, 38, 31");
    expect(highlightLandFill("c", "ussr", mode)).toBeNull();
    expect(highlightSeaFill("s", { kind: "move", from: "a", legal: ["s"], hover: "" })).toContain("242, 38, 31");
    expect(highlightSeaFill("t", { kind: "move", from: "a", legal: ["s"], hover: "" })).toBeNull();
  });

  it("tints the legal targets of a mobilize", () => {
    const mode = { kind: "mobilize" as const, legal: ["b"], hover: "" };
    expect(highlightLandFill("b", "ussr", mode)).not.toBeNull();
    expect(highlightLandFill("a", "ussr", mode)).toBeNull();
  });
});

describe("world wrapping", () => {
  it("folds a world x onto the primary copy", () => {
    expect(wrapWorldX(100, WORLD)).toBe(100);
    expect(wrapWorldX(900, WORLD)).toBe(100);
    expect(wrapWorldX(-100, WORLD)).toBe(700);
    expect(wrapWorldX(1600, WORLD)).toBe(0);
    expect(wrapWorldX(5, { x: 10, y: 0, w: 100, h: 50 })).toBe(105);
  });

  it("keeps the view centre on the primary copy by shifting whole widths", () => {
    const k = 1;
    const width = 400;
    const inside = { x: 300, y: 0, k }; // centre 500
    expect(wrapView(inside, width, WORLD)).toBe(inside);
    const past = wrapView({ x: 700, y: 0, k }, width, WORLD); // centre 900 -> 100
    expect(past.x).toBe(-100);
    const before = wrapView({ x: -500, y: 0, k }, width, WORLD); // centre -300 -> 500
    expect(before.x).toBe(300);
    // The same picture: the point under the screen centre is the same place on the wrapped world.
    expect(wrapWorldX(past.x + width / 2, WORLD)).toBe(wrapWorldX(700 + width / 2, WORLD));
  });

  it("draws the copies that reach the screen, at -width, 0 and +width", () => {
    const k = 1;
    expect(visibleCopies({ x: 100, y: 0, k }, 400, WORLD, true)).toEqual([0]);
    expect(visibleCopies({ x: -100, y: 0, k }, 400, WORLD, true)).toEqual([-800, 0]);
    expect(visibleCopies({ x: 600, y: 0, k }, 400, WORLD, true)).toEqual([0, 800]);
    expect(visibleCopies({ x: -200, y: 0, k: 0.4 }, 1500, WORLD, true)).toEqual([-800, 0, 800]);
  });

  it("draws only the primary copy when wrapping is off, as in the editor", () => {
    expect(visibleCopies({ x: -100, y: 0, k: 1 }, 4000, WORLD, false)).toEqual([0]);
  });
});
