// The light over the table. Pure.
//
// One day is `SUN_CYCLE_S` seconds. The sun crosses the top of the board from the east side to the
// west, low and warm at each end and high and plain in the middle, so cast shadows start long to
// the lower left, shorten, and stretch out to the lower right. Between sunset and the next sunrise
// the direct light fades out and the table is evenly lit for a moment; that is where the direction
// jumps back, with nothing on screen to show it.
//
// Directions are scene coordinates: x east, y north, z up.

export const SUN_CYCLE_S = 300;
/** Share of the cycle the sun is up. The rest is the even light between days. */
export const DAY_SHARE = 0.92;

export type BoardLook = "field" | "dusk";

export type Triple = [number, number, number];

export interface SunState {
  /** Unit vector from the board toward the sun. */
  dir: Triple;
  /** Colour of the direct light. */
  color: Triple;
  /** Colour of the fill light. */
  ambient: Triple;
  /** Strength of the direct light, 0 to 1. Cast shadows fade with it. */
  direct: number;
  /** Opacity of a cast shadow. */
  shadow: number;
}

const DEG = Math.PI / 180;
const NOON: Triple = [1.0, 0.985, 0.95];
const GOLD: Triple = [1.0, 0.86, 0.68];
const SKY: Triple = [0.8, 0.84, 0.9];
const SKY_LOW: Triple = [0.76, 0.74, 0.82];
const SHADOW_ALPHA = 0.3;

function mix(a: Triple, b: Triple, t: number): Triple {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function smooth(from: number, to: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

function direction(azimuthDeg: number, elevationDeg: number): Triple {
  const a = azimuthDeg * DEG;
  const e = elevationDeg * DEG;
  return [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)];
}

/** The fixed evening light of the dusk look: low from the west side, cool fill. */
const DUSK: SunState = {
  dir: direction(-58, 26),
  color: [0.9, 0.8, 0.84],
  ambient: [0.64, 0.68, 0.82],
  direct: 1,
  shadow: 0.34,
};

/** The fixed light for a viewer who asked for less motion: mid-morning. */
const STILL_DAY = 0.3;

function dayLight(day: number): SunState {
  const height = Math.sin(Math.PI * day);
  const warmth = (1 - height) ** 1.5;
  // Azimuth is measured from north toward east. The sun starts on the east side and ends on the west.
  const dir = direction(62 - 124 * day, 30 + 32 * height);
  const edge = smooth(0, 0.07, day) * smooth(1, 0.93, day);
  return {
    dir,
    color: mix(NOON, GOLD, warmth),
    ambient: mix(SKY, SKY_LOW, warmth),
    direct: edge,
    shadow: SHADOW_ALPHA * edge,
  };
}

/** The light at `seconds` since the board opened. */
export function sunAt(seconds: number, look: BoardLook = "field", still = false): SunState {
  if (look === "dusk") {
    return DUSK;
  }
  if (still) {
    return dayLight(STILL_DAY);
  }
  const phase = (((seconds % SUN_CYCLE_S) + SUN_CYCLE_S) % SUN_CYCLE_S) / SUN_CYCLE_S;
  if (phase >= DAY_SHARE) {
    // Between days. The direct light is already out, so only the fill shows.
    const rest = dayLight(1);
    return { ...rest, dir: dayLight(0).dir, direct: 0, shadow: 0 };
  }
  return dayLight(phase / DAY_SHARE);
}

/** How far east or west of north a held sun can stand, in degrees. Inside the lit part of the day. */
export const HELD_SUN_LIMIT = 50;

/**
 * The daylight with the sun held at an azimuth, in degrees east of north. It is the same arc the
 * moving sun follows, so a held sun at 0 is noon and one at either limit is a long warm shadow.
 */
export function sunAtAzimuth(azimuthDeg: number, look: BoardLook = "field"): SunState {
  if (look === "dusk") {
    return DUSK;
  }
  const azimuth = Math.min(HELD_SUN_LIMIT, Math.max(-HELD_SUN_LIMIT, azimuthDeg));
  return dayLight((62 - azimuth) / 124);
}

/**
 * Light on a surface facing `normalDotSun` toward the sun, as a multiplier on its colour. A face
 * square to the noon sun comes out near 1, so the flat top of the land keeps its printed colour.
 */
export function litFactor(sun: SunState, normalDotSun: number): Triple {
  const n = Math.max(0, normalDotSun) * sun.direct;
  const fill = 1 - 0.42 * sun.direct;
  return [
    sun.ambient[0] * fill + sun.color[0] * n * 0.62 + 0.2 * (1 - sun.direct),
    sun.ambient[1] * fill + sun.color[1] * n * 0.62 + 0.16 * (1 - sun.direct),
    sun.ambient[2] * fill + sun.color[2] * n * 0.62 + 0.1 * (1 - sun.direct),
  ];
}

/** How far a shadow reaches along the ground for each unit of height. Capped so dawn does not smear. */
export function shadowReach(sun: SunState, cap = 1.8): number {
  const flat = Math.hypot(sun.dir[0], sun.dir[1]);
  return Math.min(cap, flat / Math.max(sun.dir[2], 1e-3));
}
