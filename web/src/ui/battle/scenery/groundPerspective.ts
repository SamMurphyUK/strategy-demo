// Painters for the things on the battle field that recede toward the horizon. The baked region
// ground and the plain theatre ground both use these, so the two never drift apart.
// Every colour is one of the 16 on the military strip.
import { MILITARY as P } from "../../theme/militaryPalette";
import type { Paint } from "./sceneryPaint";
import {
  HAZE_ALPHA,
  HAZE_DEPTH,
  SKY_HAZE_ALPHA,
  SKY_HAZE_DEPTH,
  decalRadii,
  decalScale,
  hazeBands,
  rayScale,
  rayX,
  squashSlope,
  squashY,
  TRACK_WIDTH_FRONT,
  trackWidth,
  unsquashY,
} from "./perspective";

/**
 * A view of a painter that squeezes everything vertically toward the horizon.
 * The old flat painters draw through it unchanged: a row a long way down the plan lands near the
 * horizon, and an oval there is flatter. Fills that span the whole field still span it.
 */
export function squashPaint(target: Paint): Paint {
  const wrapped: Record<string, unknown> = {
    fillRect: (x: number, y: number, w: number, h: number) => {
      const top = Math.round(squashY(y));
      const bottom = Math.round(squashY(y + h));
      target.fillRect(x, top, w, h > 0 ? Math.max(1, bottom - top) : 0);
    },
    moveTo: (x: number, y: number) => target.moveTo(x, squashY(y)),
    lineTo: (x: number, y: number) => target.lineTo(x, squashY(y)),
    arc: (x: number, y: number, radius: number, start: number, end: number, anticlockwise?: boolean) =>
      target.ellipse(x, squashY(y), radius, Math.max(0.5, radius * squashSlope(y)), 0, start, end, anticlockwise),
    ellipse: (x: number, y: number, rx: number, ry: number, rotation: number, start: number, end: number, anticlockwise?: boolean) =>
      target.ellipse(x, squashY(y), rx, Math.max(0.5, ry * squashSlope(y)), rotation, start, end, anticlockwise),
  };
  return new Proxy(target, {
    get(source, key) {
      if (typeof key === "string" && key in wrapped) {
        return wrapped[key];
      }
      const value = Reflect.get(source, key) as unknown;
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(source) : value;
    },
    set(source, key, value) {
      return Reflect.set(source, key, value);
    },
  });
}

/** Calls `row` for each board row from the plan row `top` to the plan row `bottom`. */
export function planRows(top: number, bottom: number, row: (y: number, plan: number) => void): void {
  const first = Math.ceil(squashY(top));
  const last = Math.floor(squashY(bottom));
  for (let y = first; y <= last; y += 1) {
    row(y, unsquashY(y));
  }
}

/** The left edge and width on a board row of a strip that stands from x0 to x1 on the bottom edge. */
export function stripAt(x0: number, x1: number, y: number): { x: number; width: number } {
  const left = Math.round(rayX(x0, y));
  const right = Math.round(rayX(x1, y));
  return { x: left, width: Math.max(1, right - left) };
}

/**
 * A strip of a trench or its parapet on a board row. `from` and `to` are offsets from the
 * trench's middle at its full 12 pixel width. The middle leans along its ray and the offsets
 * shrink only as far as the trench's own width does, so it is 10 pixels wide at the horizon.
 */
function trackAt(centre: number, from: number, to: number, y: number): { x: number; width: number } {
  const share = trackWidth(y) / TRACK_WIDTH_FRONT;
  return {
    x: Math.round(rayX(centre, y) + from * share),
    width: Math.max(1, Math.round((to - from) * share)),
  };
}

function fill(ctx: Paint, color: string, x: number, y: number, w: number, h = 1): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function ellipse(ctx: Paint, color: string, x: number, y: number, rx: number, ry: number): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
  ctx.fill();
}

/** A trench along a ray. `centre` is its middle on the bottom edge of the field. */
export function paintTrench(ctx: Paint, centre: number, urban: boolean, bend?: Bend): void {
  const top = 130;
  const bottom = 520;
  if (urban) {
    planRows(top, bottom, (y, plan) => {
      const course = Math.floor((plan - top) / 7);
      const into = plan - top - course * 7;
      if (into < 5) {
        const shift = (course % 2) * 3;
        const brick = trackAt(centre + bendOffset(bend, plan), -7 + shift, 3 + shift, y);
        fill(ctx, into >= 4 ? P.brown : P.terracotta, brick.x, y, brick.width);
      }
      const edge = trackAt(centre + bendOffset(bend, plan), -8, -6, y);
      fill(ctx, P.charcoal, edge.x, y, edge.width);
    });
    return;
  }
  planRows(top, bottom, (y, plan) => {
    const bed = trackAt(centre + bendOffset(bend, plan), -6, 6, y);
    fill(ctx, P.taupe, bed.x, y, bed.width);
    const into = (((plan - (top + 4)) % 12) + 12) % 12;
    if (into < 4 && bed.width >= 4) {
      const inset = Math.max(1, Math.round(bed.width / 6));
      fill(ctx, P.brown, bed.x + inset, y, bed.width - inset * 2);
    }
    fill(ctx, P.charcoal, bed.x, y, Math.max(1, Math.round(bed.width / 6)));
  });
}

/**
 * A parapet of sandbags laid along the ray of the trench it guards. Far bags first.
 * `offset` is where the bags start, from the trench's middle: -15 on the left side, 5 on the right.
 */
export function paintParapet(ctx: Paint, centre: number, offset: number, bend?: Bend): void {
  for (let plan = 140; plan <= 524; plan += 8) {
    const y = Math.round(squashY(plan));
    const h = Math.max(1, Math.round(squashY(plan + 5)) - y);
    const { x, width: w } = trackAt(centre + bendOffset(bend, plan), offset, offset + 7, y);
    fill(ctx, P.tan, x, y, w, h);
    if (w >= 3 && h >= 3) {
      fill(ctx, P.cream, x + 1, y + 1, w - 2, Math.max(1, Math.round(h * 0.4)));
      fill(ctx, P.brown, x, y + h - 1, w);
    }
  }
}

function strand(ctx: Paint, color: string, a: [number, number], b: [number, number]): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.stroke();
}

const WIRE_POSTS = { left: 620, right: 660 };

/** Rows of wire across the middle of no-man's land. Posts stand up, so they shrink with depth. */
export function paintWire(ctx: Paint): void {
  for (let plan = 350; plan <= 510; plan += 35) {
    const y = Math.round(squashY(plan));
    const k = rayScale(y);
    const w = Math.max(1, Math.round(3 * k));
    const h = Math.max(2, Math.round(8 * k));
    const left = Math.round(rayX(WIRE_POSTS.left, y));
    const right = Math.round(rayX(WIRE_POSTS.right, y));
    fill(ctx, P.brown, left, y - h, w, h);
    fill(ctx, P.brown, right, y - h, w, h);
    strand(ctx, P.feldgrau, [left, y - h * 0.25], [right, y - h * 0.8]);
    strand(ctx, P.feldgrau, [left, y - h * 0.8], [right, y - h * 0.25]);
  }
}

/** The dotted range grid: lines that run away from the viewer lean in, cross rows are squeezed. */
export function paintGrid(ctx: Paint, width: number, color: string, alpha: number): void {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  // Lines that stand well outside the board at the bottom edge still lean into view up the field.
  for (let gx = 100 - 110 * 30; gx < width + 110 * 30; gx += 110) {
    let last = -1;
    for (let plan = 122; plan < 520; plan += 10) {
      const y = Math.round(squashY(plan));
      if (y === last) continue;
      last = y;
      const x = Math.round(rayX(gx, y));
      if (x >= 0 && x < width) ctx.fillRect(x, y, 1, 1);
    }
  }
  for (let plan = 150; plan < 520; plan += 90) {
    const y = Math.round(squashY(plan));
    for (let x = 40; x < width - 40; x += 10) ctx.fillRect(x, y, 2, 1);
  }
  ctx.globalAlpha = 1;
}

/** A shell crater. `x` and `plan` are where it sits on the flat plan. It lands flat and wide. */
export function paintCrater(ctx: Paint, x: number, plan: number, radius: number, dirt: string): void {
  const y = squashY(plan);
  const cx = rayX(x, y);
  const { rx, ry } = decalRadii(radius, y);
  const rim = 3 * decalScale(y);
  ellipse(ctx, dirt, cx, y, rx + rim, ry + rim * 0.42);
  ellipse(ctx, P.taupe, cx, y, rx, ry);
  ellipse(ctx, P.charcoal, cx - 0.5, y - 0.5, rx * 0.55, ry * 0.5);
}

/** Haze that thins out down the far ground, in the sky's own colour. */
export function paintGroundHaze(ctx: Paint, width: number): void {
  ctx.fillStyle = P.cream;
  for (const band of hazeBands(HAZE_DEPTH, HAZE_ALPHA)) {
    ctx.globalAlpha = band.alpha;
    ctx.fillRect(0, band.y, width, band.height);
  }
  ctx.globalAlpha = 1;
}

/** A thin veil over the foot of the skyline, strongest on the horizon line. */
export function paintSkyHaze(ctx: Paint, width: number): void {
  ctx.fillStyle = P.cream;
  for (const band of hazeBands(SKY_HAZE_DEPTH, SKY_HAZE_ALPHA, 4, -1)) {
    ctx.globalAlpha = band.alpha;
    ctx.fillRect(0, band.y, width, band.height);
  }
  ctx.globalAlpha = 1;
}


// ============================================================================
// SEEDED LAYOUT: where the trenches, craters and bag clusters go on one region's field
// ============================================================================

/** A dogleg: from plan row `from` the trench slides sideways by `shift` over `BEND_RAMP` rows. */
export interface Bend {
  from: number;
  shift: number;
}

export const BEND_RAMP = 34;

/** How far a trench's middle has moved from its straight line at this plan row. */
export function bendOffset(bend: Bend | undefined, plan: number): number {
  if (!bend) return 0;
  const t = Math.min(1, Math.max(0, (plan - bend.from) / BEND_RAMP));
  return bend.shift * t * t * (3 - 2 * t);
}

export interface TrenchLine {
  /** Middle of the trench on the bottom edge of the field. */
  centre: number;
  bend?: Bend;
}

export interface CraterSpot {
  x: number;
  /** Row of the flat plan, before the squeeze. */
  y: number;
  r: number;
}

/** A small thing beside a trench: a heap of sandbags, or a timber-faced stretch of its wall. */
export interface TrenchCluster {
  /** 0 is the left trench, 1 the right. */
  trench: 0 | 1;
  kind: "bags" | "revetment";
  /** Row of the flat plan where it starts. */
  plan: number;
  /** How many rows of the plan a revetment runs, or how many bags sit in the bottom row of a heap. */
  size: number;
  /** -1 puts it on the trench's left side, 1 on its right. */
  side: -1 | 1;
}

export interface GroundLayout {
  trenches: [TrenchLine, TrenchLine];
  craters: CraterSpot[];
  clusters: TrenchCluster[];
}

/** Where the trenches stand with no seed, and the craters they have always had. */
export const DEFAULT_TRENCH_CENTRES = [470, 810] as const;
export const DEFAULT_CRATERS: readonly CraterSpot[] = [
  { x: 520, y: 360, r: 16 },
  { x: 760, y: 380, r: 14 },
  { x: 640, y: 440, r: 20 },
  { x: 580, y: 490, r: 12 },
  { x: 700, y: 495, r: 15 },
  { x: 490, y: 420, r: 10 },
  { x: 790, y: 430, r: 11 },
];

/**
 * How far a trench may wander. The left one stays in x 440 to 500 and the right in 780 to 840
 * on the bottom edge, doglegs included, so the middle 280 pixels are never trench.
 */
export const TRENCH_BOUNDS = {
  left: { min: 440, max: 500 },
  right: { min: 780, max: 840 },
} as const;
/** Craters keep this far off a trench's middle, on the bottom edge, and stay inside the field. */
export const CRATER_CLEARANCE = 40;
export const CRATER_COUNT = { min: 5, max: 9 } as const;
export const CRATER_ROWS = { min: 250, max: 505 } as const;

function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function span(rand: () => number, lo: number, hi: number): number {
  return lo + (hi - lo) * rand();
}

function chooseTrench(rand: () => number, bounds: { min: number; max: number }): TrenchLine {
  const centre = Math.round(span(rand, bounds.min + 6, bounds.max - 6));
  let bend: Bend | undefined;
  if (rand() < 0.7) {
    // Slide toward whichever side has the room, never out of bounds.
    const room = { down: centre - bounds.min, up: bounds.max - centre };
    const dir = rand() < 0.5 ? -1 : 1;
    const limit = Math.min(26, dir < 0 ? room.down : room.up);
    if (limit >= 10) {
      bend = { from: Math.round(span(rand, 230, 420)), shift: dir * Math.round(span(rand, 10, limit)) };
    }
  }
  return bend ? { centre, bend } : { centre };
}

function chooseCraters(rand: () => number, left: TrenchLine, right: TrenchLine): CraterSpot[] {
  const count = CRATER_COUNT.min + Math.floor(rand() * (CRATER_COUNT.max - CRATER_COUNT.min + 1));
  // Doglegs move a trench's middle, so clear the whole range it can reach.
  const lowX = left.centre + Math.max(0, left.bend?.shift ?? 0) + CRATER_CLEARANCE;
  const highX = right.centre + Math.min(0, right.bend?.shift ?? 0) - CRATER_CLEARANCE;
  const spots: CraterSpot[] = [];
  for (let attempt = 0; attempt < 80 && spots.length < count; attempt += 1) {
    const spot = {
      x: Math.round(span(rand, lowX, highX)),
      y: Math.round(span(rand, CRATER_ROWS.min, CRATER_ROWS.max)),
      r: Math.round(span(rand, 9, 21)),
    };
    // Rough spacing, so two craters never merge into one blot.
    const crowded = spots.some((other) => Math.hypot(other.x - spot.x, (other.y - spot.y) * 1.6) < other.r + spot.r + 14);
    if (!crowded) spots.push(spot);
  }
  return spots;
}

function chooseClusters(rand: () => number): TrenchCluster[] {
  const clusters: TrenchCluster[] = [];
  for (const trench of [0, 1] as const) {
    const count = 1 + Math.floor(rand() * 3);
    let last = 0;
    for (let i = 0; i < count; i += 1) {
      const plan = Math.round(span(rand, 190 + i * 100, 270 + i * 100));
      if (plan - last < 60) continue;
      last = plan;
      const bags = rand() < 0.55;
      clusters.push({
        trench,
        kind: bags ? "bags" : "revetment",
        plan,
        size: bags ? 2 + Math.floor(rand() * 3) : Math.round(span(rand, 40, 90)),
        // Heaps stand on the outer side with the parapet; timber faces the inside of the wall.
        side: (bags ? (trench === 0 ? -1 : 1) : (trench === 0 ? 1 : -1)) as -1 | 1,
      });
    }
  }
  return clusters;
}

/**
 * The same two trenches and seven craters every field used to have, with no clusters.
 * Give it a seed and the field gets its own layout; no seed gives this back, so the old fields
 * and the plain theatre ground do not change.
 */
export function groundLayout(seed?: number): GroundLayout {
  if (seed === undefined) {
    return {
      trenches: [{ centre: DEFAULT_TRENCH_CENTRES[0] }, { centre: DEFAULT_TRENCH_CENTRES[1] }],
      craters: DEFAULT_CRATERS.map((c) => ({ ...c })),
      clusters: [],
    };
  }
  const rand = seededRandom(seed ^ 0x5eed1e55);
  const left = chooseTrench(rand, TRENCH_BOUNDS.left);
  const right = chooseTrench(rand, TRENCH_BOUNDS.right);
  return {
    trenches: [left, right],
    craters: chooseCraters(rand, left, right),
    clusters: chooseClusters(rand),
  };
}

function bagAt(ctx: Paint, centre: number, offset: number, plan: number, lift: number): void {
  const y = Math.round(squashY(plan));
  const h = Math.max(2, Math.round(squashY(plan + 5)) - y);
  const { x, width } = trackAt(centre, offset, offset + 7, y);
  const top = y - lift * (h - 1);
  fill(ctx, P.tan, x, top, width, h);
  if (width >= 3 && h >= 3) {
    fill(ctx, P.cream, x + 1, top + 1, width - 2, Math.max(1, Math.round(h * 0.4)));
    fill(ctx, P.brown, x, top + h - 1, width);
  }
}

/** A heap of sandbags beside a trench: `size` along the bottom row, then one fewer, and so on. */
export function paintBagHeap(ctx: Paint, centre: number, offset: number, plan: number, size: number, bend?: Bend): void {
  const c = centre + bendOffset(bend, plan);
  for (let row = 0; row < size; row += 1) {
    const count = size - row;
    for (let i = 0; i < count; i += 1) {
      // Rows stagger half a bag; each bag is 7 wide on the bottom edge.
      bagAt(ctx, c, offset + i * 7 + row * 3, plan, row);
    }
  }
}

/** Timber facing on a stretch of trench wall: upright planks with a darker post every few rows. */
export function paintRevetment(ctx: Paint, centre: number, side: -1 | 1, plan: number, length: number, bend?: Bend): void {
  const from = side < 0 ? -6 : 3;
  const to = from + 3;
  planRows(plan, plan + length, (y, row) => {
    const bandNo = Math.floor((row - plan) / 6);
    const hit = trackAt(centre + bendOffset(bend, row), from, to, y);
    fill(ctx, bandNo % 2 === 0 ? P.khaki : P.tan, hit.x, y, hit.width);
    if ((row - plan) % 18 < 2) fill(ctx, P.brown, hit.x, y, hit.width);
  });
  // A dark lip on the inner edge, so the wall reads as a wall.
  planRows(plan, plan + length, (y, row) => {
    const lip = trackAt(centre + bendOffset(bend, row), side < 0 ? -6 : 5, side < 0 ? -5 : 6, y);
    fill(ctx, P.charcoal, lip.x, y, lip.width);
  });
}

/** Every cluster in a layout, painted after the trenches and parapets. */
export function paintTrenchClusters(ctx: Paint, layout: GroundLayout): void {
  for (const cluster of layout.clusters) {
    const line = layout.trenches[cluster.trench];
    if (cluster.kind === "bags") {
      // Outside the parapet, which ends at -8 on the left and starts at 5 on the right.
      paintBagHeap(ctx, line.centre, cluster.side < 0 ? -18 - cluster.size * 7 : 14, cluster.plan, cluster.size, line.bend);
    } else {
      paintRevetment(ctx, line.centre, cluster.side, cluster.plan, cluster.size, line.bend);
    }
  }
}
