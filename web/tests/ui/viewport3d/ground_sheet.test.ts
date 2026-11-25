import { describe, expect, it } from "vitest";
import {
  bakeLineField,
  buildCoverSheet,
  buildGroundSheet,
  COVER_STEP,
  GRAIN_SLOPE_GAIN,
  grainTile,
  GROUND_REACH,
  GROUND_SCALE,
  planRoads,
  riverLines,
  RIVERS,
  smoothLine,
  vectorByte,
  vectorOfByte,
} from "../../../src/ui/viewport3d/groundSheet";

const BOUNDS = { x: 0, y: 0, w: 40, h: 20 };

/** The vector the shader reads at a map point, between the texels, the way a linear filter does. */
function readVector(data: Uint8Array, width: number, height: number, channel: number, p: { x: number; y: number }): { x: number; y: number } {
  const u = (p.x / BOUNDS.w) * width - 0.5;
  const v = (1 - p.y / BOUNDS.h) * height - 0.5;
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const fx = u - x0;
  const fy = v - y0;
  const at = (x: number, y: number, c: number) => vectorOfByte(data[(Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))) * 4 + c]);
  const mix = (c: number) =>
    at(x0, y0, c) * (1 - fx) * (1 - fy) + at(x0 + 1, y0, c) * fx * (1 - fy) + at(x0, y0 + 1, c) * (1 - fx) * fy + at(x0 + 1, y0 + 1, c) * fx * fy;
  return { x: mix(channel), y: mix(channel + 1) };
}

describe("the world's rivers", () => {
  it("names the great ones, each once", () => {
    const names = RIVERS.map((river) => river.name);
    for (const name of ["Rhine", "Danube", "Volga", "Nile", "Yangtze", "Mississippi", "Amazon", "Ganges"]) {
      expect(names).toContain(name);
    }
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives every river a course of at least two points, one way or the other", () => {
    for (const river of RIVERS) {
      const course = river.map ?? river.lonLat;
      expect(course, river.name).toBeDefined();
      expect(course!.length, river.name).toBeGreaterThanOrEqual(2);
      expect(Boolean(river.map) !== Boolean(river.lonLat), river.name).toBe(true);
    }
  });

  it("draws each as a smooth line that starts and ends where its course does", () => {
    const lines = riverLines();
    expect(lines.length).toBe(RIVERS.length);
    RIVERS.forEach((river, i) => {
      const line = lines[i];
      expect(line.length, river.name).toBeGreaterThan(river.map?.length ?? river.lonLat!.length);
      if (river.map) {
        expect(line[0].x).toBeCloseTo(river.map[0][0], 6);
        expect(line[0].y).toBeCloseTo(river.map[0][1], 6);
        const end = river.map[river.map.length - 1];
        expect(line[line.length - 1].x).toBeCloseTo(end[0], 6);
        expect(line[line.length - 1].y).toBeCloseTo(end[1], 6);
      }
      for (let k = 0; k + 1 < line.length; k++) {
        // No leap across the sheet: a river that crosses the seam carries on past the edge.
        expect(Math.hypot(line[k + 1].x - line[k].x, line[k + 1].y - line[k].y), river.name).toBeLessThan(6);
      }
    });
    // The same lines every time.
    expect(riverLines()).toEqual(lines);
  });
});

describe("a smooth line", () => {
  it("passes through every point it was given", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 4 },
      { x: 20, y: -3 },
      { x: 30, y: 0 },
    ];
    const line = smoothLine(points, 1);
    for (const point of points) {
      expect(line.some((p) => Math.hypot(p.x - point.x, p.y - point.y) < 1e-9)).toBe(true);
    }
    expect(line.length).toBeGreaterThan(25);
    expect(smoothLine(points.slice(0, 2), 1)).toEqual(points.slice(0, 2));
  });
});

describe("the ground sheet", () => {
  it("stores a vector a byte each way, with none at 128", () => {
    expect(vectorByte(0)).toBe(128);
    expect(vectorOfByte(128)).toBe(0);
    expect(vectorOfByte(vectorByte(1))).toBeCloseTo(1, 1);
    expect(vectorOfByte(vectorByte(-1.3))).toBeCloseTo(-1.3, 1);
    expect(vectorByte(99)).toBe(255);
    expect(vectorByte(-99)).toBe(1);
    expect(vectorOfByte(255)).toBeCloseTo(GROUND_REACH, 9);
  });

  it("knows how far a point is from a line, to a few hundredths, even on the line itself", () => {
    const width = BOUNDS.w * 4;
    const height = BOUNDS.h * 4;
    const data = new Uint8Array(width * height * 4).fill(255);
    // A slanted line, so it runs between the texel centres and not along them.
    const a = { x: 6, y: 5.13 };
    const b = { x: 34, y: 14.37 };
    bakeLineField(data, width, height, 0, BOUNDS, [[a, b]]);
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const along = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    const across = { x: -along.y, y: along.x };
    for (const t of [0.2, 0.35, 0.5, 0.65, 0.8]) {
      for (const d of [-1.4, -0.6, -0.15, -0.05, 0, 0.05, 0.15, 0.6, 1.4]) {
        const p = { x: a.x + along.x * length * t + across.x * d, y: a.y + along.y * length * t + across.y * d };
        const way = readVector(data, width, height, 0, p);
        expect(Math.hypot(way.x, way.y)).toBeCloseTo(Math.abs(d), 1);
        expect(Math.abs(Math.hypot(way.x, way.y) - Math.abs(d))).toBeLessThan(0.04);
      }
    }
  });

  it("points away from the line, in scene coordinates", () => {
    const width = BOUNDS.w * 4;
    const height = BOUNDS.h * 4;
    const data = new Uint8Array(width * height * 4).fill(255);
    bakeLineField(data, width, height, 2, BOUNDS, [
      [
        { x: 5, y: 10 },
        { x: 35, y: 10 },
      ],
    ]);
    // Up the map is north in the scene.
    const north = readVector(data, width, height, 2, { x: 20, y: 9 });
    expect(north.x).toBeCloseTo(0, 1);
    expect(north.y).toBeCloseTo(1, 1);
    const south = readVector(data, width, height, 2, { x: 20, y: 11.5 });
    expect(south.y).toBeCloseTo(-1.5, 1);
    // The other pair of channels was left alone.
    expect(data[0]).toBe(255);
    expect(data[1]).toBe(255);
  });

  it("leaves far ground a whole reach away, and repeats a line across the seam", () => {
    const width = BOUNDS.w * 4;
    const height = BOUNDS.h * 4;
    const data = new Uint8Array(width * height * 4).fill(255);
    bakeLineField(data, width, height, 0, BOUNDS, [
      [
        { x: 38, y: 10 },
        { x: 43, y: 10 },
      ],
    ]);
    const far = readVector(data, width, height, 0, { x: 20, y: 3 });
    expect(Math.hypot(far.x, far.y)).toBeGreaterThanOrEqual(GROUND_REACH);
    // Past the east edge is the west edge again.
    const wrapped = readVector(data, width, height, 0, { x: 2, y: 10.5 });
    expect(Math.hypot(wrapped.x, wrapped.y)).toBeCloseTo(0.5, 1);
  });

  it("holds rivers in the first two channels and roads in the last two", () => {
    const river = [
      { x: 5, y: 5 },
      { x: 35, y: 5 },
    ];
    const road = [
      { x: 5, y: 15 },
      { x: 35, y: 15 },
    ];
    const sheet = buildGroundSheet(BOUNDS, [river], [road]);
    expect(sheet.width).toBe(BOUNDS.w * GROUND_SCALE);
    expect(sheet.height).toBe(BOUNDS.h * GROUND_SCALE);
    expect(sheet.data.length).toBe(sheet.width * sheet.height * 4);
    const onRiver = { x: 20, y: 5.4 };
    const onRoad = { x: 20, y: 15.4 };
    const riverAtRiver = readVector(sheet.data, sheet.width, sheet.height, 0, onRiver);
    const roadAtRiver = readVector(sheet.data, sheet.width, sheet.height, 2, onRiver);
    const roadAtRoad = readVector(sheet.data, sheet.width, sheet.height, 2, onRoad);
    expect(Math.hypot(riverAtRiver.x, riverAtRiver.y)).toBeCloseTo(0.4, 1);
    expect(Math.hypot(roadAtRiver.x, roadAtRiver.y)).toBeGreaterThanOrEqual(GROUND_REACH);
    expect(Math.hypot(roadAtRoad.x, roadAtRoad.y)).toBeCloseTo(0.4, 1);
    // No lines, no marks.
    expect(buildGroundSheet(BOUNDS, [], []).data.every((byte) => byte === 255)).toBe(true);
  });
});

describe("where the grain is fine", () => {
  it("samples the ground cover on a coarse grid, rows running up the sheet", () => {
    const cover = buildCoverSheet(BOUNDS, (p) => (p.y < 10 ? 1 : 0));
    expect(cover.width).toBe(BOUNDS.w / COVER_STEP);
    expect(cover.height).toBe(BOUNDS.h / COVER_STEP);
    // The top of the map is the last row.
    expect(cover.data[(cover.height - 1) * cover.width]).toBe(255);
    expect(cover.data[0]).toBe(0);
  });
});

describe("the roads", () => {
  const open = () => true;

  it("join every place with the shortest set of roads", () => {
    const hubs = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 60, y: 0 },
      { x: 90, y: 0 },
    ];
    const roads = planRoads(hubs, open);
    expect(roads.length).toBe(3);
    for (const road of roads) {
      const length = Math.hypot(road[road.length - 1].x - road[0].x, road[road.length - 1].y - road[0].y);
      expect(length).toBeCloseTo(30, 6);
    }
  });

  it("start and end on their places, and bow a little between", () => {
    const hubs = [
      { x: 10, y: 10 },
      { x: 50, y: 30 },
    ];
    const [road] = planRoads(hubs, open);
    const ends = [road[0], road[road.length - 1]];
    for (const hub of hubs) {
      expect(ends.some((p) => Math.hypot(p.x - hub.x, p.y - hub.y) < 1e-9)).toBe(true);
    }
    const length = Math.hypot(40, 20);
    let off = 0;
    for (const p of road) {
      off = Math.max(off, Math.abs((p.x - 10) * 20 - (p.y - 10) * 40) / length);
    }
    expect(off).toBeGreaterThan(0);
    expect(off).toBeLessThanOrEqual(2.6);
  });

  it("do not cross water, a hole in the territories, or more than the reach", () => {
    const hubs = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
    ];
    // A strait down the middle.
    expect(planRoads(hubs, (p) => Math.abs(p.x - 20) > 2)).toEqual([]);
    expect(planRoads(hubs, open, { reach: 30 })).toEqual([]);
    expect(planRoads(hubs, open, { reach: 50 }).length).toBe(1);
    expect(planRoads([], open)).toEqual([]);
    expect(planRoads([hubs[0]], open)).toEqual([]);
  });

  it("go round a range that stands between two places, on open ground all the way", () => {
    const hubs = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
    ];
    // A range across the straight line, ten units deep each way.
    const range = (p: { x: number; y: number }) => Math.abs(p.x - 20) < 4 && Math.abs(p.y) < 10;
    const [road] = planRoads(hubs, (p) => !range(p));
    expect(road).toBeDefined();
    expect(Math.hypot(road[0].x - hubs[0].x, road[0].y - hubs[0].y)).toBeLessThan(1e-9);
    expect(Math.hypot(road[road.length - 1].x - hubs[1].x, road[road.length - 1].y - hubs[1].y)).toBeLessThan(1e-9);
    let far = 0;
    let length = 0;
    for (let i = 0; i < road.length; i++) {
      expect(range(road[i])).toBe(false);
      far = Math.max(far, Math.abs(road[i].y));
      if (i > 0) {
        length += Math.hypot(road[i].x - road[i - 1].x, road[i].y - road[i - 1].y);
      }
    }
    expect(far).toBeGreaterThan(10);
    expect(length).toBeLessThan(40 * 1.7);
    // A range too long to go round within the winding allowed leaves the two places unjoined.
    expect(planRoads(hubs, (p) => !(Math.abs(p.x - 20) < 4 && Math.abs(p.y) < 40))).toEqual([]);
    expect(planRoads(hubs, (p) => !range(p), { winding: 1.05 })).toEqual([]);
  });

  it("add a second way where the way round would be long", () => {
    // Six places at the corners of a hexagon, twenty apart, with nothing in reach across it. Five
    // roads join them all, and the two at the ends of that chain are then a hundred apart by road
    // and twenty apart on the ground.
    const ring = Array.from({ length: 6 }, (_, k) => ({ x: 50 + 20 * Math.cos((k * Math.PI) / 3), y: 50 + 20 * Math.sin((k * Math.PI) / 3) }));
    expect(planRoads(ring, open, { reach: 25 }).length).toBe(6);
    // Told that a detour of six times is no hardship, the ring stays open.
    expect(planRoads(ring, open, { reach: 25, detour: 6 }).length).toBe(5);
  });

  it("lay the same roads every time", () => {
    const hubs = [
      { x: 3, y: 9 },
      { x: 40, y: 22 },
      { x: 71, y: 5 },
      { x: 55, y: 48 },
      { x: 12, y: 60 },
    ];
    expect(planRoads(hubs, open)).toEqual(planRoads(hubs, open));
  });
});

describe("the grain tile", () => {
  // The size the board builds it at. Smaller, its finest bumps would be under a texel.
  const size = 256;
  const tile = grainTile(size);

  it("is a square of four bytes a texel: slope, slope, height, and a full alpha", () => {
    expect(tile.length).toBe(size * size * 4);
    for (let i = 3; i < tile.length; i += 4) {
      expect(tile[i]).toBe(255);
    }
  });

  it("is level on average, so the land keeps its colour under it", () => {
    let dx = 0;
    let dy = 0;
    for (let i = 0; i < size * size; i++) {
      dx += tile[i * 4];
      dy += tile[i * 4 + 1];
    }
    expect(dx / (size * size)).toBeGreaterThan(125);
    expect(dx / (size * size)).toBeLessThan(131);
    expect(dy / (size * size)).toBeGreaterThan(125);
    expect(dy / (size * size)).toBeLessThan(131);
  });

  it("has real relief in it, and no clipped slopes", () => {
    let low = 255;
    let high = 0;
    let clipped = 0;
    for (let i = 0; i < size * size; i++) {
      low = Math.min(low, tile[i * 4 + 2]);
      high = Math.max(high, tile[i * 4 + 2]);
      if (tile[i * 4] === 0 || tile[i * 4] === 255) {
        clipped += 1;
      }
    }
    expect(high - low).toBeGreaterThan(60);
    expect(clipped).toBe(0);
  });

  it("repeats with no seam: the slope across an edge is what the two edge columns say it is", () => {
    for (let y = 0; y < size; y += 5) {
      const height = (x: number) => tile[(y * size + ((x + size) % size)) * 4 + 2] / 255;
      // The red channel at the last column was measured from the first column, round the edge.
      const stored = (tile[(y * size + size - 1) * 4] / 255 - 0.5) / GRAIN_SLOPE_GAIN;
      expect(Math.abs(stored - (height(size) - height(size - 2)))).toBeLessThan(0.02);
    }
    expect(grainTile(size)).toEqual(tile);
  });
});
