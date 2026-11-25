import { describe, expect, it } from "vitest";
import { lonLatToMap } from "../../../src/ui/viewport3d/geography";
import type { ReliefPatch } from "../../../src/ui/viewport3d/mountainRelief";
import {
  bayer4,
  buildCoastField,
  buildPixieSheet,
  CLIMATE_ZONE,
  climateZoneOf,
  climateZoneOfRegion,
  COAST_FIELD_SIZE,
  coastDistanceOfByte,
  PIXIE_COAST_REACH,
  PIXIE_HEIGHT_TOP,
  PIXIE_INK,
  PIXIE_LAND,
  PIXIE_SEA,
  PIXIE_SHELF_WIDTH,
  regionIdBytes,
  snapRegionIds,
  unitRgb,
  ZONE_INK,
} from "../../../src/ui/viewport3d/pixieSheet";

const WORLD = { x: 0, y: 0, w: 800, h: 504 };

describe("the ordered dither", () => {
  // The 4×4 Bayer matrix, in sixteenths, row by row.
  const BAYER = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
  ];

  it("is the 4×4 Bayer matrix", () => {
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        expect(bayer4(x, y) * 16).toBeCloseTo(BAYER[y][x], 9);
      }
    }
  });

  it("repeats every four texels, either side of the origin", () => {
    for (const [x, y] of [[5, 2], [-1, -1], [-7, 9], [4001, -3999]] as const) {
      expect(bayer4(x, y)).toBeCloseTo(bayer4(((x % 4) + 4) % 4, ((y % 4) + 4) % 4), 9);
    }
  });

  it("uses every threshold once in a tile, so half the texels pass a half", () => {
    const seen = new Set<number>();
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        seen.add(Math.round(bayer4(x + 8, y - 4) * 16));
      }
    }
    expect(seen.size).toBe(16);
  });
});

describe("climate zones", () => {
  it("numbers the four zones 0 to 3", () => {
    expect(CLIMATE_ZONE).toEqual({ TEMPERATE: 0, BOREAL: 1, ARID: 2, TROPICAL: 3 });
  });

  it("calls Europe and the lowlands of East Asia temperate", () => {
    expect(climateZoneOf(undefined, 10, 51)).toBe(CLIMATE_ZONE.TEMPERATE); // Germany
    expect(climateZoneOf(undefined, 2, 47)).toBe(CLIMATE_ZONE.TEMPERATE); // France
    expect(climateZoneOf(undefined, -4, 40)).toBe(CLIMATE_ZONE.TEMPERATE); // Spain
    expect(climateZoneOf(undefined, 139, 36)).toBe(CLIMATE_ZONE.TEMPERATE); // Japan
    expect(climateZoneOf(undefined, 116, 38)).toBe(CLIMATE_ZONE.TEMPERATE); // North China plain
  });

  it("calls northern Russia, Scandinavia, and Siberia boreal", () => {
    expect(climateZoneOf(undefined, 40, 60)).toBe(CLIMATE_ZONE.BOREAL);
    expect(climateZoneOf(undefined, 15, 62)).toBe(CLIMATE_ZONE.BOREAL);
    expect(climateZoneOf(undefined, 100, 62)).toBe(CLIMATE_ZONE.BOREAL);
    expect(climateZoneOf(undefined, -40, 72)).toBe(CLIMATE_ZONE.BOREAL); // Greenland
  });

  it("calls North Africa, the Middle East, and the steppe arid", () => {
    expect(climateZoneOf(undefined, 30, 26)).toBe(CLIMATE_ZONE.ARID); // Egypt
    expect(climateZoneOf(undefined, 15, 32.5)).toBe(CLIMATE_ZONE.ARID); // The Libyan coast
    expect(climateZoneOf(undefined, 45, 24)).toBe(CLIMATE_ZONE.ARID); // Arabia
    expect(climateZoneOf(undefined, 54, 32)).toBe(CLIMATE_ZONE.ARID); // Persia
    expect(climateZoneOf(undefined, 65, 48)).toBe(CLIMATE_ZONE.ARID); // The Kazakh steppe
  });

  it("calls India, Burma, South China, and the Pacific tropical", () => {
    expect(climateZoneOf(undefined, 78, 20)).toBe(CLIMATE_ZONE.TROPICAL);
    expect(climateZoneOf(undefined, 96, 20)).toBe(CLIMATE_ZONE.TROPICAL);
    expect(climateZoneOf(undefined, 113, 25)).toBe(CLIMATE_ZONE.TROPICAL);
    expect(climateZoneOf(undefined, 122, 12)).toBe(CLIMATE_ZONE.TROPICAL); // The Philippines
    expect(climateZoneOf(undefined, 145, -6)).toBe(CLIMATE_ZONE.TROPICAL); // New Guinea
  });

  it("takes a territory's named cover before its place", () => {
    expect(climateZoneOf("DESERT", 10, 51)).toBe(CLIMATE_ZONE.ARID);
    expect(climateZoneOf("snow", 10, 51)).toBe(CLIMATE_ZONE.BOREAL);
    // A named forest is pine country a little further south than open ground is.
    expect(climateZoneOf("FOREST", 20, 56)).toBe(CLIMATE_ZONE.BOREAL);
    expect(climateZoneOf(undefined, 20, 56)).toBe(CLIMATE_ZONE.TEMPERATE);
    expect(climateZoneOf("FOREST", 10, 50)).toBe(CLIMATE_ZONE.TEMPERATE);
    // A cover that says nothing of the climate leaves it to the place.
    expect(climateZoneOf("URBAN", 30, 26)).toBe(CLIMATE_ZONE.ARID);
    expect(climateZoneOf("MOUNTAIN", 78, 20)).toBe(CLIMATE_ZONE.TROPICAL);
  });

  it("places a territory by its anchor", () => {
    expect(climateZoneOfRegion({ anchor: lonLatToMap(30, 26) })).toBe(CLIMATE_ZONE.ARID);
    expect(climateZoneOfRegion({ anchor: lonLatToMap(10, 51) })).toBe(CLIMATE_ZONE.TEMPERATE);
    expect(climateZoneOfRegion({ anchor: lonLatToMap(10, 51), landCover: "SNOW" })).toBe(CLIMATE_ZONE.BOREAL);
  });

  it("paints three zones a channel each and the fourth black, so the shares add to one", () => {
    expect(ZONE_INK).toHaveLength(4);
    const sum = [0, 0, 0];
    for (const ink of ZONE_INK) {
      unitRgb(ink).forEach((channel, i) => (sum[i] += channel));
    }
    expect(sum).toEqual([1, 1, 1]);
    expect(unitRgb(ZONE_INK[CLIMATE_ZONE.TROPICAL])).toEqual([0, 0, 0]);
  });
});

describe("the palette", () => {
  const luma = (hex: string) => {
    const [r, g, b] = unitRgb(hex);
    return 0.299 * r + 0.587 * g + 0.114 * b;
  };
  const saturation = (hex: string) => {
    const rgb = unitRgb(hex);
    return (Math.max(...rgb) - Math.min(...rgb)) / Math.max(...rgb);
  };

  it("has five tones for each of the four zones", () => {
    expect(PIXIE_LAND).toHaveLength(4);
    for (const ramp of PIXIE_LAND) {
      expect(ramp).toHaveLength(5);
    }
  });

  it("keeps the land to muted earth colours", () => {
    for (const hex of PIXIE_LAND.flat()) {
      expect(saturation(hex)).toBeLessThan(0.6);
    }
  });

  it("runs each ramp from forest, the darkest, up to the crest, the palest", () => {
    for (const [dry, meadow, forest, upland, crest] of PIXIE_LAND) {
      expect(luma(forest)).toBeLessThan(luma(meadow));
      expect(luma(meadow)).toBeLessThan(luma(dry));
      expect(luma(crest)).toBeGreaterThan(luma(dry));
      expect(luma(crest)).toBeGreaterThan(luma(upland));
    }
  });

  it("stops the shade at a warm slate umber and never at black", () => {
    for (const hex of [PIXIE_INK.floor, PIXIE_INK.umber]) {
      const [r, g, b] = unitRgb(hex);
      expect(r).toBeGreaterThan(g);
      expect(g).toBeGreaterThan(b);
      expect(b).toBeGreaterThan(0.18);
    }
    expect(luma(PIXIE_INK.umber)).toBeGreaterThan(luma(PIXIE_INK.floor));
  });

  it("has no land colour the floor would lift", () => {
    const floor = unitRgb(PIXIE_INK.floor);
    for (const hex of PIXIE_LAND.flat()) {
      unitRgb(hex).forEach((channel, i) => expect(channel).toBeGreaterThanOrEqual(floor[i]));
    }
  });

  it("steps the sea from ice powder on the shelf down to steel teal", () => {
    expect(PIXIE_SEA).toHaveLength(4);
    for (let i = 1; i < PIXIE_SEA.length; i++) {
      expect(luma(PIXIE_SEA[i])).toBeLessThan(luma(PIXIE_SEA[i - 1]));
    }
    for (const hex of PIXIE_SEA) {
      const [r, g, b] = unitRgb(hex);
      expect(b).toBeGreaterThan(r);
      expect(g).toBeGreaterThan(r);
    }
  });

  it("rims the coast in a warm sandy ochre", () => {
    const [r, g, b] = unitRgb(PIXIE_INK.rim);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    expect(luma(PIXIE_INK.rim)).toBeGreaterThan(0.6);
  });
});

describe("territory ids", () => {
  it("gives every territory its own id, and none of them black", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const [r, g, b] = regionIdBytes(i, false);
      expect(r + g).toBeGreaterThan(0);
      expect(b).toBe(0);
      seen.add(r | (g << 8));
    }
    expect(seen.size).toBe(2000);
  });

  it("marks a sea zone in blue", () => {
    expect(regionIdBytes(7, true)[2]).toBe(255);
    expect(regionIdBytes(7, true).slice(0, 2)).toEqual(regionIdBytes(7, false).slice(0, 2));
  });

  it("takes the soft edge off a fill, so a texel holds a whole id or none", () => {
    const a = regionIdBytes(0, false);
    const b = regionIdBytes(1, false);
    const valid = new Set([a, b].map(([r, g, blue]) => r | (g << 8) | (blue << 16)));
    const blend = a.map((channel, i) => Math.round((channel + b[i]) / 2));
    // Two rows: a, a blend, b; then clear black, a blend beside it, b.
    const pixels = new Uint8ClampedArray([...a, 255, ...blend, 200, ...b, 255, 0, 0, 0, 0, ...blend, 255, ...b, 255]);
    snapRegionIds(pixels, 3, 2, valid);
    const at = (x: number, y: number) => [...pixels.slice((y * 3 + x) * 4, (y * 3 + x) * 4 + 4)];
    expect(at(0, 0)).toEqual([...a, 255]);
    expect(at(1, 0)).toEqual([...a, 255]);
    expect(at(2, 0)).toEqual([...b, 255]);
    expect(at(0, 1)).toEqual([0, 0, 0, 255]);
    expect(at(1, 1)).toEqual([0, 0, 0, 255]);
    expect(at(2, 1)).toEqual([...b, 255]);
  });
});

describe("the coast field", () => {
  /** The distance the shader reads at a map point, from the nearest texel. */
  function distanceAt(field: ReturnType<typeof buildCoastField>, bounds: typeof WORLD, p: { x: number; y: number }): number {
    const tx = Math.min(field.size - 1, Math.max(0, Math.floor(((p.x - bounds.x) / bounds.w) * field.size)));
    const ty = Math.min(field.size - 1, Math.max(0, Math.floor(((p.y - bounds.y) / bounds.h) * field.size)));
    return coastDistanceOfByte(field.data[(field.size - 1 - ty) * field.size + tx], field.reach);
  }

  it("is 512 texels a side, and reaches past the shelf", () => {
    expect(COAST_FIELD_SIZE).toBe(512);
    expect(PIXIE_COAST_REACH).toBeGreaterThan(PIXIE_SHELF_WIDTH);
  });

  it("measures out to sea from a straight coast, and inland the other way", () => {
    const bounds = { x: 0, y: 0, w: 40, h: 40 };
    // Land west of x = 20. The world repeats, so the next copy's land starts at x = 40.
    const field = buildCoastField((p) => p.x < 20, bounds, 64, 16);
    expect(field.data).toHaveLength(64 * 64);
    expect(distanceAt(field, bounds, { x: 25, y: 20 })).toBeCloseTo(5, 0);
    expect(distanceAt(field, bounds, { x: 30, y: 7 })).toBeCloseTo(10, 0);
    // Past the middle of the strait the nearer shore is the next copy's.
    expect(distanceAt(field, bounds, { x: 36, y: 20 })).toBeCloseTo(4, 0);
    expect(distanceAt(field, bounds, { x: 10, y: 20 })).toBeCloseTo(-10, 0);
    expect(distanceAt(field, bounds, { x: 4, y: 33 })).toBeCloseTo(-4, 0);
    // On the shore itself it is nearly nothing.
    expect(Math.abs(distanceAt(field, bounds, { x: 20.3, y: 20 }))).toBeLessThan(0.8);
  });

  it("measures round an island in world units, on a sheet wider than it is tall", () => {
    const bounds = { x: 0, y: 0, w: 80, h: 40 };
    const size = 64;
    const field = buildCoastField((p) => Math.hypot(p.x - 40, p.y - 20) < 8, bounds, size, 20);
    // A texel is 1.25 units wide and 0.625 tall. The answer is held to the middle of the texel it is read from.
    for (const p of [{ x: 40, y: 6 }, { x: 56, y: 20 }, { x: 50, y: 30 }, { x: 24, y: 12 }, { x: 40, y: 20 }, { x: 43, y: 22 }]) {
      const cx = (Math.floor((p.x / bounds.w) * size) + 0.5) * (bounds.w / size);
      const cy = (Math.floor((p.y / bounds.h) * size) + 0.5) * (bounds.h / size);
      expect(Math.abs(distanceAt(field, bounds, p) - (Math.hypot(cx - 40, cy - 20) - 8))).toBeLessThan(1);
    }
    expect(distanceAt(field, bounds, { x: 56, y: 20 })).toBeGreaterThan(0);
    expect(distanceAt(field, bounds, { x: 40, y: 20 })).toBeLessThan(0);
  });

  it("holds a far sea at the whole reach, and stores rows from the bottom of the sheet up", () => {
    const bounds = { x: 0, y: 0, w: 40, h: 40 };
    const open = buildCoastField(() => false, bounds, 32, 10);
    expect(open.data.every((byte) => byte === 255)).toBe(true);
    // Land across the top of the map is the last rows of the sheet.
    const north = buildCoastField((p) => p.y < 10, bounds, 32, 10);
    expect(north.data[31 * 32]).toBeLessThan(128);
    expect(north.data[0]).toBe(255);
  });

  it("reads back the distance a byte was written for", () => {
    expect(coastDistanceOfByte(128)).toBe(0);
    expect(coastDistanceOfByte(255)).toBeCloseTo(PIXIE_COAST_REACH, 9);
    expect(coastDistanceOfByte(1)).toBeCloseTo(-PIXIE_COAST_REACH, 9);
  });
});

describe("the relief and cover sheet", () => {
  const sheet = buildPixieSheet(WORLD);
  const at = (p: { x: number; y: number }, channel: number) => {
    const tx = Math.min(sheet.width - 1, Math.max(0, Math.floor(((p.x - WORLD.x) / WORLD.w) * sheet.width)));
    const ty = Math.min(sheet.height - 1, Math.max(0, Math.floor(((p.y - WORLD.y) / WORLD.h) * sheet.height)));
    return sheet.data[((sheet.height - 1 - ty) * sheet.width + tx) * 4 + channel];
  };

  it("covers the world at a texel a unit, four bytes a texel", () => {
    expect(sheet.width).toBe(800);
    expect(sheet.height).toBe(504);
    expect(sheet.data).toHaveLength(800 * 504 * 4);
  });

  it("raises the ranges along their crests and leaves the plains level", () => {
    expect(at(lonLatToMap(83, 29.2), 0)).toBeGreaterThan(200); // The Himalaya
    expect(at(lonLatToMap(43, 42.8), 0)).toBeGreaterThan(120); // The Caucasus
    expect(at(lonLatToMap(33, 49), 0)).toBe(0); // The Ukrainian plain
    expect(at(lonLatToMap(20, 24), 0)).toBe(0); // The Libyan desert
  });

  it("is greenest in the rainforest and barest in the desert", () => {
    expect(at(lonLatToMap(20, 0), 1)).toBeGreaterThan(200); // The Congo
    expect(at(lonLatToMap(10, 24), 1)).toBeLessThan(40); // The Sahara
    const europe = at(lonLatToMap(10, 51), 1);
    expect(europe).toBeGreaterThan(at(lonLatToMap(65, 48), 1)); // Greener than the steppe
    expect(europe).toBeLessThan(at(lonLatToMap(20, 0), 1));
  });

  it("lays snow on the ice sheet and on the summits that carry it, and none on a warm range", () => {
    expect(at(lonLatToMap(-40, 72), 2)).toBeGreaterThan(200); // Greenland
    expect(at(lonLatToMap(20, 0), 2)).toBe(0);
    expect(at(lonLatToMap(8.2, 46.1), 3)).toBeGreaterThan(200); // The Alps
    expect(at(lonLatToMap(13.2, 42.5), 3)).toBe(0); // The Apennines
    expect(at(lonLatToMap(13.2, 42.5), 0)).toBeGreaterThan(0);
  });

  it("leaves the high plateau bare, though the biome table files it with the tundra", () => {
    expect(at(lonLatToMap(90, 33), 2)).toBeLessThan(60); // Tibet
    expect(at(lonLatToMap(100, 72), 2)).toBeGreaterThan(120); // The Taymyr
  });

  it("lays the table's sculpted ranges over the chart at their own shape", () => {
    const fields = new Float32Array(5 * 5 * 2).fill(0.8);
    const patch: ReliefPatch = { originX: 500, originY: 400, step: 1, columns: 5, rows: 5, fields };
    expect(at({ x: 502.5, y: 402.5 }, 0)).toBe(0);
    const raised = buildPixieSheet(WORLD, [patch]);
    const byte = raised.data[((raised.height - 1 - 402) * raised.width + 502) * 4];
    expect(byte / 255).toBeCloseTo((5.2 * 0.8) / PIXIE_HEIGHT_TOP, 1);
    // And nothing a few units away.
    expect(raised.data[((raised.height - 1 - 420) * raised.width + 520) * 4]).toBe(0);
  });
});
