// The shadow each counter and figure drops on the board. Pure.
//
// A flat counter gets a disc slid a little away from the sun, enough to lift it off the sheet at
// any zoom. An upright figure gets an ellipse that stretches away from the sun, and an aircraft's
// falls further off, because it is not standing on the ground. Everything is in scene
// coordinates: x east, y north.
import type { BoardFrame } from "../map/boardLayer";
import { screenToWorld } from "../map/viewMath";
import { shadowReach, type SunState } from "./sun";

/** Most shadows one frame draws. More counters than this are on screen only at absurd zooms. */
export const MAX_UNIT_SHADOWS = 2048;
/** How far a counter's shadow slides, in screen pixels, at the least. */
const MIN_SLIDE_PX = 1.6;
/** The direction shadows fall when the sun is down between days. */
const REST_DIR = { x: 0.5, y: -0.866 } as const;

export interface GroundEllipse {
  /** Centre, in scene coordinates. */
  x: number;
  y: number;
  /** Half-length along `angle`, and half-width across it. */
  a: number;
  b: number;
  /** Direction of the long axis, in radians from scene x. */
  angle: number;
}

/** The unit direction shadows fall along the ground. */
export function shadowDirection(sun: SunState): { x: number; y: number } {
  const flat = Math.hypot(sun.dir[0], sun.dir[1]);
  if (flat < 1e-4 || sun.direct <= 0) {
    return REST_DIR;
  }
  return { x: -sun.dir[0] / flat, y: -sun.dir[1] / flat };
}

/**
 * The shadow of one unit. `x` and `y` are its foot in scene coordinates, `radius` is half a token in
 * world units, `fade` is 0 for a counter and 1 for an upright figure, and `k` is pixels per unit.
 */
export function unitShadow(
  x: number,
  y: number,
  radius: number,
  airborne: boolean,
  fade: number,
  sun: SunState,
  k: number,
): GroundEllipse {
  const dir = shadowDirection(sun);
  const reach = sun.direct > 0 ? Math.min(shadowReach(sun), 1.2) : 0.5;
  const f = Math.min(1, Math.max(0, fade));
  // A counter: a disc, slid.
  const slide = Math.max(0.12 * radius * reach, MIN_SLIDE_PX / Math.max(k, 1e-6));
  // A figure: an ellipse from the foot, thrown along the ground.
  const thrown = radius * 0.9 * reach;
  const lift = airborne ? radius * 1.1 : 0;
  const offset = slide + (thrown / 2 + lift - slide) * f;
  const size = airborne ? 1 - 0.2 * f : 1;
  return {
    x: x + dir.x * offset,
    y: y + dir.y * offset,
    a: (radius * 1.03 + (radius * 0.9 + thrown / 2 - radius * 1.03) * f) * size,
    b: (radius * 1.03 + (radius * 0.6 - radius * 1.03) * f) * size,
    angle: Math.atan2(dir.y, dir.x),
  };
}

/**
 * The dark under a stack whose figures cast their own shadows (see sunShadow.ts): the base they
 * stand on, seen from above, slid a little away from the sun. `fade` is 0 for a counter, which
 * keeps its disc, and 1 for standing figures. An aircraft's base is on the ground like any other.
 */
export function contactShadow(x: number, y: number, radius: number, fade: number, sun: SunState, k: number): GroundEllipse {
  const disc = unitShadow(x, y, radius, false, 0, sun, k);
  const f = Math.min(1, Math.max(0, fade));
  return {
    x: disc.x,
    y: disc.y,
    a: disc.a + (radius * 1.14 - disc.a) * f,
    b: disc.b + (radius * 0.7 - disc.b) * f,
    // The base is wide across the screen, whichever way the sun stands.
    angle: f >= 1 ? 0 : disc.angle * (1 - f),
  };
}

/** Most unit clearings the terrain shader reads. Past this the nearest to the screen's middle are kept. */
export const MAX_UNIT_CLEARINGS = 96;
/** How far past a base's radius the chart's dither and slope shade are fully eased, and where they are back in full. */
export const CLEARING_REACH = 1.5;

/**
 * Where each unit stands, as map x, map y (down the sheet), and the radius of its base, in world
 * units. The terrain shader eases its dither and slope shade down around these so a figure never
 * sits on noise. Writes into `out` (one x, y, r triple per slot) and returns how many.
 */
export function writeUnitClearings(out: Float32Array, frame: BoardFrame): number {
  const k = Math.max(frame.view.k, 1e-6);
  const radius = frame.tokenPx / 2 / k;
  const limit = Math.min(MAX_UNIT_CLEARINGS, Math.floor(out.length / 3));
  const middle = { x: frame.width / 2, y: frame.height / 2 };
  const seen: { x: number; y: number; d: number }[] = [];
  for (const layout of frame.layouts) {
    for (const counter of layout.counters) {
      if (counter.x < -80 || counter.y < -80 || counter.x > frame.width + 80 || counter.y > frame.height + 80) {
        continue;
      }
      seen.push({ x: counter.x, y: counter.y, d: Math.hypot(counter.x - middle.x, counter.y - middle.y) });
    }
  }
  if (seen.length > limit) {
    seen.sort((a, b) => a.d - b.d);
  }
  const count = Math.min(limit, seen.length);
  for (let i = 0; i < count; i += 1) {
    const world = screenToWorld(frame.view, seen[i]);
    out[i * 3] = world.x;
    out[i * 3 + 1] = world.y;
    out[i * 3 + 2] = radius;
  }
  return count;
}

/**
 * Where each ship afloat stands, as map x, map y (down the sheet), and the radius of its mark, in
 * world units. The sea shader holds them for the swell and the bounce round a hull. Returns how many.
 */
export function writeShipPositions(out: Float32Array, frame: BoardFrame): number {
  const k = Math.max(frame.view.k, 1e-6);
  const radius = frame.tokenPx / 2 / k;
  const limit = Math.floor(out.length / 3);
  let count = 0;
  for (const layout of frame.layouts) {
    for (const counter of layout.counters) {
      if (count >= limit) {
        return count;
      }
      if (counter.domain !== "sea" || counter.x < -80 || counter.y < -80 || counter.x > frame.width + 80 || counter.y > frame.height + 80) {
        continue;
      }
      const world = screenToWorld(frame.view, counter);
      out[count * 3] = world.x;
      out[count * 3 + 1] = world.y;
      out[count * 3 + 2] = radius;
      count += 1;
    }
  }
  return count;
}

/**
 * Writes one matrix per counter in the frame into `out` (sixteen numbers each, column-major), for a
 * quad that spans -1 to 1. Returns how many were written. With `contact` set the figures cast
 * their own shadows, and each stack gets only the dark under its base.
 */
export function writeUnitShadows(out: Float32Array, frame: BoardFrame, sun: SunState, z: number, contact = false): number {
  const k = frame.view.k;
  const radius = frame.tokenPx / 2 / Math.max(k, 1e-6);
  const limit = Math.min(MAX_UNIT_SHADOWS, Math.floor(out.length / 16));
  let count = 0;
  for (const layout of frame.layouts) {
    for (const counter of layout.counters) {
      if (count >= limit) {
        return count;
      }
      if (counter.x < -80 || counter.y < -80 || counter.x > frame.width + 80 || counter.y > frame.height + 80) {
        continue;
      }
      // A ship floats on the water. The disc these draw lies on the land plane, above the water, so it would
      // read as a shadow hovering over the sea. A ship's own shadow is cast onto the water by the sun.
      if (counter.domain === "sea") {
        continue;
      }
      const world = screenToWorld(frame.view, counter);
      const shadow = contact
        ? contactShadow(world.x, -world.y, radius, frame.unitFade, sun, k)
        : unitShadow(world.x, -world.y, radius, counter.domain === "air", frame.unitFade, sun, k);
      const c = Math.cos(shadow.angle);
      const s = Math.sin(shadow.angle);
      const m = count * 16;
      out.fill(0, m, m + 16);
      out[m] = c * shadow.a;
      out[m + 1] = s * shadow.a;
      out[m + 4] = -s * shadow.b;
      out[m + 5] = c * shadow.b;
      out[m + 10] = 1;
      out[m + 12] = shadow.x;
      out[m + 13] = shadow.y;
      out[m + 14] = z;
      out[m + 15] = 1;
      count += 1;
    }
  }
  return count;
}
