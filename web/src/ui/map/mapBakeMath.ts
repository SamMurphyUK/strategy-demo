// Pure parts of the baked base map: outline runs that skip the world-wrap seam, shared-border detection,
// the procedural parchment grain, and the rule for when the cached bitmap must be rebuilt. No canvas here,
// so all of it is testable.
import type { MultiPolygon } from "./regionClip";

export type Pt = [number, number];

/** Points closer than this count as the same vertex when matching shared edges. */
const KEY_EPS = 1e-3;
/** An edge this close to the seam line (both ends) lies on it. */
const SEAM_EPS = 1e-3;

export interface Seam {
  /** x of the left edge of the world, and of the right edge. Edges lying on either are not inked. */
  left: number;
  right: number;
}

/** True when the edge runs along the world's left or right edge, where land continues on the wrapped copy. */
export function isSeamEdge(a: Pt, b: Pt, seam: Seam): boolean {
  const on = (x: number, line: number) => Math.abs(x - line) <= SEAM_EPS;
  return (on(a[0], seam.left) && on(b[0], seam.left)) || (on(a[0], seam.right) && on(b[0], seam.right));
}

/** The ring without a repeated closing point. */
function openRing(ring: Pt[]): Pt[] {
  const n = ring.length;
  if (n > 1 && ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1]) {
    return ring.slice(0, n - 1);
  }
  return ring;
}

/**
 * Splits a ring into the polylines left after dropping its seam edges. A ring with no seam edge comes back
 * as one closed run (first point repeated at the end), so it strokes with a proper join.
 */
export function ringRuns(ring: Pt[], seam: Seam | null): Pt[][] {
  const pts = openRing(ring);
  const n = pts.length;
  if (n < 2) {
    return [];
  }
  const skip = (i: number) => seam !== null && isSeamEdge(pts[i], pts[(i + 1) % n], seam);
  let first = -1;
  for (let i = 0; i < n; i++) {
    if (skip(i)) {
      first = i;
      break;
    }
  }
  if (first === -1) {
    return [[...pts, pts[0]]];
  }
  // Start just after a skipped edge, so no run wraps around the ring's start.
  const runs: Pt[][] = [];
  let run: Pt[] = [];
  for (let step = 1; step <= n; step++) {
    const i = (first + step) % n;
    if (skip(i)) {
      if (run.length > 1) {
        runs.push(run);
      }
      run = [];
      continue;
    }
    if (run.length === 0) {
      run.push(pts[i]);
    }
    run.push(pts[(i + 1) % n]);
  }
  if (run.length > 1) {
    runs.push(run);
  }
  return runs;
}

/** Every ring of every polygon of the shapes, flattened. */
export function ringsOf(shape: MultiPolygon): Pt[][] {
  const out: Pt[][] = [];
  for (const polygon of shape) {
    for (const ring of polygon) {
      out.push(ring as Pt[]);
    }
  }
  return out;
}

const q = (v: number) => Math.round(v / KEY_EPS);

function edgeKey(a: Pt, b: Pt): string {
  const ka = `${q(a[0])},${q(a[1])}`;
  const kb = `${q(b[0])},${q(b[1])}`;
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

/**
 * The edges listed by at least `minShapes` different shapes, minus seam edges: the borders two territories
 * share. With `minShapes` 1 it is every distinct edge. Each edge comes back once, as [x1, y1, x2, y2].
 */
export function sharedEdges(shapes: Iterable<MultiPolygon>, seam: Seam | null, minShapes = 2): [number, number, number, number][] {
  const seen = new Map<string, { seg: [number, number, number, number]; count: number }>();
  for (const shape of shapes) {
    const mine = new Set<string>();
    for (const ring of ringsOf(shape)) {
      const pts = openRing(ring);
      const n = pts.length;
      for (let i = 0; i < n && n > 1; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % n];
        if (a[0] === b[0] && a[1] === b[1]) {
          continue;
        }
        const key = edgeKey(a, b);
        if (mine.has(key)) {
          continue; // a hairline traversed twice by one shape is not a border between two
        }
        mine.add(key);
        const hit = seen.get(key);
        if (hit) {
          hit.count++;
        } else {
          seen.set(key, { seg: [a[0], a[1], b[0], b[1]], count: 1 });
        }
      }
    }
  }
  const out: [number, number, number, number][] = [];
  for (const { seg, count } of seen.values()) {
    if (count >= minShapes && !(seam && isSeamEdge([seg[0], seg[1]], [seg[2], seg[3]], seam))) {
      out.push(seg);
    }
  }
  return out;
}

// ---------------------------------------------------------------
// Parchment grain
// ---------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A seamless greyscale paper tile as RGBA bytes: fine speckle, a few dark and pale stipple dots, and soft
 * fibre variation. Everything periodic in `size` (waves have whole periods, fibres wrap), so it tiles with
 * no seam. Near white, so multiplying it over a colour only ages the colour a little.
 */
export function grainTile(size = 256, seed = 20241031): Uint8ClampedArray {
  const rand = mulberry32(seed);
  const dark = new Float32Array(size * size); // 0 = clean paper, 1 = black
  const TAU = Math.PI * 2;

  // Soft cloudy variation: blotches from products of waves with whole periods across the tile. A product
  // (not a sum) of waves gives soft cells; a plain sum shows as long diagonal stripes.
  const waves = Array.from({ length: 5 }, () => ({
    fx: 2 + Math.floor(rand() * 6),
    fy: 2 + Math.floor(rand() * 6),
    px: rand() * TAU,
    py: rand() * TAU,
    amp: 0.004 + rand() * 0.006,
  }));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0.035;
      for (const w of waves) {
        v += w.amp * Math.sin(TAU * ((w.fx * x) / size) + w.px) * Math.sin(TAU * ((w.fy * y) / size) + w.py);
      }
      // Fine speckle: two uniforms summed, so it clusters near the middle.
      v += (rand() + rand() - 1) * 0.035;
      // Sparse stipple.
      const r = rand();
      if (r < 0.012) {
        v += 0.07 + rand() * 0.14;
      } else if (r > 0.992) {
        v -= 0.03;
      }
      dark[y * size + x] = v;
    }
  }
  // Short fibres, wrapped around the edges.
  const fibres = Math.round(size * 0.45);
  for (let f = 0; f < fibres; f++) {
    const length = 6 + rand() * 18;
    const angle = rand() * TAU;
    const strength = 0.02 + rand() * 0.045;
    let x = rand() * size;
    let y = rand() * size;
    const dx = Math.cos(angle) * 0.5;
    const dy = Math.sin(angle) * 0.5;
    for (let s = 0; s < length * 2; s++) {
      const px = ((Math.floor(x) % size) + size) % size;
      const py = ((Math.floor(y) % size) + size) % size;
      dark[py * size + px] += strength;
      x += dx;
      y += dy;
    }
  }

  const out = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const value = 255 * (1 - Math.min(Math.max(dark[i], 0), 0.6));
    out[i * 4] = value;
    out[i * 4 + 1] = value;
    out[i * 4 + 2] = value;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Mean brightness of a greyscale RGBA tile, 0 to 1. */
export function tileMean(tile: Uint8ClampedArray): number {
  let sum = 0;
  for (let i = 0; i < tile.length; i += 4) {
    sum += tile[i];
  }
  return sum / (tile.length / 4) / 255;
}

// ---------------------------------------------------------------
// Cache policy
// ---------------------------------------------------------------

/** Largest bake, in bitmap pixels per world unit. 4 on an 800 unit map is 3200 px wide. */
export const MAX_BAKE_SCALE = 4;

/** The bake resolution a view needs: whole steps of pixels per world unit, so the cache seldom rebuilds. */
export function bakeScaleFor(pixelsPerUnit: number): number {
  return Math.min(MAX_BAKE_SCALE, Math.max(1, Math.ceil(pixelsPerUnit - 1e-6)));
}

/** The pieces of state a bake depends on. Two bakes with the same key look the same. */
export interface BakeKey {
  regions: unknown;
  paths: unknown;
  land: unknown;
  exact: boolean;
  owners: string;
  bounds: string;
}

/** `id:owner` of every land region, so a capture changes the key and nothing else does. */
export function ownersSignature(regions: { id: string; type: string }[], owners: Record<string, string>): string {
  let out = "";
  for (const r of regions) {
    if (r.type === "land") {
      out += `${r.id}:${owners[r.id] ?? ""}|`;
    }
  }
  return out;
}

function sameKey(a: BakeKey, b: BakeKey): boolean {
  return (
    a.regions === b.regions &&
    a.paths === b.paths &&
    a.land === b.land &&
    a.exact === b.exact &&
    a.owners === b.owners &&
    a.bounds === b.bounds
  );
}

/**
 * Holds one baked bitmap. `get` returns it untouched while the map's geometry and land ownership are
 * unchanged, and rebuilds it when either changes, or when the view needs a finer resolution than the bake has
 * (or the bake is more than a step finer than needed, which only wastes memory).
 */
export class BakeCache<I, T> {
  private key: BakeKey | null = null;
  private scale = 0;
  private value: T | null = null;
  /** How many times `render` has run. */
  builds = 0;

  constructor(private readonly render: (input: I, scale: number) => T) {}

  get(key: BakeKey, pixelsPerUnit: number, input: I, holdResolution = false): { value: T; scale: number } {
    const wanted = bakeScaleFor(pixelsPerUnit);
    const missing = this.value === null || this.key === null || !sameKey(this.key, key);
    const resolutionStale = wanted > this.scale || wanted < this.scale - 1;
    // A wheel glide keeps the sheet it already has. Geometry and ownership still rebuild.
    const stale = missing || (resolutionStale && !holdResolution);
    if (stale) {
      this.value = this.render(input, wanted);
      this.scale = wanted;
      this.key = key;
      this.builds++;
    }
    return { value: this.value as T, scale: this.scale };
  }

  /** Forget the bake, so the next `get` rebuilds. */
  invalidate(): void {
    this.value = null;
    this.key = null;
  }
}
