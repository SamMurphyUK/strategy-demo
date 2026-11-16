// An 8×8 lattice over the 800×504 world. A sea zone is a set of squares and diagonal wedges.
// Dissolving them cancels every shared half-edge, so the saved cutter is an ordinary polygon the
// land mask still clips with difference(cutter, land). The dateline stays two rings: x = 0 and
// x = 800 are different vertices, so a Pacific zone does not draw a chord across the map.
import { pointInPolygon, type Vec2 } from "../geometry";

export const LATTICE = 8;
export const MAP_W = 800;
export const MAP_H = 504;
export const LATTICE_COLS = MAP_W / LATTICE;
export const LATTICE_ROWS = MAP_H / LATTICE;

export const WEDGES = ["N", "E", "S", "W"] as const;
export type Wedge = (typeof WEDGES)[number];
/** The whole square, or the wedges that are painted. Four wedges are stored as FULL. */
export type LatticeFill = "FULL" | Wedge[];
export type LatticePart = "FULL" | Wedge;

export interface LatticeCell {
  col: number;
  row: number;
  fill: LatticeFill;
}

export interface LatticeHit {
  col: number;
  row: number;
  part: LatticePart;
  /** World x of the map copy under the pointer, a multiple of 800. Painting still stores col in 0..99. */
  originX: number;
}

export interface LatticeRings {
  polygon: Vec2[];
  extra: Vec2[][];
}

const wedgeRank: Record<Wedge, number> = { N: 0, E: 1, S: 2, W: 3 };

function isWedge(value: string): value is Wedge {
  return value === "N" || value === "E" || value === "S" || value === "W";
}

/** Four wedges become FULL. Anything else stays a sorted wedge list, or null when empty. */
export function normalizeFill(fill: LatticeFill | Wedge[] | null | undefined): LatticeFill | null {
  if (fill == null) {
    return null;
  }
  if (fill === "FULL") {
    return "FULL";
  }
  const unique = WEDGES.filter((wedge) => fill.includes(wedge));
  if (unique.length === 0) {
    return null;
  }
  if (unique.length === WEDGES.length) {
    return "FULL";
  }
  return unique;
}

export function fillKey(fill: LatticeFill): string {
  return fill === "FULL" ? "FULL" : fill.join("");
}

export function parseFill(raw: unknown): LatticeFill | null {
  if (raw === "FULL") {
    return "FULL";
  }
  if (typeof raw !== "string" || raw === "") {
    return null;
  }
  const wedges: Wedge[] = [];
  for (const letter of raw) {
    if (isWedge(letter) && !wedges.includes(letter)) {
      wedges.push(letter);
    }
  }
  wedges.sort((a, b) => wedgeRank[a] - wedgeRank[b]);
  return normalizeFill(wedges);
}

/** Drop cells that are out of the grid or empty. Later cells with the same col/row replace earlier ones. */
export function normalizeCells(cells: readonly LatticeCell[]): LatticeCell[] {
  const byKey = new Map<string, LatticeCell>();
  for (const cell of cells) {
    if (!Number.isInteger(cell.col) || !Number.isInteger(cell.row)) {
      continue;
    }
    if (cell.col < 0 || cell.col >= LATTICE_COLS || cell.row < 0 || cell.row >= LATTICE_ROWS) {
      continue;
    }
    const fill = normalizeFill(cell.fill);
    if (!fill) {
      continue;
    }
    byKey.set(`${cell.col},${cell.row}`, { col: cell.col, row: cell.row, fill });
  }
  return [...byKey.values()].sort((a, b) => a.row - b.row || a.col - b.col);
}

export function parseLatticeCells(raw: unknown): LatticeCell[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const cells: LatticeCell[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const record = item as { col?: unknown; row?: unknown; fill?: unknown };
    const fill = parseFill(record.fill);
    const col = Number(record.col);
    const row = Number(record.row);
    if (!fill || !Number.isInteger(col) || !Number.isInteger(row)) {
      continue;
    }
    cells.push({ col, row, fill });
  }
  const normalized = normalizeCells(cells);
  return normalized.length > 0 ? normalized : undefined;
}

/** World x folded into [0, 800). The right edge of the map is the same seam as the left edge. */
export function wrapMapX(x: number): number {
  if (!Number.isFinite(x)) {
    return 0;
  }
  return ((x % MAP_W) + MAP_W) % MAP_W;
}

function wedgeAt(lx: number, ly: number): Wedge {
  const dx = lx - LATTICE / 2;
  const dy = ly - LATTICE / 2;
  if (dx === 0 && dy === 0) {
    return "N";
  }
  const angle = Math.atan2(dy, dx);
  if (angle >= -Math.PI / 4 && angle < Math.PI / 4) {
    return "E";
  }
  if (angle >= Math.PI / 4 && angle < (3 * Math.PI) / 4) {
    return "S";
  }
  if (angle >= (-3 * Math.PI) / 4 && angle < -Math.PI / 4) {
    return "N";
  }
  return "W";
}

/** The square or wedge under a world point. Y outside the map misses. X wraps the dateline. */
export function latticeHit(x: number, y: number, triangle: boolean): LatticeHit | null {
  if (!Number.isFinite(x) || !Number.isFinite(y) || y < 0 || y >= MAP_H) {
    return null;
  }
  const wx = wrapMapX(x);
  const col = Math.floor(wx / LATTICE);
  const row = Math.floor(y / LATTICE);
  if (col < 0 || col >= LATTICE_COLS || row < 0 || row >= LATTICE_ROWS) {
    return null;
  }
  const lx = wx - col * LATTICE;
  const ly = y - row * LATTICE;
  return { col, row, part: triangle ? wedgeAt(lx, ly) : "FULL", originX: Math.floor(x / MAP_W) * MAP_W };
}

/** Samples a drag so a fast stroke still paints every cell it crosses. */
export function hitsAlong(from: Vec2, to: Vec2, triangle: boolean): LatticeHit[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const span = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(span / (LATTICE / 4)));
  const hits: LatticeHit[] = [];
  let previous = "";
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const hit = latticeHit(from.x + dx * t, from.y + dy * t, triangle);
    if (!hit) {
      continue;
    }
    const key = `${hit.col},${hit.row},${hit.part}`;
    if (key === previous) {
      continue;
    }
    previous = key;
    hits.push(hit);
  }
  return hits;
}

interface Corner {
  x: number;
  y: number;
}

function corners(col: number, row: number): { nw: Corner; ne: Corner; se: Corner; sw: Corner; c: Corner } {
  const x0 = col * LATTICE;
  const y0 = row * LATTICE;
  const x1 = x0 + LATTICE;
  const y1 = y0 + LATTICE;
  return {
    nw: { x: x0, y: y0 },
    ne: { x: x1, y: y0 },
    se: { x: x1, y: y1 },
    sw: { x: x0, y: y1 },
    c: { x: x0 + LATTICE / 2, y: y0 + LATTICE / 2 },
  };
}

/** The painted square or wedge, counter-clockwise in the same winding the editor's squares use. */
export function latticePartRing(col: number, row: number, part: LatticePart): Vec2[] {
  const { nw, ne, se, sw, c } = corners(col, row);
  if (part === "FULL") {
    return [nw, ne, se, sw];
  }
  if (part === "N") {
    return [nw, ne, c];
  }
  if (part === "E") {
    return [ne, se, c];
  }
  if (part === "S") {
    return [se, sw, c];
  }
  return [sw, nw, c];
}

const rasterCache = new WeakMap<Vec2[], LatticeCell[]>();

function ringHolds(rings: Vec2[][], x: number, y: number): boolean {
  const point = { x, y };
  return rings.some((ring) => pointInPolygon(point, ring));
}

/** The centroid of a square or wedge and a point near each of its corners. */
export function partSamples(col: number, row: number, part: LatticePart): Vec2[] {
  const ring = latticePartRing(col, row, part);
  const gx = ring.reduce((sum, p) => sum + p.x, 0) / ring.length;
  const gy = ring.reduce((sum, p) => sum + p.y, 0) / ring.length;
  return [{ x: gx, y: gy }, ...ring.map((p) => ({ x: gx + (p.x - gx) * 0.8, y: gy + (p.y - gy) * 0.8 }))];
}

/** True when any sample of the square or wedge lies inside the rings. */
export function partTouches(rings: Vec2[][], col: number, row: number, part: LatticePart): boolean {
  return partSamples(col, row, part).some((p) => ringHolds(rings, p.x, p.y));
}

/** Cells whose center sits inside `ring`, using the same even-odd rule as `pointInPolygon`. */
function fillRingCenters(ring: Vec2[], cells: Map<string, LatticeFill>): void {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of ring) {
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  const row0 = Math.max(0, Math.floor(minY / LATTICE));
  const row1 = Math.min(LATTICE_ROWS - 1, Math.floor((maxY - 1e-9) / LATTICE));
  for (let row = row0; row <= row1; row++) {
    const y = row * LATTICE + LATTICE / 2;
    const xs: number[] = [];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j];
      const b = ring[i];
      if ((a.y > y) === (b.y > y)) {
        continue;
      }
      const t = (y - a.y) / (b.y - a.y);
      xs.push(a.x + t * (b.x - a.x));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      let col = Math.floor(xs[k] / LATTICE);
      const colEnd = Math.min(LATTICE_COLS - 1, Math.floor(xs[k + 1] / LATTICE));
      for (; col <= colEnd; col++) {
        if (col < 0) {
          continue;
        }
        const cx = col * LATTICE + LATTICE / 2;
        if (cx >= xs[k] && cx < xs[k + 1]) {
          cells.set(`${col},${row}`, "FULL");
        }
      }
    }
  }
}

function visitSegment(x0: number, y0: number, x1: number, y1: number, visit: (col: number, row: number) => void): void {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (LATTICE / 4)));
  let previous = "";
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const col = Math.floor((x0 + (x1 - x0) * t) / LATTICE);
    const row = Math.floor((y0 + (y1 - y0) * t) / LATTICE);
    if (col < 0 || row < 0 || col >= LATTICE_COLS || row >= LATTICE_ROWS) {
      continue;
    }
    const key = `${col},${row}`;
    if (key === previous) {
      continue;
    }
    previous = key;
    visit(col, row);
  }
}

/**
 * Squares and wedges that cover an existing cutter. A hand-drawn sea zone is read through this the first
 * time a lattice stroke touches it, so painting adds or carves cells instead of replacing the zone.
 * A wedge on the outline counts when any part of it is inside, so a coast keeps its water. The land mask
 * still trims the coast when the map draws.
 */
export function rasterizeRings(polygon: Vec2[], extra: Vec2[][] = []): LatticeCell[] {
  const cached = rasterCache.get(polygon);
  if (cached) {
    return cached;
  }
  const rings = [polygon, ...extra].filter((ring) => ring.length >= 3);
  const cells = new Map<string, LatticeFill>();
  const boundary = new Set<string>();
  for (const ring of rings) {
    fillRingCenters(ring, cells);
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      visitSegment(a.x, a.y, b.x, b.y, (col, row) => boundary.add(`${col},${row}`));
    }
  }
  for (const key of boundary) {
    const [col, row] = key.split(",").map(Number);
    const wedges = WEDGES.filter((wedge) => partTouches(rings, col, row, wedge));
    const fill = normalizeFill(wedges);
    if (fill) {
      cells.set(key, fill);
    } else {
      cells.delete(key);
    }
  }
  const result = normalizeCells(
    [...cells.entries()].map(([key, fill]) => {
      const [col, row] = key.split(",").map(Number);
      return { col, row, fill };
    }),
  );
  rasterCache.set(polygon, result);
  return result;
}

interface HalfEdge {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

function edgeKey(edge: HalfEdge): string {
  return `${edge.ax},${edge.ay}>${edge.bx},${edge.by}`;
}

function oppositeKey(edge: HalfEdge): string {
  return `${edge.bx},${edge.by}>${edge.ax},${edge.ay}`;
}

function ringEdges(ring: readonly Vec2[]): HalfEdge[] {
  const edges: HalfEdge[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    edges.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
  }
  return edges;
}

function partsOf(fill: LatticeFill): LatticePart[] {
  return fill === "FULL" ? ["FULL"] : fill;
}

/** Horizontal, vertical, or 45°, and b sits between a and c. */
function colinearBetween(a: Vec2, b: Vec2, c: Vec2): boolean {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const bcx = c.x - b.x;
  const bcy = c.y - b.y;
  if (abx * bcy - aby * bcx !== 0) {
    return false;
  }
  if (abx * bcx + aby * bcy <= 0) {
    return false;
  }
  const straight = (dx: number, dy: number) => dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy);
  return straight(abx, aby) && straight(bcx, bcy);
}

function simplifyRing(ring: Vec2[]): Vec2[] {
  let points = ring;
  let changed = true;
  while (changed && points.length > 3) {
    changed = false;
    const next: Vec2[] = [];
    const count = points.length;
    for (let i = 0; i < count; i++) {
      const a = points[(i - 1 + count) % count];
      const b = points[i];
      const c = points[(i + 1) % count];
      if (colinearBetween(a, b, c)) {
        changed = true;
        continue;
      }
      next.push(b);
    }
    points = next;
  }
  return points;
}

function signedArea(ring: Vec2[]): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += ring[j].x * ring[i].y - ring[i].x * ring[j].y;
  }
  return sum / 2;
}

function leftmost(ring: Vec2[]): Vec2 {
  let best = ring[0];
  for (const p of ring) {
    if (p.x < best.x || (p.x === best.x && p.y < best.y)) {
      best = p;
    }
  }
  return best;
}

/** A point just inside the hole next to `h`, to confirm which outline really surrounds it. */
function nudgeInto(hole: Vec2[], h: Vec2): Vec2 {
  let sx = 0;
  let sy = 0;
  for (const p of hole) {
    sx += p.x;
    sy += p.y;
  }
  const cx = sx / hole.length;
  const cy = sy / hole.length;
  return { x: h.x + (cx - h.x) * 0.01, y: h.y + (cy - h.y) * 0.01 };
}

/**
 * Joins a hole into the outline around it. A ray runs left from the hole's leftmost vertex to the nearest
 * edge of the outline, and the ring goes out along it, around the hole, and back. Holes are bridged in
 * order of their leftmost x, so earlier bridges are already part of the outline the ray can hit.
 */
function bridgeHole(outer: Vec2[], hole: Vec2[]): Vec2[] {
  const h = leftmost(hole);
  let bestX = -Infinity;
  let bestEdge = -1;
  for (let i = 0; i < outer.length; i++) {
    const a = outer[i];
    const b = outer[(i + 1) % outer.length];
    if (a.y === b.y) {
      continue;
    }
    const crosses = (a.y <= h.y && b.y > h.y) || (b.y <= h.y && a.y > h.y);
    if (!crosses) {
      continue;
    }
    const x = a.x + ((h.y - a.y) * (b.x - a.x)) / (b.y - a.y);
    if (x <= h.x && x > bestX) {
      bestX = x;
      bestEdge = i;
    }
  }
  if (bestEdge < 0) {
    return outer;
  }
  const a = outer[bestEdge];
  const b = outer[(bestEdge + 1) % outer.length];
  const p = { x: bestX, y: h.y };
  const start = hole.indexOf(h);
  const around = [...hole.slice(start), ...hole.slice(0, start), h];
  const sameAsA = a.x === p.x && a.y === p.y;
  const sameAsB = b.x === p.x && b.y === p.y;
  const head = outer.slice(0, bestEdge + 1);
  const tail = outer.slice(bestEdge + 1);
  if (sameAsA) {
    return [...head, ...around, a, ...tail];
  }
  if (sameAsB) {
    return [...head, b, ...around, ...tail];
  }
  return [...head, p, ...around, p, ...tail];
}

function vertexKey(x: number, y: number): string {
  return `${x},${y}`;
}

/**
 * Cancel every internal half-edge and stitch what remains into rings.
 * The largest ring is `polygon`. Further pieces, including a second ring across the dateline, are `extra`.
 */
export function dissolveLatticeCellsToRings(cells: readonly LatticeCell[]): LatticeRings {
  const counts = new Map<string, HalfEdge>();
  for (const cell of normalizeCells(cells)) {
    for (const part of partsOf(cell.fill)) {
      for (const edge of ringEdges(latticePartRing(cell.col, cell.row, part))) {
        const forward = edgeKey(edge);
        const back = oppositeKey(edge);
        if (counts.has(back)) {
          counts.delete(back);
        } else {
          counts.set(forward, edge);
        }
      }
    }
  }

  const outgoing = new Map<string, HalfEdge[]>();
  for (const edge of counts.values()) {
    const key = vertexKey(edge.ax, edge.ay);
    const list = outgoing.get(key);
    if (list) {
      list.push(edge);
    } else {
      outgoing.set(key, [edge]);
    }
  }

  const unused = new Set(counts.keys());
  const rings: Vec2[][] = [];
  while (unused.size > 0) {
    const startKey = unused.values().next().value;
    if (startKey === undefined) {
      break;
    }
    const start = counts.get(startKey);
    if (!start) {
      unused.delete(startKey);
      continue;
    }
    const ring: Vec2[] = [{ x: start.ax, y: start.ay }];
    let previous = { x: start.ax, y: start.ay };
    let current = { x: start.bx, y: start.by };
    unused.delete(startKey);
    let guard = counts.size + 2;
    while ((current.x !== start.ax || current.y !== start.ay) && guard-- > 0) {
      ring.push(current);
      const incoming = { x: current.x - previous.x, y: current.y - previous.y };
      const choices = (outgoing.get(vertexKey(current.x, current.y)) ?? []).filter((edge) => unused.has(edgeKey(edge)));
      if (choices.length === 0) {
        break;
      }
      choices.sort((a, b) => turnRank(incoming, a) - turnRank(incoming, b));
      const next = choices[0];
      unused.delete(edgeKey(next));
      previous = current;
      current = { x: next.bx, y: next.by };
    }
    const simplified = simplifyRing(ring);
    if (simplified.length >= 3) {
      rings.push(simplified);
    }
  }

  // Painted parts wind positive, so an outline winds positive and the outline of a hole winds negative.
  // The cutter format has no holes, so each hole is joined to the ring around it by a zero-width bridge.
  const outers = rings.filter((ring) => signedArea(ring) > 0);
  const holes = rings.filter((ring) => signedArea(ring) < 0);
  holes.sort((a, b) => leftmost(a).x - leftmost(b).x || leftmost(a).y - leftmost(b).y);
  for (const hole of holes) {
    const h = leftmost(hole);
    let owner = -1;
    let ownerArea = Infinity;
    outers.forEach((outer, index) => {
      const area = signedArea(outer);
      if (area < ownerArea && pointInPolygon(h, outer) && pointInPolygon(nudgeInto(hole, h), outer)) {
        owner = index;
        ownerArea = area;
      }
    });
    if (owner < 0) {
      continue;
    }
    outers[owner] = bridgeHole(outers[owner], hole);
  }

  rings.length = 0;
  rings.push(...outers);

  rings.sort((a, b) => {
    const area = Math.abs(signedArea(b)) - Math.abs(signedArea(a));
    if (area !== 0) {
      return area;
    }
    const minX = Math.min(...a.map((p) => p.x)) - Math.min(...b.map((p) => p.x));
    if (minX !== 0) {
      return minX;
    }
    return Math.min(...a.map((p) => p.y)) - Math.min(...b.map((p) => p.y));
  });

  const [polygon = [], ...extra] = rings;
  return { polygon, extra };
}

/** Larger cross product first (the turn the square's own corners take), then the straighter continuation. */
function turnRank(incoming: { x: number; y: number }, edge: HalfEdge): number {
  const ox = edge.bx - edge.ax;
  const oy = edge.by - edge.ay;
  const cross = incoming.x * oy - incoming.y * ox;
  const dot = incoming.x * ox + incoming.y * oy;
  return -cross * 1_000_000 - dot;
}

function addPart(fill: LatticeFill | null, part: LatticePart): LatticeFill {
  if (part === "FULL" || fill === "FULL") {
    return "FULL";
  }
  if (fill == null) {
    return [part];
  }
  return normalizeFill([...fill, part]) ?? [part];
}

function removePart(fill: LatticeFill, part: LatticePart): LatticeFill | null {
  if (part === "FULL") {
    return null;
  }
  const source = fill === "FULL" ? [...WEDGES] : fill;
  return normalizeFill(source.filter((wedge) => wedge !== part));
}

export interface LatticeZone {
  id: string;
  cells: LatticeCell[];
}

/**
 * Paint or erase `hits` on `targetId`. A painted wedge is taken off every other zone first,
 * so two sea zones share the cut and do not overlap.
 */
export function editLatticeZones(zones: readonly LatticeZone[], targetId: string, hits: readonly LatticeHit[], erase: boolean): LatticeZone[] {
  const maps = new Map<string, Map<string, LatticeCell>>();
  for (const zone of zones) {
    const cells = new Map<string, LatticeCell>();
    for (const cell of normalizeCells(zone.cells)) {
      cells.set(`${cell.col},${cell.row}`, cell);
    }
    maps.set(zone.id, cells);
  }
  const target = maps.get(targetId);
  if (!target) {
    return zones.map((zone) => ({ id: zone.id, cells: normalizeCells(zone.cells) }));
  }

  for (const hit of hits) {
    if (hit.col < 0 || hit.col >= LATTICE_COLS || hit.row < 0 || hit.row >= LATTICE_ROWS) {
      continue;
    }
    const key = `${hit.col},${hit.row}`;
    if (!erase) {
      for (const [id, cells] of maps) {
        if (id === targetId) {
          continue;
        }
        const existing = cells.get(key);
        if (!existing) {
          continue;
        }
        const left = removePart(existing.fill, hit.part);
        if (left) {
          cells.set(key, { col: hit.col, row: hit.row, fill: left });
        } else {
          cells.delete(key);
        }
      }
      const existing = target.get(key);
      target.set(key, { col: hit.col, row: hit.row, fill: addPart(existing?.fill ?? null, hit.part) });
    } else {
      const existing = target.get(key);
      if (!existing) {
        continue;
      }
      const left = removePart(existing.fill, hit.part);
      if (left) {
        target.set(key, { col: hit.col, row: hit.row, fill: left });
      } else {
        target.delete(key);
      }
    }
  }

  return zones.map((zone) => {
    const cells = maps.get(zone.id);
    return { id: zone.id, cells: cells ? normalizeCells([...cells.values()]) : [] };
  });
}

/** A point inside the dissolved cutter, preferring the middle of the largest ring. */
export function latticeAnchor(polygon: Vec2[], extra: Vec2[][] = []): Vec2 | null {
  const rings = [polygon, ...extra].filter((ring) => ring.length >= 3);
  if (rings.length === 0) {
    return null;
  }
  const largest = [...rings].sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)))[0];
  let twice = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0, j = largest.length - 1; i < largest.length; j = i++) {
    const cross = largest[j].x * largest[i].y - largest[i].x * largest[j].y;
    twice += cross;
    sx += (largest[j].x + largest[i].x) * cross;
    sy += (largest[j].y + largest[i].y) * cross;
  }
  if (twice !== 0) {
    const at = { x: sx / (3 * twice), y: sy / (3 * twice) };
    if (pointInPolygon(at, largest)) {
      return at;
    }
  }
  return { x: largest[0].x, y: largest[0].y };
}
