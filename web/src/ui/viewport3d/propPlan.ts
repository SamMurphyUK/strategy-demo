// Where the table dressing stands: trees by biome, peaks along the ranges, a few roofs by the
// industry. Pure and deterministic, so the same map always grows the same forest.
//
// Nothing here is a rule. Props keep clear of the points the pieces use (unit anchors, unit slots,
// facility badges), stay off the coast, and are small next to a counter.
import type { Rect, Vec2 } from "../map/geometry";
import { type Biome, biomeAtMap, mapToLonLat, crestPoints, MOUNTAIN_RANGES, type MountainRange } from "./geography";

export type PropKind = "pine" | "broadleaf" | "acacia" | "palm" | "rock" | "dune" | "peak" | "house" | "factory";

export const PROP_KINDS: readonly PropKind[] = ["pine", "broadleaf", "acacia", "palm", "rock", "dune", "peak", "house", "factory"];

export type Rgb = [number, number, number];

export interface PropInstance {
  x: number;
  y: number;
  /** Footprint scale, in world units for a model one unit wide. */
  scale: number;
  /** Height, in world units for a model one unit tall. */
  height: number;
  /** Rotation about the vertical, in radians. */
  turn: number;
  /** Lift above the ground, in world units. Absent is 0. Set by the placement editor. */
  lift?: number;
  /** Colour of the tinted parts (foliage, rock, walls), as 0 to 1 sRGB. */
  tint: Rgb;
  /** A switch for the model's optional part: 1 puts snow on a peak, or a second chimney on a factory. */
  snow: number;
}

export interface SmokeStack {
  x: number;
  y: number;
  /** Height of the chimney mouth above the land. */
  z: number;
}

export interface PropPlan {
  props: Record<PropKind, PropInstance[]>;
  chimneys: SmokeStack[];
}

export interface TownSite {
  x: number;
  y: number;
  houses: number;
  /** 0 none, 1 one chimney, 2 two. */
  factory: 0 | 1 | 2;
}

export interface PlanInput {
  bounds: Rect;
  isLand(p: Vec2): boolean;
  /** Points the pieces use. Props stay away from each. */
  keepClear: readonly Vec2[];
  towns: readonly TownSite[];
  /** Ranges to raise. Defaults to the world's. */
  ranges?: readonly MountainRange[];
  /** Ground cover at a point. Defaults to the world's. */
  biomeAt?(p: Vec2): Biome;
  /** 0 to 1: how far the theaters' crowns differ (see theaterTint). Absent is 0, one look. */
  canopyContrast?: number;
}

/** Where the factory model's chimneys stand, in model units. The second is mirrored in x. */
export const FACTORY_CHIMNEY = { x: 0.3, y: 0.18, top: 1.4 } as const;

/** Spacing of the tree grid, in world units. */
export const TREE_STEP = 2.6;
/** Trees and rocks keep this far from a point the pieces use. */
export const TREE_CLEARANCE = 4.4;
/** Dunes and buildings keep this far. */
export const PEAK_CLEARANCE = 7.2;
/** A peak keeps its own foot, and a little more, clear of a point the pieces use. `scale` is the foot's width. */
export function peakClearance(scale: number): number {
  return scale * 0.5 + 1.6;
}
/** Share of a range's height its peaks stand to. Low, so a range is a ridge on the board and not a row of spikes. */
export const PEAK_RISE = 0.62;
/** A prop stands at least this far inside the coast. */
export const COAST_MARGIN = 1.1;

const hex = (value: string): Rgb => [
  Number.parseInt(value.slice(1, 3), 16) / 255,
  Number.parseInt(value.slice(3, 5), 16) / 255,
  Number.parseInt(value.slice(5, 7), 16) / 255,
];
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// From the fading-16 strip (see militaryPalette.ts), spelled out so this file stays free of the theme.
const SPRUCE = hex("#5B7D73");
const SAGE = hex("#8E9F7D");
const OLIVE = hex("#7D7B62");
const TAN = hex("#CCA87B");
const CREAM = hex("#DDCF99");
const BONE = hex("#A99C8D");
const TAUPE = hex("#645355");
const BROWN = hex("#846D59");
const FELDGRAU = hex("#8C7C79");
const CHARCOAL = hex("#4B3D44");

const PINE = mix(SPRUCE, CHARCOAL, 0.22);
const LEAF = mix(SAGE, SPRUCE, 0.35);
const JUNGLE = mix(SPRUCE, OLIVE, 0.3);
const DRY_LEAF = mix(OLIVE, SAGE, 0.35);
const PALM = mix(SAGE, SPRUCE, 0.55);
const SAND = mix(TAN, CREAM, 0.35);
const ROCK = mix(TAUPE, FELDGRAU, 0.5);
const ICE = mix(BONE, CREAM, 0.6);
const PEAK_ROCK = mix(TAUPE, BROWN, 0.45);
const WALL = mix(CREAM, BONE, 0.35);

/** A repeatable number in [0, 1) for a grid cell and a salt. */
export function cellHash(ix: number, iy: number, salt: number): number {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * How a wood is clumped into copses: a multiplier on the chance a cell grows a tree. A slow noise draws the copses (about
 * twenty units across), and a ramp through it makes a dense heart, a feathered edge, and open clearings between them.
 */
export function copseFactor(x: number, y: number): number {
  const copse = patchNoise(x * 0.09, y * 0.09, 23) * 0.7 + patchNoise(x * 0.23, y * 0.23, 29) * 0.3;
  const t = Math.min(1, Math.max(0, (copse - 0.36) / 0.2));
  return 0.06 + 1.5 * t * t * (3 - 2 * t);
}

/** Smooth noise in [0, 1], for forest patches. */
export function patchNoise(x: number, y: number, salt: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const a = cellHash(ix, iy, salt);
  const b = cellHash(ix + 1, iy, salt);
  const c = cellHash(ix, iy + 1, salt);
  const d = cellHash(ix + 1, iy + 1, salt);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

interface Cover {
  /** Chance that a grid cell grows something, inside a patch. */
  density: number;
  /** Share of the ground that patches leave bare. 0 spreads the cover evenly. */
  patchy: number;
  /** Kinds and their shares, in order. */
  mix: readonly (readonly [PropKind, number])[];
}

const COVER: Record<Biome, Cover> = {
  ice: { density: 0.03, patchy: 0, mix: [["rock", 1]] },
  tundra: { density: 0.06, patchy: 0, mix: [["rock", 0.75], ["pine", 0.25]] },
  taiga: { density: 0.72, patchy: 0.47, mix: [["pine", 0.9], ["broadleaf", 0.07], ["rock", 0.03]] },
  temperate: { density: 0.56, patchy: 0.51, mix: [["broadleaf", 0.68], ["pine", 0.3], ["rock", 0.02]] },
  steppe: { density: 0.05, patchy: 0, mix: [["broadleaf", 0.5], ["rock", 0.5]] },
  scrub: { density: 0.3, patchy: 0.55, mix: [["broadleaf", 0.5], ["pine", 0.38], ["rock", 0.12]] },
  desert: { density: 0.1, patchy: 0, mix: [["dune", 0.58], ["rock", 0.3], ["palm", 0.12]] },
  savanna: { density: 0.13, patchy: 0, mix: [["acacia", 0.84], ["rock", 0.16]] },
  jungle: { density: 0.8, patchy: 0.42, mix: [["broadleaf", 0.74], ["palm", 0.26]] },
};

function pickKind(cover: Cover, roll: number): PropKind {
  let sum = 0;
  for (const [kind, share] of cover.mix) {
    sum += share;
    if (roll < sum) {
      return kind;
    }
  }
  return cover.mix[cover.mix.length - 1][0];
}

function shade(tint: Rgb, roll: number, spread = 0.2): Rgb {
  const f = 1 - spread / 2 + roll * spread;
  return [Math.min(1, tint[0] * f), Math.min(1, tint[1] * f), Math.min(1, tint[2] * f)];
}

/** Rich emerald-jade and mossy-lime crowns for the Pacific and Southeast Asian jungles. */
const PACIFIC_JADE: Rgb = [0.16, 0.5, 0.36];
const PACIFIC_LIME: Rgb = [0.42, 0.6, 0.2];
/** Sun-bleached olive-sage and warm acacia-gold crowns for Sub-Saharan and East Africa. */
const AFRICA_SAGE: Rgb = [0.5, 0.54, 0.36];
const AFRICA_GOLD: Rgb = [0.74, 0.6, 0.27];

export type Theater = "pacific" | "africa" | "other";

/** The theater of a place, from its longitude and latitude. */
export function theaterOf(lon: number, lat: number): Theater {
  if (lat >= -26 && lat <= 26 && (lon >= 92 || lon <= -140)) {
    return "pacific";
  }
  if (lat >= -36 && lat <= 22 && lon >= -20 && lon <= 55) {
    return "africa";
  }
  return "other";
}

/**
 * A crown's tint by theater: Pacific and Southeast Asian jungles go rich emerald-jade and mossy-lime, Africa's go dry olive-sage and
 * acacia-gold. `contrast` is how far the crown moves toward its theater's colours, and a roll picks between the pair. Other places,
 * and everything that is not foliage, keep their own tint.
 */
export function theaterTint(tint: Rgb, theater: Theater, roll: number, contrast: number): Rgb {
  if (theater === "other" || contrast <= 0) {
    return tint;
  }
  const pair = theater === "pacific" ? [PACIFIC_JADE, PACIFIC_LIME] : [AFRICA_SAGE, AFRICA_GOLD];
  const target = mix(pair[0], pair[1], roll);
  // Keep the crown's own light and dark: the target's hue at the tint's brightness.
  const own = (tint[0] + tint[1] + tint[2]) / 3;
  const goal = (target[0] + target[1] + target[2]) / 3 || 1;
  const lit: Rgb = [Math.min(1, target[0] * (own / goal)), Math.min(1, target[1] * (own / goal)), Math.min(1, target[2] * (own / goal))];
  return mix(tint, lit, Math.min(1, contrast));
}

function dress(kind: PropKind, biome: Biome, p: Vec2, rolls: readonly [number, number, number, number]): PropInstance {
  const [a, b, c, d] = rolls;
  const base = { x: p.x, y: p.y, turn: c * Math.PI * 2, snow: 0 };
  switch (kind) {
    case "pine": {
      const cold = biome === "taiga" || biome === "tundra";
      const lean = biome === "scrub";
      const size = biome === "tundra" ? 0.7 : 1;
      return {
        ...base,
        scale: (lean ? 1.15 : 1.5 + a * 0.6) * size,
        height: (lean ? 3.4 + b * 0.8 : 3.0 + b * 1.4) * size,
        tint: shade(cold ? PINE : mix(PINE, LEAF, 0.3), d),
      };
    }
    case "broadleaf": {
      if (biome === "jungle") {
        return { ...base, scale: 1.9 + a * 0.7, height: 3.0 + b * 1.1, tint: shade(JUNGLE, d) };
      }
      const dry = biome === "scrub" || biome === "steppe";
      return {
        ...base,
        scale: dry ? 1.3 + a * 0.5 : 1.6 + a * 0.7,
        height: dry ? 1.9 + b * 0.6 : 2.4 + b * 0.9,
        tint: shade(dry ? DRY_LEAF : LEAF, d),
      };
    }
    case "acacia":
      return { ...base, scale: 2.0 + a * 0.7, height: 2.2 + b * 0.6, tint: shade(DRY_LEAF, d) };
    case "palm":
      return { ...base, scale: 1.5 + a * 0.4, height: 3.0 + b * 0.8, tint: shade(PALM, d) };
    case "dune":
      return { ...base, turn: (c - 0.5) * 0.9, scale: 2.8 + a * 2.2, height: 0.42 + b * 0.3, tint: shade(SAND, d, 0.12) };
    default:
      return {
        ...base,
        scale: 0.7 + a * 0.7,
        height: 0.5 + b * 0.5,
        tint: shade(biome === "ice" ? ICE : biome === "desert" ? mix(ROCK, TAN, 0.4) : ROCK, d),
      };
  }
}

/** Looks up whether any stored point lies within a radius. */
class PointGrid {
  private readonly cells = new Map<number, number[]>();

  constructor(private readonly size: number) {}

  private key(ix: number, iy: number): number {
    return ix * 100003 + iy;
  }

  add(x: number, y: number, radius = 0): void {
    const key = this.key(Math.floor(x / this.size), Math.floor(y / this.size));
    const list = this.cells.get(key);
    if (list) {
      list.push(x, y, radius);
    } else {
      this.cells.set(key, [x, y, radius]);
    }
  }

  /** True when a stored point is closer than `reach` plus its own radius. */
  near(x: number, y: number, reach: number): boolean {
    const span = Math.ceil((reach + this.size) / this.size);
    const cx = Math.floor(x / this.size);
    const cy = Math.floor(y / this.size);
    for (let iy = cy - span; iy <= cy + span; iy++) {
      for (let ix = cx - span; ix <= cx + span; ix++) {
        const list = this.cells.get(this.key(ix, iy));
        if (!list) {
          continue;
        }
        for (let i = 0; i < list.length; i += 3) {
          const limit = reach + list[i + 2];
          const dx = list[i] - x;
          const dy = list[i + 1] - y;
          if (dx * dx + dy * dy < limit * limit) {
            return true;
          }
        }
      }
    }
    return false;
  }
}

function emptyProps(): Record<PropKind, PropInstance[]> {
  return { pine: [], broadleaf: [], acacia: [], palm: [], rock: [], dune: [], peak: [], house: [], factory: [] };
}

/** Lays out every prop for a map. */
export function planProps(input: PlanInput): PropPlan {
  const { bounds } = input;
  const biomeOf = input.biomeAt ?? biomeAtMap;
  const props = emptyProps();
  const contrast = input.canopyContrast ?? 0;
  const chimneys: SmokeStack[] = [];
  const wrapX = (x: number) => bounds.x + ((((x - bounds.x) % bounds.w) + bounds.w) % bounds.w);
  const inside = (p: Vec2, margin: number): boolean =>
    p.y >= bounds.y + margin &&
    p.y <= bounds.y + bounds.h - margin &&
    input.isLand(p) &&
    input.isLand({ x: p.x + margin, y: p.y }) &&
    input.isLand({ x: p.x - margin, y: p.y }) &&
    input.isLand({ x: p.x, y: p.y + margin }) &&
    input.isLand({ x: p.x, y: p.y - margin });

  const reserved = new PointGrid(8);
  for (const point of input.keepClear) {
    reserved.add(point.x, point.y);
  }
  // Whatever is built or raised first, so the forest grows around it.
  const built = new PointGrid(8);

  // Towns: a factory if the territory has one, with houses around it.
  for (const [index, town] of input.towns.entries()) {
    const centre = { x: town.x, y: town.y };
    if (!inside(centre, COAST_MARGIN)) {
      continue;
    }
    if (town.factory > 0) {
      const turn = (cellHash(index, 3, 71) - 0.5) * 0.5;
      // On a factory the flag raises the second chimney.
      props.factory.push({
        x: centre.x,
        y: centre.y,
        scale: 2.7,
        height: 2.3,
        turn,
        tint: shade(BROWN, cellHash(index, 5, 71), 0.1),
        snow: town.factory > 1 ? 1 : 0,
      });
      built.add(centre.x, centre.y, 2.2);
      // The model's chimneys, turned with it. Model y points north; map y points south.
      const stacks = town.factory > 1 ? [FACTORY_CHIMNEY.x, -FACTORY_CHIMNEY.x] : [FACTORY_CHIMNEY.x];
      for (const mx of stacks) {
        const cx = mx * 2.7;
        const cy = FACTORY_CHIMNEY.y * 2.7;
        chimneys.push({
          x: centre.x + cx * Math.cos(turn) - cy * Math.sin(turn),
          y: centre.y - (cx * Math.sin(turn) + cy * Math.cos(turn)),
          z: FACTORY_CHIMNEY.top * 2.3,
        });
      }
    }
    let placed = 0;
    for (let attempt = 0; attempt < town.houses * 6 && placed < town.houses; attempt++) {
      const angle = cellHash(index, attempt, 17) * Math.PI * 2;
      const reach = (town.factory > 0 ? 2.6 : 0.4) + cellHash(index, attempt, 19) * (1.6 + town.houses * 0.32);
      const p = { x: centre.x + Math.cos(angle) * reach, y: centre.y + Math.sin(angle) * reach * 0.8 };
      if (!inside(p, COAST_MARGIN) || built.near(p.x, p.y, 0.75) || reserved.near(p.x, p.y, TREE_CLEARANCE)) {
        continue;
      }
      const quarter = Math.floor(cellHash(index, attempt, 23) * 2) * (Math.PI / 2);
      props.house.push({
        x: p.x,
        y: p.y,
        scale: 1.15 + cellHash(index, attempt, 29) * 0.4,
        height: 1.2 + cellHash(index, attempt, 31) * 0.4,
        turn: quarter + (cellHash(index, attempt, 37) - 0.5) * 0.35,
        tint: shade(WALL, cellHash(index, attempt, 41), 0.16),
        snow: 0,
      });
      built.add(p.x, p.y, 0.75);
      placed += 1;
    }
  }

  // Peaks, along each crest. The tallest stand in the middle of the range.
  const ranges = input.ranges ?? MOUNTAIN_RANGES;
  for (const [rangeIndex, range] of ranges.entries()) {
    const crest = crestPoints(range, 2.4);
    for (const [i, at] of crest.entries()) {
      const rows = range.spread > 1.5 ? 2 : 1;
      for (let row = 0; row < rows; row++) {
        const jx = (cellHash(rangeIndex * 97 + i, row, 43) - 0.5) * 2;
        const jy = (cellHash(rangeIndex * 97 + i, row, 47) - 0.5) * 2;
        const p = { x: wrapX(at.x + jx * range.spread), y: at.y + jy * range.spread };
        const full = 0.55 + 0.45 * at.crown * (0.7 + 0.3 * cellHash(rangeIndex * 97 + i, row, 53));
        // Where the pieces crowd the range, a foothill stands in for the peak.
        let size = 0;
        let radius = 0;
        for (const tried of [full, full * 0.62]) {
          // The foot's radius, in world units.
          const foot = 1.3 + 1.5 * tried;
          // Neighbours overlap at the foot, so a range reads as one massif and not a row of cones.
          if (inside(p, foot * 0.8) && !reserved.near(p.x, p.y, peakClearance(foot * 2)) && !built.near(p.x, p.y, foot * 0.3)) {
            size = tried;
            radius = foot;
            break;
          }
        }
        if (size === 0) {
          continue;
        }
        const tall = size >= range.snowline;
        props.peak.push({
          x: p.x,
          y: p.y,
          scale: radius * 2,
          height: range.height * size * PEAK_RISE,
          turn: cellHash(rangeIndex * 97 + i, row, 59) * Math.PI * 2,
          tint: shade(PEAK_ROCK, cellHash(rangeIndex * 97 + i, row, 61), 0.14),
          snow: tall ? 1 : 0,
        });
        built.add(p.x, p.y, radius * 0.55);
      }
    }
  }

  // Trees, rocks, and dunes on a jittered grid, thinned into patches.
  const columns = Math.ceil(bounds.w / TREE_STEP);
  const rows = Math.ceil(bounds.h / TREE_STEP);
  for (let iy = 0; iy < rows; iy++) {
    for (let ix = 0; ix < columns; ix++) {
      const p = {
        x: bounds.x + (ix + 0.15 + 0.7 * cellHash(ix, iy, 1)) * TREE_STEP,
        y: bounds.y + (iy + 0.15 + 0.7 * cellHash(ix, iy, 2)) * TREE_STEP,
      };
      const biome = biomeOf(p);
      const cover = COVER[biome];
      let chance = cover.density;
      if (cover.patchy > 0) {
        const patch = patchNoise(p.x * 0.045, p.y * 0.045, 7) * 0.65 + patchNoise(p.x * 0.13, p.y * 0.13, 11) * 0.35;
        // Bare below the threshold, full a little above it.
        chance *= Math.min(1, Math.max(0, (patch - cover.patchy) / 0.08));
        // Woods stand in copses, thick at the heart of each and thinning to an open edge, with clearings between.
        chance *= copseFactor(p.x, p.y);
      }
      if (cellHash(ix, iy, 3) >= chance) {
        continue;
      }
      const kind = pickKind(cover, cellHash(ix, iy, 4));
      const margin = kind === "dune" ? COAST_MARGIN * 2.2 : COAST_MARGIN;
      if (!inside(p, margin) || reserved.near(p.x, p.y, kind === "dune" ? PEAK_CLEARANCE : TREE_CLEARANCE) || built.near(p.x, p.y, 0.5)) {
        continue;
      }
      const dressed = dress(kind, biome, p, [cellHash(ix, iy, 5), cellHash(ix, iy, 6), cellHash(ix, iy, 8), cellHash(ix, iy, 9)]);
      if (contrast > 0 && (kind === "pine" || kind === "broadleaf" || kind === "palm" || kind === "acacia")) {
        const place = mapToLonLat(p);
        dressed.tint = theaterTint(dressed.tint, theaterOf(place.lon, place.lat), cellHash(ix, iy, 12), contrast);
      }
      props[kind].push(dressed);
    }
  }
  return { props, chimneys };
}

export interface TownRegion {
  id: string;
  ipc: number;
  /** 0 none, 1 minor, 2 major. */
  factory: 0 | 1 | 2;
  anchor: Vec2;
  /** True for a point inside the territory. */
  contains(p: Vec2): boolean;
}

/**
 * Picks a town site for each territory with industry or income worth a roof: a spot inside the
 * territory, on land, as far from the pieces' points as the neighbourhood of the anchor allows.
 */
export function townSites(
  regions: readonly TownRegion[],
  isLand: (p: Vec2) => boolean,
  keepClear: readonly Vec2[],
): TownSite[] {
  const sites: TownSite[] = [];
  for (const region of regions) {
    if (region.factory === 0 && region.ipc < 2) {
      continue;
    }
    let best: Vec2 | null = null;
    let bestGap = PEAK_CLEARANCE;
    for (const reach of [10, 13, 16, 8]) {
      for (let step = 0; step < 16; step++) {
        const angle = (step / 16) * Math.PI * 2 + reach;
        const p = { x: region.anchor.x + Math.cos(angle) * reach, y: region.anchor.y + Math.sin(angle) * reach * 0.85 };
        if (!region.contains(p) || !isLand(p)) {
          continue;
        }
        let gap = Number.POSITIVE_INFINITY;
        for (const point of keepClear) {
          const d = Math.hypot(point.x - p.x, point.y - p.y);
          if (d < gap) {
            gap = d;
          }
        }
        if (gap > bestGap) {
          bestGap = gap;
          best = p;
        }
      }
    }
    if (!best) {
      continue;
    }
    sites.push({
      x: best.x,
      y: best.y,
      houses: Math.min(9, 1 + Math.floor(region.ipc * 0.9) + (region.factory > 0 ? 1 : 0)),
      factory: region.factory,
    });
  }
  return sites;
}
