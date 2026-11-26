// The sea strip and the beach along the front of a coastal battle. Pure. Built on the campaign's sine swell (skins/waterSwell.ts): the same
// `waterY` drives the water's bob, the swash up the beach and the offshore ship's heave, so the sea here and on the board move alike.
import { waterY } from "../skins/waterSwell";
import { hexToRgb, type Rgb } from "../skins/battleSkin";
import type { BattleLook } from "../skins/battleVisualConfig";

function smooth(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * The sea's colour across the strip: `v` is 0 at the coast and 1 at the bottom edge. Three bands blend: a lighter green-blue at the coast, a
 * mid blue in the middle, a darker blue at the bottom.
 */
export function seaBandAt(v: number, look: Readonly<BattleLook["sea"]>): Rgb {
  const coast = hexToRgb(look.coast);
  const mid = hexToRgb(look.mid);
  const deep = hexToRgb(look.deep);
  const t = Math.min(1, Math.max(0, v));
  return mix(mix(coast, mid, smooth(0.1, 0.5, t)), deep, smooth(0.5, 0.95, t));
}

/** The water takes a share of the light's colour (the sun's or the moon's): a tint, so night water is cool and dusk water warm. */
export function seaLit(color: Rgb, light: Rgb, share: number): Rgb {
  const k = Math.min(1, Math.max(0, share));
  return [color[0] * (1 - k + light[0] * k), color[1] * (1 - k + light[1] * k), color[2] * (1 - k + light[2] * k)];
}

/** The swell the strip rides, as the campaign's function takes it. */
export function swellAt(x: number, y: number, seconds: number, look: Readonly<BattleLook["sea"]>): number {
  return waterY(x, y, { amp: 0.12 * look.bob, seconds, loopSeconds: 20, directionDeg: 0 });
}

/** How far up the beach the water's edge reaches at x, in the share of the beach's width, 0 to 1: it breaks and swashes in and out. */
export function swashReach(x: number, seconds: number, look: Readonly<BattleLook["sea"]>): number {
  const wave = 0.5 + 0.5 * Math.sin(seconds * 0.9 - x * 0.35);
  const slow = 0.5 + 0.5 * Math.sin(seconds * 0.37 + x * 0.11);
  return Math.min(1, Math.max(0, look.swash * (0.55 * wave + 0.45 * slow)));
}

/** The beach's height above the sea at a share across it (0 at the waterline, 1 at the land): a gentle slope, never a cliff. */
export function beachHeight(share: number): number {
  const t = Math.min(1, Math.max(0, share));
  return 0.25 * t * (2 - t);
}
