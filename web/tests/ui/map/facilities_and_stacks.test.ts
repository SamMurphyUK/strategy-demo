// Facility fields, the anchors, the Tri-Wedge badge, and the three-stage unit layout.
import { describe, expect, it } from "vitest";
import {
  airAnchorOfRegion,
  anchorHandleAt,
  anchorPoints,
  applyMerge,
  editorFromMapJson,
  editorToMapJson,
  facilityAnchorAfterPlace,
  facilityAnchorOfRegion,
  findRegion,
  isUnconfiguredLand,
  moveSlot,
  slotsAfterAdd,
  slotsAfterRemoveLast,
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
  UNIT_SLOT_MAX_LAND,
  UNIT_SLOT_MAX_SEA,
  type Vec2,
} from "../../../src/ui/map/geometry";
import { hatchSegments, isHatchedOwner } from "../../../src/ui/map/hatch";
import { legacyToWorld, projectMapJson, WORLD_COORD_SPACE } from "../../../src/ui/map/map_space";
import { CARGO_DOT, isActiveFaction, navalLetter, pillColors, pillRadius, PILL_OFFSET, tokenDisc, TOKEN_INK, unitSilhouette } from "../../../src/ui/map/tokenStyle";
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
  ARC_RADIUS_RATIO,
  ARC_SATELLITE_MAX,
  arcAngles,
  arcOffset,
  assignStacks,
  canonicalUnit,
  clearOf,
  frontMostIndex,
  LAND_ROSTER,
  layoutRegionVisuals,
  orderStacks,
  plusOffset,
  ROSTER,
  SEA_ROSTER,
  unitDomain,
  unitLabel,
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

  it("reads eight hand-placed land slots and six sea slots, and ignores a malformed pair", () => {
    const pairs = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => [10 + i * 10, 20 + i * 10]);
    const [land] = buildMapGeometry(mapOf(regionJson("L", { unit_slots: [...pairs, [1]] }))).regions;
    expect(land.unitSlots).toEqual(pairs.slice(0, UNIT_SLOT_MAX_LAND).map(([x, y]) => ({ x, y })));
    expect(hasHandPlacedSlots(land)).toBe(true);
    const [sea] = buildMapGeometry(
      mapOf(regionJson("Sea Zone 9", { type: "sea", ipc: 0, unit_slots: [...pairs, [1]] })),
    ).regions;
    expect(sea.type).toBe("sea");
    expect(sea.unitSlots).toEqual(pairs.slice(0, UNIT_SLOT_MAX_SEA).map(([x, y]) => ({ x, y })));
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

  it("a land region has the unit diamond and the facility trapezoid, and no air handle", () => {
    expect(anchorPoints(land())).toEqual([
      { kind: "anchor", at: { x: 50, y: 50 } },
      { kind: "facility", at: { x: 50, y: 66 } },
    ]);
  });

  it("a sea zone has no facility handle", () => {
    expect(anchorPoints(sea()).map((p) => p.kind)).toEqual(["anchor"]);
    expect(anchorHandleAt(sea(), { x: 50, y: 66 }, 2)).toBeNull();
  });

  it("picks the handle under the pointer", () => {
    const r = land();
    expect(anchorHandleAt(r, { x: 50.5, y: 50 }, 3)).toEqual({ kind: "anchor", regionId: "L" });
    expect(anchorHandleAt(r, { x: 50, y: 65 }, 3)).toEqual({ kind: "facility", regionId: "L" });
    expect(anchorHandleAt(r, { x: 64, y: 40 }, 3)).toBeNull();
    expect(anchorHandleAt(r, { x: 0, y: 0 }, 3)).toBeNull();
  });

  it("when handles overlap the nearest wins, and the unit anchor wins a tie", () => {
    const r = updateRegion(editorFromMapJson(mapOf(regionJson("L", {}))), "L", { facility_anchor: [50, 50] });
    const region = findRegion(r, "L")!;
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

  it("adds and removes hand-placed slots as their own lists, and writes them into the map", () => {
    const base = editorFromMapJson(mapOf(regionJson("L", {}, 0, [50, 50])));
    const region = findRegion(base, "L")!;
    expect(slotsAfterAdd(region)).toEqual([[50, 50]]);
    const added = updateRegion(base, "L", { unit_slots: slotsAfterAdd(region)! });
    expect(slotsAfterAdd(findRegion(added, "L")!)).toEqual([
      [50, 50],
      [62, 50],
    ]);
    const file = editorToMapJson(added, { round: false }) as { regions: { metadata: { unit_slots?: [number, number][] } }[] };
    expect(file.regions[0].metadata.unit_slots).toEqual([[50, 50]]);
    expect(slotsAfterRemoveLast(findRegion(added, "L")!)).toBeUndefined();
    const six: [number, number][] = [
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
      [5, 5],
      [6, 6],
    ];
    const landSix = findRegion(updateRegion(base, "L", { unit_slots: six }), "L")!;
    expect(slotsAfterAdd(landSix)).toHaveLength(7);
    const eight: [number, number][] = [...six, [7, 7], [8, 8]];
    expect(slotsAfterAdd(findRegion(updateRegion(base, "L", { unit_slots: eight }), "L")!)).toBeNull();
    const sea = editorFromMapJson(mapOf(regionJson("Sea Zone 1", { type: "sea", ipc: 0 }, 0, [50, 50])));
    expect(slotsAfterAdd(findRegion(updateRegion(sea, "Sea Zone 1", { unit_slots: six }), "Sea Zone 1")!)).toBeNull();
    expect(slotsAfterAdd(findRegion(updateRegion(sea, "Sea Zone 1", { unit_slots: six.slice(0, 5) }), "Sea Zone 1")!)).toHaveLength(6);
  });

  it("keeps the generated slots when adding or removing one", () => {
    const region = findRegion(editorFromMapJson(mapOf(regionJson("L", {}, 0, [50, 50]))), "L")!;
    const generated = [
      { x: 10, y: 20 },
      { x: 30, y: 20 },
      { x: 50, y: 40 },
    ];
    expect(slotsAfterAdd(region, generated)).toEqual([
      [10, 20],
      [30, 20],
      [50, 40],
      [62, 40],
    ]);
    expect(slotsAfterRemoveLast(region, generated)).toEqual([
      [10, 20],
      [30, 20],
    ]);
    const placed = findRegion(updateRegion(editorFromMapJson(mapOf(regionJson("L", {}, 0, [50, 50]))), "L", { unit_slots: [[1, 1]] }), "L")!;
    expect(slotsAfterAdd(placed, generated)).toEqual([
      [1, 1],
      [13, 1],
    ]);
  });

  it("places one facility anchor on land, and none on a sea zone or a region that already has one", () => {
    const land = findRegion(editorFromMapJson(mapOf(regionJson("L", {}, 0, [50, 50]))), "L")!;
    expect(facilityAnchorAfterPlace(land)).toEqual([50, 66]);
    const placed = updateRegion(editorFromMapJson(mapOf(regionJson("L", {}, 0, [50, 50]))), "L", { facility_anchor: [1, 2] });
    expect(facilityAnchorAfterPlace(findRegion(placed, "L")!)).toBeNull();
    const sea = findRegion(editorFromMapJson(mapOf(regionJson("Sea Zone 1", { type: "sea", ipc: 0 }))), "Sea Zone 1")!;
    expect(facilityAnchorAfterPlace(sea)).toBeNull();
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
// One roster, one pool of slots
// ---------------------------------------------------------------

describe("unit domains", () => {
  it("classifies the standard units, aliases included", () => {
    for (const id of ["infantry", "artillery", "tank", "armor", "mech_infantry", "aa", "aaa"]) {
      expect(unitDomain(id)).toBe("land");
    }
    for (const id of ["fighter", "tactical_bomber", "strategic_bomber", "bomber"]) {
      expect(unitDomain(id)).toBe("air");
    }
    for (const id of ["destroyer", "cruiser", "battleship", "carrier", "submarine", "sub", "transport"]) {
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
    expect(unitLabel("tank")).toBe("Armor");
    expect(unitLabel("aa")).toBe("AA");
  });
});

describe("unified roster order", () => {
  it("sorts a land territory as one list, armor first and aa last", () => {
    const ordered = orderStacks(
      ["aa", "fighter", "infantry", "tank", "mech_infantry", "artillery", "strategic_bomber", "tactical_bomber"].map((id) => unit(id)),
      false,
    );
    expect(ordered.map((e) => canonicalUnit(e.unit_type_id))).toEqual([...LAND_ROSTER]);
  });

  it("sorts a sea zone with the carrier first and the transport last", () => {
    const ordered = orderStacks(
      ["transport", "tactical_bomber", "fighter", "submarine", "destroyer", "cruiser", "battleship", "carrier"].map((id) => unit(id)),
      true,
    );
    expect(ordered.map((e) => canonicalUnit(e.unit_type_id))).toEqual([...SEA_ROSTER]);
  });

  it("drops an empty stack and keeps two factions of one type", () => {
    expect(orderStacks([unit("infantry", 0)], false)).toEqual([]);
    const both = orderStacks([unit("infantry", 2, "uk"), unit("infantry", 3, "ger")], false);
    expect(both).toHaveLength(2);
    expect(both.map((e) => e.faction_id)).toEqual(["ger", "uk"]);
  });
});

describe("circular arc", () => {
  const d = 20;

  it("folds satellites onto the upper crescent, clear of the count-pill quadrant", () => {
    expect(ARC_RADIUS_RATIO).toBe(0.72);
    expect(ARC_SATELLITE_MAX).toBe(3);
    expect(arcAngles(3)).toEqual([-145, -100, -55]);
    for (const deg of arcAngles(3)) {
      expect(deg).toBeLessThan(0);
      expect(deg >= 20 && deg <= 80).toBe(false);
    }
    const offsets = [0, 1, 2].map((i) => arcOffset(i, 3, d));
    offsets.forEach((off, i) => {
      const rad = (arcAngles(3)[i] * Math.PI) / 180;
      expect(off.x).toBeCloseTo(Math.cos(rad) * 0.72 * d, 6);
      expect(off.y).toBeCloseTo(Math.sin(rad) * 0.72 * d, 6);
      expect(Math.hypot(off.x, off.y)).toBeCloseTo(0.72 * d, 6);
    });
    // Not a straight line: the two steps from the first satellite are not parallel.
    const ab = { x: offsets[1].x - offsets[0].x, y: offsets[1].y - offsets[0].y };
    const ac = { x: offsets[2].x - offsets[0].x, y: offsets[2].y - offsets[0].y };
    expect(Math.abs(ab.x * ac.y - ab.y * ac.x)).toBeGreaterThan(1);
  });

  it("puts one primary on each slot and deals the overflow around them, three deep", () => {
    const stacks = ["tank", "mech_infantry", "artillery", "infantry", "fighter"].map((id) => unit(id));
    const open = assignStacks(stacks.slice(0, 2), 3);
    expect(open.capped).toBe(false);
    expect(open.groups.map((g) => g.map((e) => e.unit_type_id))).toEqual([["tank"], ["mech_infantry"], []]);
    const folded = assignStacks(stacks, 1);
    expect(folded.capped).toBe(true);
    expect(folded.groups[0].map((e) => e.unit_type_id)).toEqual(["tank", "mech_infantry", "artillery", "infantry"]);
  });

  it("puts the [+] up and to the right of the lead token", () => {
    const off = plusOffset(d);
    expect(off.x).toBeGreaterThan(0);
    expect(off.y).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------
// Layout
// ---------------------------------------------------------------

describe("layoutRegionVisuals", () => {
  const view = { x: 0, y: 0, k: 4 };
  const params = (slots: Vec2[] = sixSlots()) => ({ view, tokenPx: 32, badgeSide: 30, slots, tokenWorld: 8 });
  const landRegion = (over: Partial<RegionShape> = {}) =>
    bareShape({
      bounds: { x: 0, y: 0, w: 100, h: 100 },
      anchor: { x: 50, y: 50 },
      ...over,
    });
  /** Back to front, so the last token is the lead. */
  const leadOf = <T extends { entry: StackEntry }>(tokens: T[]): T => tokens[tokens.length - 1];

  it("gives every unit type its own slot when the centres are a diameter apart", () => {
    const slots = [
      { x: 10, y: 20 },
      { x: 30, y: 20 },
      { x: 50, y: 20 },
    ];
    const { tokens, stage, capped, plus } = layoutRegionVisuals(
      landRegion(),
      [unit("infantry", 3), unit("tank", 2), unit("fighter", 1)],
      params(slots),
    );
    expect(stage).toBe("open");
    expect(capped).toBe(false);
    expect(plus).toBeNull();
    // armor (tank), then infantry, then the fighter. Air is not kept back for its own anchor.
    const front = [...tokens].reverse();
    expect(front.map((t) => t.entry.unit_type_id)).toEqual(["tank", "infantry", "fighter"]);
    expect(front.map((t) => [t.x, t.y])).toEqual([
      [40, 80],
      [120, 80],
      [200, 80],
    ]);
    for (let i = 1; i < front.length; i++) {
      const dist = Math.hypot(front[i].x - front[i - 1].x, front[i].y - front[i - 1].y);
      expect(dist).toBeGreaterThanOrEqual(32);
    }
  });

  it("puts a tank on any free slot, including one an aircraft would have used", () => {
    const slots = [
      { x: 10, y: 20 },
      { x: 40, y: 20 },
    ];
    const { tokens, stage } = layoutRegionVisuals(landRegion(), [unit("mech_infantry", 1), unit("tank", 1)], params(slots));
    expect(stage).toBe("open");
    expect([...tokens].reverse().map((t) => t.entry.unit_type_id)).toEqual(["tank", "mech_infantry"]);
  });

  it("puts ships and aircraft in the same slots, carrier first", () => {
    const slots = [
      { x: 10, y: 20 },
      { x: 30, y: 20 },
      { x: 50, y: 20 },
    ];
    const { tokens, stage } = layoutRegionVisuals(
      landRegion({ type: "sea" }),
      [unit("transport", 1), unit("fighter", 1), unit("destroyer", 2)],
      params(slots),
    );
    expect(stage).toBe("open");
    expect([...tokens].reverse().map((t) => canonicalUnit(t.entry.unit_type_id))).toEqual(["destroyer", "fighter", "transport"]);
  });

  it("sits every stack on its slot when there are enough slots, however close those slots are", () => {
    const slots = [
      { x: 10, y: 20 },
      { x: 11, y: 20 },
    ];
    const { tokens, stage, capped, plus } = layoutRegionVisuals(
      landRegion(),
      [unit("infantry", 4), unit("tank", 1)],
      { view: { x: 0, y: 0, k: 1 }, tokenPx: 20, badgeSide: 16, slots },
    );
    expect(stage).toBe("open");
    expect(capped).toBe(false);
    expect(plus).toBeNull();
    const front = [...tokens].reverse();
    expect(front.map((t) => t.entry.unit_type_id)).toEqual(["tank", "infantry"]);
    expect(front.map((t) => [t.x, t.y])).toEqual([
      [10, 20],
      [11, 20],
    ]);
  });

  it("folds the overflow into a circular arc around the primary, not a straight line", () => {
    const diameter = 20;
    const slot = { x: 40, y: 18 };
    const visual = layoutRegionVisuals(landRegion(), [unit("infantry"), unit("artillery"), unit("tank")], {
      view: { x: 0, y: 0, k: 1 },
      tokenPx: diameter,
      badgeSide: 16,
      slots: [slot],
    });
    expect(visual.stage).toBe("arc");
    expect(visual.capped).toBe(false);
    expect(visual.tokens).toHaveLength(3);
    const lead = leadOf(visual.tokens);
    expect(lead.entry.unit_type_id).toBe("tank");
    expect([lead.x, lead.y]).toEqual([slot.x, slot.y]);
    expect(lead.z).toBeGreaterThan(visual.tokens[0].z);
    const sats = visual.tokens.slice(0, -1);
    const angles = arcAngles(sats.length);
    sats.forEach((sat, i) => {
      const off = arcOffset(i, sats.length, diameter);
      expect(sat.x).toBeCloseTo(slot.x + off.x, 6);
      expect(sat.y).toBeCloseTo(slot.y + off.y, 6);
      expect(angles[i]).toBeLessThan(0);
    });
    const ab = { x: sats[1].x - sats[0].x, y: sats[1].y - sats[0].y };
    const ap = { x: lead.x - sats[0].x, y: lead.y - sats[0].y };
    expect(Math.abs(ab.x * ap.y - ab.y * ap.x)).toBeGreaterThan(1);
  });

  it("caps a slot after three satellites and parks the [+] on the primary's upper right", () => {
    const stacks = ["tank", "mech_infantry", "artillery", "infantry", "fighter", "aa"].map((id) => unit(id));
    const slot = { x: 14, y: 14 };
    const visual = layoutRegionVisuals(landRegion({ bounds: { x: 0, y: 0, w: 28, h: 28 } }), stacks, {
      view: { x: 0, y: 0, k: 1 },
      tokenPx: 20,
      badgeSide: 16,
      slots: [slot],
    });
    expect(visual.capped).toBe(true);
    expect(visual.stage).toBe("capped");
    expect(visual.tokens).toHaveLength(1 + ARC_SATELLITE_MAX);
    const lead = leadOf(visual.tokens);
    expect(lead.entry.unit_type_id).toBe("tank");
    expect([lead.x, lead.y]).toEqual([slot.x, slot.y]);
    expect(visual.plus).not.toBeNull();
    expect(visual.plus!.x).toBeGreaterThan(lead.x);
    expect(visual.plus!.y).toBeLessThan(lead.y);
  });

  it("keeps a default badge off the unit tokens", () => {
    const region = landRegion({ factorySize: "major", hasAirbase: true, hasHarbour: true, hasFactory: true });
    const { badge, tokens } = layoutRegionVisuals(region, [unit("infantry", 6), unit("artillery", 4), unit("tank", 2)], params());
    expect(badge).not.toBeNull();
    for (const s of tokens) {
      const overlap = Math.abs(badge!.x - s.x) < badge!.hw + 16 && Math.abs(badge!.y - s.y) < badge!.hh + 16;
      expect(overlap).toBe(false);
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
    const { tokens } = layoutRegionVisuals(withFacilities, [], params());
    expect(tokens).toEqual([]);
  });

  it("puts the combat marker below whatever sits under the unit anchor", () => {
    const region = landRegion({ factorySize: "major", hasFactory: true });
    const v = layoutRegionVisuals(region, [unit("infantry", 6), unit("tank", 2)], params());
    const near = (x: number, hw: number) => Math.abs(x - 200) < hw + 24;
    const bottom = Math.max(
      200,
      ...v.tokens.filter((s) => near(s.x, 16)).map((s) => s.y + 16),
      v.badge && near(v.badge.x, v.badge.hw) ? v.badge.y + v.badge.hh : 200,
    );
    expect(v.markerY).toBeGreaterThanOrEqual(bottom);
  });
});

describe("hit testing a curved arc", () => {
  it("the front token wins a point on the overlap, and a tucked token wins its own centre", () => {
    const visual = layoutRegionVisuals(
      bareShape({ bounds: { x: 0, y: 0, w: 80, h: 36 }, anchor: { x: 40, y: 18 } }),
      [unit("infantry"), unit("artillery"), unit("tank")],
      { view: { x: 0, y: 0, k: 1 }, tokenPx: 20, badgeSide: 16, slots: [{ x: 40, y: 18 }], tokenWorld: 20 },
    );
    const rear = visual.tokens[visual.tokens.length - 2];
    const front = visual.tokens[visual.tokens.length - 1];
    const mid = { x: (rear.x + front.x) / 2, y: (rear.y + front.y) / 2 };
    expect(visual.tokens[frontMostIndex(visual.tokens, mid, 12)].entry.unit_type_id).toBe("tank");
    expect(visual.tokens[frontMostIndex(visual.tokens, rear, 10)].entry.unit_type_id).toBe(rear.entry.unit_type_id);
    expect(frontMostIndex(visual.tokens, { x: -100, y: -100 }, 10)).toBe(-1);
  });
});

describe("the fourteen silhouettes", () => {
  it("draws a distinct white vector for every roster piece", () => {
    expect(ROSTER).toHaveLength(14);
    expect(TOKEN_INK).toBe("#1A1815");
    const prints = ROSTER.map((id) => JSON.stringify(unitSilhouette(id)));
    expect(new Set(prints).size).toBe(14);
    expect(JSON.stringify(unitSilhouette("mech_infantry"))).not.toBe(JSON.stringify(unitSilhouette("infantry")));
    expect(JSON.stringify(unitSilhouette("tactical_bomber"))).not.toBe(JSON.stringify(unitSilhouette("strategic_bomber")));
    expect(JSON.stringify(unitSilhouette("tank"))).toBe(JSON.stringify(unitSilhouette("armor")));
    expect(JSON.stringify(unitSilhouette("submarine"))).toBe(JSON.stringify(unitSilhouette("sub")));
    expect(navalLetter("battleship")).toBe("B");
    expect(navalLetter("carrier")).toBe("A");
    expect(navalLetter("cruiser")).toBe("C");
    expect(navalLetter("destroyer")).toBe("D");
    expect(navalLetter("sub")).toBe("S");
    expect(navalLetter("submarine")).toBe("S");
    expect(navalLetter("transport")).toBe("T");
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
  it("puts the land roster and the sea roster on a territory", () => {
    expect(SAMPLE_LAND_GARRISON).toHaveLength(8);
    expect(new Set(SAMPLE_LAND_GARRISON.map((u) => u.unit_type_id)).size).toBe(8);
    expect(SAMPLE_SEA_GARRISON).toHaveLength(8);
    expect(new Set(SAMPLE_SEA_GARRISON.map((u) => u.unit_type_id)).size).toBe(8);
    const land = sampleGarrison(false, "ussr");
    expect(land.every((u) => u.faction_id === "ussr")).toBe(true);
    expect(land.map((u) => u.unit_type_id)).toEqual(SAMPLE_LAND_GARRISON.map((u) => u.unit_type_id));
    expect(sampleGarrison(true, "uk").map((u) => u.unit_type_id)).toEqual(SAMPLE_SEA_GARRISON.map((u) => u.unit_type_id));
  });

  it("startingStacks groups the scenario's starting_units by region", () => {
    const map = editorFromMapJson(mapOf(regionJson("R", {})));
    const filled = { ...map, meta: { ...map.meta, starting_units: sampleGarrison(false, "ger").map((u) => ({ ...u, region_id: "R" })) } };
    expect(startingStacks(filled).R).toHaveLength(8);
  });
});

describe("world-space token scale", () => {
  it("is half the old diameter, and the count pill stays a small share of that", () => {
    expect(PILL_OFFSET).toBeCloseTo(0.36);
    expect(pillRadius(16)).toBeCloseTo(0.27 * 16);
    expect(pillRadius(1)).toBe(3.25);
    expect(TOKEN_WORLD).toBe(10);
    expect(worldTokenPx(1, TOKEN_WORLD)).toBe(TOKEN_WORLD);
    expect(worldTokenPx(2, TOKEN_WORLD)).toBe(20);
    expect(worldTokenPx(0.1, TOKEN_WORLD)).toBe(TOKEN_MIN_PX);
    expect(worldTokenPx(10, TOKEN_WORLD)).toBe(TOKEN_MAX_PX);
    expect(TOKEN_MIN_PX).toBe(4);
    expect(TOKEN_MAX_PX).toBe(32);
  });
});

