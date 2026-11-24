// Where the world's forests, deserts, and mountains lie, for dressing the board. Pure.
//
// The land master is a Mercator sheet (see `projection` in demomap01.json), so a longitude and a
// latitude place a real feature on it. This is set dressing: it decides where a pine or a peak
// stands, and nothing in the rules reads it. Territories are game shapes and some islands were
// moved for play, so a range is drawn where the land is, whoever's border runs over it.
import type { Vec2 } from "../map/geometry";

/** The same numbers as `projection` in demomap01.json. A test holds the two together. */
export const BOARD_PROJECTION = { lon0: 60, pxPerDegree: 2.22, originX: 400, originY: 355 } as const;

const RAD = Math.PI / 180;
const MERCATOR_R = BOARD_PROJECTION.pxPerDegree / RAD;

export function lonLatToMap(lon: number, lat: number): Vec2 {
  let d = (lon - BOARD_PROJECTION.lon0) % 360;
  if (d < -180) {
    d += 360;
  } else if (d >= 180) {
    d -= 360;
  }
  return {
    x: BOARD_PROJECTION.originX + d * BOARD_PROJECTION.pxPerDegree,
    y: BOARD_PROJECTION.originY - MERCATOR_R * Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2)),
  };
}

export function mapToLonLat(p: Vec2): { lon: number; lat: number } {
  let lon = BOARD_PROJECTION.lon0 + (p.x - BOARD_PROJECTION.originX) / BOARD_PROJECTION.pxPerDegree;
  if (lon < -180) {
    lon += 360;
  } else if (lon >= 180) {
    lon -= 360;
  }
  const lat = (2 * Math.atan(Math.exp((BOARD_PROJECTION.originY - p.y) / MERCATOR_R)) - Math.PI / 2) / RAD;
  return { lon, lat };
}

export type Biome = "ice" | "tundra" | "taiga" | "temperate" | "steppe" | "scrub" | "desert" | "savanna" | "jungle";

/** A box of longitude and latitude. `lon0` may be larger than `lon1` only by crossing the date line. */
interface BiomeBox {
  biome: Biome;
  lon: [number, number];
  lat: [number, number];
}

// First match wins, so the small and the certain come before the broad.
const BOXES: readonly BiomeBox[] = [
  { biome: "ice", lon: [-75, -18], lat: [60, 90] }, // Greenland
  // Deserts
  { biome: "desert", lon: [-17, 36], lat: [16, 31.5] }, // Sahara
  { biome: "desert", lon: [34, 60], lat: [12, 33] }, // Arabia and Mesopotamia
  { biome: "desert", lon: [41, 52], lat: [-1, 12] }, // Horn of Africa
  { biome: "desert", lon: [50, 70], lat: [25, 44] }, // Persia, Karakum, Kyzylkum
  { biome: "desert", lon: [67, 74], lat: [23, 30] }, // Thar
  { biome: "tundra", lon: [78, 102], lat: [28, 37] }, // Tibetan plateau
  { biome: "desert", lon: [76, 112], lat: [37, 46] }, // Taklamakan and Gobi
  { biome: "desert", lon: [-118, -101], lat: [23, 37] }, // Sonora, Chihuahua, Mojave
  { biome: "desert", lon: [11, 26], lat: [-30, -17] }, // Namib and Kalahari
  { biome: "desert", lon: [113, 143], lat: [-31, -19] }, // Australian interior
  // Rainforest
  { biome: "jungle", lon: [-79, -46], lat: [-13, 8] }, // Amazon
  { biome: "jungle", lon: [-93, -77], lat: [7, 18] }, // Central America
  { biome: "jungle", lon: [-15, 9], lat: [4, 9.5] }, // Guinea coast
  { biome: "jungle", lon: [9, 30], lat: [-6, 5] }, // Congo
  { biome: "jungle", lon: [88, 110], lat: [8, 27] }, // Bengal, Burma, Indochina
  { biome: "jungle", lon: [94, 160], lat: [-11, 20] }, // Malaya, the Indies, the Philippines, New Guinea
  { biome: "jungle", lon: [43, 51], lat: [-26, -12] }, // Madagascar
  // Grassland with scattered trees
  { biome: "savanna", lon: [-17, 40], lat: [9.5, 16] }, // Sahel
  { biome: "savanna", lon: [28, 42], lat: [-12, 9.5] }, // East Africa
  { biome: "savanna", lon: [11, 41], lat: [-35, -6] }, // Southern Africa
  { biome: "savanna", lon: [-62, -34], lat: [-32, -13] }, // Cerrado and Chaco
  { biome: "savanna", lon: [113, 154], lat: [-19, -11] }, // Northern Australia
  { biome: "savanna", lon: [68, 90], lat: [8, 30] }, // India
  { biome: "savanna", lon: [-106, -86], lat: [14, 23] }, // Southern Mexico
  // Open grass
  { biome: "steppe", lon: [30, 85], lat: [44, 52] }, // Pontic and Kazakh steppe
  { biome: "steppe", lon: [100, 120], lat: [42, 50] }, // Mongolia
  { biome: "steppe", lon: [-105, -95], lat: [30, 50] }, // Great Plains
  { biome: "steppe", lon: [-73, -57], lat: [-52, -30] }, // Pampas and Patagonia
  // Dry woodland around the Mediterranean
  { biome: "scrub", lon: [-10, 45], lat: [31.5, 41.5] },
  // Broadleaf Europe, which reaches further north than the latitude bands allow
  { biome: "temperate", lon: [-12, 30], lat: [46, 58] },
];

function inBox(box: BiomeBox, lon: number, lat: number): boolean {
  if (lat < box.lat[0] || lat > box.lat[1]) {
    return false;
  }
  return box.lon[0] <= box.lon[1] ? lon >= box.lon[0] && lon <= box.lon[1] : lon >= box.lon[0] || lon <= box.lon[1];
}

/** The ground cover at a place. The boxes name the exceptions; latitude decides the rest. */
export function biomeAt(lon: number, lat: number): Biome {
  for (const box of BOXES) {
    if (inBox(box, lon, lat)) {
      return box.biome;
    }
  }
  if (lat >= 67 || lat <= -56) {
    return "tundra";
  }
  if (lat >= 52) {
    return "taiga";
  }
  if (lat >= 30) {
    return "temperate";
  }
  if (lat >= 23) {
    return "scrub";
  }
  if (lat >= 10) {
    return "savanna";
  }
  if (lat >= -10) {
    return "jungle";
  }
  if (lat >= -23) {
    return "savanna";
  }
  return "temperate";
}

export function biomeAtMap(p: Vec2): Biome {
  const { lon, lat } = mapToLonLat(p);
  return biomeAt(lon, lat);
}

export interface MountainRange {
  name: string;
  /** The crest, as longitude and latitude pairs. */
  crest: readonly (readonly [number, number])[];
  /** Half the width of the belt, in world units. */
  spread: number;
  /** Height of the tallest peaks, in world units. */
  height: number;
  /** Peaks above this share of `height` carry snow. 1 means none do. */
  snowline: number;
}

// Kept low and narrow: a range is a landmark on the table, and the pieces still need the ground.
export const MOUNTAIN_RANGES: readonly MountainRange[] = [
  { name: "Alps", crest: [[6.4, 44.4], [8.2, 46.1], [10.6, 46.7], [13.6, 47.2]], spread: 2.2, height: 4.2, snowline: 0.45 },
  { name: "Pyrenees", crest: [[-1.6, 43.0], [2.6, 42.4]], spread: 1.2, height: 3.0, snowline: 0.7 },
  { name: "Apennines", crest: [[9.6, 44.3], [13.2, 42.5], [15.8, 40.6]], spread: 1.0, height: 2.4, snowline: 1 },
  { name: "Dinaric Alps", crest: [[15.6, 45.0], [18.8, 43.2], [21.2, 40.6]], spread: 1.4, height: 2.6, snowline: 1 },
  { name: "Carpathians", crest: [[19.0, 49.3], [24.4, 47.9], [26.2, 45.7], [23.0, 45.4]], spread: 1.4, height: 2.8, snowline: 0.9 },
  { name: "Scandes", crest: [[6.8, 60.0], [10.5, 62.8], [14.5, 65.5], [19.0, 68.4]], spread: 1.8, height: 3.0, snowline: 0.4 },
  { name: "Caucasus", crest: [[38.0, 44.0], [43.0, 42.8], [47.6, 41.2]], spread: 1.6, height: 4.4, snowline: 0.45 },
  { name: "Taurus", crest: [[30.0, 37.2], [36.5, 37.8], [42.5, 39.4]], spread: 1.6, height: 3.0, snowline: 0.8 },
  { name: "Urals", crest: [[59.5, 66.0], [59.0, 60.0], [58.4, 53.0]], spread: 1.6, height: 2.6, snowline: 0.75 },
  { name: "Atlas", crest: [[-8.4, 31.0], [-2.0, 33.6], [7.6, 35.8]], spread: 1.6, height: 3.0, snowline: 0.85 },
  { name: "Zagros", crest: [[45.0, 36.4], [49.5, 33.2], [53.0, 30.2], [56.2, 28.0]], spread: 2.0, height: 3.4, snowline: 0.8 },
  { name: "Alborz", crest: [[49.0, 37.0], [54.2, 36.3]], spread: 1.0, height: 3.4, snowline: 0.6 },
  { name: "Hindu Kush", crest: [[62.5, 34.3], [66.5, 35.0], [70.0, 35.8], [73.4, 36.6]], spread: 2.4, height: 4.8, snowline: 0.45 },
  { name: "Himalaya", crest: [[74.2, 35.2], [78.5, 32.2], [83.0, 29.2], [88.0, 27.9], [95.0, 28.6]], spread: 2.6, height: 5.6, snowline: 0.35 },
  { name: "Kunlun", crest: [[78.0, 36.6], [84.0, 36.2], [91.0, 36.0]], spread: 1.6, height: 3.8, snowline: 0.5 },
  { name: "Tien Shan", crest: [[70.0, 41.6], [76.0, 42.2], [82.0, 42.8], [88.0, 43.4]], spread: 2.0, height: 4.2, snowline: 0.45 },
  { name: "Altai", crest: [[83.5, 50.2], [89.0, 48.4], [95.0, 46.4]], spread: 1.8, height: 3.4, snowline: 0.55 },
  { name: "Sayan", crest: [[96.0, 52.6], [104.0, 52.0], [112.0, 54.6], [122.0, 56.4], [131.0, 56.6]], spread: 1.6, height: 2.6, snowline: 0.7 },
  { name: "Verkhoyansk", crest: [[127.0, 66.0], [131.0, 63.6], [137.0, 61.4]], spread: 1.8, height: 2.6, snowline: 0.5 },
  { name: "Kamchatka", crest: [[157.5, 53.0], [159.6, 56.0], [161.5, 58.6]], spread: 1.2, height: 3.2, snowline: 0.5 },
  { name: "Japanese Alps", crest: [[136.6, 35.4], [138.4, 36.8], [140.6, 39.6]], spread: 1.0, height: 2.8, snowline: 0.7 },
  { name: "Western Ghats", crest: [[73.6, 19.0], [75.2, 14.0], [76.8, 10.0]], spread: 0.9, height: 2.0, snowline: 1 },
  { name: "Barisan", crest: [[96.0, 4.6], [100.4, 0.0], [104.6, -5.2]], spread: 0.9, height: 2.2, snowline: 1 },
  { name: "New Guinea Highlands", crest: [[136.0, -4.0], [141.0, -5.0], [146.4, -6.6]], spread: 1.2, height: 3.0, snowline: 1 },
  { name: "Great Dividing Range", crest: [[146.0, -37.2], [149.8, -33.0], [152.2, -27.0], [146.4, -19.2]], spread: 1.2, height: 2.0, snowline: 1 },
  { name: "Southern Alps", crest: [[168.0, -45.2], [172.2, -42.4]], spread: 0.9, height: 2.8, snowline: 0.6 },
  { name: "Ethiopian Highlands", crest: [[37.0, 13.4], [39.4, 9.6], [40.2, 7.0]], spread: 1.8, height: 2.8, snowline: 1 },
  { name: "Drakensberg", crest: [[26.8, -31.4], [29.6, -28.6], [30.6, -25.6]], spread: 1.1, height: 2.4, snowline: 1 },
  { name: "Alaska Range", crest: [[-153.0, 61.6], [-148.0, 63.2], [-143.0, 63.4]], spread: 1.6, height: 4.0, snowline: 0.3 },
  { name: "Rockies", crest: [[-129.0, 57.6], [-121.0, 52.4], [-115.0, 48.0], [-110.4, 43.4], [-106.2, 38.6], [-105.4, 35.0]], spread: 2.4, height: 4.0, snowline: 0.5 },
  { name: "Sierra Nevada", crest: [[-121.6, 40.4], [-118.4, 36.2]], spread: 1.0, height: 3.0, snowline: 0.6 },
  { name: "Sierra Madre", crest: [[-107.6, 29.0], [-104.6, 24.0], [-100.6, 20.0]], spread: 1.4, height: 2.6, snowline: 1 },
  { name: "Appalachians", crest: [[-84.2, 35.0], [-79.6, 38.6], [-75.4, 41.6], [-70.6, 45.0]], spread: 1.1, height: 1.8, snowline: 1 },
  { name: "Andes", crest: [[-76.6, 7.0], [-78.4, -1.6], [-76.6, -10.0], [-70.6, -16.6], [-68.6, -24.0], [-70.0, -32.6], [-71.4, -41.0], [-72.6, -50.0]], spread: 1.7, height: 4.6, snowline: 0.5 },
];

export interface CrestPoint extends Vec2 {
  /** 0 at either end of the range, 1 in the middle. */
  crown: number;
}

/** Width of the whole world on the sheet, in world units. */
export const WORLD_WIDTH = 360 * BOARD_PROJECTION.pxPerDegree;

/**
 * Points along a range's crest on the sheet, `step` world units apart. A leg takes the short way
 * round the world, so a range that crosses the seam runs off one edge: its x can fall outside the
 * sheet, and the caller folds it back.
 */
export function crestPoints(range: MountainRange, step: number): CrestPoint[] {
  const legs: { a: Vec2; b: Vec2; length: number }[] = [];
  let total = 0;
  let previous: Vec2 | null = null;
  for (let i = 0; i + 1 < range.crest.length; i++) {
    const a: Vec2 = previous ?? lonLatToMap(range.crest[i][0], range.crest[i][1]);
    const b = lonLatToMap(range.crest[i + 1][0], range.crest[i + 1][1]);
    while (b.x - a.x > WORLD_WIDTH / 2) {
      b.x -= WORLD_WIDTH;
    }
    while (a.x - b.x > WORLD_WIDTH / 2) {
      b.x += WORLD_WIDTH;
    }
    previous = b;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    legs.push({ a, b, length });
    total += length;
  }
  const out: CrestPoint[] = [];
  if (total <= 0) {
    return out;
  }
  let walked = 0;
  for (const leg of legs) {
    const n = Math.max(1, Math.round(leg.length / step));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const along = (walked + leg.length * t) / total;
      out.push({
        x: leg.a.x + (leg.b.x - leg.a.x) * t,
        y: leg.a.y + (leg.b.y - leg.a.y) * t,
        crown: Math.sin(Math.PI * along),
      });
    }
    walked += leg.length;
  }
  return out;
}
