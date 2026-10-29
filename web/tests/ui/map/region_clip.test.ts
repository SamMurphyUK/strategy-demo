import polygonClipping from "polygon-clipping";
import { describe, expect, it } from "vitest";
import { loadJson } from "../../../src/engine/content/res";
import { mapIntegrityProblems } from "./map_invariants";
import { editorFromMapJson, editorToMapJson, formatMapJson } from "../../../src/ui/map/editor/editorModel";
import { buildMapGeometry, type Vec2 } from "../../../src/ui/map/geometry";
import { extractPathData, parsePathRings } from "../../../src/ui/map/landSvg";
import {
  clipperFor,
  landFromPathData,
  multiPolygonArea,
  type MultiPolygon,
  pointInMultiPolygon,
  RegionClipper,
  ringArea,
  uncoveredLand,
} from "../../../src/ui/map/regionClip";
import landSvg from "../../../public/assets/ne_110m_land_FINAL.svg?raw";

const square = (x: number, y: number, s: number): Vec2[] => [
  { x, y },
  { x: x + s, y },
  { x: x + s, y: y + s },
  { x, y: y + s },
];

describe("parsePathRings", () => {
  it("reads absolute and relative lines, closing each sub-path", () => {
    const rings = parsePathRings("M 0 0 L 10 0 L 10 10 Z m 20 20 h 5 v 5 h -5 z");
    expect(rings).toEqual([
      [[0, 0], [10, 0], [10, 10]],
      [[20, 20], [25, 20], [25, 25], [20, 25]],
    ]);
  });

  it("takes implicit line-to pairs after a move", () => {
    expect(parsePathRings("M0,0 10,0 10,10Z")).toEqual([[[0, 0], [10, 0], [10, 10]]]);
  });

  it("refuses curves, so a changed SVG fails loudly instead of drawing wrong", () => {
    expect(() => parsePathRings("M 0 0 C 1 1 2 2 3 3 Z")).toThrow();
  });
});

describe("landFromPathData", () => {
  it("keeps one path per landmass and cuts even-odd holes for extra sub-paths", () => {
    const land = landFromPathData(["M0 0 L100 0 L100 100 L0 100 Z M40 40 L60 40 L60 60 L40 60 Z", "M200 0 L210 0 L210 10 L200 10 Z"]);
    expect(land).toHaveLength(2);
    expect(multiPolygonArea(land)).toBeCloseTo(100 * 100 - 20 * 20 + 100, 6);
    expect(pointInMultiPolygon({ x: 50, y: 50 }, land)).toBe(false);
    expect(pointInMultiPolygon({ x: 10, y: 10 }, land)).toBe(true);
  });

  it("parses the real land SVG into 121 landmasses", () => {
    expect(extractPathData(landSvg)).toHaveLength(121);
  });
});

describe("RegionClipper", () => {
  // One island and a lake-bearing continent.
  const land = landFromPathData(["M0 0 L100 0 L100 100 L0 100 Z", "M200 0 L220 0 L220 20 L200 20 Z"]);
  const clipper = new RegionClipper(land);

  it("intersects land regions with the land, so a cutter hanging over the sea stops at the coast", () => {
    const clipped = clipper.clip({ id: "a", type: "land", points: square(50, 50, 100) });
    expect(multiPolygonArea(clipped)).toBeCloseTo(50 * 50, 6);
    expect(pointInMultiPolygon({ x: 75, y: 75 }, clipped)).toBe(true);
    expect(pointInMultiPolygon({ x: 120, y: 120 }, clipped)).toBe(false);
  });

  it("subtracts the land from sea regions, so water wraps around coasts and islands", () => {
    const cutter = square(-20, -20, 260);
    const water = clipper.clip({ id: "s", type: "sea", points: cutter });
    expect(multiPolygonArea(water)).toBeCloseTo(260 * 260 - 100 * 100 - 20 * 20, 6);
    expect(pointInMultiPolygon({ x: 50, y: 50 }, water)).toBe(false);
    expect(pointInMultiPolygon({ x: 210, y: 10 }, water)).toBe(false);
    expect(pointInMultiPolygon({ x: 150, y: 50 }, water)).toBe(true);
  });

  it("splits a land cutter into one piece per island it covers", () => {
    const both = clipper.clip({ id: "b", type: "land", points: square(-10, -10, 250) });
    expect(both).toHaveLength(2);
    expect(multiPolygonArea(both)).toBeCloseTo(100 * 100 + 20 * 20, 6);
  });

  it("gives a land cutter wholly at sea nothing, and a sea cutter wholly at sea itself", () => {
    expect(clipper.clip({ id: "c", type: "land", points: square(120, 120, 30) })).toEqual([]);
    expect(multiPolygonArea(clipper.clip({ id: "d", type: "sea", points: square(120, 120, 30) }))).toBeCloseTo(900, 6);
  });

  it("reuses a result while the cutter is unchanged and recomputes when a vertex moves", () => {
    const region = { id: "e", type: "land" as const, points: square(50, 50, 100) };
    const first = clipper.clip(region);
    expect(clipper.clip({ ...region, points: region.points.map((p) => ({ ...p })) })).toBe(first);
    const moved = clipper.clip({ ...region, points: [{ x: 50, y: 50 }, { x: 150, y: 50 }, { x: 150, y: 150 }, { x: 80, y: 150 }] });
    expect(moved).not.toBe(first);
    expect(multiPolygonArea(moved)).toBeLessThan(multiPolygonArea(first));
  });

  it("clipAll returns every region and drops cache entries for cutters that are gone", () => {
    const local = new RegionClipper(land);
    const a = { id: "a", type: "land" as const, points: square(10, 10, 20) };
    const b = { id: "b", type: "land" as const, points: square(40, 40, 20) };
    const all = local.clipAll([a, b]);
    expect([...all.keys()]).toEqual(["a", "b"]);
    const kept = local.clip(a);
    local.clipAll([a]);
    expect(local.clip(a)).toBe(kept);
    expect(local.clip(b)).not.toBe(all.get("b"));
  });

  it("shares one clipper per land, so the canvas and the export agree", () => {
    expect(clipperFor(land)).toBe(clipperFor(land));
    expect(clipperFor(landFromPathData(["M0 0 L1 0 L1 1 Z"]))).not.toBe(clipperFor(land));
  });

  it("measures land no cutter covers", () => {
    const cover = clipper.clip({ id: "f", type: "land", points: square(0, 0, 100) });
    expect(multiPolygonArea(uncoveredLand(land, [cover]))).toBeCloseTo(400, 6);
    expect(multiPolygonArea(uncoveredLand(land, []))).toBeCloseTo(10400, 6);
  });
});

describe("demomap01 against the land SVG", () => {
  const data = extractPathData(landSvg);
  const land = landFromPathData(data);
  const geometry = buildMapGeometry(loadJson("res://demomap01.json"));
  const clipper = new RegionClipper(land);
  const clipped = clipper.clipAll(geometry.regions);
  const lands = geometry.regions.filter((r) => r.type === "land");

  it("clips every cutter without falling back to the raw polygon", () => {
    expect(clipper.failed.size).toBe(0);
    for (const r of geometry.regions) {
      expect(clipped.get(r.id)!.length, r.id).toBeGreaterThan(0);
    }
  });

  it("keeps every land region inside the coast, leaving unclaimed land as decorative scenery", () => {
    // Unallocated land is allowed (decorative islands), so there is no coverage floor, only a ceiling.
    expect(lands.length).toBeGreaterThanOrEqual(1);
    const left = uncoveredLand(land, lands.map((r) => clipped.get(r.id)!));
    expect(multiPolygonArea(left)).toBeLessThanOrEqual(multiPolygonArea(land) + 1e-6);
    for (const r of lands) {
      // Clipping a coast-shaped outline against the coast changes nothing, and none is a canvas-sized box.
      const outline = ringArea(r.points.map((p) => [p.x, p.y] as [number, number]));
      expect(Math.abs(multiPolygonArea(clipped.get(r.id)!) - outline), r.id).toBeLessThan(0.5 + outline * 0.002);
      expect(r.bounds.w, r.id).toBeLessThan(700);
    }
  });

  it("keeps sea selections off the land, wrapping around coasts and islands", () => {
    const sea = geometry.regions.filter((r) => r.type === "sea");
    for (const r of sea) {
      const water = clipped.get(r.id)!;
      for (const l of lands.slice(0, 12)) {
        const overlap = multiPolygonArea(polygonClipping.intersection(water, clipped.get(l.id)!));
        expect(overlap, `${r.id} / ${l.id}`).toBeLessThan(0.5);
      }
    }
  });
});

describe("clipped_polygon export", () => {
  const json = loadJson("res://demomap01.json");
  const map = editorFromMapJson(json);
  const land = landFromPathData(extractPathData(landSvg));

  it("exports a sound map", () => {
    expect(mapIntegrityProblems(editorToMapJson(map))).toEqual([]);
  });

  it("is absent by default, so autosave and plain exports stay small", () => {
    const out = editorToMapJson(map);
    for (const region of out.regions as { clipped_polygon?: unknown }[]) {
      expect(region.clipped_polygon).toBeUndefined();
    }
  });

  it("writes each region's clipped MultiPolygon when a clipper is given, and loading ignores it", () => {
    const out = editorToMapJson(map, { round: true, clipper: clipperFor(land) });
    const regions = out.regions as { metadata: { region_id: string }; polygon: number[][]; clipped_polygon: number[][][][] }[];
    const landIds = new Set(map.regions.filter((r) => !r.is_sea).map((r) => r.id));
    const master = regions.find((r) => landIds.has(r.metadata.region_id))!;
    expect(master.clipped_polygon.length).toBeGreaterThan(0);
    const mp = master.clipped_polygon as unknown as MultiPolygon;
    // Clipping to the coast can only trim the outline, never add to it.
    const outline = multiPolygonArea([[master.polygon.map(([x, y]) => [x, y] as [number, number])]]);
    expect(multiPolygonArea(mp)).toBeGreaterThan(0);
    expect(multiPolygonArea(mp)).toBeLessThanOrEqual(outline * 1.002);
    expect(formatMapJson(out)).toContain("clipped_polygon");

    const again = editorFromMapJson(out);
    expect(again.regions).toHaveLength(map.regions.length);
    expect(editorToMapJson(again)).toEqual(editorToMapJson(map));
  });
});
