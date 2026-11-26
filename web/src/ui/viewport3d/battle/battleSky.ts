// The battle's sky, sun and light, from the campaign's own lighting engine (sun.ts): the sun's direction, colour and shadow follow its
// smooth day cycle (never a shadowless sunset), and a night mode swaps the sun for a moon with a cool grade. Pure.
import { sunFor, type SunState, type Triple } from "../sun";

export type SkyMode = "day" | "night";

export interface SkyState {
  mode: SkyMode;
  /** Direction toward the light (the sun or the moon): x east, y into the scene, z up. */
  dir: Triple;
  color: Triple;
  ambient: Triple;
  direct: number;
  /** Opacity of a cast shadow. */
  shadow: number;
  /** 0 by day, 1 at night: the stars and the moon come in with it. */
  night: number;
  zenith: Triple;
  horizon: Triple;
  tree: Triple;
  cloud: Triple;
  /** What the lit surfaces are multiplied by: the ambient fill plus the direct light. About 1 at noon. */
  light: Triple;
}

/** The sky mode: the `sky` query value wins ("night" or "day"); otherwise the theatre's. Only day theatres exist so far. */
export function skyModeFor(_theater: string | undefined, param: string | null): SkyMode {
  return param === "night" ? "night" : "day";
}

/** Where on the campaign's day the battle starts, in seconds: mid-morning, low enough to throw long shadows. */
export const BATTLE_DAY_START = 30;
/** How fast the battle's clock runs the campaign's sun. A long battle crosses a good part of the day. */
export const BATTLE_DAY_PACE = 0.5;

function lightOf(ambient: Triple, color: Triple, direct: number, floor: number): Triple {
  return [Math.min(1.1, ambient[0] * 0.55 + color[0] * direct * 0.5 + floor), Math.min(1.1, ambient[1] * 0.55 + color[1] * direct * 0.5 + floor), Math.min(1.1, ambient[2] * 0.55 + color[2] * direct * 0.5 + floor)];
}

function mix(a: Triple, b: Triple, t: number): Triple {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** The sky `seconds` into the battle. */
export function skyAt(mode: SkyMode, seconds: number): SkyState {
  if (mode === "night") {
    const az = (-40 * Math.PI) / 180;
    const el = (38 * Math.PI) / 180;
    const dir: Triple = [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)];
    const color: Triple = [0.5, 0.6, 0.9];
    const ambient: Triple = [0.2, 0.25, 0.38];
    return {
      mode,
      dir,
      color,
      ambient,
      direct: 0.55,
      shadow: 0.24,
      night: 1,
      zenith: [0.05, 0.07, 0.15],
      horizon: [0.16, 0.2, 0.32],
      tree: [0.03, 0.04, 0.07],
      cloud: [0.2, 0.24, 0.36],
      light: lightOf(ambient, color, 0.55, 0.06),
    };
  }
  const sun: SunState = sunFor("animated", BATTLE_DAY_START + seconds * BATTLE_DAY_PACE, "field", false, null);
  // A low sun warms the horizon; a high one leaves it pale.
  const low = 1 - Math.min(1, Math.max(0, sun.dir[2]) / 0.85);
  const horizon = mix([0.82, 0.86, 0.84], [sun.color[0], sun.color[1] * 0.9, sun.color[2] * 0.78], 0.25 + low * 0.5);
  return {
    mode,
    dir: sun.dir,
    color: sun.color,
    ambient: sun.ambient,
    direct: sun.direct,
    shadow: sun.shadow,
    night: 0,
    zenith: [0.5, 0.65, 0.84],
    horizon,
    tree: [0.27, 0.33, 0.3],
    cloud: mix([0.96, 0.95, 0.92], sun.color, 0.3),
    light: lightOf(sun.ambient, sun.color, sun.direct, 0),
  };
}
