import { describe, expect, it } from "vitest";
import { buildMapData, NEWMAP_PATH } from "../../../src/content/game_scene_session_builder";
import { loadJson } from "../../../src/engine/content/res";
import { mapIntegrityProblems } from "./map_invariants";
import { autoNeighborPairs, coastalAdjacent, sameDomainAdjacent, sharesEdgeSegment } from "../../../src/ui/map/editor/adjacency";
import {
  addRegionFromPolygon,
  applyAutoLinks,
  coincidentVertices,
  deleteRegion,
  editorFromMapJson,
  editorToMapJson,
  findRegion,
  formatMapJson,
  insertOnEdges,
  isLinked,
  labelPoint,
  moveVertices,
  neighborsOf,
  renameRegion,
  snapPoint,
  toggleLink,
  weldRegion,
} from "../../../src/ui/map/editor/editorModel";
import { buildMapGeometry, layoutStackSlots, type Vec2 } from "../../../src/ui/map/geometry";
import { combinePathData, parseViewBox } from "../../../src/ui/map/landSvg";
import { LEGACY_TO_WORLD, legacyToWorld, projectMapJson, worldToLegacy } from "../../../src/ui/map/map_space";
import { landFill, seaFill } from "../../../src/ui/map/mapStyle";
import { fitView, panBy, screenToWorld, tokenZoomScale, worldToScreen, zoomAt } from "../../../src/ui/map/viewMath";

const square = (x: number, y: number, s: number): Vec2[] => [
  { x, y },
  { x: x + s, y },
  { x: x + s, y: y + s },
  { x, y: y + s },
];

describe("land svg helpers", () => {
  it("parses the viewBox, falling back to width and height", () => {
    expect(parseViewBox("0 0 800 504")).toEqual({ x: 0, y: 0, w: 800, h: 504 });
    expect(parseViewBox("-10, 5, 100, 50")).toEqual({ x: -10, y: 5, w: 100, h: 50 });
    expect(parseViewBox(null, 640, 480)).toEqual({ x: 0, y: 0, w: 640, h: 480 });
    expect(parseViewBox("0 0 0 0", 10, 20)).toEqual({ x: 0, y: 0, w: 10, h: 20 });
  });

  it("joins path data into one string and drops empties", () => {
    expect(combinePathData(["M 0 0 L 1 1 Z", "  ", " M 2 2 L 3 3 Z "])).toBe("M 0 0 L 1 1 Z M 2 2 L 3 3 Z");
  });
});

describe("world projection of demomap01", () => {
  const world = projectMapJson(loadJson(NEWMAP_PATH));
  const geometry = buildMapGeometry(world);

  it("puts every region inside the 800 x 504 land SVG", () => {
    for (const r of geometry.regions) {
      for (const p of r.points) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(800);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(504);
      }
    }
  });

  it("starts from master blocks shaped like the coast, not canvas-sized boxes", () => {
    const land = geometry.regions.filter((r) => r.type === "land");
    const sea = geometry.regions.filter((r) => r.type === "sea");
    expect(sea.length).toBeGreaterThanOrEqual(1);
    expect(land.length).toBeGreaterThanOrEqual(1);
    // No land region spans the canvas, however the map has been sliced or pruned.
    for (const r of land) {
      expect(r.bounds.w, r.id).toBeLessThan(700);
    }
  });

  it("is a sound map: unique ids, real outlines, anchors and symmetric neighbors", () => {
    expect(mapIntegrityProblems(loadJson(NEWMAP_PATH))).toEqual([]);
  });

  it("is idempotent and reversible", () => {
    expect(projectMapJson(world).regions).toEqual(world.regions);
    const [x, y] = legacyToWorld(1000, 600);
    const [lx, ly] = worldToLegacy(x, y);
    expect(lx).toBeCloseTo(1000, 6);
    expect(ly).toBeCloseTo(600, 6);
    expect(LEGACY_TO_WORLD.scale).toBeGreaterThan(0);
  });

  it("is already in land-SVG coordinates", () => {
    expect(loadJson(NEWMAP_PATH).coord_space).toBe("svg");
  });
});

describe("view maths", () => {
  const bounds = { x: 0, y: 0, w: 800, h: 504 };

  it("fits the bounds centred", () => {
    const v = fitView(bounds, 1000, 600, 0);
    expect(v.k).toBeCloseTo(Math.min(1000 / 800, 600 / 504), 6);
    const centre = screenToWorld(v, { x: 500, y: 300 });
    expect(centre.x).toBeCloseTo(400, 6);
    expect(centre.y).toBeCloseTo(252, 6);
  });

  it("round-trips screen and world", () => {
    const v = { x: 12, y: -5, k: 2.5 };
    const p = { x: 123, y: 45 };
    const back = screenToWorld(v, worldToScreen(v, p));
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.y).toBeCloseTo(p.y, 9);
  });

  it("shrinks units by at most 10% when zoomed out and grows them by at most 10% when zoomed in", () => {
    expect(tokenZoomScale(2, 2)).toBe(1);
    expect(tokenZoomScale(1.6, 2)).toBeCloseTo(0.9, 9);
    expect(tokenZoomScale(1, 2)).toBeCloseTo(0.9, 9);
    expect(tokenZoomScale(2.2, 2)).toBeCloseTo(1.1, 9);
    expect(tokenZoomScale(8, 2)).toBeCloseTo(1.1, 9);
  });

  it("zooms about the cursor and clamps", () => {
    const v = { x: 0, y: 0, k: 1 };
    const cursor = { x: 300, y: 200 };
    const before = screenToWorld(v, cursor);
    const z = zoomAt(v, cursor, 2, 1);
    const after = screenToWorld(z, cursor);
    expect(z.k).toBe(2);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
    expect(zoomAt(v, cursor, 1000, 1).k).toBe(24);
    expect(zoomAt(v, cursor, 0.0001, 1).k).toBeCloseTo(0.6, 9);
  });

  it("pans by screen pixels", () => {
    expect(panBy({ x: 10, y: 10, k: 2 }, 20, -10)).toEqual({ x: 0, y: 15, k: 2 });
  });
});

describe("map fills", () => {
  it("leaves unowned land as parchment and tints owned land", () => {
    expect(landFill("a", "", { kind: "none" })).toBeNull();
    expect(landFill("a", "allies", { kind: "none" })).toMatch(/^rgba\(/);
  });

  it("highlights legal move targets on land and sea", () => {
    const mode = { kind: "move" as const, from: "a", legal: ["b", "s"], hover: "b" };
    expect(landFill("b", "", mode)).toContain("242, 38, 31");
    expect(seaFill("s", mode)).toContain("242, 38, 31");
    expect(seaFill("other", mode)).not.toContain("242, 38, 31");
  });
});

describe("stack slots", () => {
  it("lays counters out in screen pixels, sorted by key", () => {
    const slots = layoutStackSlots([
      { unit_type_id: "tank", faction_id: "axis", count: 1 },
      { unit_type_id: "infantry", faction_id: "axis", count: 2 },
    ]);
    expect(slots.map((s) => s.key)).toEqual(["infantry|axis", "tank|axis"]);
    expect(slots[1].offset.x - slots[0].offset.x).toBeGreaterThan(40);
  });
});

describe("snapping and welding", () => {
  const regions = [{ id: "A", polygon: square(0, 0, 100) }];

  it("snaps to a vertex first, then to an edge, otherwise stays free", () => {
    expect(snapPoint({ x: 103, y: 2 }, regions, 8)).toMatchObject({ kind: "vertex", point: { x: 100, y: 0 } });
    expect(snapPoint({ x: 50, y: 5 }, regions, 8)).toMatchObject({ kind: "edge", point: { x: 50, y: 0 } });
    expect(snapPoint({ x: 50, y: 50 }, regions, 8)).toMatchObject({ kind: "free", point: { x: 50, y: 50 } });
  });

  it("can ignore the vertex being dragged", () => {
    const snap = snapPoint({ x: 1, y: 1 }, regions, 8, (_id, i) => i === 0);
    expect(snap.kind).not.toBe("vertex");
  });

  it("inserts a T-junction vertex into the edge it sits on", () => {
    const out = insertOnEdges(square(0, 0, 100), [{ x: 50, y: 0 }]);
    expect(out).toHaveLength(5);
    expect(out[1]).toEqual({ x: 50, y: 0 });
    expect(insertOnEdges(out, [{ x: 50, y: 0 }])).toHaveLength(5);
  });

  it("welds a drawn border into the neighbor so both list the shared vertices", () => {
    const base = editorFromMapJson({ regions: [] });
    const withA = addRegionFromPolygon(base, square(0, 0, 100), false).map;
    // B shares A's right edge but its corners fall mid-edge on A.
    const b = addRegionFromPolygon(withA, [{ x: 100, y: 20 }, { x: 200, y: 20 }, { x: 200, y: 80 }, { x: 100, y: 80 }], false);
    const a = findRegion(b.map, "Territory 1")!;
    expect(a.polygon.some((p) => p.x === 100 && p.y === 20)).toBe(true);
    expect(a.polygon.some((p) => p.x === 100 && p.y === 80)).toBe(true);
    expect(sameDomainAdjacent(a.polygon, findRegion(b.map, b.id)!.polygon, 0.5)).toBe(true);
  });

  it("moves every coincident vertex together", () => {
    let map = editorFromMapJson({ regions: [] });
    map = addRegionFromPolygon(map, square(0, 0, 100), false).map;
    map = addRegionFromPolygon(map, [{ x: 100, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 100, y: 100 }], false).map;
    const refs = coincidentVertices(map, "Territory 1", 1);
    expect(refs.map((r) => r.regionId).sort()).toEqual(["Territory 1", "Territory 2"]);
    const moved = moveVertices(map, refs, { x: 110, y: -10 });
    expect(findRegion(moved, "Territory 1")!.polygon[1]).toEqual({ x: 110, y: -10 });
    expect(findRegion(moved, "Territory 2")!.polygon[0]).toEqual({ x: 110, y: -10 });
    expect(weldRegion(moved, "Territory 1")).toBeTruthy();
  });

  it("puts the label point inside a concave polygon", () => {
    const u: Vec2[] = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 100 },
      { x: 70, y: 100 },
      { x: 70, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 120 },
      { x: 0, y: 120 },
    ];
    const p = labelPoint(u);
    // A point in the notch would be outside; the label must be in one of the arms or the base.
    const inNotch = p.x > 30 && p.x < 70 && p.y < 100;
    expect(inNotch).toBe(false);
  });
});

describe("neighbor links", () => {
  const base = () => {
    let map = editorFromMapJson({ regions: [] });
    map = addRegionFromPolygon(map, square(0, 0, 10), false).map;
    map = addRegionFromPolygon(map, square(10, 0, 10), false).map;
    map = addRegionFromPolygon(map, square(200, 0, 10), true).map;
    return map;
  };

  it("toggles links both ways and records them as overrides against the auto set", () => {
    let map = base();
    map = toggleLink(map, "Territory 1", "Sea Zone 01");
    expect(isLinked(map, "Sea Zone 01", "Territory 1")).toBe(true);
    expect(map.overrides.add).toHaveLength(1);
    map = toggleLink(map, "Sea Zone 01", "Territory 1");
    expect(isLinked(map, "Territory 1", "Sea Zone 01")).toBe(false);
    expect(map.overrides.add).toHaveLength(0);
    expect(map.overrides.remove).toHaveLength(0);
  });

  it("keeps manual overrides when the auto links are recalculated", () => {
    let map = applyAutoLinks(base(), [["Territory 1", "Territory 2"]]);
    expect(neighborsOf(map, "Territory 1")).toEqual(["Territory 2"]);
    map = toggleLink(map, "Territory 1", "Territory 2"); // manual removal
    map = toggleLink(map, "Territory 1", "Sea Zone 01"); // manual strait
    map = applyAutoLinks(map, [["Territory 1", "Territory 2"]]);
    expect(isLinked(map, "Territory 1", "Territory 2")).toBe(false);
    expect(isLinked(map, "Territory 1", "Sea Zone 01")).toBe(true);
  });

  it("renames and deletes regions without leaving dangling links", () => {
    let map = applyAutoLinks(base(), [["Territory 1", "Territory 2"]]);
    const renamed = renameRegion(map, "Territory 1", "Alpha");
    expect("error" in renamed).toBe(false);
    map = renamed as typeof map;
    expect(neighborsOf(map, "Territory 2")).toEqual(["Alpha"]);
    expect("error" in renameRegion(map, "Alpha", "Territory 2")).toBe(true);
    expect("error" in renameRegion(map, "Alpha", "  ")).toBe(true);
    map = deleteRegion(map, "Alpha");
    expect(map.links).toHaveLength(0);
  });
});

describe("auto adjacency", () => {
  it("links land to land and sea to sea on two shared vertices", () => {
    expect(sameDomainAdjacent(square(0, 0, 10), square(10, 0, 10))).toBe(true);
    expect(sameDomainAdjacent(square(0, 0, 10), square(10.5, 10.5, 10))).toBe(false); // one corner only
    expect(sameDomainAdjacent(square(0, 0, 10), square(100, 100, 10))).toBe(false);
  });

  it("links on a shared edge segment even without two shared vertices", () => {
    const long = square(0, 0, 100);
    const short = [{ x: 100, y: 30 }, { x: 140, y: 30 }, { x: 140, y: 60 }, { x: 100, y: 60 }];
    expect(sharesEdgeSegment(long, short, 1.5)).toBe(true);
    expect(sameDomainAdjacent(long, short)).toBe(true);
  });

  // The "land mask" is the left half of the world: x < 50.
  const isLand = (x: number) => x < 50;

  it("links a land region and a sea zone along the shore, ignoring the rough overlap", () => {
    const land = square(0, 0, 60); // sticks 10 units out to sea
    const sea = [{ x: 40, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 60 }, { x: 40, y: 60 }]; // runs 10 units inland
    expect(coastalAdjacent(land, sea, (x) => isLand(x))).toBe(true);
  });

  it("does not link a sea zone to land that is not near its water", () => {
    const farLand = square(0, 200, 30);
    const sea = [{ x: 60, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 60 }, { x: 60, y: 60 }];
    expect(coastalAdjacent(farLand, sea, (x) => isLand(x))).toBe(false);
  });

  it("does not link land and water that overlap only on their rough parts", () => {
    // Land polygon entirely over water; sea polygon entirely over land: there is no real land or water to meet.
    const landInWater = square(70, 0, 20);
    const seaOnLand = square(0, 0, 20);
    expect(coastalAdjacent(landInWater, seaOnLand, (x) => isLand(x))).toBe(false);
  });

  it("finds every pair at once and skips coastal links without a land mask", () => {
    const regions = [
      { id: "L1", polygon: square(0, 0, 60), is_sea: false },
      { id: "L2", polygon: square(60, 0, 10), is_sea: false },
      { id: "S1", polygon: [{ x: 40, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 60 }, { x: 40, y: 60 }], is_sea: true },
    ];
    expect(autoNeighborPairs(regions, (x) => isLand(x)).map((p) => p.join("-")).sort()).toEqual(["L1-L2", "L1-S1"]);
    expect(autoNeighborPairs(regions, null).map((p) => p.join("-"))).toEqual(["L1-L2"]);
  });
});

describe("export", () => {
  it("round-trips the demo map through the editor and writes explicit neighbors", () => {
    const world = projectMapJson(loadJson(NEWMAP_PATH));
    const map = editorFromMapJson(world);
    expect(map.regions.some((r) => r.is_sea)).toBe(true);
    expect(map.regions.some((r) => !r.is_sea)).toBe(true);

    const json = editorToMapJson(map);
    expect(json.coord_space).toBe("svg");
    expect(mapIntegrityProblems(json)).toEqual([]);
    const regions = json.regions as Array<Record<string, any>>;
    const land = regions.find((r) => r.metadata.is_sea === false)!;
    expect(land.metadata).toMatchObject({ type: "land", is_sea: false });
    expect(land.anchors[0]).toMatchObject({ type: "unit" });
    expect(Array.isArray(land.neighbors)).toBe(true);

    const again = editorFromMapJson(JSON.parse(formatMapJson(json)));
    expect(again.regions).toHaveLength(map.regions.length);
    expect(again.links.map((p) => p.join("|")).sort()).toEqual(map.links.map((p) => p.join("|")).sort());
  });

  it("keeps each coordinate pair on one line", () => {
    const text = formatMapJson({ polygon: [[1.5, 2], [3, 4.25]] });
    expect(text).toContain("[1.5, 2]");
    expect(text).toContain("[3, 4.25]");
  });

  it("feeds the engine's explicit neighbors straight into adjacency", () => {
    const loaded = editorFromMapJson(projectMapJson(loadJson(NEWMAP_PATH)));
    const map = applyAutoLinks({ ...loaded, overrides: { add: [], remove: [] } }, [["Sea Zone 01", "Territory 1"]]);
    const data = buildMapData(editorToMapJson(map));
    expect(data.adjacency).toEqual([{ from: "Sea Zone 01", to: "Territory 1" }]);
  });

  it("still derives adjacency from polygons when no neighbors are listed", () => {
    const raw = loadJson(NEWMAP_PATH);
    const stripped = {
      ...raw,
      regions: (raw.regions as Array<Record<string, unknown>>).map(({ neighbors: _n, ...region }) => region),
    };
    const data = buildMapData(stripped);
    expect((data.adjacency as unknown[]).length).toBeGreaterThan(0);
  });
});
