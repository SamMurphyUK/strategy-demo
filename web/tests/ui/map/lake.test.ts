import { describe, expect, it } from "vitest";
import polygonClipping from "polygon-clipping";
import { GameState, Region } from "../../../src/engine";
import { loadMap } from "../../../src/engine/session/session_loaders";
import { MovementValidator } from "../../../src/engine/movement/movement_validator";
import { buildMapData, territoryIncome } from "../../../src/content/game_scene_session_builder";
import { autoNeighborPairs } from "../../../src/ui/map/editor/adjacency";
import { blankEditorMap } from "../../../src/ui/map/editor/blankMap";
import { applyAutoLinks, editorToMapJson, type EditorMap, type EditorRegion } from "../../../src/ui/map/editor/editorModel";
import { turnRegionToLake } from "../../../src/ui/map/editor/lake";
import { landmassToSvg } from "../../../src/ui/map/editor/landmass";
import { clipperFor, landFromPathData, multiPolygonArea, pointInMultiPolygon, type MultiPolygon, type Ring } from "../../../src/ui/map/regionClip";
import type { Vec2 } from "../../../src/ui/map/geometry";

function square(x0: number, y0: number, x1: number, y1: number): Vec2[] {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

function ring(x0: number, y0: number, x1: number, y1: number): Ring {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0],
  ];
}

function landRegion(id: string, polygon: Vec2[], at: Vec2, extra: Partial<EditorRegion> = {}): EditorRegion {
  return {
    id,
    name: id,
    ipc_value: 3,
    starting_owner: "USSR",
    is_sea: false,
    factory: "minor",
    capital: true,
    polygon,
    cx: at.x,
    cy: at.y,
    land_cover: "FOREST",
    has_airbase: true,
    has_harbour: true,
    ...extra,
  };
}

function seaFrom(id: string, mp: MultiPolygon): EditorRegion {
  const poly = mp[0];
  const outer = poly[0].slice(0, -1).map(([x, y]) => ({ x, y }));
  const holes = poly.slice(1).map((item) => item.slice(0, -1).map(([x, y]) => ({ x, y })));
  return {
    id,
    name: id,
    ipc_value: 0,
    starting_owner: "Neutral",
    is_sea: true,
    factory: "none",
    capital: false,
    polygon: outer,
    ...(holes.length > 0 ? { holes } : {}),
    cx: 4,
    cy: 4,
  };
}

function linked(map: EditorMap, land: MultiPolygon): EditorMap {
  const pairs = autoNeighborPairs(
    map.regions.map((region) => ({
      id: region.id,
      polygon: region.polygon,
      extra: region.extra,
      holes: region.holes,
      is_sea: region.is_sea,
    })),
    (x, y) => pointInMultiPolygon({ x, y }, land),
  );
  return applyAutoLinks(map, pairs);
}

function boot(map: EditorMap): GameState {
  const state = new GameState();
  loadMap(state, buildMapData(editorToMapJson(map, { round: false })));
  return state;
}

describe("turn region to lake", () => {
  it("bakes a sealed lake as its own sea zone and keeps ships out of the ocean", () => {
    const continent = square(20, 20, 180, 180);
    const lake = square(80, 80, 120, 120);
    const coast: MultiPolygon = [[ring(20, 20, 180, 180)]];
    const ocean = polygonClipping.difference([[ring(0, 0, 200, 200)]], coast);
    const map: EditorMap = {
      ...blankEditorMap(200, 200),
      regions: [
        landRegion("Kazakh", continent, { x: 100, y: 100 }, { land_cover: undefined, factory: "none", capital: false, ipc_value: 2 }),
        landRegion("Caspian", lake, { x: 100, y: 100 }),
        seaFrom("Sea Zone 01", ocean),
      ],
      meta: {
        ...blankEditorMap(200, 200).meta,
        starting_units: [{ region_id: "Caspian", faction_id: "ussr", unit_type_id: "infantry", count: 2 }],
      },
    };

    const turned = turnRegionToLake(map, "Caspian", coast);
    expect(turned.ok).toBe(true);
    if (!turned.ok || !turned.land) {
      return;
    }

    const caspian = turned.map.regions.find((region) => region.id === "Caspian");
    const kazakh = turned.map.regions.find((region) => region.id === "Kazakh");
    expect(caspian).toMatchObject({ is_sea: true, ipc_value: 0, factory: "none", capital: false });
    expect(caspian).not.toHaveProperty("land_cover");
    expect(caspian).not.toHaveProperty("has_airbase");
    expect(caspian).not.toHaveProperty("has_harbour");
    expect(kazakh?.holes?.length).toBeGreaterThan(0);
    expect(pointInMultiPolygon({ x: 100, y: 100 }, turned.land)).toBe(false);
    expect(pointInMultiPolygon({ x: 40, y: 40 }, turned.land)).toBe(true);
    const baked = landmassToSvg(turned.land, { x: 0, y: 0, w: 200, h: 200 });
    const path = baked.match(/d="([^"]+)"/)?.[1] ?? "";
    const reread = landFromPathData([path], "evenodd");
    expect(pointInMultiPolygon({ x: 100, y: 100 }, reread)).toBe(false);
    expect(pointInMultiPolygon({ x: 40, y: 40 }, reread)).toBe(true);
    expect(kazakh && pointInPolygonOn(kazakh, 100, 100)).toBe(false);

    const clipper = clipperFor(turned.land);
    const water = clipper.clip({ id: "Caspian", type: "sea", points: caspian!.polygon });
    const shore = clipper.clip({
      id: "Kazakh",
      type: "land",
      points: kazakh!.polygon,
      holes: kazakh!.holes,
    });
    expect(multiPolygonArea(water)).toBeGreaterThan(1500);
    expect(pointInMultiPolygon({ x: 100, y: 100 }, water)).toBe(true);
    expect(pointInMultiPolygon({ x: 100, y: 100 }, shore)).toBe(false);
    expect(pointInMultiPolygon({ x: 40, y: 40 }, shore)).toBe(true);

    const ready = linked(turned.map, turned.land);
    const json = editorToMapJson(ready, { round: false });
    const data = buildMapData(json);
    const played = (data.regions as { id: string; type: string; ipc_value: number; land_cover?: string }[]).find(
      (region) => region.id === "Caspian",
    );
    expect(played).toMatchObject({ type: "sea", ipc_value: 0 });
    expect(played).not.toHaveProperty("land_cover");
    expect(territoryIncome(json).ussr ?? 0).toBe(2);

    const edges = data.adjacency as { from: string; to: string }[];
    const touches = (a: string, b: string) =>
      edges.some((edge) => (edge.from === a && edge.to === b) || (edge.from === b && edge.to === a));
    expect(touches("Caspian", "Kazakh")).toBe(true);
    expect(touches("Caspian", "Sea Zone 01")).toBe(false);

    const state = boot(ready);
    expect(state.regions.Caspian.isSeaRegion()).toBe(true);
    const moves = new MovementValidator();
    expect(moves.floodFill("Kazakh", 1, state, false, "ussr", false, "infantry")).not.toContain("Caspian");
    expect(moves.floodFill("Caspian", 2, state, true, "ussr", false, "destroyer")).not.toContain("Sea Zone 01");
    expect(moves.floodFill("Sea Zone 01", 2, state, true, "ussr", false, "destroyer")).not.toContain("Caspian");
  });

  it("leaves a lake cut from open water joined to that ocean", () => {
    const island: MultiPolygon = [[ring(10, 10, 60, 60)]];
    const ocean = polygonClipping.difference([[ring(0, 0, 200, 200)]], island);
    const map: EditorMap = {
      ...blankEditorMap(200, 200),
      regions: [
        landRegion("Island", square(10, 10, 60, 60), { x: 30, y: 30 }, { ipc_value: 1, factory: "none", capital: false }),
        landRegion("Basin", square(100, 100, 140, 140), { x: 120, y: 120 }, { ipc_value: 0, factory: "none", capital: false }),
        seaFrom("Ocean", ocean),
      ],
    };
    const turned = turnRegionToLake(map, "Basin", island);
    expect(turned.ok).toBe(true);
    if (!turned.ok) {
      return;
    }
    expect(turned.land).toBeNull();
    const ready = linked(turned.map, island);
    const edges = buildMapData(editorToMapJson(ready, { round: false })).adjacency as { from: string; to: string }[];
    const touches = (a: string, b: string) =>
      edges.some((edge) => (edge.from === a && edge.to === b) || (edge.from === b && edge.to === a));
    expect(touches("Basin", "Ocean")).toBe(true);
    expect(touches("Basin", "Island")).toBe(false);
  });
});

function pointInPolygonOn(region: EditorRegion, x: number, y: number): boolean {
  const outer: MultiPolygon = [[region.polygon.map((p) => [p.x, p.y] as [number, number])]];
  if (!pointInMultiPolygon({ x, y }, outer)) {
    return false;
  }
  return !(region.holes ?? []).some((hole) =>
    pointInMultiPolygon({ x, y }, [[hole.map((p) => [p.x, p.y] as [number, number])]]),
  );
}
