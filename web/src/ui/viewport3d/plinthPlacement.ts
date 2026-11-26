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
/** A base a little wider again for a pair or a crowd, so the figures have room. */
export const PLINTH_CROWD = 0.12;
/** Height of the base against its radius, at the shipped setting. */
export const PLINTH_HEIGHT_RATIO = 0.22;

export interface PlinthBuffers {
  /** Sixteen numbers each, column-major. */
  matrices: Float32Array;
  /** Three each: the faction's colour, 0 to 1. */
  colors: Float32Array;
  /** Two each: the range's two shapes under the base (see mountainRelief.ts). */
  rises: Float32Array;
}

export function plinthBuffers(): PlinthBuffers {
  return {
    matrices: new Float32Array(MAX_PLINTHS * 16),
    colors: new Float32Array(MAX_PLINTHS * 3),
    rises: new Float32Array(MAX_PLINTHS * 2),
  };
}

/** The base's radius, in world units, for a token `tokenPx` across at zoom `k` and a stack of `count`. */
export function plinthRadius(tokenPx: number, k: number, count: number): number {
  return (tokenPx / 2 / Math.max(k, 1e-6)) * (PLINTH_WIDEN + (count >= 2 ? PLINTH_CROWD : 0));
}

function rgb(hex: string): [number, number, number] {
  return [Number.parseInt(hex.slice(1, 3), 16) / 255, Number.parseInt(hex.slice(3, 5), 16) / 255, Number.parseInt(hex.slice(5, 7), 16) / 255];
}

/**
 * Writes one base for each standing stack in the frame, and returns how many. `heightRatio` is the
 * base's height against its radius. `riseAt` reads the sculpted ranges, so a base on one stands on it.
 */
export function writePlinths(
  out: PlinthBuffers,
  frame: Pick<BoardFrame, "view" | "layouts" | "tokenPx" | "width" | "height">,
  heightRatio: number,
  riseAt: (x: number, y: number) => { dome: number; ridge: number },
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
      const radius = plinthRadius(frame.tokenPx, frame.view.k, counter.slot.entry.count);
      const m = count * 16;
      out.matrices.fill(0, m, m + 16);
      out.matrices[m] = radius;
      out.matrices[m + 5] = radius;
      out.matrices[m + 10] = radius * heightRatio;
      out.matrices[m + 12] = world.x;
      out.matrices[m + 13] = -world.y;
      out.matrices[m + 15] = 1;
      out.colors.set(rgb(factionPalette(counter.slot.entry.faction_id).primary), count * 3);
      const under = riseAt(world.x, world.y);
      out.rises[count * 2] = under.dome;
      out.rises[count * 2 + 1] = under.ridge;
      count += 1;
    }
  }
  return count;
}
