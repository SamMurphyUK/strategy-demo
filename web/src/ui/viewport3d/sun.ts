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

/** The shape of the day: how high the sun stands at its ends and at noon, and how strong its two lights are. */
export interface SunArc {
  /** Height of the sun at dawn and at dusk, in degrees above the table. */
  minElevation: number;
  /** Height at noon. */
  maxElevation: number;
  /** 1 is the shipped amber at the ends of the day. More warms noon too. 0 is white light all day. */
  warmth: number;
  /** Strength of the cool fill from the sky. */
  fill: number;
}

/** The arc the board shipped with. */
export const SHIPPED_ARC: Readonly<SunArc> = Object.freeze({ minElevation: 30, maxElevation: 62, warmth: 1, fill: 1 });

function dayLight(day: number, arc: Readonly<SunArc> = SHIPPED_ARC): SunState {
  const height = Math.sin(Math.PI * day);
  const low = (1 - height) ** 1.5;
  const warmth = Math.min(1, Math.max(0, low * arc.warmth + 0.3 * (arc.warmth - 1)));
  // Azimuth is measured from north toward east. The sun starts on the east side and ends on the west.
  const dir = direction(62 - 124 * day, arc.minElevation + (arc.maxElevation - arc.minElevation) * height);
  const edge = smooth(0, 0.07, day) * smooth(1, 0.93, day);
  const sky = mix(SKY, SKY_LOW, low);
  return {
    dir,
    color: mix(NOON, GOLD, warmth),
    ambient: [sky[0] * arc.fill, sky[1] * arc.fill, sky[2] * arc.fill],
    direct: edge,
    shadow: SHADOW_ALPHA * edge,
  };
}

/** The light at `seconds` since the board opened. */
export function sunAt(seconds: number, look: BoardLook = "field", still = false, arc: Readonly<SunArc> = SHIPPED_ARC): SunState {
  if (look === "dusk") {
    return DUSK;
  }
  if (still) {
    return dayLight(STILL_DAY, arc);
  }
  const phase = (((seconds % SUN_CYCLE_S) + SUN_CYCLE_S) % SUN_CYCLE_S) / SUN_CYCLE_S;
  if (phase >= DAY_SHARE) {
    // Between days. The direct light is already out, so only the fill shows.
    const rest = dayLight(1, arc);
    return { ...rest, dir: dayLight(0, arc).dir, direct: 0, shadow: 0 };
  }
  return dayLight(phase / DAY_SHARE, arc);
}

/** How far east or west of north a held sun can stand, in degrees. Inside the lit part of the day. */
export const HELD_SUN_LIMIT = 50;

/**
 * The daylight with the sun held at an azimuth, in degrees east of north. It is the same arc the
 * moving sun follows, so a held sun at 0 is noon and one at either limit is a long warm shadow.
 */
export function sunAtAzimuth(azimuthDeg: number, look: BoardLook = "field", arc: Readonly<SunArc> = SHIPPED_ARC): SunState {
  if (look === "dusk") {
    return DUSK;
  }
  const azimuth = Math.min(HELD_SUN_LIMIT, Math.max(-HELD_SUN_LIMIT, azimuthDeg));
  return dayLight((62 - azimuth) / 124, arc);
}

export type SunCycleMode = "animated" | "static-noon" | "static-golden" | "off";

/** The held sun of the golden setting: the west end of the arc, late in the afternoon. */
export const GOLDEN_AZIMUTH = -HELD_SUN_LIMIT;

/**
 * The light for a sun setting. `animated` is the moving day, or the sun held at `held` degrees
 * when a board holds it. The two static settings stand on the same arc. `off` is the even light
 * between days: no direct light, and nothing casts.
 */
export function sunFor(
  cycle: SunCycleMode,
  seconds: number,
  look: BoardLook = "field",
  still = false,
  held: number | null = null,
  arc: Readonly<SunArc> = SHIPPED_ARC,
): SunState {
  if (cycle === "off") {
    const rest = sunAtAzimuth(0, look, arc);
    return { ...rest, direct: 0, shadow: 0 };
  }
  if (cycle === "static-noon") {
    return sunAtAzimuth(0, look, arc);
  }
  if (cycle === "static-golden") {
    return sunAtAzimuth(GOLDEN_AZIMUTH, look, arc);
  }
  return held === null ? sunAt(seconds, look, still, arc) : sunAtAzimuth(held, look, arc);
}

/**
 * The direction cast shadows are thrown from: the sun's bearing, lifted until a shadow is no
 * longer than `cap` times the height of what casts it. A dawn sun would lay a forest's shadows
 * across the whole territory.
 */
export function shadowLight(sun: SunState, cap = 1): Triple {
  const flat = Math.hypot(sun.dir[0], sun.dir[1]);
  if (flat < 1e-6) {
    return [0, 0, 1];
  }
  const reach = Math.min(cap, flat / Math.max(sun.dir[2], 1e-3));
  const length = Math.hypot(reach, 1);
  return [(sun.dir[0] / flat) * (reach / length), (sun.dir[1] / flat) * (reach / length), 1 / length];
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
