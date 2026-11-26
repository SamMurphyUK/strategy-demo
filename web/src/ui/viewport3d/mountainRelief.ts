// Sculpted ranges for three places on the board: Switzerland, the Himalayas, and Persia. Pure.
//
// The first two are land no territory owns, the holes the map leaves between its neighbours, and
// no piece ever stands there. Persia is a territory, so its ranges leave a level clearing round
// every point its pieces use. Everywhere else the land stays a flat slab: a border is a straight
// printed line, and nothing stands in front of a counter.
//
// A zone is sampled on a grid. Each node carries two shapes of the same massif, both 0 to 1: a
// smooth dome and a ridged one. The board mixes the two by a slider and scales them by another, so
// a patch is built once and every change after that is a number sent to a shader. Both shapes are
// 0 on the zone's edge, on a clearing, and along a river, so the patch joins the flat land with no
// step and a river keeps its valley.
import type { Rect, Vec2 } from "../map/geometry";

export interface ReliefZone {
  name: string;
  /**
   * A hole in the territories: a point inside it, and a box that holds it. The zone is the land no
   * territory owns that is joined to the point, inside the box.
   */
  gap?: { seed: Vec2; box: Rect };
  /** Or a territory, by id. */
  region?: string;
  /** Height of this zone's tallest summit, as a share of the board's. */
  rise: number;
  /** Spacing of the grid, in world units. */
  step: number;
}

/** The sculpted places. Points are map coordinates of demomap01.json. */
export const RELIEF_ZONES: readonly ReliefZone[] = [
  { name: "Switzerland", gap: { seed: { x: 279, y: 221.5 }, box: { x: 267, y: 213, w: 24, h: 17 } }, rise: 0.8, step: 0.3 },
  { name: "Himalayas", gap: { seed: { x: 451, y: 278 }, box: { x: 426, y: 257, w: 50, h: 40 } }, rise: 1, step: 0.5 },
  { name: "Persia", region: "Persia", rise: 0.68, step: 0.5 },
  // The Caucasus and the Urals are left out for now: a whole territory raised for either threw a long white ridge across
  // Russia ("Caucus" is a tall narrow territory by Moscow). They need a boxed zone like the Alps, placed by eye.
  // The Rockies are a whole territory, with a level clearing round every point its pieces use.
  { name: "Rockies", region: "Central US", rise: 0.74, step: 0.5 },
];

/** The ground is level within this distance of a point the pieces use, in world units. */
export const CLEARING_FLAT = 3.6;
/** And back to its full height this far out. */
export const CLEARING_FULL = 8;
/** A river's valley floor, and where the slopes above it are whole again. */
export const VALLEY_FLAT = 0.7;
export const VALLEY_FULL = 2.6;
/** The massif climbs from the zone's edge over this distance at most. */
export const EDGE_RISE = 3.2;

export interface ReliefSite {
  /** A box that holds the whole zone. */
  box: Rect;
  /** True for a point of the zone. */
  inside(p: Vec2): boolean;
  /** Given, only the part of the zone joined to this point is raised. */
  seed?: Vec2;
  /** Points the pieces use. */
  keepClear: readonly Vec2[];
  /** Rivers, as points along them. */
  valleys: readonly Vec2[];
  rise: number;
  step: number;
  /** Changes the pattern of ridges. */
  salt: number;
}

export interface ReliefPatch {
  /** Map coordinates of the first node. */
  originX: number;
  originY: number;
  step: number;
  columns: number;
  rows: number;
  /** Two numbers a node: the dome and the ridged massif. */
  fields: Float32Array;
  /** The gentle rolling hills of the continent, not a range (see buildHillPatch). */
  hills?: boolean;
  /** A share the fields are read at, for the hills' slider. Absent is 1. */
  scale?: number;
}

function smooth(value: number): number {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

function hash(ix: number, iy: number, salt: number): number {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function noise(x: number, y: number, salt: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const a = hash(ix, iy, salt);
  const b = hash(ix + 1, iy, salt);
  const c = hash(ix, iy + 1, salt);
  const d = hash(ix + 1, iy + 1, salt);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/**
 * Ridged noise, 0 to 1: creases where the plain noise crosses its middle, so the high ground runs
 * in spurs. The grain leans north-west to south-east, the way the ranges here lie.
 */
function ridges(x: number, y: number, salt: number): number {
  const u = x * 0.86 + y * 0.5;
  const v = (y * 0.86 - x * 0.5) * 1.4;
  // Two sizes of spur, the smaller two and a half units from crest to crest. Nothing finer: the
  // range is a carved model, and its grid is half a unit.
  let sum = 0;
  let weight = 0;
  let amplitude = 1;
  let frequency = 0.19;
  for (let octave = 0; octave < 2; octave++) {
    const n = 1 - Math.abs(2 * noise(u * frequency, v * frequency, salt + octave * 17) - 1);
    sum += n * n * amplitude;
    weight += amplitude;
    amplitude *= 0.45;
    frequency *= 2.1;
  }
  return sum / weight;
}

const FAR = 1e20;

/** One pass of the exact squared distance transform (Felzenszwalb and Huttenlocher) along a line. */
function distanceLine(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -FAR;
  z[1] = FAR;
  for (let q = 1; q < n; q++) {
    let s = 0;
    for (;;) {
      const p = v[k];
      s = (f[q] + q * q - (f[p] + p * p)) / (2 * q - 2 * p);
      if (s > z[k] || k === 0) {
        break;
      }
      k -= 1;
    }
    if (s <= z[k]) {
      // Only at k = 0: the new parabola is under the first one everywhere.
      v[0] = q;
      z[0] = -FAR;
      z[1] = FAR;
      continue;
    }
    k += 1;
    v[k] = q;
    z[k] = s;
    z[k + 1] = FAR;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) {
      k += 1;
    }
    const p = v[k];
    d[q] = (q - p) * (q - p) + f[p];
  }
}

/** Distance from each node of a mask to the nearest node outside it, in nodes. 0 outside. */
export function insideDistance(mask: Uint8Array, columns: number, rows: number): Float32Array {
  const size = Math.max(columns, rows);
  const f = new Float64Array(size);
  const d = new Float64Array(size);
  const v = new Int32Array(size);
  const z = new Float64Array(size + 1);
  const grid = new Float64Array(columns * rows);
  for (let i = 0; i < grid.length; i++) {
    grid[i] = mask[i] ? FAR : 0;
  }
  for (let x = 0; x < columns; x++) {
    for (let y = 0; y < rows; y++) {
      f[y] = grid[y * columns + x];
    }
    distanceLine(f, rows, d, v, z);
    for (let y = 0; y < rows; y++) {
      grid[y * columns + x] = d[y];
    }
  }
  const out = new Float32Array(columns * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      f[x] = grid[y * columns + x];
    }
    distanceLine(f, columns, d, v, z);
    for (let x = 0; x < columns; x++) {
      out[y * columns + x] = Math.sqrt(Math.min(d[x], FAR));
    }
  }
  return out;
}

/** How much of the height is left at `distance` from the nearest of `points`: 0 inside `flat`, 1 past `full`. */
function keep(points: readonly Vec2[], x: number, y: number, flat: number, full: number): number {
  let nearest = full * full;
  for (const point of points) {
    const dx = point.x - x;
    const dy = point.y - y;
    const d = dx * dx + dy * dy;
    if (d < nearest) {
      nearest = d;
    }
  }
  return smooth((Math.sqrt(nearest) - flat) / (full - flat));
}

/** Builds the patch for one zone, or null when the zone has no ground to raise. */
export function buildReliefPatch(site: ReliefSite): ReliefPatch | null {
  const { step, box } = site;
  const columns = Math.ceil(box.w / step) + 3;
  const rows = Math.ceil(box.h / step) + 3;
  const originX = box.x - step;
  const originY = box.y - step;
  const mask = new Uint8Array(columns * rows);
  // The outermost ring of nodes stays outside, so the patch always closes on flat ground.
  for (let iy = 1; iy < rows - 1; iy++) {
    for (let ix = 1; ix < columns - 1; ix++) {
      if (site.inside({ x: originX + ix * step, y: originY + iy * step })) {
        mask[iy * columns + ix] = 1;
      }
    }
  }
  if (site.seed) {
    // Keep the part joined to the seed: the nearest node inside, then everything that touches it.
    let start = -1;
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) {
        continue;
      }
      const dx = originX + (i % columns) * step - site.seed.x;
      const dy = originY + Math.floor(i / columns) * step - site.seed.y;
      const d = dx * dx + dy * dy;
      if (d < best) {
        best = d;
        start = i;
      }
    }
    if (start < 0 || best > 16 * step * step) {
      return null;
    }
    const joined = new Uint8Array(mask.length);
    const stack = [start];
    joined[start] = 1;
    while (stack.length > 0) {
      const i = stack.pop()!;
      for (const next of [i - 1, i + 1, i - columns, i + columns]) {
        if (mask[next] && !joined[next]) {
          joined[next] = 1;
          stack.push(next);
        }
      }
    }
    mask.set(joined);
  }

  // Measured from the outermost ring of nodes inside the zone, so that ring is level ground and
  // the zone's true edge, which runs just outside it, is too.
  const depth = insideDistance(mask, columns, rows);
  let deepest = 0;
  for (let i = 0; i < depth.length; i++) {
    depth[i] = Math.max(0, depth[i] - 1);
    if (depth[i] > deepest) {
      deepest = depth[i];
    }
  }
  deepest *= step;
  if (deepest < step * 2) {
    return null;
  }
  // A narrow zone climbs over its whole half width; a wide one over a fixed margin, then rolls.
  const margin = Math.min(EDGE_RISE, deepest * 0.75);
  const clear = site.keepClear.filter(
    (p) => p.x > box.x - CLEARING_FULL && p.x < box.x + box.w + CLEARING_FULL && p.y > box.y - CLEARING_FULL && p.y < box.y + box.h + CLEARING_FULL,
  );
  const valleys = site.valleys.filter(
    (p) => p.x > box.x - VALLEY_FULL && p.x < box.x + box.w + VALLEY_FULL && p.y > box.y - VALLEY_FULL && p.y < box.y + box.h + VALLEY_FULL,
  );

  const fields = new Float32Array(columns * rows * 2);
  let domeTop = 0;
  let ridgeTop = 0;
  for (let iy = 0; iy < rows; iy++) {
    for (let ix = 0; ix < columns; ix++) {
      const i = iy * columns + ix;
      if (!mask[i]) {
        continue;
      }
      const x = originX + ix * step;
      const y = originY + iy * step;
      const d = depth[i] * step;
      let ground = smooth(d / margin) * (0.5 + 0.5 * smooth(d / deepest));
      if (clear.length > 0) {
        ground *= keep(clear, x, y, CLEARING_FLAT, CLEARING_FULL);
      }
      if (valleys.length > 0) {
        ground *= keep(valleys, x, y, VALLEY_FLAT, VALLEY_FULL);
      }
      if (ground <= 0) {
        continue;
      }
      const swell = 0.72 + 0.28 * noise(x * 0.11, y * 0.11, site.salt + 5);
      const dome = ground * swell;
      const ridge = ground * (0.16 + 0.84 * ridges(x, y, site.salt)) * (0.8 + 0.2 * swell);
      fields[i * 2] = dome;
      fields[i * 2 + 1] = ridge;
      domeTop = Math.max(domeTop, dome);
      ridgeTop = Math.max(ridgeTop, ridge);
    }
  }
  if (domeTop <= 0 || ridgeTop <= 0) {
    return null;
  }
  // Each shape's summit stands at the zone's share of the board's peak height.
  for (let i = 0; i < columns * rows; i++) {
    fields[i * 2] *= site.rise / domeTop;
    fields[i * 2 + 1] *= site.rise / ridgeTop;
  }
  return { originX, originY, step, columns, rows, fields };
}

/** The two shapes at a map point, read between the nodes. Both 0 off the patch. */
export function sampleReliefField(patch: ReliefPatch, x: number, y: number): { dome: number; ridge: number } {
  const gx = (x - patch.originX) / patch.step;
  const gy = (y - patch.originY) / patch.step;
  if (!(gx >= 0 && gy >= 0 && gx <= patch.columns - 1 && gy <= patch.rows - 1)) {
    return { dome: 0, ridge: 0 };
  }
  const ix = Math.min(patch.columns - 2, Math.floor(gx));
  const iy = Math.min(patch.rows - 2, Math.floor(gy));
  const fx = gx - ix;
  const fy = gy - iy;
  const at = (cx: number, cy: number, channel: number) => patch.fields[(cy * patch.columns + cx) * 2 + channel];
  const read = (channel: number) =>
    at(ix, iy, channel) * (1 - fx) * (1 - fy) +
    at(ix + 1, iy, channel) * fx * (1 - fy) +
    at(ix, iy + 1, channel) * (1 - fx) * fy +
    at(ix + 1, iy + 1, channel) * fx * fy;
  const scale = patch.scale ?? 1;
  return { dome: read(0) * scale, ridge: read(1) * scale };
}

/** The two shapes at a map point over every patch. Zones do not overlap, so the first that answers is it. */
export function sampleReliefFields(patches: readonly ReliefPatch[], x: number, y: number): { dome: number; ridge: number } {
  for (const patch of patches) {
    const field = sampleReliefField(patch, x, y);
    if (field.dome > 0 || field.ridge > 0) {
      return field;
    }
  }
  return { dome: 0, ridge: 0 };
}

/**
 * Height of the sculpted ground at a map point, in world units. `peak` is the tallest summit's
 * height and `sharpness` mixes the dome (0) with the ridged massif (1). This is the sum the land's
 * shader does at each vertex, so whatever is stood on it sits on the surface.
 */
export function sampleMountainHeight(patches: readonly ReliefPatch[], x: number, y: number, peak: number, sharpness: number): number {
  const field = sampleReliefFields(patches, x, y);
  return peak * (field.dome + (field.ridge - field.dome) * sharpness);
}

export interface ReliefBuffers {
  /** Three a node: scene x, scene y (map y turned over), and 0. */
  positions: Float32Array;
  /** Two a node: the dome and the ridged massif. */
  fields: Float32Array;
  /** Four a node: the slope of each shape along scene x and scene y, per world unit. */
  slopes: Float32Array;
  /** Triangles over the cells that have any height. */
  indices: Uint32Array;
}

/** A patch as vertex buffers. Only the cells that rise are meshed. */
export function reliefBuffers(patch: ReliefPatch): ReliefBuffers {
  const { columns, rows, step, fields } = patch;
  const count = columns * rows;
  const positions = new Float32Array(count * 3);
  const slopes = new Float32Array(count * 4);
  const at = (ix: number, iy: number, channel: number) =>
    fields[(Math.min(rows - 1, Math.max(0, iy)) * columns + Math.min(columns - 1, Math.max(0, ix))) * 2 + channel];
  for (let iy = 0; iy < rows; iy++) {
    for (let ix = 0; ix < columns; ix++) {
      const i = iy * columns + ix;
      positions[i * 3] = patch.originX + ix * step;
      positions[i * 3 + 1] = -(patch.originY + iy * step);
      for (let channel = 0; channel < 2; channel++) {
        slopes[i * 4 + channel * 2] = (at(ix + 1, iy, channel) - at(ix - 1, iy, channel)) / (2 * step);
        // Map y runs down the sheet and scene y runs up it.
        slopes[i * 4 + channel * 2 + 1] = (at(ix, iy - 1, channel) - at(ix, iy + 1, channel)) / (2 * step);
      }
    }
  }
  const indices: number[] = [];
  for (let iy = 0; iy + 1 < rows; iy++) {
    for (let ix = 0; ix + 1 < columns; ix++) {
      const a = iy * columns + ix;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;
      if (fields[a * 2] + fields[b * 2] + fields[c * 2] + fields[d * 2] <= 0) {
        continue;
      }
      // Scene y is map y turned over, so this order faces up.
      indices.push(a, c, b, b, c, d);
    }
  }
  return { positions, fields, slopes, indices: new Uint32Array(indices) };
}

export interface HillSite {
  /** A box that holds the whole land. */
  box: Rect;
  /** True where the ground may roll: land that no range takes. */
  inside(p: Vec2): boolean;
  /** What the ground is at a point: how much it swells (0 to 1) and how much of it is dune ridge (0 to 1). */
  kind(p: Vec2): { swell: number; dune: number };
  step: number;
  salt: number;
}

/** The field value of the highest hill. The slider (`terrainHillRelief`) is a share of the mountains' height: it reads the fields at share / HILL_PEAK. */
export const HILL_PEAK = 0.2;

/** The hills climb from the land's edge, and from the foot of a range, over this distance. */
export const HILL_EDGE = 5;

/**
 * The broad, gentle swells of the continent: rolling hills, desert dune ridges, and highland basins, from layered noise and
 * what the ground is. The fields are normalised to 1 at the highest rise; the slider reads them at a share of the mountains'
 * height (see ReliefPatch.scale). The land's edges and the feet of the ranges stay level, so a coast or a border never meets
 * a wall, and the ranges carry the tall spikes.
 */
export function buildHillPatch(site: HillSite): ReliefPatch | null {
  const { step, box } = site;
  const columns = Math.ceil(box.w / step) + 3;
  const rows = Math.ceil(box.h / step) + 3;
  const originX = box.x - step;
  const originY = box.y - step;
  const mask = new Uint8Array(columns * rows);
  for (let iy = 1; iy < rows - 1; iy++) {
    for (let ix = 1; ix < columns - 1; ix++) {
      if (site.inside({ x: originX + ix * step, y: originY + iy * step })) {
        mask[iy * columns + ix] = 1;
      }
    }
  }
  const depth = insideDistance(mask, columns, rows);
  const fields = new Float32Array(columns * rows * 2);
  let top = 0;
  for (let iy = 0; iy < rows; iy++) {
    for (let ix = 0; ix < columns; ix++) {
      const i = iy * columns + ix;
      if (!mask[i]) {
        continue;
      }
      const x = originX + ix * step;
      const y = originY + iy * step;
      const ground = smooth((Math.max(0, depth[i] - 1) * step) / HILL_EDGE);
      if (ground <= 0) {
        continue;
      }
      const kind = site.kind({ x, y });
      // Three octaves of swell: a broad one, a rolling one, and a small undulation.
      const swell = noise(x * 0.035, y * 0.035, site.salt) * 0.55 + noise(x * 0.09, y * 0.09, site.salt + 3) * 0.33 + noise(x * 0.22, y * 0.22, site.salt + 7) * 0.12;
      // Dune ridges lie across the wind, long and low, and wander with a slow noise.
      // The crest lines are not straight: the direction they run turns slowly with the ground, a randomised sine wanders them off their line, the
      // phase is pushed by the swell so the ridges follow the hills, and a slow noise cuts natural breaks in them.
      // The crests run on a slant: their direction on the map is 0.3 to 0.85 radians off the x axis, so with the board's foreshortening they
      // read as diagonals across the screen and never straight down it. The direction wanders with the ground within that.
      const crestDir = 0.3 + noise(x * 0.028, y * 0.028, site.salt + 13) * 0.55;
      const turn = crestDir + Math.PI / 2;
      const along = x * Math.cos(turn) + y * Math.sin(turn);
      const across = -x * Math.sin(turn) + y * Math.cos(turn);
      const wander = Math.sin(across * 0.11 + noise(x * 0.04, y * 0.04, site.salt + 17) * 6) * 2.6 + Math.sin(across * 0.27 + along * 0.05 + site.salt) * 1.1;
      const t = along * 0.4 + wander + noise(x * 0.05, y * 0.05, site.salt + 11) * 3.4 + swell * 4.2;
      const crest = 0.5 + 0.5 * Math.sin(t);
      // Breaks: where the slow noise falls low the crest thins out and gaps open along it.
      const gap = smooth((noise(x * 0.085 + 3, y * 0.085, site.salt + 23) - 0.3) / 0.25);
      const dune = crest * (0.25 + 0.75 * gap);
      const height = ground * (kind.swell * (0.25 + 0.75 * swell) + kind.dune * 0.7 * dune * (0.45 + 0.55 * swell));
      if (height <= 0) {
        continue;
      }
      fields[i * 2] = height;
      fields[i * 2 + 1] = height;
      top = Math.max(top, height);
    }
  }
  if (top <= 0) {
    return null;
  }
  // The highest hill stands at HILL_PEAK, well under the snow line and the foot of a range, so the shaders never mistake a hill
  // for a mountain (no snow on it, no rock). The slider reads the fields at a share of that (see ReliefPatch.scale).
  for (let i = 0; i < fields.length; i++) {
    fields[i] = (fields[i] / top) * HILL_PEAK;
  }
  return { originX, originY, step, columns, rows, fields, hills: true, scale: 1 };
}
