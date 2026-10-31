// Facility fields, the three anchors, the Tri-Wedge badge and domain-separated collapsible stacks.
import { describe, expect, it } from "vitest";
import {
  airAnchorOfRegion,
  anchorHandleAt,
  anchorPoints,
  applyMerge,
  editorFromMapJson,
  editorToMapJson,
  facilityAnchorOfRegion,
  findRegion,
  isUnconfiguredLand,
  moveSlot,
  SAMPLE_LAND_GARRISON,
  SAMPLE_SEA_GARRISON,
  sampleGarrison,
  startingStacks,
  updateRegion,
} from "../../../src/ui/map/editor/editorModel";
import {
  badgeExtent,
  badgeShapes,
  chimneyCount,
  facilityCount,
  factoryParts,
  planePolygon,
  silhouetteBox,
} from "../../../src/ui/map/facilityBadge";
import {
  airAnchorOf,
  buildMapGeometry,
  defaultAirAnchor,
  defaultFacilityAnchor,
  facilitiesOf,
  facilityAnchorOf,
  factorySizeOf,
  type RegionShape,
  type StackEntry,
  UNIT_SLOT_MAX,
  type Vec2,
} from "../../../src/ui/map/geometry";
import { hatchSegments, isHatchedOwner } from "../../../src/ui/map/hatch";
import { legacyToWorld, projectMapJson, WORLD_COORD_SPACE } from "../../../src/ui/map/map_space";
import { CARGO_DOT, isActiveFaction, navalLetter, pillColors, tokenDisc } from "../../../src/ui/map/tokenStyle";
import {
  effectiveUnitSlots,
  ELONGATION_RATIO,
  generateUnitSlots,
  hasHandPlacedSlots,
  nonCollidingSlots,
  roughShape,
  SLOT_INSET,
  TOKEN_WORLD,
} from "../../../src/ui/map/unitSlots";
import {
  clearOf,
  drawerRows,
  groupByDomain,
  layoutRegionVisuals,
  planCollapse,
  unitDomain,
  unitLabel,
  unitPriority,
} from "../../../src/ui/map/unitStacks";
import { worldTokenPx, TOKEN_MAX_PX, TOKEN_MIN_PX } from "../../../src/ui/map/viewMath";

// ---------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------

function regionJson(id: string, meta: Record<string, unknown>, x = 0, anchor: [number, number] = [x + 50, 50]) {
  return {
    anchors: [{ capacity: 5, type: "unit", x: anchor[0], y: anchor[1] }],
    metadata: { region_id: id, name: id, ipc: 3, type: "land", ...meta },
    polygon: [
      [x, 0],
      [x + 100, 0],
      [x + 100, 100],
      [x, 100],
    ],
    neighbors: [],
  };
}

const mapOf = (...regions: unknown[]) => ({ version: 2, coord_space: WORLD_COORD_SPACE, regions });

const unit = (unit_type_id: string, count = 1, faction_id = "ger"): StackEntry => ({ unit_type_id, faction_id, count });

/** A bare shape, as the older tests build them: none of the facility fields. */
const bareShape = (over: Partial<RegionShape> = {}): RegionShape => ({
  id: "r",
  type: "land",
  ipc: 1,
  hasFactory: false,
  points: [],
  bounds: { x: 0, y: 0, w: 100, h: 100 },
  centroid: { x: 50, y: 50 },
  anchor: { x: 50, y: 50 },
  ...over,
});

const squarePoly = (x: number, y: number, w: number, h: number): [number, number][][][] => [
  [
    [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
      [x, y],
    ],
  ],
];

const sixSlots = (cx = 50, cy = 50): Vec2[] =>
  [0, 1, 2, 3, 4, 5].map((i) => ({ x: cx + (i - 2.5) * TOKEN_WORLD, y: cy + 22 }));

// ---------------------------------------------------------------
// Schema
// ---------------------------------------------------------------

describe("facility schema: defaults and compatibility", () => {
  it("defaults the facility anchor to [cx, cy + 16] and the air anchor to [cx + 14, cy - 10]", () => {
    expect(defaultFacilityAnchor({ x: 100, y: 200 })).toEqual({ x: 100, y: 216 });
    expect(defaultAirAnchor({ x: 100, y: 200 })).toEqual({ x: 114, y: 190 });
  });

  it("an older region with only factory: true is a major factory with no airbase or harbour", () => {
    const [r] = buildMapGeometry(mapOf(regionJson("Old", { factory: true }))).regions;
    expect(r.hasFactory).toBe(true);
    expect(r.factorySize).toBe("major");
    expect(r.hasAirbase).toBe(false);
    expect(r.hasHarbour).toBe(false);
    expect(r.facilityAnchor).toEqual({ x: 50, y: 66 });
    expect(r.facilityAnchorSet).toBe(false);
    expect(r.airAnchor).toEqual({ x: 64, y: 40 });
    expect(r.airAnchorSet).toBe(false);
  });

  it("a region with no facility fields at all has none", () => {
    const [r] = buildMapGeometry(mapOf(regionJson("Plain", {}))).regions;
    expect(r.hasFactory).toBe(false);
    expect(r.factorySize).toBe("none");
    expect(facilityCount(facilitiesOf(r))).toBe(0);
  });

  it("reads factory_size, has_airbase, has_harbour and both anchors", () => {
    const [r] = buildMapGeometry(
      mapOf(
        regionJson("Port", {
          factory: true,
          factory_size: "minor",
          has_airbase: true,
          has_harbour: true,
          facility_anchor: [70, 80],
          air_anchor: [20, 15],
        }),
      ),
    ).regions;
    expect(r.factorySize).toBe("minor");
    expect(r.hasAirbase).toBe(true);
    expect(r.hasHarbour).toBe(true);
    expect(r.facilityAnchor).toEqual({ x: 70, y: 80 });
    expect(r.facilityAnchorSet).toBe(true);
    expect(r.airAnchor).toEqual({ x: 20, y: 15 });
    expect(r.airAnchorSet).toBe(true);
  });

  it("factory_size minor or major keeps the factory flag true even when factory is absent", () => {
    for (const size of ["minor", "major"] as const) {
      const [r] = buildMapGeometry(mapOf(regionJson("F", { factory_size: size }))).regions;
      expect(r.hasFactory).toBe(true);
      expect(r.factorySize).toBe(size);
    }
  });

  it("factorySizeOf: size wins when minor or major, a bare factory is major, none is none", () => {
    expect(factorySizeOf({ factory: true, factory_size: "minor" })).toBe("minor");
    expect(factorySizeOf({ factory: true })).toBe("major");
    expect(factorySizeOf({ factory: true, factory_size: "none" })).toBe("major");
    expect(factorySizeOf({ factory: false })).toBe("none");
    expect(factorySizeOf({})).toBe("none");
    expect(factorySizeOf({ factory_size: "huge" })).toBe("none");
  });

  it("a malformed anchor falls back to the default", () => {
    const [r] = buildMapGeometry(mapOf(regionJson("Bad", { facility_anchor: [1], air_anchor: "x" }))).regions;
    expect(r.facilityAnchorSet).toBe(false);
    expect(r.airAnchorSet).toBe(false);
    expect(r.facilityAnchor).toEqual({ x: 50, y: 66 });
  });

  it("a sea zone has no facilities and no facility anchor, but keeps an air anchor", () => {
    const [r] = buildMapGeometry(
      mapOf(
        regionJson("Sea Zone 1", {
          type: "sea",
          ipc: 0,
          has_airbase: true,
          has_harbour: true,
          factory_size: "major",
          facility_anchor: [1, 1],
          air_anchor: [30, 30],
        }),
      ),
    ).regions;
    expect(r.type).toBe("sea");
    expect(r.factorySize).toBe("none");
    expect(r.hasAirbase).toBe(false);
    expect(r.hasHarbour).toBe(false);
    expect(r.facilityAnchorSet).toBe(false);
    expect(r.airAnchor).toEqual({ x: 30, y: 30 });
  });

  it("helpers fall back to the defaults for a shape without the new fields", () => {
    const shape = bareShape({ hasFactory: true });
    expect(facilitiesOf(shape)).toEqual({ factory: "major", airbase: false, harbour: false });
    expect(facilityAnchorOf(shape)).toEqual({ x: 50, y: 66 });
    expect(airAnchorOf(shape)).toEqual({ x: 64, y: 40 });
    expect(facilitiesOf(bareShape())).toEqual({ factory: "none", airbase: false, harbour: false });
  });

  it("projects the anchors of a legacy-space map along with the polygons", () => {
    const legacy = {
      version: 2,
      regions: [{ ...regionJson("L", { facility_anchor: [100, 200], air_anchor: [300, 400], unit_slots: [[10, 20], [30, 40]] }), anchors: [] }],
    };
    const out = projectMapJson(legacy);
    const meta = (out.regions[0] as { metadata: Record<string, unknown> }).metadata;
    expect(meta.facility_anchor).toEqual(legacyToWorld(100, 200));
    expect(meta.air_anchor).toEqual(legacyToWorld(300, 400));
    expect(meta.unit_slots).toEqual([legacyToWorld(10, 20), legacyToWorld(30, 40)]);
  });

  it("reads up to six hand-placed unit_slots and ignores a malformed pair", () => {
    const slots = [
      [10, 20],
      [30, 40],
      [50, 60],
      [70, 80],
      [90, 100],
      [110, 120],
      [130, 140],
    ];
    const [r] = buildMapGeometry(mapOf(regionJson("S", { unit_slots: [...slots, [1]] }))).regions;
    expect(r.unitSlots).toEqual(slots.slice(0, UNIT_SLOT_MAX).map(([x, y]) => ({ x, y })));
    expect(hasHandPlacedSlots(r)).toBe(true);
  });

  it("a region without unit_slots has none, so the generator will fill them in", () => {
    const [r] = buildMapGeometry(mapOf(regionJson("Plain", {}))).regions;
    expect(r.unitSlots).toBeUndefined();
    expect(hasHandPlacedSlots(r)).toBe(false);
  });
});

// ---------------------------------------------------------------
// Editor model
// ---------------------------------------------------------------

describe("editor: facility fields round-trip through the map file", () => {
  const roundTrip = (json: object) => editorToMapJson(editorFromMapJson(json), { round: false });
  const metaOf = (json: { regions: { metadata: Record<string, unknown> }[] }, i = 0) => json.regions[i].metadata;

  it("writes nothing new for a region that does not use the fields", () => {
    const meta = metaOf(roundTrip(mapOf(regionJson("Plain", {}))) as never);
    for (const key of ["has_airbase", "has_harbour", "facility_anchor", "air_anchor", "factory_size", "unit_slots"]) {
      expect(meta).not.toHaveProperty(key);
    }
    expect(meta.factory).toBe(false);
  });

  it("keeps factory true whenever the size is minor or major", () => {
    for (const size of ["minor", "major"] as const) {
      const map = updateRegion(editorFromMapJson(mapOf(regionJson("R", {}))), "R", { factory: size });
      const meta = metaOf(editorToMapJson(map) as never);
      expect(meta.factory).toBe(true);
      expect(meta.factory_size).toBe(size);
    }
    const none = metaOf(editorToMapJson(editorFromMapJson(mapOf(regionJson("R", { factory: true, factory_size: "minor" })))) as never);
    expect(none.factory).toBe(true);
    const off = updateRegion(editorFromMapJson(mapOf(regionJson("R", { factory: true }))), "R", { factory: "none" });
    expect(metaOf(editorToMapJson(off) as never).factory).toBe(false);
  });

  it("round-trips airbase, harbour, both anchors and unit_slots", () => {
    const json = mapOf(
      regionJson("Port", {
        factory: true,
        factory_size: "major",
        has_airbase: true,
        has_harbour: true,
        facility_anchor: [61.5, 82],
        air_anchor: [33, 21],
        unit_slots: [
          [40, 70],
          [60, 70],
        ],
      }),
    );
    const meta = metaOf(roundTrip(json) as never);
    expect(meta).toMatchObject({
      factory: true,
      factory_size: "major",
      has_airbase: true,
      has_harbour: true,
      facility_anchor: [61.5, 82],
      air_anchor: [33, 21],
      unit_slots: [
        [40, 70],
        [60, 70],
      ],
    });
    // And loading what was written gives the same editor map.
    expect(editorFromMapJson(roundTrip(json)).regions).toEqual(editorFromMapJson(json).regions);
  });

  it("rounds the anchors like every other coordinate when exporting a file", () => {
    const map = updateRegion(editorFromMapJson(mapOf(regionJson("R", {}))), "R", {
      facility_anchor: [10.126, 20.874],
      air_anchor: [1.004, 2.996],
    });
    const meta = metaOf(editorToMapJson(map, { round: true }) as never);
    expect(meta.facility_anchor).toEqual([10.13, 20.87]);
    expect(meta.air_anchor).toEqual([1, 3]);
  });

  it("drops a reset anchor from the file", () => {
    const set = updateRegion(editorFromMapJson(mapOf(regionJson("R", {}))), "R", { facility_anchor: [1, 2], air_anchor: [3, 4] });
    const reset = updateRegion(set, "R", { facility_anchor: undefined, air_anchor: undefined, unit_slots: undefined });
    const meta = metaOf(editorToMapJson(reset) as never);
    expect(meta).not.toHaveProperty("facility_anchor");
    expect(meta).not.toHaveProperty("air_anchor");
    expect(meta).not.toHaveProperty("unit_slots");
  });

  it("writes unit_slots only when they have been placed by hand", () => {
    const map = updateRegion(editorFromMapJson(mapOf(regionJson("R", {}))), "R", {
      unit_slots: [
        [1.004, 2.996],
        [3.5, 4.5],
      ],
    });
    expect(metaOf(editorToMapJson(map, { round: true }) as never).unit_slots).toEqual([
      [1, 3],
      [3.5, 4.5],
    ]);
    const cleared = updateRegion(map, "R", { unit_slots: undefined });
    expect(metaOf(editorToMapJson(cleared) as never)).not.toHaveProperty("unit_slots");
  });

  it("the editor geometry sees what was set, so the preview matches play", () => {
    const map = updateRegion(editorFromMapJson(mapOf(regionJson("R", {}))), "R", { has_airbase: true, air_anchor: [5, 6] });
    const [shape] = buildMapGeometry(editorToMapJson(map, { round: false })).regions;
    expect(shape.hasAirbase).toBe(true);
    expect(shape.airAnchor).toEqual({ x: 5, y: 6 });
  });

  it("clears an airbase or harbour that was turned off", () => {
    const on = updateRegion(editorFromMapJson(mapOf(regionJson("R", {}))), "R", { has_airbase: true, has_harbour: true });
    const off = updateRegion(on, "R", { has_airbase: false, has_harbour: false });
    const meta = metaOf(editorToMapJson(off) as never);
    expect(meta).not.toHaveProperty("has_airbase");
    expect(meta).not.toHaveProperty("has_harbour");
  });

  it("a region with a facility or a custom anchor is not an unconfigured Territory", () => {
    const base = editorFromMapJson(
      mapOf({ ...regionJson("Territory 1", { ipc: 1, faction: "Neutral" }), metadata: { region_id: "Territory 1", name: "Territory 1", ipc: 1, type: "land", faction: "Neutral" } }),
    );
    const region = findRegion(base, "Territory 1")!;
    expect(isUnconfiguredLand(base, region)).toBe(true);
    for (const patch of [
      { has_airbase: true },
      { has_harbour: true },
      { facility_anchor: [1, 1] as [number, number] },
      { air_anchor: [1, 1] as [number, number] },
      { unit_slots: [[1, 1]] as [number, number][] },
    ]) {
      const next = updateRegion(base, "Territory 1", patch);
      expect(isUnconfiguredLand(next, findRegion(next, "Territory 1")!)).toBe(false);
    }
  });

  it("merging keeps an airbase or harbour from either region", () => {
    const base = editorFromMapJson(
      mapOf(regionJson("A", { has_airbase: true }, 0), regionJson("B", { has_harbour: true }, 100)),
    );
    const merged = applyMerge(base, "A", "B", {
      polygon: [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        { x: 200, y: 100 },
        { x: 0, y: 100 },
      ],
      cx: 100,
      cy: 50,
    });
    expect(merged).not.toBeNull();
    const a = findRegion(merged!, "A")!;
    expect(a.has_airbase).toBe(true);
    expect(a.has_harbour).toBe(true);
  });
});

describe("editor: anchor handles", () => {
  const land = () => findRegion(editorFromMapJson(mapOf(regionJson("L", {}, 0, [50, 50]))), "L")!;
  const sea = () =>
    findRegion(editorFromMapJson(mapOf(regionJson("Sea Zone 1", { type: "sea", ipc: 0 }, 0, [50, 50]))), "Sea Zone 1")!;

  it("a land region has unit, facility and air handles at the defaults", () => {
    expect(anchorPoints(land())).toEqual([
      { kind: "anchor", at: { x: 50, y: 50 } },
      { kind: "facility", at: { x: 50, y: 66 } },
      { kind: "air", at: { x: 64, y: 40 } },
    ]);
  });

  it("a sea zone has no facility handle", () => {
    expect(anchorPoints(sea()).map((p) => p.kind)).toEqual(["anchor", "air"]);
    expect(anchorHandleAt(sea(), { x: 50, y: 66 }, 2)).toBeNull();
  });

  it("picks the handle under the pointer", () => {
    const r = land();
    expect(anchorHandleAt(r, { x: 50.5, y: 50 }, 3)).toEqual({ kind: "anchor", regionId: "L" });
    expect(anchorHandleAt(r, { x: 50, y: 65 }, 3)).toEqual({ kind: "facility", regionId: "L" });
    expect(anchorHandleAt(r, { x: 65, y: 41 }, 3)).toEqual({ kind: "air", regionId: "L" });
    expect(anchorHandleAt(r, { x: 0, y: 0 }, 3)).toBeNull();
  });

  it("when handles overlap the nearest wins, and the unit anchor wins a tie", () => {
    const r = updateRegion(editorFromMapJson(mapOf(regionJson("L", {}))), "L", { air_anchor: [52, 50], facility_anchor: [50, 50] });
    const region = findRegion(r, "L")!;
    expect(anchorHandleAt(region, { x: 52, y: 50 }, 5)?.kind).toBe("air");
    expect(anchorHandleAt(region, { x: 50, y: 50 }, 5)?.kind).toBe("anchor");
  });

  it("picks a numbered unit slot when it is nearer than any anchor", () => {
    const r = land();
    const slots = [
      { x: 20, y: 20 },
      { x: 80, y: 20 },
    ];
    expect(anchorHandleAt(r, { x: 20.2, y: 20 }, 3, slots)).toEqual({ kind: "slot", regionId: "L", index: 0 });
    expect(anchorHandleAt(r, { x: 80, y: 20 }, 3, slots)).toEqual({ kind: "slot", regionId: "L", index: 1 });
    // The unit anchor still wins a tie, so a slot sitting on it is not stolen.
    expect(anchorHandleAt(r, { x: 50, y: 50 }, 3, [{ x: 50, y: 50 }])).toEqual({ kind: "anchor", regionId: "L" });
  });

  it("moveSlot writes only the dragged slot, so one drag is one undo step", () => {
    expect(moveSlot([{ x: 1, y: 2 }, { x: 3, y: 4 }], 1, { x: 9, y: 8 })).toEqual([
      [1, 2],
      [9, 8],
    ]);
  });

  it("the default anchors follow the unit anchor, and explicit ones stay put", () => {
    const moved = updateRegion(editorFromMapJson(mapOf(regionJson("L", {}))), "L", { cx: 10, cy: 20 });
    expect(facilityAnchorOfRegion(findRegion(moved, "L")!)).toEqual({ x: 10, y: 36 });
    expect(airAnchorOfRegion(findRegion(moved, "L")!)).toEqual({ x: 24, y: 10 });
    const fixed = updateRegion(moved, "L", { facility_anchor: [1, 2], air_anchor: [3, 4] });
    const again = updateRegion(fixed, "L", { cx: 99, cy: 99 });
    expect(facilityAnchorOfRegion(findRegion(again, "L")!)).toEqual({ x: 1, y: 2 });
    expect(airAnchorOfRegion(findRegion(again, "L")!)).toEqual({ x: 3, y: 4 });
  });
});

// ---------------------------------------------------------------
// The Tri-Wedge badge
// ---------------------------------------------------------------

describe("Tri-Wedge facility badge", () => {
  const none = { factory: "none", airbase: false, harbour: false } as const;
  const sharedCorners = (a: Vec2[], b: Vec2[]) =>
    a.filter((p) => b.some((q) => Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.y - q.y) < 1e-9)).length;

  it("draws nothing for a region with no facility", () => {
    expect(badgeShapes(none)).toEqual([]);
    expect(badgeExtent(none)).toEqual({ w: 0, h: 0 });
  });

  it("draws only the active triangle for a single facility", () => {
    const factory = badgeShapes({ ...none, factory: "minor" });
    expect(factory.map((s) => [s.slot, s.active])).toEqual([["factory", true]]);
    expect(factory[0].pointsUp).toBe(true);
    expect(badgeShapes({ ...none, airbase: true }).map((s) => [s.slot, s.active, s.pointsUp])).toEqual([["airbase", true, false]]);
    expect(badgeShapes({ ...none, harbour: true }).map((s) => [s.slot, s.active, s.pointsUp])).toEqual([["harbour", true, false]]);
  });

  it("centres the badge on the anchor", () => {
    for (const f of [{ ...none, factory: "major" }, { ...none, airbase: true }, { factory: "major", airbase: true, harbour: true }] as const) {
      const pts = badgeShapes(f).flatMap((s) => s.points);
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(0, 9);
      expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(0, 9);
    }
  });

  it("with two or more facilities all three slots show, the empty one as a faint outline", () => {
    const two = badgeShapes({ factory: "major", airbase: true, harbour: false });
    expect(two.map((s) => [s.slot, s.active])).toEqual([
      ["airbase", true],
      ["factory", true],
      ["harbour", false],
    ]);
    const harbourAndFactory = badgeShapes({ factory: "minor", airbase: false, harbour: true });
    expect(harbourAndFactory.find((s) => s.slot === "airbase")?.active).toBe(false);
    const three = badgeShapes({ factory: "minor", airbase: true, harbour: true });
    expect(three.every((s) => s.active)).toBe(true);
    expect(three).toHaveLength(3);
  });

  it("the three triangles share edges and make one trapezoid", () => {
    const [left, centre, right] = badgeShapes({ factory: "major", airbase: true, harbour: true });
    expect(sharedCorners(left.points, centre.points)).toBe(2);
    expect(sharedCorners(centre.points, right.points)).toBe(2);
    expect(sharedCorners(left.points, right.points)).toBe(1);
    const { w, h } = badgeExtent({ factory: "major", airbase: true, harbour: true });
    expect(w).toBeCloseTo(2, 9);
    expect(h).toBeCloseTo(Math.sqrt(3) / 2, 9);
    // The ▲ is the factory and the ▼s are the airbase and the harbour.
    expect([left.pointsUp, centre.pointsUp, right.pointsUp]).toEqual([false, true, false]);
  });

  it("a minor factory has one chimney and a major factory two", () => {
    expect(chimneyCount("none")).toBe(0);
    expect(chimneyCount("minor")).toBe(1);
    expect(chimneyCount("major")).toBe(2);
    expect(factoryParts("minor").chimneys).toHaveLength(1);
    expect(factoryParts("major").chimneys).toHaveLength(2);
    expect(factoryParts("none").chimneys).toHaveLength(0);
  });

  it("the airplane silhouette is symmetric about its axis", () => {
    const plane = planePolygon();
    for (const p of plane) {
      const mirror = plane.find((q) => Math.abs(q.x + p.x) < 1e-9 && Math.abs(q.y - p.y) < 1e-9);
      expect(mirror).toBeDefined();
    }
  });

  it("silhouettes fit inside their triangle", () => {
    const inside = (p: Vec2, t: [Vec2, Vec2, Vec2]) => {
      const sign = (a: Vec2, b: Vec2, c: Vec2) => (a.x - c.x) * (b.y - c.y) - (b.x - c.x) * (a.y - c.y);
      const d1 = sign(p, t[0], t[1]);
      const d2 = sign(p, t[1], t[2]);
      const d3 = sign(p, t[2], t[0]);
      return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
    };
    for (const shape of badgeShapes({ factory: "major", airbase: true, harbour: true })) {
      const { centre, size } = silhouetteBox(shape);
      const corners = [
        { x: centre.x - size, y: centre.y - size },
        { x: centre.x + size, y: centre.y - size },
        { x: centre.x + size, y: centre.y + size },
        { x: centre.x - size, y: centre.y + size },
      ];
      // The centre is inside, and the silhouette's widest part (its midline) stays within the triangle.
      expect(inside(centre, shape.points)).toBe(true);
      expect(inside({ x: centre.x - size * 0.5, y: centre.y }, shape.points)).toBe(true);
      expect(inside({ x: centre.x + size * 0.5, y: centre.y }, shape.points)).toBe(true);
      expect(corners.length).toBe(4);
    }
  });
});

// ---------------------------------------------------------------
// Domains and collapse
// ---------------------------------------------------------------

describe("unit domains", () => {
  it("classifies the standard units", () => {
    for (const id of ["infantry", "artillery", "tank", "mech_infantry", "aa"]) {
      expect(unitDomain(id)).toBe("land");
    }
    for (const id of ["fighter", "tactical_bomber", "strategic_bomber"]) {
      expect(unitDomain(id)).toBe("air");
    }
    for (const id of ["destroyer", "cruiser", "battleship", "carrier", "submarine", "transport"]) {
      expect(unitDomain(id)).toBe("sea");
    }
  });

  it("an unknown unit is land, and declared categories win", () => {
    expect(unitDomain("mystery")).toBe("land");
    expect(unitDomain("mystery", { mystery: "air" })).toBe("air");
    expect(unitDomain("fighter", { fighter: "sea" })).toBe("sea");
    expect(unitDomain("fighter", { fighter: "bogus" })).toBe("air");
  });

  it("labels unit types", () => {
    expect(unitLabel("strategic_bomber")).toBe("Strategic bomber");
    expect(unitLabel("aa")).toBe("Aa");
  });
});

describe("groupByDomain", () => {
  it("splits land, sea and air, in that order, with totals and a lead unit", () => {
    const groups = groupByDomain([
      unit("fighter", 2),
      unit("infantry", 5),
      unit("tank", 5),
      unit("destroyer", 1),
      unit("artillery", 1),
    ]);
    expect(groups.map((g) => g.domain)).toEqual(["land", "sea", "air"]);
    const land = groups[0];
    expect(land.total).toBe(11);
    expect(land.typeCount).toBe(3);
    // 5 infantry and 5 tanks tie; the tank is the heavier piece.
    expect(land.lead.unit_type_id).toBe("tank");
    expect(groups[2].total).toBe(2);
  });

  it("drops empty stacks and empty domains", () => {
    expect(groupByDomain([unit("infantry", 0)])).toEqual([]);
    expect(groupByDomain([])).toEqual([]);
  });

  it("counts distinct unit types, not stacks, so two factions of one type are one type", () => {
    const [g] = groupByDomain([unit("infantry", 2, "ger"), unit("infantry", 3, "uk")]);
    expect(g.entries).toHaveLength(2);
    expect(g.typeCount).toBe(1);
    expect(g.total).toBe(5);
  });

  it("the lead is the highest threat, not the biggest stack", () => {
    const [g] = groupByDomain([unit("tank", 1), unit("infantry", 7)]);
    expect(g.lead.unit_type_id).toBe("tank");
    expect(unitPriority("tank")).toBeGreaterThan(unitPriority("artillery"));
    expect(unitPriority("artillery")).toBeGreaterThan(unitPriority("infantry"));
    expect(unitPriority("infantry")).toBeGreaterThan(unitPriority("aa"));
    expect(unitPriority("strategic_bomber")).toBeGreaterThan(unitPriority("fighter"));
    expect(unitPriority("carrier")).toBeGreaterThan(unitPriority("battleship"));
    expect(unitPriority("battleship")).toBeGreaterThan(unitPriority("cruiser"));
    expect(unitPriority("destroyer")).toBeGreaterThan(unitPriority("submarine"));
    expect(unitPriority("submarine")).toBeGreaterThan(unitPriority("transport"));
  });
});

describe("overflow-only collapse", () => {
  const groups = (...types: string[]) => groupByDomain(types.map((t) => unit(t, 2)));

  it("never collapses while every stack has a non-colliding slot", () => {
    expect(planCollapse(groups("infantry", "artillery", "tank"), 6)).toEqual([]);
    expect(planCollapse(groups("infantry", "artillery", "tank", "fighter", "strategic_bomber"), 6)).toEqual([]);
  });

  it("collapses only when there are more stacks than slots", () => {
    expect(planCollapse(groups("infantry", "artillery", "tank"), 2)).toEqual(["land"]);
  });

  it("a single stack never collapses, even with no slots", () => {
    expect(planCollapse(groups("infantry"), 0)).toEqual([]);
  });

  it("does not collapse because of how many types there are, or how far the camera is zoomed out", () => {
    // Six types still expand when six slots fit.
    expect(planCollapse(groups("infantry", "artillery", "tank", "fighter", "tactical_bomber", "strategic_bomber"), 6)).toEqual([]);
  });

  it("collapses the domain with the most stacks first, air before land on a tie", () => {
    const mixed = groupByDomain([unit("infantry"), unit("artillery"), unit("tank"), unit("fighter"), unit("strategic_bomber")]);
    expect(planCollapse(mixed, 4)).toEqual(["land"]);
    const tied = groupByDomain([unit("infantry"), unit("tank"), unit("fighter"), unit("strategic_bomber")]);
    expect(planCollapse(tied, 3)).toEqual(["air"]);
  });

  it("an air bubble whose air anchor was placed by hand does not take a slot", () => {
    const mixed = groupByDomain([unit("infantry"), unit("tank"), unit("fighter"), unit("strategic_bomber")]);
    // Two land and an air bubble on the placed air anchor: 2 <= 2.
    expect(planCollapse(mixed, 2, true)).toEqual(["air"]);
  });
});

// ---------------------------------------------------------------
// Layout
// ---------------------------------------------------------------

describe("layoutRegionVisuals", () => {
  const view = { x: 0, y: 0, k: 4 };
  const params = (slots: Vec2[] = sixSlots()) => ({ view, tokenPx: 32, badgeSide: 30, slots });
  const landRegion = (over: Partial<RegionShape> = {}) =>
    bareShape({
      bounds: { x: 0, y: 0, w: 100, h: 100 },
      anchor: { x: 50, y: 50 },
      ...over,
    });

  it("places one token per stack at the region's world-space slots, land then air, highest threat first", () => {
    const slots = [
      { x: 10, y: 20 },
      { x: 30, y: 20 },
      { x: 50, y: 20 },
    ];
    const { clusters } = layoutRegionVisuals(landRegion(), [unit("infantry", 3), unit("tank", 2), unit("fighter", 1)], params(slots));
    const land = clusters.find((c) => c.domain === "land")!;
    const air = clusters.find((c) => c.domain === "air")!;
    expect(land.collapsed).toBe(false);
    expect(air.collapsed).toBe(false);
    expect(land.slots.map((s) => s.slot.entry.unit_type_id)).toEqual(["tank", "infantry"]);
    expect(land.slots.map((s) => [s.x, s.y])).toEqual([
      [40, 80],
      [120, 80],
    ]);
    expect(air.slots.map((s) => [s.x, s.y])).toEqual([[200, 80]]);
  });

  it("puts ships in the same slots as land, in a sea zone", () => {
    const slots = [
      { x: 10, y: 20 },
      { x: 30, y: 20 },
    ];
    const { clusters } = layoutRegionVisuals(landRegion({ type: "sea" }), [unit("destroyer", 2), unit("transport", 1)], params(slots));
    expect(clusters).toHaveLength(1);
    expect(clusters[0].domain).toBe("sea");
    expect(clusters[0].collapsed).toBe(false);
    expect(clusters[0].slots).toHaveLength(2);
  });

  it("a collapsed domain is one bubble with the lead unit and a total, and no counters", () => {
    const region = landRegion();
    const { clusters } = layoutRegionVisuals(region, [unit("infantry", 6), unit("artillery", 4), unit("tank", 2)], params([{ x: 50, y: 70 }]));
    expect(clusters).toHaveLength(1);
    const [c] = clusters;
    expect(c.collapsed).toBe(true);
    expect(c.slots).toEqual([]);
    expect(c.bubbleRadius).toBeGreaterThan(0);
    expect(c.group.total).toBe(12);
    expect(c.group.lead.unit_type_id).toBe("tank");
  });

  it("an expanded domain has one counter per stack, even with more than two types", () => {
    const stacks = [unit("infantry", 6), unit("artillery", 2), unit("tank", 2)];
    const { clusters } = layoutRegionVisuals(landRegion(), stacks, params());
    expect(clusters[0].collapsed).toBe(false);
    expect(clusters[0].slots).toHaveLength(3);
    expect(clusters[0].bubbleRadius).toBe(0);
  });

  it("collapses only when the slots cannot hold the stacks, never because of zoom", () => {
    const stacks = [unit("infantry", 6), unit("tank", 2)];
    expect(layoutRegionVisuals(landRegion(), stacks, params([{ x: 50, y: 70 }])).clusters[0].collapsed).toBe(true);
    expect(layoutRegionVisuals(landRegion(), stacks, { ...params(), view: { x: 0, y: 0, k: 0.4 } }).clusters[0].collapsed).toBe(false);
    expect(layoutRegionVisuals(landRegion(), stacks, params()).clusters[0].collapsed).toBe(false);
  });

  it("a hand-placed air anchor is the air bubble's exact seat", () => {
    // Three air types and one land, one slot: air overflows, land keeps the slot, the bubble sits on the air anchor.
    const stacks = [unit("infantry", 3), unit("fighter", 2), unit("tactical_bomber", 1), unit("strategic_bomber", 1)];
    const placed = layoutRegionVisuals(
      landRegion({ airAnchor: { x: 80, y: 20 }, airAnchorSet: true }),
      stacks,
      params([{ x: 10, y: 70 }]),
    ).clusters;
    const air = placed.find((c) => c.domain === "air")!;
    expect(air.collapsed).toBe(true);
    expect([air.x, air.y]).toEqual([320, 80]);
  });

  it("keeps a default badge off the unit tokens", () => {
    const region = landRegion({ factorySize: "major", hasAirbase: true, hasHarbour: true, hasFactory: true });
    const { badge, clusters } = layoutRegionVisuals(region, [unit("infantry", 6), unit("artillery", 4), unit("tank", 2)], params());
    expect(badge).not.toBeNull();
    for (const c of clusters) {
      for (const s of c.slots) {
        const overlap = Math.abs(badge!.x - s.x) < badge!.hw + 16 && Math.abs(badge!.y - s.y) < badge!.hh + 16;
        expect(overlap).toBe(false);
      }
    }
  });

  it("a facility anchor placed by hand is exact", () => {
    const region = landRegion({ factorySize: "minor", hasFactory: true, facilityAnchor: { x: 50, y: 52 }, facilityAnchorSet: true });
    const { badge } = layoutRegionVisuals(region, [unit("infantry", 6)], params());
    expect([badge!.x, badge!.y]).toEqual([200, 208]);
  });

  it("no facility means no badge, and facilities are not listed among the stacks", () => {
    expect(layoutRegionVisuals(landRegion(), [unit("infantry")], params()).badge).toBeNull();
    const withFacilities = landRegion({ factorySize: "major", hasFactory: true, hasAirbase: true });
    const { clusters } = layoutRegionVisuals(withFacilities, [], params());
    expect(clusters).toEqual([]);
  });

  it("puts the combat marker below whatever sits under the unit anchor", () => {
    const region = landRegion({ factorySize: "major", hasFactory: true });
    const v = layoutRegionVisuals(region, [unit("infantry", 6), unit("tank", 2)], params());
    const near = (x: number, hw: number) => Math.abs(x - 200) < hw + 24;
    const bottom = Math.max(
      200,
      ...v.clusters.flatMap((c) => c.slots.filter((s) => near(s.x, 16)).map((s) => s.y + 16)),
      v.badge && near(v.badge.x, v.badge.hw) ? v.badge.y + v.badge.hh : 200,
    );
    expect(v.markerY).toBeGreaterThanOrEqual(bottom);
  });
});

describe("clearOf", () => {
  const fixed = { x: 0, y: 0, hw: 10, hh: 10 };

  it("leaves a clear box where it is", () => {
    const far = { x: 100, y: 0, hw: 10, hh: 10 };
    expect(clearOf(fixed, far, { x: 1, y: 0 })).toBe(far);
  });

  it("slides an overlapping box along its own direction until it is clear", () => {
    const moved = clearOf(fixed, { x: 5, y: -5, hw: 10, hh: 10 }, { x: 1, y: -1 }, 2);
    const apart = Math.abs(moved.x) >= 22 - 1e-9 || Math.abs(moved.y) >= 22 - 1e-9;
    expect(apart).toBe(true);
    expect(moved.x).toBeGreaterThan(5);
    expect(moved.y).toBeLessThan(-5);
  });

  it("uses the fallback direction when the boxes are exactly stacked", () => {
    const moved = clearOf(fixed, { x: 0, y: 0, hw: 10, hh: 10 }, { x: 0, y: 1 }, 0);
    expect(moved.x).toBeCloseTo(0, 9);
    expect(moved.y).toBeCloseTo(20, 9);
  });
});

describe("drawer rows", () => {
  it("lists every unit type and count in the domain, biggest first", () => {
    const [g] = groupByDomain([unit("infantry", 7), unit("artillery", 2), unit("tank", 7), unit("mech_infantry", 1)]);
    const rows = drawerRows(g);
    expect(rows.map((r) => [r.label, r.count])).toEqual([
      ["Infantry", 7],
      ["Tank", 7],
      ["Artillery", 2],
      ["Mech infantry", 1],
    ]);
    expect(rows.reduce((n, r) => n + r.count, 0)).toBe(g.total);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });
});

describe("unit slot generation", () => {
  it("puts a rounded territory's slots in an orbit around the hub", () => {
    const { mode, slots } = generateUnitSlots({ shape: squarePoly(0, 0, 120, 120), hub: { x: 60, y: 60 } });
    expect(mode).toBe("orbit");
    expect(slots.length).toBeGreaterThanOrEqual(4);
    expect(slots.length).toBeLessThanOrEqual(UNIT_SLOT_MAX);
    const radii = slots.map((p) => Math.hypot(p.x - 60, p.y - 60));
    const mean = radii.reduce((s, r) => s + r, 0) / radii.length;
    for (const r of radii) {
      expect(Math.abs(r - mean)).toBeLessThan(1);
    }
  });

  it("puts a long narrow territory's slots in a spine down its length", () => {
    const { mode, slots } = generateUnitSlots({ shape: squarePoly(0, 0, 16, 140), hub: { x: 8, y: 70 } });
    expect(mode).toBe("spine");
    expect(ELONGATION_RATIO).toBeLessThan(4);
    expect(slots.length).toBeGreaterThanOrEqual(3);
    const xs = slots.map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(8);
    const ys = slots.map((p) => p.y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
  });

  it("keeps generated slot centres inside the land and inset from the edge", () => {
    const shape = squarePoly(0, 0, 100, 100);
    const { slots } = generateUnitSlots({ shape, hub: { x: 50, y: 50 } });
    expect(slots.length).toBeGreaterThan(0);
    for (const p of slots) {
      expect(p.x).toBeGreaterThanOrEqual(SLOT_INSET);
      expect(p.x).toBeLessThanOrEqual(100 - SLOT_INSET);
      expect(p.y).toBeGreaterThanOrEqual(SLOT_INSET);
      expect(p.y).toBeLessThanOrEqual(100 - SLOT_INSET);
    }
  });

  it("uses hand-placed unit_slots as they are, and generates when they are unset", () => {
    const placed = bareShape({ unitSlots: [{ x: 11, y: 12 }, { x: 21, y: 22 }] });
    expect(effectiveUnitSlots(placed, roughShape(placed))).toEqual([
      { x: 11, y: 12 },
      { x: 21, y: 22 },
    ]);
    const generated = effectiveUnitSlots(
      bareShape({
        points: [
          { x: 0, y: 0 },
          { x: 80, y: 0 },
          { x: 80, y: 80 },
          { x: 0, y: 80 },
        ],
        anchor: { x: 40, y: 40 },
      }),
      squarePoly(0, 0, 80, 80),
    );
    expect(generated.length).toBeGreaterThan(1);
    expect(generated.length).toBeLessThanOrEqual(UNIT_SLOT_MAX);
  });

  it("drops a later slot that sits on top of an earlier one", () => {
    expect(nonCollidingSlots([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 40, y: 0 }])).toEqual([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
    ]);
  });
});

describe("token styling", () => {
  it("uses the faction disc colours", () => {
    expect(tokenDisc("ussr")).toBe("#4D1913");
    expect(tokenDisc("ger")).toBe("#35393A");
    expect(tokenDisc("uk")).toBe("#C59B61");
    expect(tokenDisc("usa")).toBe("#586949");
    expect(tokenDisc("jap")).toBe("#8C4A27");
  });

  it("the count pill is gold for the active faction and black for the rest", () => {
    expect(isActiveFaction("ussr", "ussr")).toBe(true);
    expect(isActiveFaction("ger", "ussr")).toBe(false);
    expect(pillColors(true)).toEqual({ fill: "#E2B53C", text: "#000000", rim: "#FFFFFF" });
    expect(pillColors(false)).toEqual({ fill: "#000000", text: "#FFFFFF", rim: "#E2B53C" });
  });

  it("the naval letters are B C A D S T", () => {
    expect(navalLetter("battleship")).toBe("B");
    expect(navalLetter("cruiser")).toBe("C");
    expect(navalLetter("carrier")).toBe("A");
    expect(navalLetter("destroyer")).toBe("D");
    expect(navalLetter("submarine")).toBe("S");
    expect(navalLetter("transport")).toBe("T");
    expect(CARGO_DOT.x).toBeLessThan(0);
    expect(CARGO_DOT.y).toBeLessThan(0);
  });
});

describe("neutral hatch", () => {
  it("covers a box with 45-degree lines", () => {
    const lines = hatchSegments({ x: 0, y: 0, w: 10, h: 10 }, 5);
    expect(lines.length).toBeGreaterThan(1);
    for (const [x1, y1, x2, y2] of lines) {
      expect(x2 - x1).toBeCloseTo(y1 - y2, 9);
    }
  });

  it("hatches unowned and Neutral land, never a faction's", () => {
    expect(isHatchedOwner("")).toBe(true);
    expect(isHatchedOwner("Neutral")).toBe(true);
    expect(isHatchedOwner("ussr")).toBe(false);
    expect(isHatchedOwner("GER")).toBe(false);
  });
});

describe("sample garrison", () => {
  it("puts six distinct land types, or six ship types, on a territory", () => {
    expect(SAMPLE_LAND_GARRISON).toHaveLength(6);
    expect(new Set(SAMPLE_LAND_GARRISON.map((u) => u.unit_type_id)).size).toBe(6);
    expect(SAMPLE_SEA_GARRISON).toHaveLength(6);
    expect(new Set(SAMPLE_SEA_GARRISON.map((u) => u.unit_type_id)).size).toBe(6);
    const land = sampleGarrison(false, "ussr");
    expect(land.every((u) => u.faction_id === "ussr")).toBe(true);
    expect(land.map((u) => u.unit_type_id)).toEqual(SAMPLE_LAND_GARRISON.map((u) => u.unit_type_id));
    expect(sampleGarrison(true, "uk").map((u) => u.unit_type_id)).toEqual(SAMPLE_SEA_GARRISON.map((u) => u.unit_type_id));
  });

  it("startingStacks groups the scenario's starting_units by region", () => {
    const map = editorFromMapJson(mapOf(regionJson("R", {})));
    const filled = { ...map, meta: { ...map.meta, starting_units: sampleGarrison(false, "ger").map((u) => ({ ...u, region_id: "R" })) } };
    expect(startingStacks(filled).R).toHaveLength(6);
  });
});

describe("world-space token scale", () => {
  it("is the token's world diameter times the zoom, clamped at the extremes", () => {
    expect(worldTokenPx(1, TOKEN_WORLD)).toBe(TOKEN_WORLD);
    expect(worldTokenPx(2, TOKEN_WORLD)).toBe(40);
    expect(worldTokenPx(0.1, TOKEN_WORLD)).toBe(TOKEN_MIN_PX);
    expect(worldTokenPx(10, TOKEN_WORLD)).toBe(TOKEN_MAX_PX);
  });
});

