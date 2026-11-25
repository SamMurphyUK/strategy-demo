// What is drawn on the land besides its colour: the rivers, the roads, and the grain. Pure.
//
// Rivers and roads are lines, and the land's shader draws them from a distance field: a sheet over
// the whole board that holds, for each point, the way to the nearest river and the way to the
// nearest road. The lines are baked once. Their width, colour, and strength are numbers the shader
// is sent, so a slider never bakes anything. Nothing is cut into the land: a river is paint and a
// bank is shading.
//
// This is set dressing, like the forests and the ranges in geography.ts. No rule reads it.
import type { Rect, Vec2 } from "../map/geometry";
import { biomeAtMap, lonLatToMap, WORLD_WIDTH } from "./geography";

/** The furthest distance the sheet can tell, in world units. Past it a point is simply far. */
export const GROUND_REACH = 2.5;
/** Texels of the sheet per world unit. */
export const GROUND_SCALE = 2.5;

export interface Waterway {
  name: string;
  /**
   * The course from source to mouth. `lonLat` is longitude and latitude. `map` is map coordinates,
   * for the rivers of Europe and the Nile: the board's seas are wider than the real ones there, so
   * a real course would run out over open water.
   */
  lonLat?: readonly (readonly [number, number])[];
  map?: readonly (readonly [number, number])[];
}

export const RIVERS: readonly Waterway[] = [
  { name: "Rhine", map: [[277.5, 218.6], [273.5, 213.5], [268.5, 208.5], [263.5, 204.5], [259.5, 201.8], [257.2, 200.6]] },
  { name: "Danube", map: [[286.6, 221.4], [293, 223.2], [300.5, 224], [308, 225.2], [317, 227.2], [325, 230], [330.5, 232.6], [334.4, 233.6]] },
  { name: "Elbe", map: [[299, 224], [297, 217], [292, 210], [286.5, 203], [282.5, 196], [280.6, 189.6]] },
  { name: "Seine", map: [[270, 222], [264, 218], [257, 214], [251, 211.6], [246.6, 210.6]] },
  { name: "Po", map: [[266.5, 231], [272, 229.6], [278, 229.6], [283.6, 230.6]] },
  { name: "Vistula", map: [[309, 226], [311.5, 217], [309, 207], [306.6, 197], [305.2, 188.4]] },
  { name: "Dnieper", map: [[341, 207], [339.6, 212], [340.2, 217], [341.6, 221], [342, 224.6]] },
  { name: "Don", map: [[352, 212], [355, 216], [358, 219.6], [358, 223.2]] },
  { name: "Nile", map: [[337, 334], [335.5, 326], [333.6, 318], [334, 310], [335.6, 303], [337.6, 298.2]] },
  { name: "Volga", lonLat: [[33.0, 57.0], [35.9, 56.9], [40.9, 57.8], [44.0, 56.3], [49.1, 55.8], [49.4, 53.5], [50.1, 53.2], [46.0, 51.5], [44.5, 48.7], [46.5, 47.6], [48.0, 46.3]] },
  { name: "Ural", lonLat: [[59.0, 54.0], [58.6, 51.2], [55.0, 51.7], [51.4, 51.2], [51.9, 47.1]] },
  { name: "Ob", lonLat: [[85.0, 52.0], [83.0, 55.0], [77.0, 59.5], [69.0, 61.0], [66.6, 66.5]] },
  { name: "Irtysh", lonLat: [[84.0, 48.0], [80.2, 50.4], [73.4, 55.0], [68.3, 58.2], [69.0, 61.0]] },
  { name: "Yenisei", lonLat: [[92.9, 56.0], [90.0, 61.6], [87.5, 65.8], [86.2, 69.4], [82.7, 71.5]] },
  { name: "Lena", lonLat: [[107.0, 54.0], [108.0, 57.8], [115.0, 60.4], [122.0, 60.0], [129.7, 62.0], [127.0, 66.8], [126.5, 72.0]] },
  { name: "Amur", lonLat: [[117.0, 49.5], [121.5, 53.3], [127.5, 50.0], [131.0, 47.7], [135.0, 48.4], [137.0, 50.5], [140.5, 53.0]] },
  { name: "Yellow River", lonLat: [[100.2, 35.5], [103.8, 36.0], [106.7, 38.0], [107.0, 40.5], [110.0, 40.6], [111.2, 39.5], [110.4, 35.0], [113.6, 34.9], [116.0, 36.0], [118.5, 37.7]] },
  { name: "Yangtze", lonLat: [[99.0, 28.0], [101.8, 26.5], [104.6, 28.8], [106.5, 29.5], [108.4, 30.8], [111.3, 30.7], [112.9, 29.8], [114.3, 30.6], [116.0, 29.7], [117.0, 30.5], [118.7, 32.0], [121.0, 31.8]] },
  { name: "Mekong", lonLat: [[100.1, 20.3], [102.6, 18.0], [104.8, 16.5], [105.8, 13.5], [105.0, 11.5], [106.3, 10.0]] },
  { name: "Ganges", lonLat: [[78.2, 30.0], [80.3, 26.5], [82.0, 25.4], [85.1, 25.6], [87.9, 25.0], [89.0, 23.5], [90.5, 22.5]] },
  { name: "Indus", lonLat: [[75.0, 35.3], [72.9, 34.0], [71.5, 32.0], [70.9, 29.5], [69.0, 27.5], [68.3, 25.4], [67.5, 24.0]] },
  { name: "Euphrates", lonLat: [[39.0, 38.8], [38.0, 36.8], [40.2, 35.3], [42.5, 34.0], [44.3, 32.5], [46.0, 31.2], [47.4, 31.0], [48.5, 30.0]] },
  { name: "Tigris", lonLat: [[40.2, 37.9], [42.0, 37.3], [43.1, 36.3], [44.4, 33.3], [46.0, 32.2], [47.4, 31.0]] },
  { name: "Niger", lonLat: [[-8.0, 12.6], [-3.0, 16.8], [0.0, 16.5], [2.1, 13.5], [4.4, 11.0], [6.7, 7.8], [6.0, 4.5]] },
  { name: "Congo", lonLat: [[25.2, 0.5], [21.0, 2.0], [18.0, 0.0], [16.2, -2.5], [15.3, -4.3], [13.0, -5.8], [12.4, -6.0]] },
  { name: "Zambezi", lonLat: [[23.0, -14.0], [25.9, -17.9], [28.8, -16.5], [32.7, -16.2], [35.3, -17.7], [36.3, -18.8]] },
  { name: "Mississippi", lonLat: [[-93.3, 45.0], [-91.2, 43.0], [-90.6, 41.5], [-90.2, 38.6], [-89.2, 37.0], [-90.0, 35.1], [-91.2, 32.3], [-91.2, 30.5], [-89.9, 29.9], [-89.3, 29.1]] },
  { name: "Missouri", lonLat: [[-111.0, 47.5], [-104.0, 48.0], [-100.8, 46.8], [-98.9, 43.8], [-96.0, 41.3], [-94.6, 39.1], [-90.2, 38.7]] },
  { name: "Ohio", lonLat: [[-80.0, 40.4], [-82.5, 38.7], [-85.7, 38.3], [-87.6, 37.9], [-89.1, 37.0]] },
  { name: "Saint Lawrence", lonLat: [[-76.5, 44.2], [-73.6, 45.5], [-71.2, 46.8], [-68.5, 48.5]] },
  { name: "Mackenzie", lonLat: [[-117.0, 61.3], [-123.5, 62.0], [-125.5, 65.0], [-130.0, 67.5], [-134.0, 69.0]] },
  { name: "Columbia", lonLat: [[-118.0, 49.0], [-119.5, 46.5], [-121.2, 45.7], [-123.8, 46.2]] },
  { name: "Colorado", lonLat: [[-108.5, 39.1], [-110.5, 37.0], [-113.5, 36.2], [-114.6, 34.0], [-114.8, 32.0]] },
  { name: "Rio Grande", lonLat: [[-106.5, 35.0], [-106.5, 31.8], [-104.0, 29.5], [-101.0, 29.4], [-99.5, 27.5], [-97.2, 25.9]] },
  { name: "Amazon", lonLat: [[-73.5, -4.5], [-70.0, -4.2], [-66.0, -3.0], [-60.0, -3.1], [-55.5, -2.0], [-52.0, -1.5], [-50.5, -0.5]] },
  { name: "Orinoco", lonLat: [[-67.5, 3.0], [-67.4, 6.2], [-64.0, 8.0], [-62.0, 8.5], [-61.0, 9.0]] },
  { name: "Parana", lonLat: [[-51.0, -20.0], [-54.5, -25.5], [-57.6, -27.5], [-59.5, -30.0], [-60.6, -32.9], [-58.4, -34.0]] },
  { name: "Murray", lonLat: [[147.0, -36.0], [144.0, -35.6], [141.0, -34.2], [139.6, -34.6], [139.3, -35.5]] },
];

function hash(ix: number, iy: number, salt: number): number {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

/** A point on the Catmull-Rom curve through `b` and `c`, with `a` and `d` either side. */
function spline(a: Vec2, b: Vec2, c: Vec2, d: Vec2, t: number): Vec2 {
  const t2 = t * t;
  const t3 = t2 * t;
  const at = (p0: number, p1: number, p2: number, p3: number) =>
    0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3);
  return { x: at(a.x, b.x, c.x, d.x), y: at(a.y, b.y, c.y, d.y) };
}

/** A smooth curve through the points of a line, as points about `spacing` apart. The ends are kept. */
export function smoothLine(points: readonly Vec2[], spacing: number): Vec2[] {
  if (points.length < 3) {
    return points.map((p) => ({ x: p.x, y: p.y }));
  }
  const out: Vec2[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[i];
    const c = points[i + 1];
    const d = points[Math.min(points.length - 1, i + 2)];
    const steps = Math.max(1, Math.round(Math.hypot(c.x - b.x, c.y - b.y) / spacing));
    for (let s = 0; s < steps; s++) {
      out.push(spline(a, b, c, d, s / steps));
    }
  }
  const last = points[points.length - 1];
  out.push({ x: last.x, y: last.y });
  return out;
}

/** Bends a line from side to side by up to `reach`, none at its ends, so it wanders the way water does. */
function meander(points: readonly Vec2[], reach: number, salt: number): Vec2[] {
  const last = points.length - 1;
  return points.map((p, i) => {
    if (i === 0 || i === last) {
      return { x: p.x, y: p.y };
    }
    const before = points[i - 1];
    const after = points[i + 1];
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const length = Math.hypot(dx, dy) || 1;
    const along = i * 0.37;
    const cell = Math.floor(along);
    const t = fade(along - cell);
    const sway = hash(cell, 0, salt) * (1 - t) + hash(cell + 1, 0, salt) * t - 0.5;
    const ends = Math.min(1, Math.min(i, last - i) / 3);
    return { x: p.x + (-dy / length) * sway * 2 * reach * ends, y: p.y + (dx / length) * sway * 2 * reach * ends };
  });
}

/** Every river as a smooth line of map points. A course that crosses the sheet's seam keeps going past its edge. */
export function riverLines(rivers: readonly Waterway[] = RIVERS): Vec2[][] {
  return rivers.map((river, index) => {
    let course: Vec2[];
    if (river.map) {
      course = river.map.map(([x, y]) => ({ x, y }));
    } else {
      course = [];
      for (const [lon, lat] of river.lonLat ?? []) {
        const p = lonLatToMap(lon, lat);
        const previous = course[course.length - 1];
        // The short way round the world from the point before.
        if (previous) {
          while (p.x - previous.x > WORLD_WIDTH / 2) {
            p.x -= WORLD_WIDTH;
          }
          while (previous.x - p.x > WORLD_WIDTH / 2) {
            p.x += WORLD_WIDTH;
          }
        }
        course.push(p);
      }
    }
    return meander(smoothLine(course, 1.1), 0.5, index + 1);
  });
}

function pathOpen(a: Vec2, b: Vec2, open: (p: Vec2) => boolean): boolean {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(2, Math.ceil(length / 1.5));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (!open({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })) {
      return false;
    }
  }
  return true;
}

export interface RoadOptions {
  /** The furthest apart two places a single road joins may be, in world units. */
  reach?: number;
  /** A second road joins two places when the way round by the others is this many times the direct way. */
  detour?: number;
  /** A road that has to go round a bay or a range may be this many times the straight distance, and no longer. */
  winding?: number;
}

/** The grid a road is routed on when it cannot run straight, in world units. */
export const ROAD_STEP = 2;

const ROAD_NEIGHBOURS: readonly (readonly [number, number, number])[] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/**
 * The shortest way from `a` to `b` over open ground, on a grid of `ROAD_STEP`, or null when there
 * is none shorter than `limit`. It keeps a step back from closed ground where it can, so a road
 * does not run along the lip of a cliff. The search stays in a box round the two places.
 */
function routeRound(a: Vec2, b: Vec2, open: (p: Vec2) => boolean, limit: number): { course: Vec2[]; length: number } | null {
  const s = ROAD_STEP;
  const straight = Math.hypot(b.x - a.x, b.y - a.y);
  const pad = Math.max(6, Math.ceil((straight * 0.5) / s));
  const x0 = Math.floor(Math.min(a.x, b.x) / s) - pad;
  const y0 = Math.floor(Math.min(a.y, b.y) / s) - pad;
  const columns = Math.ceil(Math.max(a.x, b.x) / s) + pad - x0 + 1;
  const rows = Math.ceil(Math.max(a.y, b.y) / s) + pad - y0 + 1;
  const count = columns * rows;
  const cellOf = (p: Vec2) => (Math.round(p.y / s) - y0) * columns + (Math.round(p.x / s) - x0);
  const start = cellOf(a);
  const goal = cellOf(b);

  // 0 not asked yet, 1 open, 2 closed. The two ends are places, and a place is open.
  const state = new Uint8Array(count);
  state[start] = 1;
  state[goal] = 1;
  const isOpen = (cell: number): boolean => {
    if (state[cell] === 0) {
      state[cell] = open({ x: ((cell % columns) + x0) * s, y: (Math.floor(cell / columns) + y0) * s }) ? 1 : 2;
    }
    return state[cell] === 1;
  };
  const crowded = (cell: number): boolean => {
    const cx = cell % columns;
    const cy = Math.floor(cell / columns);
    for (let k = 0; k < 4; k++) {
      const nx = cx + ROAD_NEIGHBOURS[k][0];
      const ny = cy + ROAD_NEIGHBOURS[k][1];
      if (nx < 0 || ny < 0 || nx >= columns || ny >= rows || !isOpen(ny * columns + nx)) {
        return true;
      }
    }
    return false;
  };

  const cost = new Float64Array(count).fill(Number.POSITIVE_INFINITY);
  const length = new Float64Array(count);
  const from = new Int32Array(count).fill(-1);
  const done = new Uint8Array(count);
  const gx = goal % columns;
  const gy = Math.floor(goal / columns);
  const ahead = (cell: number) => Math.hypot((cell % columns) - gx, Math.floor(cell / columns) - gy) * s;

  // A binary heap of [estimate, cell], smallest estimate first, ties by cell so the road is the same every time.
  const heap: [number, number][] = [];
  const before = (p: [number, number], q: [number, number]) => p[0] < q[0] || (p[0] === q[0] && p[1] < q[1]);
  const push = (item: [number, number]) => {
    let i = heap.length;
    heap.push(item);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!before(heap[i], heap[parent])) {
        break;
      }
      [heap[i], heap[parent]] = [heap[parent], heap[i]];
      i = parent;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let least = i;
        if (left < heap.length && before(heap[left], heap[least])) {
          least = left;
        }
        if (right < heap.length && before(heap[right], heap[least])) {
          least = right;
        }
        if (least === i) {
          break;
        }
        [heap[i], heap[least]] = [heap[least], heap[i]];
        i = least;
      }
    }
    return top;
  };

  cost[start] = 0;
  push([ahead(start), start]);
  while (heap.length > 0) {
    const [, cell] = pop();
    if (done[cell]) {
      continue;
    }
    done[cell] = 1;
    if (cell === goal) {
      break;
    }
    const cx = cell % columns;
    const cy = Math.floor(cell / columns);
    for (const [dx, dy, span] of ROAD_NEIGHBOURS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= columns || ny >= rows) {
        continue;
      }
      const next = ny * columns + nx;
      if (done[next] || !isOpen(next)) {
        continue;
      }
      // A diagonal step does not cut the corner of closed ground.
      if (dx !== 0 && dy !== 0 && (!isOpen(cy * columns + nx) || !isOpen(ny * columns + cx))) {
        continue;
      }
      const stride = span * s;
      if (length[cell] + stride + ahead(next) > limit) {
        continue;
      }
      const priced = cost[cell] + stride * (next !== goal && crowded(next) ? 1.7 : 1);
      if (priced < cost[next]) {
        cost[next] = priced;
        length[next] = length[cell] + stride;
        from[next] = cell;
        push([priced + ahead(next), next]);
      }
    }
  }
  if (!done[goal]) {
    return null;
  }

  const cells: number[] = [];
  for (let cell = goal; cell !== -1; cell = from[cell]) {
    cells.push(cell);
  }
  cells.reverse();
  // Every third cell is a point of the road, which takes the stair-steps out of it.
  const course: Vec2[] = [a];
  for (let i = 2; i < cells.length - 2; i += 3) {
    course.push({ x: ((cells[i] % columns) + x0) * s, y: (Math.floor(cells[i] / columns) + y0) * s });
  }
  course.push(b);
  return { course, length: Math.max(length[goal], straight) };
}

/**
 * Roads between the board's capitals and factories. `hubs` are the places and `open` says whether
 * a point is passable ground. Two places within `reach` are joined by a straight road, gently
 * bowed, when the line between them stays on open ground; when it does not, by the shortest way
 * round, if that is not too winding. The network is the shortest set of roads that joins every
 * place it can reach, and a few more where the way round would be long. Each road is a line of
 * map points.
 */
export function planRoads(hubs: readonly Vec2[], open: (p: Vec2) => boolean, options: RoadOptions = {}): Vec2[][] {
  const reach = options.reach ?? 80;
  const detour = options.detour ?? 2.3;
  const winding = options.winding ?? 1.7;
  const candidates: { a: number; b: number; length: number; course?: Vec2[] }[] = [];
  for (let a = 0; a < hubs.length; a++) {
    for (let b = a + 1; b < hubs.length; b++) {
      const length = Math.hypot(hubs[b].x - hubs[a].x, hubs[b].y - hubs[a].y);
      if (length <= 0.5 || length > reach) {
        continue;
      }
      if (pathOpen(hubs[a], hubs[b], open)) {
        candidates.push({ a, b, length });
        continue;
      }
      const round = routeRound(hubs[a], hubs[b], open, length * winding);
      if (round) {
        candidates.push({ a, b, length: round.length, course: round.course });
      }
    }
  }
  candidates.sort((p, q) => p.length - q.length || p.a - q.a || p.b - q.b);

  const group = hubs.map((_, i) => i);
  const find = (i: number): number => {
    while (group[i] !== i) {
      group[i] = group[group[i]];
      i = group[i];
    }
    return i;
  };
  const links: typeof candidates = [];
  const spare: typeof candidates = [];
  for (const edge of candidates) {
    const ra = find(edge.a);
    const rb = find(edge.b);
    if (ra === rb) {
      spare.push(edge);
    } else {
      group[ra] = rb;
      links.push(edge);
    }
  }
  /** Length of the way from one place to another along the roads so far. */
  const wayRound = (from: number, to: number): number => {
    const best = hubs.map(() => Number.POSITIVE_INFINITY);
    best[from] = 0;
    const frontier = new Set<number>([from]);
    while (frontier.size > 0) {
      let at = -1;
      for (const i of frontier) {
        if (at < 0 || best[i] < best[at]) {
          at = i;
        }
      }
      frontier.delete(at);
      if (at === to) {
        break;
      }
      for (const link of links) {
        const next = link.a === at ? link.b : link.b === at ? link.a : -1;
        if (next >= 0 && best[at] + link.length < best[next]) {
          best[next] = best[at] + link.length;
          frontier.add(next);
        }
      }
    }
    return best[to];
  };
  for (const edge of spare) {
    if (wayRound(edge.a, edge.b) > detour * edge.length) {
      links.push(edge);
    }
  }

  return links.map((link) => {
    if (link.course) {
      return smoothLine(link.course, 1.4);
    }
    const a = hubs[link.a];
    const b = hubs[link.b];
    // A road is not ruled: it bows a little to one side, by a twentieth of its length at most.
    const side = (hash(link.a, link.b, 91) - 0.5) * 2;
    const bow = Math.min(2.4, link.length * 0.05) * side;
    const nx = -(b.y - a.y) / link.length;
    const ny = (b.x - a.x) / link.length;
    const course = [
      a,
      { x: a.x + (b.x - a.x) * 0.33 + nx * bow, y: a.y + (b.y - a.y) * 0.33 + ny * bow },
      { x: a.x + (b.x - a.x) * 0.67 + nx * bow, y: a.y + (b.y - a.y) * 0.67 + ny * bow },
      b,
    ];
    return smoothLine(course, 1.4);
  });
}

/** The byte a component of a stored vector takes: 128 is none, and 1 and 255 are a whole reach either way. */
export function vectorByte(component: number): number {
  return Math.min(255, Math.max(1, Math.round(128 + (component / GROUND_REACH) * 127)));
}

/** The component a stored byte stands for, in world units. What the shader does to read it. */
export function vectorOfByte(byte: number): number {
  return ((byte - 128) / 127) * GROUND_REACH;
}

/**
 * Writes, for each texel near one of `lines`, the vector from the nearest point of a line to the
 * texel, into two channels of an RGBA sheet starting at `channel`. The vector is in scene
 * coordinates: x east, y north. Its length is the distance to the line, and it is stored as a
 * vector because a vector reads back true between texels. A bare distance does not: it has a
 * crease along the line, and a line thinner than a texel would come out in beads.
 *
 * A texel further than `GROUND_REACH` keeps what it had; a fresh sheet holds 255, a whole reach
 * each way. Rows run up the sheet, the way a texture's do. The world repeats sideways, and so
 * does a line.
 */
export function bakeLineField(
  data: Uint8Array,
  width: number,
  height: number,
  channel: number,
  bounds: Rect,
  lines: readonly (readonly Vec2[])[],
): void {
  const sx = width / bounds.w;
  const sy = height / bounds.h;
  const pad = GROUND_REACH;
  const reach2 = GROUND_REACH * GROUND_REACH;
  const best = new Float32Array(width * height).fill(reach2);
  for (const line of lines) {
    for (let i = 0; i + 1 < line.length; i++) {
      for (const shift of [0, -bounds.w, bounds.w]) {
        const ax = line[i].x + shift;
        const ay = line[i].y;
        const bx = line[i + 1].x + shift;
        const by = line[i + 1].y;
        const x0 = Math.max(0, Math.floor((Math.min(ax, bx) - pad - bounds.x) * sx));
        const x1 = Math.min(width - 1, Math.ceil((Math.max(ax, bx) + pad - bounds.x) * sx));
        const y0 = Math.max(0, Math.floor((Math.min(ay, by) - pad - bounds.y) * sy));
        const y1 = Math.min(height - 1, Math.ceil((Math.max(ay, by) + pad - bounds.y) * sy));
        if (x0 > x1 || y0 > y1) {
          continue;
        }
        const dx = bx - ax;
        const dy = by - ay;
        const span = dx * dx + dy * dy;
        for (let ty = y0; ty <= y1; ty++) {
          const py = bounds.y + (ty + 0.5) / sy;
          const row = (height - 1 - ty) * width;
          for (let tx = x0; tx <= x1; tx++) {
            const px = bounds.x + (tx + 0.5) / sx;
            const t = span > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / span)) : 0;
            const ex = px - (ax + dx * t);
            const ey = py - (ay + dy * t);
            const d2 = ex * ex + ey * ey;
            if (d2 < best[row + tx]) {
              best[row + tx] = d2;
              const at = (row + tx) * 4 + channel;
              data[at] = vectorByte(ex);
              // Map y runs down the sheet and scene y runs up it.
              data[at + 1] = vectorByte(-ey);
            }
          }
        }
      }
    }
  }
}

export interface GroundSheet {
  width: number;
  height: number;
  /** RGBA, rows running up the sheet: the vector from the nearest river, then the vector from the nearest road. */
  data: Uint8Array;
}

/** The sheet for a board. `rivers` and `roads` are lines of map points; either may be empty. */
export function buildGroundSheet(bounds: Rect, rivers: readonly (readonly Vec2[])[], roads: readonly (readonly Vec2[])[]): GroundSheet {
  const width = Math.max(1, Math.round(bounds.w * GROUND_SCALE));
  const height = Math.max(1, Math.round(bounds.h * GROUND_SCALE));
  const data = new Uint8Array(width * height * 4).fill(255);
  bakeLineField(data, width, height, 0, bounds, rivers);
  bakeLineField(data, width, height, 2, bounds, roads);
  return { width, height, data };
}

/** 1 where the ground is sand, ice, or bare tundra, whose grain is fine. 0 where it is flock and soil. */
export function fineGround(p: Vec2): number {
  const biome = biomeAtMap(p);
  return biome === "desert" || biome === "ice" || biome === "tundra" ? 1 : 0;
}

/** World units between two samples of the ground cover. It changes over tens of units. */
export const COVER_STEP = 4;

export interface CoverSheet {
  width: number;
  height: number;
  /** One byte a sample, rows running up the sheet: 255 is fine ground. */
  data: Uint8Array;
}

/** Where the grain is fine, as a small sheet the shader reads smoothly between samples. */
export function buildCoverSheet(bounds: Rect, fine: (p: Vec2) => number = fineGround): CoverSheet {
  const width = Math.max(1, Math.round(bounds.w / COVER_STEP));
  const height = Math.max(1, Math.round(bounds.h / COVER_STEP));
  const data = new Uint8Array(width * height);
  for (let ty = 0; ty < height; ty++) {
    const y = bounds.y + ((ty + 0.5) / height) * bounds.h;
    for (let tx = 0; tx < width; tx++) {
      const x = bounds.x + ((tx + 0.5) / width) * bounds.w;
      data[(height - 1 - ty) * width + tx] = Math.round(Math.min(1, Math.max(0, fine({ x, y }))) * 255);
    }
  }
  return { width, height, data };
}

/** A slope is stored as half a byte's range either side of 128, times this. Low enough that none clips. */
export const GRAIN_SLOPE_GAIN = 1.6;

/**
 * The grain: a square tile that repeats with no seam. Red and green are the slope of a rough
 * surface along the tile's two sides, 128 for level; blue is its height. Five sizes of bump from
 * an eighth of the tile down to two texels, the small ones nearly as strong as the large, which is
 * what makes it read as flock and grit and not as hills.
 */
export function grainTile(size = 256): Uint8Array {
  const octaves = [
    { cells: 8, weight: 0.28 },
    { cells: 16, weight: 0.24 },
    { cells: 32, weight: 0.2 },
    { cells: 64, weight: 0.16 },
    { cells: 128, weight: 0.12 },
  ];
  const height = new Float32Array(size * size);
  for (const [index, octave] of octaves.entries()) {
    const cells = Math.min(octave.cells, size);
    const scale = cells / size;
    for (let y = 0; y < size; y++) {
      const gy = y * scale;
      const iy = Math.floor(gy);
      const fy = fade(gy - iy);
      for (let x = 0; x < size; x++) {
        const gx = x * scale;
        const ix = Math.floor(gx);
        const fx = fade(gx - ix);
        const a = hash(ix % cells, iy % cells, index + 31);
        const b = hash((ix + 1) % cells, iy % cells, index + 31);
        const c = hash(ix % cells, (iy + 1) % cells, index + 31);
        const d = hash((ix + 1) % cells, (iy + 1) % cells, index + 31);
        height[y * size + x] += (a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy) * octave.weight;
      }
    }
  }
  const data = new Uint8Array(size * size * 4);
  const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  const byte = (value: number) => Math.min(255, Math.max(0, Math.round(value * 255)));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      data[i] = byte(0.5 + (at(x + 1, y) - at(x - 1, y)) * GRAIN_SLOPE_GAIN);
      data[i + 1] = byte(0.5 + (at(x, y + 1) - at(x, y - 1)) * GRAIN_SLOPE_GAIN);
      data[i + 2] = byte(at(x, y));
      data[i + 3] = 255;
    }
  }
  return data;
}
