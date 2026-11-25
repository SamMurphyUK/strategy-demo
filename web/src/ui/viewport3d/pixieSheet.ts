// The pixel chart ("PIXIE"): faux-pixel cartography for the plain 3D board. Pure.
//
// The land and the sea are drawn as square texels fixed to the board (see pixieLook in
// mapVisualConfig.ts). The shader needs four things it must not work out for itself at every
// fragment, and they are made here, once for a map:
//
//   the climate zone of each territory, as a number
//   the distance to the coast, as a 512 by 512 field
//   the relief and the ground cover, as a sheet over the world
//   an id for each territory, so a border is where two neighbouring texels disagree
//
// The palette is here too, so a test can hold it to the earth colours the chart is drawn in.
// This is set dressing. No rule reads it.
import type { Rect, Vec2 } from "../map/geometry";
import { type Biome, biomeAt, crestPoints, mapToLonLat, MOUNTAIN_RANGES } from "./geography";
import { type ReliefPatch, sampleReliefFields } from "./mountainRelief";

// --- The ordered dither --------------------------------------------------------------------------

function bayer2(x: number, y: number): number {
  const ax = ((Math.floor(x) % 2) + 2) % 2;
  const ay = ((Math.floor(y) % 2) + 2) % 2;
  const sum = ax * 0.5 + ay * 0.75;
  return sum - Math.floor(sum);
}

/**
 * The 4×4 Bayer threshold for a texel, 0 to 15 sixteenths. The same sum the shader does, so a
 * test of this is a test of that.
 */
export function bayer4(x: number, y: number): number {
  return bayer2(Math.floor(x / 2), Math.floor(y / 2)) * 0.25 + bayer2(x, y);
}

// --- Climate zones -------------------------------------------------------------------------------

export const CLIMATE_ZONE = { TEMPERATE: 0, BOREAL: 1, ARID: 2, TROPICAL: 3 } as const;
export type ClimateZone = (typeof CLIMATE_ZONE)[keyof typeof CLIMATE_ZONE];

/**
 * The climate of a place, as one of four numbers. A territory that names its `land_cover` as
 * desert or snow is taken at its word. Every other answer comes from where the place is: the
 * biome table in geography.ts, and its latitude.
 *
 *   0 TEMPERATE  Europe and the lowlands of East Asia
 *   1 BOREAL     northern Russia, Scandinavia, Siberia, and the high cold plateau
 *   2 ARID       North Africa, the Middle East, and the steppe
 *   3 TROPICAL   India, Burma, South China, and the Pacific
 */
export function climateZoneOf(landCover: string | undefined, lon: number, lat: number): ClimateZone {
  const cover = (landCover ?? "").trim().toUpperCase();
  if (cover === "DESERT") {
    return CLIMATE_ZONE.ARID;
  }
  if (cover === "SNOW") {
    return CLIMATE_ZONE.BOREAL;
  }
  const biome = biomeAt(lon, lat);
  if (biome === "ice" || biome === "tundra" || biome === "taiga") {
    return CLIMATE_ZONE.BOREAL;
  }
  if (biome === "desert" || biome === "steppe") {
    return CLIMATE_ZONE.ARID;
  }
  if (biome === "jungle" || biome === "savanna") {
    return CLIMATE_ZONE.TROPICAL;
  }
  if (biome === "scrub") {
    if (lat >= 31.5) {
      // The north shore of the Mediterranean is green country. Its south and east shores are dry.
      return lat >= 36 && lon < 30 ? CLIMATE_ZONE.TEMPERATE : CLIMATE_ZONE.ARID;
    }
    // The band under it is wet where the monsoon or the Gulf reaches: South China and the American south.
    return (lon >= 95 && lon <= 125) || (lon >= -100 && lon <= -75) ? CLIMATE_ZONE.TROPICAL : CLIMATE_ZONE.ARID;
  }
  // Temperate ground. Far enough north it is pine country, and a named forest gets there sooner.
  if (lat >= 58 || (cover === "FOREST" && lat >= 55)) {
    return CLIMATE_ZONE.BOREAL;
  }
  return CLIMATE_ZONE.TEMPERATE;
}

/** The climate of a territory: its named cover, and where its anchor stands. */
export function climateZoneOfRegion(region: { landCover?: string; anchor: Vec2 }): ClimateZone {
  const { lon, lat } = mapToLonLat(region.anchor);
  return climateZoneOf(region.landCover, lon, lat);
}

/**
 * The colour a zone is painted on the zone sheet: one channel each for the first three, and
 * black for the fourth. Blurred, the channels are the share of each zone at a point, and what is
 * left of 1 is the fourth's.
 */
export const ZONE_INK: readonly string[] = ["#ff0000", "#00ff00", "#0000ff", "#000000"];

// --- The palette ---------------------------------------------------------------------------------

/**
 * The land, one row a climate zone in the order of `CLIMATE_ZONE`. Across a row: dry ground,
 * meadow, forest, upland, and crest.
 */
export const PIXIE_LAND: readonly (readonly string[])[] = [
  ["#A99C66", "#7C8D58", "#4F6845", "#8B7B5C", "#D9D2BC"],
  ["#9B9B7C", "#6E8163", "#3F5A48", "#7F7C6C", "#E1E5E2"],
  ["#D5B176", "#BA8A55", "#8D8956", "#9C6643", "#E6D9BE"],
  ["#A89C60", "#6F8B4F", "#3E6347", "#7B6A4B", "#CFC8AE"],
];

/** The sea, from the shelf out: ice powder, powder blue, teal, and steel teal. */
export const PIXIE_SEA: readonly string[] = ["#CDE1E3", "#A6C8D1", "#6E9FAD", "#4A7583"];

export const PIXIE_INK = {
  /** What a slope turned from the sun goes toward: warm slate umber. */
  umber: "#5C4C45",
  /** Nothing on the land is darker than this in any channel, so a dark piece still reads on it. */
  floor: "#3E3632",
  /** What a slope turned to the sun goes toward. */
  chalk: "#EADFC4",
  snow: "#EEF2F1",
  snowShade: "#B7C5D3",
  /** The coastal rim, and the odd rust texel in it. */
  rim: "#D6A561",
  rimRust: "#B8763F",
  river: "#35525A",
  road: "#E4D8BB",
  border: "#3A302D",
  /** The line between two sea zones. */
  seam: "#3C6270",
  /** The cliff under the rim: its top band, its foot, the wet rock at the water, and its lip. */
  cliffHigh: "#C79A5E",
  cliffLow: "#A67848",
  cliffWet: "#7A6450",
  cliffLip: "#E1BE80",
} as const;

/** A `#RRGGBB` colour as three numbers from 0 to 1. */
export function unitRgb(hex: string): [number, number, number] {
  return [Number.parseInt(hex.slice(1, 3), 16) / 255, Number.parseInt(hex.slice(3, 5), 16) / 255, Number.parseInt(hex.slice(5, 7), 16) / 255];
}

// --- Territory ids -------------------------------------------------------------------------------

/**
 * The colour a territory is filled with on the id sheet. Red and green are its number, spread
 * over the sixteen bits so two neighbours are far apart, and blue is 255 for a sea zone. No
 * territory is black: black is water and land that nobody holds.
 */
export function regionIdBytes(index: number, sea: boolean): [number, number, number] {
  const packed = ((index + 1) * 40503) & 0xffff;
  return [packed & 255, packed >> 8, sea ? 255 : 0];
}

/**
 * Takes the soft edges off an id sheet. A canvas smooths the edge of every fill, and a smoothed
 * texel is a number that belongs to no territory. Each one takes the id to its left, or the one
 * above it at the start of a row. `pixels` is RGBA, changed in place. `valid` holds every real
 * id as red + green × 256 + blue × 65536; black is always real.
 */
export function snapRegionIds(pixels: Uint8ClampedArray | Uint8Array, width: number, height: number, valid: ReadonlySet<number>): void {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      const key = pixels[at] | (pixels[at + 1] << 8) | (pixels[at + 2] << 16);
      if (key !== 0 && !valid.has(key)) {
        const from = x > 0 ? at - 4 : y > 0 ? at - width * 4 : -1;
        pixels[at] = from >= 0 ? pixels[from] : 0;
        pixels[at + 1] = from >= 0 ? pixels[from + 1] : 0;
        pixels[at + 2] = from >= 0 ? pixels[from + 2] : 0;
      }
      pixels[at + 3] = 255;
    }
  }
}

// --- The coast field -----------------------------------------------------------------------------

/** Texels along each side of the coast field. */
export const COAST_FIELD_SIZE = 512;
/** The furthest the coast field can tell, in world units. Past it the sea is simply deep. */
export const PIXIE_COAST_REACH = 30;
/** How far out the shelf runs before the open ocean, in world units. */
export const PIXIE_SHELF_WIDTH = 22;

export interface CoastField {
  /** Texels along each side. */
  size: number;
  /** The distance a whole byte's swing stands for, in world units. */
  reach: number;
  /** One byte a texel, rows running up the sheet. 128 is the coast, more is out to sea, less is inland. */
  data: Uint8Array;
}

/** The distance a byte of the coast field stands for, in world units. What the shader does to read it. */
export function coastDistanceOfByte(byte: number, reach = PIXIE_COAST_REACH): number {
  return ((byte - 128) / 127) * reach;
}

const FAR = 1e20;

/**
 * One pass of the squared distance transform (Felzenszwalb and Huttenlocher) along a line of `n`
 * samples `spacing` apart. `f` holds what each sample already costs and `d` takes the answer.
 */
function distancePass(f: Float64Array, n: number, spacing: number, d: Float64Array, hull: Int32Array, breaks: Float64Array): void {
  const h2 = spacing * spacing;
  const meet = (q: number, p: number) => (f[q] + h2 * q * q - (f[p] + h2 * p * p)) / (2 * h2 * (q - p));
  let k = 0;
  hull[0] = 0;
  breaks[0] = -FAR;
  breaks[1] = FAR;
  for (let q = 1; q < n; q++) {
    let s = meet(q, hull[k]);
    while (k > 0 && s <= breaks[k]) {
      k -= 1;
      s = meet(q, hull[k]);
    }
    k += 1;
    hull[k] = q;
    breaks[k] = s;
    breaks[k + 1] = FAR;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (breaks[k + 1] < q) {
      k += 1;
    }
    const p = hull[k];
    d[q] = h2 * (q - p) * (q - p) + f[p];
  }
}

/**
 * The signed distance from every texel to the coast, in world units: positive at sea, negative
 * inland. It is made once for a map, so the sea's shader reads one texel where it would
 * otherwise walk the coastline. The world repeats sideways, and the field is measured across the
 * seam.
 */
export function buildCoastField(isLand: (p: Vec2) => boolean, bounds: Rect, size = COAST_FIELD_SIZE, reach = PIXIE_COAST_REACH): CoastField {
  const cellW = bounds.w / size;
  const cellH = bounds.h / size;
  const pad = Math.min(size, Math.ceil(reach / cellW) + 1);
  const width = size + pad * 2;
  const land = new Uint8Array(width * size);
  for (let y = 0; y < size; y++) {
    const py = bounds.y + (y + 0.5) * cellH;
    for (let x = 0; x < size; x++) {
      land[y * width + x + pad] = isLand({ x: bounds.x + (x + 0.5) * cellW, y: py }) ? 1 : 0;
    }
    // The neighbouring copies of the world, as far as the field can tell.
    for (let x = 0; x < pad; x++) {
      land[y * width + x] = land[y * width + pad + size - pad + x];
      land[y * width + pad + size + x] = land[y * width + pad + x];
    }
  }

  const longest = Math.max(width, size);
  const f = new Float64Array(longest);
  const d = new Float64Array(longest);
  const hull = new Int32Array(longest);
  const breaks = new Float64Array(longest + 1);
  /** Squared distance from every texel to the nearest texel that is land (1) or sea (0). */
  const distanceTo = (kind: number): Float64Array => {
    const out = new Float64Array(width * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < width; x++) {
        f[x] = land[y * width + x] === kind ? 0 : FAR;
      }
      distancePass(f, width, cellW, d, hull, breaks);
      out.set(d.subarray(0, width), y * width);
    }
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < size; y++) {
        f[y] = out[y * width + x];
      }
      distancePass(f, size, cellH, d, hull, breaks);
      for (let y = 0; y < size; y++) {
        out[y * width + x] = d[y];
      }
    }
    return out;
  };
  const toLand = distanceTo(1);
  const toSea = distanceTo(0);
  // A distance is measured between the middles of two texels, and the coast runs between them.
  const half = (cellW + cellH) / 4;
  const data = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const at = y * width + x + pad;
      const signed = land[at] === 1 ? -Math.max(0, Math.sqrt(toSea[at]) - half) : Math.max(0, Math.sqrt(toLand[at]) - half);
      const share = Math.min(1, Math.max(-1, signed / reach));
      data[(size - 1 - y) * size + x] = Math.round(128 + share * 127);
    }
  }
  return { size, reach, data };
}

// --- The relief and cover sheet ------------------------------------------------------------------

/** Texels of the sheet per world unit. */
export const PIXIE_SHEET_SCALE = 1;
/** The height a full byte of the sheet's red stands for, in world units. */
export const PIXIE_HEIGHT_TOP = 6;
/** World units between two samples of the ground cover, before it is smoothed. */
const COVER_STEP = 4;
/** How far a range's foot lies from its crest, in half widths of the belt. */
const RANGE_REACH = 2.6;
/** The sculpted ranges of the table are drawn this tall on the chart, in world units, and ridged this much. */
const PATCH_PEAK = 5.2;
const PATCH_SHARPNESS = 0.62;

/** How green each kind of ground is: 0 bare, 1 deep forest. */
const LUSH: Readonly<Record<Biome, number>> = {
  ice: 0,
  tundra: 0.18,
  taiga: 0.86,
  temperate: 0.7,
  steppe: 0.24,
  scrub: 0.4,
  desert: 0.04,
  savanna: 0.45,
  jungle: 1,
};

/** How much snow lies on each kind of ground at a latitude: 0 none, 1 an ice sheet. */
function frostOf(biome: Biome, lat: number): number {
  if (biome === "ice") {
    return 1;
  }
  if (biome === "tundra") {
    // The polar tundra is half under snow. The high plateau that shares its name is bare and brown.
    return Math.abs(lat) >= 55 ? 0.55 : 0.12;
  }
  if (biome === "taiga") {
    return Math.min(0.4, 0.1 + Math.max(0, Math.abs(lat) - 52) * 0.02);
  }
  return 0;
}

function smooth(value: number): number {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

export interface PixieSheet {
  width: number;
  height: number;
  /**
   * RGBA, rows running up the sheet. Red is the height of the ranges, green is how green the
   * ground is, blue is the snow that lies on low ground, and alpha is the snow on a summit.
   */
  data: Uint8Array;
}

/** The ground cover on a coarse grid, smoothed, so the boxes of the biome table do not show their corners. */
function coverGrid(bounds: Rect): { columns: number; rows: number; lush: Float32Array; frost: Float32Array } {
  const columns = Math.max(2, Math.round(bounds.w / COVER_STEP));
  const rows = Math.max(2, Math.round(bounds.h / COVER_STEP));
  let lush: Float32Array = new Float32Array(columns * rows);
  let frost: Float32Array = new Float32Array(columns * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const { lon, lat } = mapToLonLat({ x: bounds.x + ((x + 0.5) / columns) * bounds.w, y: bounds.y + ((y + 0.5) / rows) * bounds.h });
      const biome = biomeAt(lon, lat);
      lush[y * columns + x] = LUSH[biome];
      frost[y * columns + x] = frostOf(biome, lat);
    }
  }
  const soften = (from: Float32Array): Float32Array => {
    const out = new Float32Array(from.length);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < columns; x++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const row = Math.min(rows - 1, Math.max(0, y + dy));
          for (let dx = -1; dx <= 1; dx++) {
            sum += from[row * columns + ((x + dx + columns) % columns)];
          }
        }
        out[y * columns + x] = sum / 9;
      }
    }
    return out;
  };
  for (let pass = 0; pass < 2; pass++) {
    lush = soften(lush);
    frost = soften(frost);
  }
  return { columns, rows, lush, frost };
}

/**
 * The sheet the chart's land is drawn from. The ranges of geography.ts are stamped along their
 * crests, tallest in the middle of a range and falling to nothing at its foot, and the sculpted
 * ranges of the table are laid over them at their own shape, so the shading on the chart agrees
 * with the ground that stands up. Fine ridges and the roll of the lowlands are the shader's.
 */
export function buildPixieSheet(bounds: Rect, patches: readonly ReliefPatch[] = []): PixieSheet {
  const width = Math.max(1, Math.round(bounds.w * PIXIE_SHEET_SCALE));
  const height = Math.max(1, Math.round(bounds.h * PIXIE_SHEET_SCALE));
  const sx = width / bounds.w;
  const sy = height / bounds.h;
  const rise = new Float32Array(width * height);
  const cap = new Float32Array(width * height);

  for (const range of MOUNTAIN_RANGES) {
    const reach = range.spread * RANGE_REACH;
    for (const point of crestPoints(range, 1)) {
      const crown = 0.45 + 0.55 * point.crown;
      const x0 = Math.floor((point.x - reach - bounds.x) * sx);
      const x1 = Math.ceil((point.x + reach - bounds.x) * sx);
      const y0 = Math.max(0, Math.floor((point.y - reach - bounds.y) * sy));
      const y1 = Math.min(height - 1, Math.ceil((point.y + reach - bounds.y) * sy));
      for (let ty = y0; ty <= y1; ty++) {
        const py = bounds.y + (ty + 0.5) / sy;
        for (let tx = x0; tx <= x1; tx++) {
          const px = bounds.x + (tx + 0.5) / sx;
          const share = crown * smooth(1 - Math.hypot(px - point.x, py - point.y) / reach);
          if (share <= 0) {
            continue;
          }
          // A range that crosses the seam carries on at the other edge.
          const at = ty * width + (((tx % width) + width) % width);
          rise[at] = Math.max(rise[at], range.height * share);
          if (range.snowline < 1) {
            cap[at] = Math.max(cap[at], smooth((share - range.snowline) / Math.max(0.08, (1 - range.snowline) * 0.5)));
          }
        }
      }
    }
  }

  for (const patch of patches) {
    const x0 = Math.max(0, Math.floor((patch.originX - bounds.x) * sx));
    const x1 = Math.min(width - 1, Math.ceil((patch.originX + (patch.columns - 1) * patch.step - bounds.x) * sx));
    const y0 = Math.max(0, Math.floor((patch.originY - bounds.y) * sy));
    const y1 = Math.min(height - 1, Math.ceil((patch.originY + (patch.rows - 1) * patch.step - bounds.y) * sy));
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const field = sampleReliefFields([patch], bounds.x + (tx + 0.5) / sx, bounds.y + (ty + 0.5) / sy);
        const share = field.dome + (field.ridge - field.dome) * PATCH_SHARPNESS;
        if (share <= 0) {
          continue;
        }
        const at = ty * width + tx;
        rise[at] = Math.max(rise[at], PATCH_PEAK * share);
        cap[at] = Math.max(cap[at], smooth((share - 0.56) / 0.2));
      }
    }
  }

  const cover = coverGrid(bounds);
  /** A smoothed cover value at a texel, read between the coarse samples. */
  const coverAt = (grid: Float32Array, tx: number, ty: number): number => {
    const gx = ((tx + 0.5) / width) * cover.columns - 0.5;
    const gy = Math.min(cover.rows - 1, Math.max(0, ((ty + 0.5) / height) * cover.rows - 0.5));
    const ix = Math.floor(gx);
    const iy = Math.min(cover.rows - 2, Math.floor(gy));
    const fx = gx - ix;
    const fy = gy - iy;
    const read = (cx: number, cy: number) => grid[cy * cover.columns + ((cx + cover.columns) % cover.columns)];
    return read(ix, iy) * (1 - fx) * (1 - fy) + read(ix + 1, iy) * fx * (1 - fy) + read(ix, iy + 1) * (1 - fx) * fy + read(ix + 1, iy + 1) * fx * fy;
  };

  const data = new Uint8Array(width * height * 4);
  const byte = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255);
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const from = ty * width + tx;
      const at = ((height - 1 - ty) * width + tx) * 4;
      data[at] = byte(rise[from] / PIXIE_HEIGHT_TOP);
      data[at + 1] = byte(coverAt(cover.lush, tx, ty));
      data[at + 2] = byte(coverAt(cover.frost, tx, ty));
      data[at + 3] = byte(cap[from]);
    }
  }
  return { width, height, data };
}
