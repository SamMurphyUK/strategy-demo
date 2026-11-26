// Where the mist lies. Pure.
//
// Two kinds. Valley mist pools in the low ground between tall ridges of the sculpted ranges, so the peaks stand out of it.
// Jungle mist hangs over the tropical land a little above the tree tops, warm. Sites are found once, with the table;
// each frame the pool of ribbons is spent on the sites nearest the camera's target (see mistField.ts).
import type { Vec2 } from "../map/geometry";
import type { ReliefPatch } from "./mountainRelief";
import { sampleReliefField } from "./mountainRelief";

export type MistKind = "valley" | "jungle";

export interface MistSite {
  x: number;
  y: number;
  kind: MistKind;
  /** The thick monsoon mist of the Southeast Asian jungles: bigger, denser, and just over the canopy. */
  dense?: boolean;
  /** A regional haze: a light, cool one over Europe, a heavy, dusty one over sub-Saharan Africa. */
  haze?: "europe" | "africa";
  /** 0 to 1, fixed per site: size, speed, and phase of the drift. */
  seed: number;
}

/** Ribbons in the pool. */
export const MIST_POOL = 110;
const VALLEY_STEP = 3;
const JUNGLE_STEP = 14;

function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * The valleys: nodes of a relief patch where the ridged massif is low but a ridge stands close on at least one side,
 * so the mist lies in a trough and not on a plain.
 */
export function valleySites(patches: readonly ReliefPatch[]): MistSite[] {
  const out: MistSite[] = [];
  for (const patch of patches) {
    const reach = patch.step * 3;
    for (let gy = 1; gy < patch.rows - 1; gy += VALLEY_STEP) {
      for (let gx = 1; gx < patch.columns - 1; gx += VALLEY_STEP) {
        const x = patch.originX + gx * patch.step;
        const y = patch.originY + gy * patch.step;
        const here = sampleReliefField(patch, x, y);
        // The troughs and the flanks both: mist lies thick over the whole of a range, not only in its floors.
        if (!(here.ridge > 0.04 && here.ridge < 0.7)) {
          continue;
        }
        const high = [
          [reach, 0],
          [-reach, 0],
          [0, reach],
          [0, -reach],
        ].some(([dx, dy]) => sampleReliefField(patch, x + dx, y + dy).ridge > here.ridge + 0.1);
        if (high) {
          out.push({ x, y, kind: "valley", seed: hash2(x, y) });
        }
      }
    }
  }
  return out;
}

/** The tropics: a coarse grid of land points the caller calls jungle. */
export function jungleSites(bounds: { x: number; y: number; w: number; h: number }, isJungle: (x: number, y: number) => boolean): MistSite[] {
  const out: MistSite[] = [];
  for (let y = bounds.y + JUNGLE_STEP / 2; y < bounds.y + bounds.h; y += JUNGLE_STEP) {
    for (let x = bounds.x + JUNGLE_STEP / 2; x < bounds.x + bounds.w; x += JUNGLE_STEP) {
      const jx = x + (hash2(x, y) - 0.5) * JUNGLE_STEP * 0.8;
      const jy = y + (hash2(y, x) - 0.5) * JUNGLE_STEP * 0.8;
      if (isJungle(jx, jy)) {
        out.push({ x: jx, y: jy, kind: "jungle", seed: hash2(jx, jy) });
      }
    }
  }
  return out;
}

/** The territories of Southeast Asia and the western Pacific whose jungles lie under monsoon mist, by words in their ids. */
export const MONSOON_NAMES: readonly string[] = ["burma", "indo", "siam", "thailand", "mala", "sumatra", "java", "borneo", "new guinea", "new_guinea", "philippine", "celebes"];

export function isMonsoonRegion(id: string): boolean {
  const lower = id.toLowerCase();
  return MONSOON_NAMES.some((name) => lower.includes(name));
}

/** Dense mist sites: a grid over each monsoon territory, where the caller says it is land and jungle. */
export function monsoonSites(
  regions: readonly { id: string; box: { x: number; y: number; w: number; h: number }; contains(p: Vec2): boolean }[],
  isLand: (x: number, y: number) => boolean,
  step = 6,
): MistSite[] {
  const out: MistSite[] = [];
  for (const region of regions) {
    if (!isMonsoonRegion(region.id)) {
      continue;
    }
    for (let y = region.box.y + step / 2; y < region.box.y + region.box.h; y += step) {
      for (let x = region.box.x + step / 2; x < region.box.x + region.box.w; x += step) {
        const jx = x + (hash2(x, y) - 0.5) * step * 0.8;
        const jy = y + (hash2(y, x) - 0.5) * step * 0.8;
        if (isLand(jx, jy) && region.contains({ x: jx, y: jy })) {
          out.push({ x: jx, y: jy, kind: "jungle", dense: true, seed: hash2(jx, jy) });
        }
      }
    }
  }
  return out;
}

/** The kind of regional haze a place lies under, from its longitude and latitude. */
export function hazeOf(lon: number, lat: number): "europe" | "africa" | null {
  if (lon >= -10 && lon <= 40 && lat >= 36 && lat <= 62) {
    return "europe";
  }
  // Africa's haze keeps to the middle, where the trees cluster (the Congo basin and the forest belt), with a drift north toward the desert.
  if (lon >= 6 && lon <= 36 && lat >= -9 && lat <= 13) {
    return "africa";
  }
  return null;
}

/** Haze sites: a coarse grid over the land where `hazeAt` names a haze. */
export function hazeSites(
  bounds: { x: number; y: number; w: number; h: number },
  hazeAt: (x: number, y: number) => "europe" | "africa" | null,
  isLand: (x: number, y: number) => boolean,
  step = 11,
): MistSite[] {
  const out: MistSite[] = [];
  for (let y = bounds.y + step / 2; y < bounds.y + bounds.h; y += step) {
    for (let x = bounds.x + step / 2; x < bounds.x + bounds.w; x += step) {
      const jx = x + (hash2(x, y) - 0.5) * step * 0.8;
      const jy = y + (hash2(y, x) - 0.5) * step * 0.8;
      const haze = hazeAt(jx, jy);
      if (haze && isLand(jx, jy)) {
        out.push({ x: jx, y: jy, kind: "valley", haze, seed: hash2(jx, jy) });
      }
    }
  }
  return out;
}

/** The `count` sites nearest a point, nearest first, and no further than `reach`. */
export function nearestSites(sites: readonly MistSite[], x: number, y: number, count: number, reach: number): MistSite[] {
  const limit = reach * reach;
  const scored: { site: MistSite; d: number }[] = [];
  for (const site of sites) {
    const d = (site.x - x) ** 2 + (site.y - y) ** 2;
    if (d <= limit) {
      scored.push({ site, d });
    }
  }
  scored.sort((a, b) => a.d - b.d);
  return scored.slice(0, count).map((entry) => entry.site);
}
