// Cuts the imported global coast into the Global 1940 catalog. Borders come from GLOBAL_LINKS.
// A zone whose box misses the coast still gets a small diamond at its anchor, so the campaign can start.
import polygonClipping from "polygon-clipping";
import type { Dict } from "../../../../engine/model/types";
import type { Rect, Vec2 } from "../../geometry";
import { labelPoint } from "../editorModel";
import { landmassToSvg } from "../landmass";
import { ringArea, polygonsFromSvg, type MultiPolygon, type Ring } from "../../regionClip";
import { editorToMapJson, pairOf, type EditorMap, type EditorRegion, type Pair } from "../editorModel";
import { GLOBAL_CANALS, GLOBAL_FACTIONS, GLOBAL_LINKS, GLOBAL_TURN, GLOBAL_ZONES, type GlobalZone } from "./catalog";

const MIN_LAND = 8;
const MIN_SEA = 40;

export interface GlobalBoard {
  map: Dict;
  /** Zones that missed the coast and received a diamond instead. */
  placeholders: string[];
  viewBox: Rect;
}

function project(lon: number, lat: number, box: Rect): [number, number] {
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  return [box.x + ((wrapped + 180) / 360) * box.w, box.y + ((90 - lat) / 180) * box.h];
}

function cellRing(zone: GlobalZone, view: Rect): Ring {
  const [lon0, lon1, lat0, lat1] = zone.box;
  const corner = (lon: number, lat: number): [number, number] => project(lon, lat, view);
  return [corner(lon0, lat0), corner(lon1, lat0), corner(lon1, lat1), corner(lon0, lat1)];
}

function anchorOf(zone: GlobalZone, view: Rect): Vec2 {
  const [lon0, lon1, lat0, lat1] = zone.box;
  const [x, y] = project((lon0 + lon1) / 2, (lat0 + lat1) / 2, view);
  return { x, y };
}

function fromRing(ring: Ring): Vec2[] {
  const out: Vec2[] = [];
  for (const [x, y] of ring) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(last.x - x, last.y - y) > 0.05) {
      out.push({ x, y });
    }
  }
  if (out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) <= 0.05) {
    out.pop();
  }
  return out;
}

function areaOf(ring: Vec2[]): number {
  return Math.abs(ringArea(ring.map((p) => [p.x, p.y])));
}

interface Piece {
  outer: Vec2[];
  holes: Vec2[][];
}

function piecesOf(mp: MultiPolygon, minArea: number): Piece[] {
  const pieces: Piece[] = [];
  for (const poly of mp) {
    if (!poly[0] || poly[0].length < 3) {
      continue;
    }
    const outer = fromRing(poly[0]);
    if (outer.length < 3 || areaOf(outer) < minArea) {
      continue;
    }
    const holes = poly
      .slice(1)
      .map(fromRing)
      .filter((ring) => ring.length >= 3 && areaOf(ring) >= minArea);
    pieces.push({ outer, holes });
  }
  pieces.sort((a, b) => areaOf(b.outer) - areaOf(a.outer));
  return pieces;
}

function asMulti(pieces: Piece[]): MultiPolygon {
  return pieces.map((piece) => [piece.outer.map((p): [number, number] => [p.x, p.y]), ...piece.holes.map((ring) => ring.map((p): [number, number] => [p.x, p.y]))]);
}

function safeIntersect(subject: MultiPolygon, box: Ring): MultiPolygon {
  try {
    return polygonClipping.intersection(subject, [box]);
  } catch {
    return [];
  }
}

function safeDifference(subject: MultiPolygon, clip: MultiPolygon): MultiPolygon {
  if (subject.length === 0 || clip.length === 0) {
    return subject;
  }
  try {
    return polygonClipping.difference(subject, clip);
  } catch {
    return subject;
  }
}

function diamond(at: Vec2): Vec2[] {
  const r = 14;
  return [
    { x: at.x, y: at.y - r },
    { x: at.x + r, y: at.y },
    { x: at.x, y: at.y + r },
    { x: at.x - r, y: at.y },
  ];
}

function boardRing(view: Rect): Ring {
  return [
    [view.x, view.y],
    [view.x + view.w, view.y],
    [view.x + view.w, view.y + view.h],
    [view.x, view.y + view.h],
  ];
}

interface Claim {
  zone: GlobalZone;
  pieces: Piece[];
  placeholder: boolean;
  at: Vec2;
}

function claimAll(pool: MultiPolygon, zones: GlobalZone[], view: Rect, minArea: number): { claims: Claim[]; left: MultiPolygon } {
  let left = pool;
  const claims: Claim[] = [];
  for (const zone of zones) {
    const hit = piecesOf(safeIntersect(left, cellRing(zone, view)), minArea);
    const at = anchorOf(zone, view);
    if (hit.length === 0) {
      claims.push({ zone, pieces: [{ outer: diamond(at), holes: [] }], placeholder: true, at });
      continue;
    }
    claims.push({ zone, pieces: hit, placeholder: false, at: labelPoint(hit[0].outer) });
    left = safeDifference(left, asMulti(hit));
  }
  return { claims, left };
}

function nearest(speck: Vec2[], claims: Claim[]): Claim {
  const at = labelPoint(speck);
  let best = claims[0];
  let bestD = Infinity;
  for (const claim of claims) {
    const d = Math.hypot(claim.at.x - at.x, claim.at.y - at.y);
    if (d < bestD) {
      bestD = d;
      best = claim;
    }
  }
  return best;
}

function absorb(left: MultiPolygon, claims: Claim[], minArea: number): void {
  for (const piece of piecesOf(left, minArea)) {
    nearest(piece.outer, claims).pieces.push(piece);
  }
}

function toRegion(claim: Claim): EditorRegion {
  const [main, ...rest] = claim.pieces;
  const zone = claim.zone;
  return {
    id: zone.id,
    name: zone.name,
    ipc_value: zone.sea ? 0 : Math.max(0, zone.ipc ?? 0),
    starting_owner: zone.owner === "" ? "Neutral" : zone.owner,
    is_sea: zone.sea === true,
    factory: zone.sea ? "none" : (zone.factory ?? "none"),
    capital: zone.sea !== true && zone.capital === true,
    polygon: main.outer,
    ...(main.holes.length > 0 ? { holes: main.holes } : {}),
    ...(rest.length > 0 ? { extra: rest.map((piece) => piece.outer) } : {}),
    cx: claim.at.x,
    cy: claim.at.y,
    ...(zone.airbase ? { has_airbase: true } : {}),
    ...(zone.harbour ? { has_harbour: true } : {}),
    ...(zone.cover ? { land_cover: zone.cover } : {}),
    ...(zone.convoy ? { is_convoy_zone: true } : {}),
  };
}

function linksFromCatalog(ids: Set<string>): Pair[] {
  const out: Pair[] = [];
  const seen = new Set<string>();
  for (const [a, b] of GLOBAL_LINKS) {
    if (!ids.has(a) || !ids.has(b) || a === b) {
      continue;
    }
    const pair = pairOf(a, b);
    const key = `${pair[0]}\u001f${pair[1]}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(pair);
  }
  return out;
}

function startingUnits(zones: GlobalZone[]): Dict[] {
  const rows: Dict[] = [];
  for (const zone of zones) {
    const owner = zone.garrison ?? zone.owner;
    if (owner === "" || !zone.units) {
      continue;
    }
    for (const unit of zone.units) {
      rows.push({ region_id: zone.id, faction_id: owner, unit_type_id: unit.id, count: unit.count });
    }
  }
  return rows;
}

/** The playable Global 1940 map for this coast. `svgText` is the Inkscape land file. */
export function buildGlobal1940(svgText: string): GlobalBoard {
  const { viewBox, polygons } = polygonsFromSvg(svgText);
  const landZones = GLOBAL_ZONES.filter((zone) => zone.sea !== true);
  const seaZones = GLOBAL_ZONES.filter((zone) => zone.sea === true);
  const landClaim = claimAll(polygons, landZones, viewBox, MIN_LAND);
  absorb(landClaim.left, landClaim.claims, MIN_LAND);
  const water = safeDifference([boardRing(viewBox)], polygons);
  const seaClaim = claimAll(water, seaZones, viewBox, MIN_SEA);
  absorb(seaClaim.left, seaClaim.claims, MIN_SEA);
  const claims = [...landClaim.claims, ...seaClaim.claims];
  const regions = claims.map(toRegion);
  const ids = new Set(regions.map((region) => region.id));
  const map: EditorMap = {
    regions,
    links: linksFromCatalog(ids),
    auto: [],
    overrides: { add: [], remove: [] },
    meta: {
      name: "GLOBAL VII (AUTO)",
      scenario: "SCENARIO_GLOBAL_1940",
      board: { x: viewBox.x, y: viewBox.y, w: viewBox.w, h: viewBox.h },
      factions: GLOBAL_FACTIONS.map((faction) => ({ ...faction })),
      turn_order: [...GLOBAL_TURN],
      canals: GLOBAL_CANALS.map((canal) => ({ id: canal.id, seas: [...canal.seas], control: [...canal.control] })),
      starting_units: startingUnits(GLOBAL_ZONES),
      sculpted_land_svg: landmassToSvg(polygons, viewBox),
    },
  };
  return {
    map: editorToMapJson(map, { round: true }),
    placeholders: claims.filter((claim) => claim.placeholder).map((claim) => claim.zone.id),
    viewBox,
  };
}
