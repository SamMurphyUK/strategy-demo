// Where each base stands, as buffers for the instanced model (see plinthMeshes.ts). Pure.
//
// One base for each standing stack on screen, in the same place and at the same size as the flat one
// the 2D map would draw: its radius is the token's, widened a little, in world units. Ships have none:
// a ship rides the water on a ring, not on a turned base.
import type { BoardFrame } from "../map/boardLayer";
import { screenToWorld } from "../map/viewMath";
import { factionPalette } from "../theme/factionPalette";

/** Most bases the scene holds. More stacks than this are on screen only at absurd zooms. */
export const MAX_PLINTHS = 512;
/** The base's radius against the token's: the flat base is drawn this much wider than the disc. */
export const PLINTH_WIDEN = 1.15;
/** Height of the base against its radius, at the shipped setting. */
export const PLINTH_HEIGHT_RATIO = 0.22;

export interface PlinthBuffers {
  /** Sixteen numbers each, column-major. */
  matrices: Float32Array;
  /** Three each: the faction's colour, 0 to 1. */
  colors: Float32Array;
  /** Two each: the range's two shapes under the base (see mountainRelief.ts). */
  rises: Float32Array;
  /** One each: 0 standing, up to 1 faded away (a dither in the shader). */
  gone: Float32Array;
}

export function plinthBuffers(): PlinthBuffers {
  return {
    matrices: new Float32Array(MAX_PLINTHS * 16),
    colors: new Float32Array(MAX_PLINTHS * 3),
    rises: new Float32Array(MAX_PLINTHS * 2),
    gone: new Float32Array(MAX_PLINTHS),
  };
}

/** How the base's size follows the stack: the sliders' share of a single unit's base for a pair and for three or more. */
export interface PlinthLook {
  heightRatio: number;
  pair: number;
  crowd: number;
  /** A tracked vehicle's or gun's base against an infantry base's, so it hugs the treads. 1 is no change. */
  vehicleRadius?: number;
}

/** Units on tracks or wheels with a long footprint: their base is drawn tight (see PlinthLook.vehicleRadius). */
const TRACKED_UNITS: ReadonlySet<string> = new Set(["tank", "armor", "artillery", "aa", "aaa"]);

/** How much of an infantry base's radius this unit type's base takes. */
export function unitBaseShare(unitType: string, look: Pick<PlinthLook, "vehicleRadius">): number {
  return TRACKED_UNITS.has(unitType) ? (look.vehicleRadius ?? 1) : 1;
}

/** The base's width against a single unit's, for a stack of `count`. */
export function plinthFactor(count: number, look: Pick<PlinthLook, "pair" | "crowd">): number {
  return count >= 3 ? look.crowd : count >= 2 ? look.pair : 1;
}

/** The base's radius, in world units, for a token `tokenPx` across at zoom `k` and a stack of `count`. */
export function plinthRadius(
  tokenPx: number,
  k: number,
  count: number,
  look: Pick<PlinthLook, "pair" | "crowd" | "vehicleRadius">,
  unitType = "",
): number {
  return (tokenPx / 2 / Math.max(k, 1e-6)) * PLINTH_WIDEN * plinthFactor(count, look) * unitBaseShare(unitType, look);
}

function rgb(hex: string): [number, number, number] {
  return [Number.parseInt(hex.slice(1, 3), 16) / 255, Number.parseInt(hex.slice(3, 5), 16) / 255, Number.parseInt(hex.slice(5, 7), 16) / 255];
}

/**
 * Writes one base for each standing stack in the frame, and returns how many. `heightRatio` is the
 * look carries the base's height against its radius and how much wider a pair and a crowd are. `riseAt` reads the sculpted ranges, so a base on one stands on it.
 */
export function writePlinths(
  out: PlinthBuffers,
  frame: Pick<BoardFrame, "view" | "layouts" | "tokenPx" | "width" | "height">,
  look: PlinthLook,
  riseAt: (x: number, y: number) => { dome: number; ridge: number },
  /** Whether a world point is open sea: an aircraft over it has no base. */
  overSea?: (x: number, y: number) => boolean,
  /** How far a stack's base is faded out, 0 to 1: the bases of a fight fade away as it begins. */
  goneFor?: (regionId: string, key: string) => number,
  /** How far the ground has been lowered at a point, in world units (an island). The base stands that much lower. */
  dropAt?: (x: number, y: number) => number,
): number {
  let count = 0;
  for (const layout of frame.layouts) {
    for (const counter of layout.counters) {
      if (count >= MAX_PLINTHS) {
        return count;
      }
      if (counter.domain === "sea") {
        continue;
      }
      if (counter.x < -80 || counter.y < -80 || counter.x > frame.width + 80 || counter.y > frame.height + 80) {
        continue;
      }
      const world = screenToWorld(frame.view, counter);
      if (counter.domain === "air" && overSea?.(world.x, world.y)) {
        continue;
      }
      const radius = plinthRadius(frame.tokenPx, frame.view.k, counter.slot.entry.count, look, counter.slot.entry.unit_type_id);
      const m = count * 16;
      out.matrices.fill(0, m, m + 16);
      out.matrices[m] = radius;
      out.matrices[m + 5] = radius;
      out.matrices[m + 10] = radius * look.heightRatio;
      out.matrices[m + 12] = world.x;
      out.matrices[m + 13] = -world.y;
      out.matrices[m + 14] = -(dropAt?.(world.x, world.y) ?? 0);
      out.matrices[m + 15] = 1;
      out.colors.set(rgb(factionPalette(counter.slot.entry.faction_id).primary), count * 3);
      const under = riseAt(world.x, world.y);
      out.rises[count * 2] = under.dome;
      out.rises[count * 2 + 1] = under.ridge;
      out.gone[count] = goneFor?.(counter.regionId, counter.slot.key) ?? 0;
      count += 1;
    }
  }
  return count;
}
