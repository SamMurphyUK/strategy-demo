// A very rough mid-1940 board cut from the cleaned coastlines. Boxes are mercator cells on the
// land SVG (lon 61.4° sits on x = 400). The first cell that covers a piece of land keeps it.
import polygonClipping from "polygon-clipping";
import type { Dict } from "../../../engine/model/types";
import type { Vec2 } from "../geometry";
import type { MultiPolygon, Pair, Ring } from "../regionClip";
import { ringArea } from "../regionClip";
import { autoNeighborPairs } from "./adjacency";
import {
  applyAutoLinks,
  editorFromMapJson,
  editorToMapJson,
  type EditorMap,
  type EditorRegion,
  type FactoryLevel,
  labelPoint,
  setStartingUnits,
} from "./editorModel";

const LON0 = 61.4;
const PX = 2.556;
const OX = 400;
const OY = 351;
const RAD = (PX * 180) / Math.PI;

const MIN_REGION = 15;
const MIN_SEA = 350;
/** Leftover specks smaller than this join the nearest territory. */
const SPECK = 220;

type Faction = "GER" | "USSR" | "UK" | "USA" | "JAP" | "Neutral";

interface Cell {
  name: string;
  faction: Faction;
  ipc: number;
  capital?: boolean;
  factory?: FactoryLevel;
  lon0: number;
  lon1: number;
  lat0: number;
  lat1: number;
}

interface Troop {
  unit_type_id: string;
  count: number;
}

const LAND: Cell[] = [
  { name: "Britain", faction: "UK", ipc: 8, capital: true, factory: "major", lon0: -12, lon1: 2, lat0: 49.5, lat1: 61 },
  { name: "Japan", faction: "JAP", ipc: 8, capital: true, factory: "major", lon0: 129, lon1: 146, lat0: 30, lat1: 46 },
  { name: "Germany", faction: "GER", ipc: 10, capital: true, factory: "major", lon0: 6, lon1: 15, lat0: 47.2, lat1: 55 },
  { name: "Eastern United States", faction: "USA", ipc: 10, capital: true, factory: "major", lon0: -92, lon1: -67, lat0: 29, lat1: 46 },
  { name: "Moscow", faction: "USSR", ipc: 8, capital: true, factory: "major", lon0: 32, lon1: 58, lat0: 51, lat1: 62 },
  { name: "Iberia", faction: "Neutral", ipc: 2, lon0: -11, lon1: 3, lat0: 36, lat1: 44 },
  { name: "France", faction: "GER", ipc: 4, factory: "minor", lon0: -5, lon1: 8, lat0: 43.5, lat1: 51 },
  { name: "Italy", faction: "GER", ipc: 3, factory: "minor", lon0: 7, lon1: 19, lat0: 36, lat1: 47 },
  { name: "Balkans", faction: "GER", ipc: 2, lon0: 19, lon1: 29, lat0: 38, lat1: 46 },
  { name: "Turkey", faction: "Neutral", ipc: 2, lon0: 26, lon1: 45, lat0: 36, lat1: 42.5 },
  { name: "Scandinavia", faction: "GER", ipc: 2, lon0: 4, lon1: 32, lat0: 55, lat1: 72 },
  { name: "Eastern Europe", faction: "GER", ipc: 3, lon0: 15, lon1: 32, lat0: 46, lat1: 56 },
  { name: "Karelia", faction: "USSR", ipc: 2, lon0: 26, lon1: 50, lat0: 62, lat1: 70 },
  { name: "Caucasus", faction: "USSR", ipc: 3, factory: "minor", lon0: 38, lon1: 55, lat0: 40, lat1: 50 },
  { name: "Egypt", faction: "UK", ipc: 2, lon0: 24, lon1: 36, lat0: 22, lat1: 32 },
  { name: "North Africa", faction: "GER", ipc: 2, lon0: -6, lon1: 24, lat0: 20, lat1: 36 },
  { name: "India", faction: "UK", ipc: 5, factory: "minor", lon0: 68, lon1: 92, lat0: 6, lat1: 40 },
  { name: "Manchuria", faction: "JAP", ipc: 3, lon0: 118, lon1: 140, lat0: 40, lat1: 53 },
  { name: "Korea", faction: "JAP", ipc: 2, lon0: 124, lon1: 130, lat0: 34, lat1: 42 },
  { name: "China", faction: "JAP", ipc: 3, lon0: 100, lon1: 122, lat0: 20, lat1: 40 },
  { name: "Southeast Asia", faction: "UK", ipc: 2, lon0: 92, lon1: 109, lat0: 0, lat1: 22 },
  { name: "Philippines", faction: "USA", ipc: 2, lon0: 119, lon1: 128, lat0: 5, lat1: 19 },
  { name: "East Indies", faction: "UK", ipc: 3, lon0: 95, lon1: 141, lat0: -11, lat1: 8 },
  { name: "Australia", faction: "UK", ipc: 3, lon0: 112, lon1: 150, lat0: -40, lat1: -11 },
  { name: "New Zealand", faction: "UK", ipc: 1, lon0: 150, lon1: 190, lat0: -48, lat1: -33 },
  { name: "Middle East", faction: "UK", ipc: 2, lon0: 36, lon1: 56, lat0: 28, lat1: 38 },
  { name: "Arabia", faction: "UK", ipc: 1, lon0: 35, lon1: 60, lat0: 12, lat1: 28 },
  { name: "West Africa", faction: "UK", ipc: 1, lon0: -18, lon1: 16, lat0: 4, lat1: 20 },
  { name: "Congo", faction: "UK", ipc: 1, lon0: 10, lon1: 32, lat0: -10, lat1: 6 },
  { name: "East Africa", faction: "UK", ipc: 1, lon0: 22, lon1: 50, lat0: -22, lat1: 18 },
  { name: "South Africa", faction: "UK", ipc: 2, lon0: 14, lon1: 34, lat0: -35, lat1: -18 },
  { name: "Madagascar", faction: "UK", ipc: 1, lon0: 43, lon1: 51, lat0: -26, lat1: -12 },
  { name: "Caribbean", faction: "USA", ipc: 1, lon0: -88, lon1: -60, lat0: 10, lat1: 27 },
  { name: "Mexico", faction: "USA", ipc: 2, lon0: -96, lon1: -86, lat0: 15, lat1: 30 },
  { name: "Brazil", faction: "Neutral", ipc: 2, lon0: -74, lon1: -34, lat0: -36, lat1: 8 },
  { name: "Southern South America", faction: "Neutral", ipc: 1, lon0: -76, lon1: -52, lat0: -56, lat1: -22 },
  { name: "Greenland", faction: "UK", ipc: 1, lon0: -75, lon1: 2, lat0: 63, lat1: 84 },
  { name: "Canada", faction: "UK", ipc: 3, lon0: -96, lon1: -45, lat0: 42, lat1: 70 },
  { name: "Alaska", faction: "USA", ipc: 1, lon0: 160, lon1: 235, lat0: 42, lat1: 72 },
  { name: "Central Asia", faction: "USSR", ipc: 1, lon0: 50, lon1: 90, lat0: 36, lat1: 50 },
  { name: "Mongolia", faction: "USSR", ipc: 1, lon0: 88, lon1: 120, lat0: 40, lat1: 52 },
  { name: "Siberia", faction: "USSR", ipc: 2, lon0: 60, lon1: 165, lat0: 50, lat1: 75 },
];

const SEAS: Cell[] = [
  { name: "Baltic Sea", faction: "GER", ipc: 0, lon0: 9, lon1: 24, lat0: 53, lat1: 66 },
  { name: "North Sea", faction: "UK", ipc: 0, lon0: -4, lon1: 8, lat0: 51, lat1: 61 },
  { name: "North Atlantic", faction: "UK", ipc: 0, lon0: -55, lon1: -8, lat0: 35, lat1: 62 },
  { name: "Mediterranean Sea", faction: "UK", ipc: 0, lon0: -6, lon1: 36, lat0: 30, lat1: 42 },
  { name: "Indian Ocean", faction: "UK", ipc: 0, lon0: 45, lon1: 100, lat0: -25, lat1: 22 },
  { name: "Western Pacific", faction: "JAP", ipc: 0, lon0: 120, lon1: 160, lat0: 8, lat1: 42 },
  { name: "North Pacific", faction: "USA", ipc: 0, lon0: 165, lon1: 230, lat0: 28, lat1: 55 },
];

const LAND_TROOPS: Record<string, Troop[]> = {
  Germany: [
    { unit_type_id: "infantry", count: 6 },
    { unit_type_id: "artillery", count: 2 },
    { unit_type_id: "tank", count: 3 },
    { unit_type_id: "fighter", count: 2 },
    { unit_type_id: "tactical_bomber", count: 1 },
  ],
  France: [
    { unit_type_id: "infantry", count: 3 },
    { unit_type_id: "tank", count: 1 },
    { unit_type_id: "fighter", count: 1 },
  ],
  "Eastern Europe": [
    { unit_type_id: "infantry", count: 4 },
    { unit_type_id: "artillery", count: 1 },
    { unit_type_id: "tank", count: 2 },
  ],
  Italy: [
    { unit_type_id: "infantry", count: 3 },
    { unit_type_id: "tank", count: 1 },
  ],
  Balkans: [{ unit_type_id: "infantry", count: 2 }],
  Scandinavia: [{ unit_type_id: "infantry", count: 2 }],
  "North Africa": [
    { unit_type_id: "infantry", count: 2 },
    { unit_type_id: "tank", count: 1 },
  ],
  Moscow: [
    { unit_type_id: "infantry", count: 8 },
    { unit_type_id: "artillery", count: 2 },
    { unit_type_id: "tank", count: 2 },
    { unit_type_id: "fighter", count: 2 },
  ],
  Karelia: [
    { unit_type_id: "infantry", count: 3 },
    { unit_type_id: "fighter", count: 1 },
  ],
  Caucasus: [
    { unit_type_id: "infantry", count: 4 },
    { unit_type_id: "tank", count: 1 },
  ],
  Siberia: [{ unit_type_id: "infantry", count: 2 }],
  "Central Asia": [{ unit_type_id: "infantry", count: 1 }],
  Britain: [
    { unit_type_id: "infantry", count: 4 },
    { unit_type_id: "artillery", count: 1 },
    { unit_type_id: "fighter", count: 3 },
    { unit_type_id: "aa", count: 1 },
  ],
  Canada: [{ unit_type_id: "infantry", count: 2 }],
  Egypt: [
    { unit_type_id: "infantry", count: 3 },
    { unit_type_id: "tank", count: 1 },
    { unit_type_id: "fighter", count: 1 },
  ],
  India: [
    { unit_type_id: "infantry", count: 3 },
    { unit_type_id: "artillery", count: 1 },
  ],
  "Middle East": [{ unit_type_id: "infantry", count: 2 }],
  Australia: [{ unit_type_id: "infantry", count: 2 }],
  "South Africa": [{ unit_type_id: "infantry", count: 1 }],
  "East Indies": [{ unit_type_id: "infantry", count: 1 }],
  "Southeast Asia": [{ unit_type_id: "infantry", count: 1 }],
  "Eastern United States": [
    { unit_type_id: "infantry", count: 3 },
    { unit_type_id: "artillery", count: 1 },
    { unit_type_id: "tank", count: 1 },
    { unit_type_id: "fighter", count: 1 },
  ],
  Philippines: [{ unit_type_id: "infantry", count: 2 }],
  Alaska: [{ unit_type_id: "infantry", count: 1 }],
  Japan: [
    { unit_type_id: "infantry", count: 4 },
    { unit_type_id: "artillery", count: 1 },
    { unit_type_id: "fighter", count: 2 },
    { unit_type_id: "tank", count: 1 },
  ],
  Manchuria: [
    { unit_type_id: "infantry", count: 4 },
    { unit_type_id: "artillery", count: 1 },
  ],
  China: [{ unit_type_id: "infantry", count: 3 }],
  Korea: [{ unit_type_id: "infantry", count: 2 }],
};

const SEA_TROOPS: Record<string, Troop[]> = {
  "Baltic Sea": [
    { unit_type_id: "cruiser", count: 1 },
    { unit_type_id: "submarine", count: 2 },
  ],
  "North Sea": [
    { unit_type_id: "battleship", count: 1 },
    { unit_type_id: "carrier", count: 1 },
    { unit_type_id: "destroyer", count: 2 },
    { unit_type_id: "cruiser", count: 1 },
    { unit_type_id: "transport", count: 1 },
    { unit_type_id: "fighter", count: 1 },
  ],
  "North Atlantic": [
    { unit_type_id: "destroyer", count: 1 },
    { unit_type_id: "transport", count: 1 },
  ],
  "Mediterranean Sea": [
    { unit_type_id: "cruiser", count: 1 },
    { unit_type_id: "destroyer", count: 1 },
  ],
  "Indian Ocean": [
    { unit_type_id: "cruiser", count: 1 },
    { unit_type_id: "destroyer", count: 1 },
    { unit_type_id: "transport", count: 1 },
  ],
  "Western Pacific": [
    { unit_type_id: "carrier", count: 1 },
    { unit_type_id: "battleship", count: 1 },
    { unit_type_id: "cruiser", count: 1 },
    { unit_type_id: "destroyer", count: 2 },
    { unit_type_id: "submarine", count: 1 },
    { unit_type_id: "transport", count: 1 },
    { unit_type_id: "fighter", count: 1 },
  ],
  "North Pacific": [
    { unit_type_id: "battleship", count: 1 },
    { unit_type_id: "carrier", count: 1 },
    { unit_type_id: "destroyer", count: 1 },
    { unit_type_id: "submarine", count: 1 },
  ],
};

const FACTION_UNIT: Record<Faction, string> = {
  GER: "ger",
  USSR: "ussr",
  UK: "uk",
  USA: "usa",
  JAP: "jap",
  Neutral: "neutral",
};

function toPair(lon: number, lat: number): Pair {
  const phi = (lat * Math.PI) / 180;
  const merc = Math.log(Math.tan(Math.PI / 4 + phi / 2));
  return [OX + (lon - LON0) * PX, OY - RAD * merc];
}

function cellRing(cell: Cell): Ring {
  const steps = 4;
  const pts: Pair[] = [];
  const push = (lon: number, lat: number) => {
    const p = toPair(lon, lat);
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) > 1e-4) {
      pts.push(p);
    }
  };
  for (let i = 0; i <= steps; i++) {
    push(cell.lon0 + ((cell.lon1 - cell.lon0) * i) / steps, cell.lat0);
  }
  for (let i = 1; i <= steps; i++) {
    push(cell.lon1, cell.lat0 + ((cell.lat1 - cell.lat0) * i) / steps);
  }
  for (let i = 1; i <= steps; i++) {
    push(cell.lon1 - ((cell.lon1 - cell.lon0) * i) / steps, cell.lat1);
  }
  for (let i = 1; i < steps; i++) {
    push(cell.lon0, cell.lat1 - ((cell.lat1 - cell.lat0) * i) / steps);
  }
  return pts;
}

function fromRing(ring: Ring): Vec2[] {
  const out: Vec2[] = [];
  for (const [x, y] of ring) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(last.x - x, last.y - y) > 1e-6) {
      out.push({ x, y });
    }
  }
  if (out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) <= 1e-6) {
    out.pop();
  }
  return out;
}

function areaOf(ring: Vec2[]): number {
  return ringArea(ring.map((p) => [p.x, p.y]));
}

function outers(mp: MultiPolygon, minArea: number): Vec2[][] {
  const rings: Vec2[][] = [];
  for (const poly of mp) {
    if (!poly[0] || poly[0].length < 4) {
      continue;
    }
    const ring = fromRing(poly[0]);
    if (ring.length >= 3 && areaOf(ring) >= minArea) {
      rings.push(ring);
    }
  }
  rings.sort((a, b) => areaOf(b) - areaOf(a));
  return rings;
}

function asMulti(rings: Vec2[][]): MultiPolygon {
  return rings.filter((r) => r.length >= 3).map((r) => [r.map((p): Pair => [p.x, p.y])]);
}

function safeIntersect(subject: MultiPolygon, box: Ring): MultiPolygon {
  try {
    return polygonClipping.intersection(subject, [box]);
  } catch {
    return [];
  }
}

function safeDifference(subject: MultiPolygon, clip: MultiPolygon): MultiPolygon {
  if (clip.length === 0) {
    return subject;
  }
  try {
    return polygonClipping.difference(subject, clip);
  } catch {
    return subject;
  }
}

function safeUnion(a: MultiPolygon, b: MultiPolygon): MultiPolygon {
  if (a.length === 0) {
    return b;
  }
  if (b.length === 0) {
    return a;
  }
  try {
    return polygonClipping.union(a, b);
  } catch {
    return a;
  }
}

interface Draft {
  name: string;
  faction: Faction;
  ipc: number;
  capital: boolean;
  factory: FactoryLevel;
  sea: boolean;
  rings: Vec2[][];
}

function draftFrom(cell: Cell, rings: Vec2[][], sea: boolean): Draft {
  return {
    name: cell.name,
    faction: cell.faction,
    ipc: sea ? 0 : cell.ipc,
    capital: !sea && cell.capital === true,
    factory: sea ? "none" : (cell.factory ?? "none"),
    sea,
    rings,
  };
}

function claimCells(land: MultiPolygon, cells: Cell[], sea: boolean, minArea: number): { drafts: Draft[]; claimed: MultiPolygon } {
  let claimed: MultiPolygon = [];
  const drafts: Draft[] = [];
  for (const cell of cells) {
    const hit = safeDifference(safeIntersect(land, cellRing(cell)), claimed);
    const rings = outers(hit, minArea);
    if (rings.length === 0) {
      continue;
    }
    drafts.push(draftFrom(cell, rings, sea));
    claimed = safeUnion(claimed, asMulti(rings));
  }
  return { drafts, claimed };
}

function centroid(ring: Vec2[]): Vec2 {
  const at = labelPoint(ring);
  return at;
}

function nearest(speck: Vec2[], drafts: Draft[], maxDist: number): Draft | null {
  const c = centroid(speck);
  let best: Draft | null = null;
  let bestD = maxDist;
  for (const draft of drafts) {
    for (const ring of draft.rings) {
      const d = Math.hypot(centroid(ring).x - c.x, centroid(ring).y - c.y);
      if (d < bestD) {
        bestD = d;
        best = draft;
      }
    }
  }
  return best;
}

function fallbackFor(ring: Vec2[]): { name: string; faction: Faction } {
  const c = centroid(ring);
  const lon = LON0 + (c.x - OX) / PX;
  const merc = (OY - c.y) / RAD;
  const lat = ((2 * Math.atan(Math.exp(merc)) - Math.PI / 2) * 180) / Math.PI;
  if (lat > 60 && lon < -20) {
    return { name: "Arctic", faction: "UK" };
  }
  if (lon > 160 || c.x > 680) {
    return { name: "Far Pacific", faction: "USA" };
  }
  if (lat < -30 && lon > 100) {
    return { name: "Southern Islands", faction: "UK" };
  }
  if (lon < -30 && lat < 15) {
    return { name: "Latin America", faction: "Neutral" };
  }
  if (lat > 15 && lat < 45 && lon > 25 && lon < 65) {
    return { name: "Sahara", faction: "Neutral" };
  }
  return { name: "Open Land", faction: "Neutral" };
}

function absorbLeftovers(land: MultiPolygon, claimed: MultiPolygon, drafts: Draft[]): Draft[] {
  const left = outers(safeDifference(land, claimed), 8);
  const extra: Draft[] = [];
  const used = new Map<string, number>();
  for (const ring of left) {
    const size = areaOf(ring);
    const host = nearest(ring, drafts, size < 2000 ? 280 : 140);
    if (host) {
      host.rings.push(ring);
      continue;
    }
    if (size < MIN_REGION) {
      continue;
    }
    const place = fallbackFor(ring);
    const n = (used.get(place.name) ?? 0) + 1;
    used.set(place.name, n);
    extra.push({
      name: n === 1 ? place.name : `${place.name} ${n}`,
      faction: place.faction,
      ipc: 1,
      capital: false,
      factory: "none",
      sea: false,
      rings: [ring],
    });
  }
  return extra;
}

function toRegion(draft: Draft): EditorRegion {
  const rings = [...draft.rings].sort((a, b) => areaOf(b) - areaOf(a));
  const polygon = rings[0];
  const at = labelPoint(polygon);
  const extra = rings.slice(1);
  return {
    id: draft.name,
    name: draft.name,
    ipc_value: draft.sea ? 0 : Math.max(1, draft.ipc),
    starting_owner: draft.faction,
    is_sea: draft.sea,
    factory: draft.factory,
    capital: draft.capital,
    polygon,
    ...(extra.length > 0 ? { extra } : {}),
    cx: at.x,
    cy: at.y,
  };
}

function ensureCapitals(regions: EditorRegion[]): void {
  for (const faction of ["GER", "USSR", "UK", "USA", "JAP"] as const) {
    const owned = regions.filter((r) => !r.is_sea && r.starting_owner === faction);
    const marked = owned.filter((r) => r.capital);
    if (marked.length > 1) {
      const keep = marked[0];
      for (const region of marked) {
        if (region !== keep) {
          region.capital = false;
        }
      }
    }
    if (marked.length === 0 && owned.length > 0) {
      const best = [...owned].sort((a, b) => areaOf(b.polygon) - areaOf(a.polygon))[0];
      best.capital = true;
      best.factory = "major";
    }
  }
}

function garrison(map: EditorMap, regions: EditorRegion[], table: Record<string, Troop[]>, sea: boolean): EditorMap {
  let next = map;
  for (const region of regions) {
    if (region.is_sea !== sea) {
      continue;
    }
    const rows = table[region.name];
    if (!rows) {
      continue;
    }
    const faction = FACTION_UNIT[region.starting_owner as Faction] ?? "neutral";
    next = setStartingUnits(
      next,
      region.id,
      rows.map((row) => ({ faction_id: faction, ...row })),
    );
  }
  return next;
}

/** Cuts `source` (a cleaned editor map in world space) into a rough 1940 scenario. */
export function populateWorldMap(source: Dict): Dict {
  const cleaned = editorFromMapJson(source);
  const landRings: Vec2[][] = [];
  const seaRings: Vec2[][] = [];
  for (const region of cleaned.regions) {
    const rings = [region.polygon, ...(region.extra ?? [])].filter((r) => r.length >= 3);
    (region.is_sea ? seaRings : landRings).push(...rings);
  }
  const land = asMulti(landRings);
  const sea = asMulti(seaRings);
  const landClaim = claimCells(land, LAND, false, MIN_REGION);
  const leftovers = absorbLeftovers(land, landClaim.claimed, landClaim.drafts);
  const seaClaim = claimCells(sea, SEAS, true, MIN_SEA);
  const openSea = outers(safeDifference(sea, seaClaim.claimed), 800);
  const seaDrafts = [...seaClaim.drafts];
  if (openSea.length > 0) {
    seaDrafts.push({
      name: "Open Ocean",
      faction: "Neutral",
      ipc: 0,
      capital: false,
      factory: "none",
      sea: true,
      rings: openSea,
    });
  }
  const drafts = [...landClaim.drafts, ...leftovers, ...seaDrafts];
  const seen = new Set<string>();
  for (const draft of drafts) {
    if (seen.has(draft.name)) {
      let n = 2;
      while (seen.has(`${draft.name} ${n}`)) {
        n++;
      }
      draft.name = `${draft.name} ${n}`;
    }
    seen.add(draft.name);
  }
  const regions = drafts.map(toRegion);
  ensureCapitals(regions);
  let map: EditorMap = {
    ...cleaned,
    regions,
    links: [],
    auto: [],
    overrides: { add: [], remove: [] },
    meta: { ...cleaned.meta, name: "WorldMap_Populated", starting_units: [] },
  };
  map = garrison(map, regions, LAND_TROOPS, false);
  map = garrison(map, regions, SEA_TROOPS, true);
  const pairs = autoNeighborPairs(
    map.regions.map((r) => ({ id: r.id, polygon: r.polygon, extra: r.extra, is_sea: r.is_sea })),
    null,
  );
  map = applyAutoLinks(map, pairs);
  return editorToMapJson(map, { round: false });
}
