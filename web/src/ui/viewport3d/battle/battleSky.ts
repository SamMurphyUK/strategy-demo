// The battle's sky, sun, moon and light, as a smooth function of the hour of the day and the skin's look (battleVisualConfig.ts). Pure.
//
// Four stages (night, dawn, day, dusk) each have three sky stops (horizon, middle, top). The sun's height decides how much of each stage shows,
// so the colours wash from one to the next with no snap. The light's colour follows: cream at noon, orange low, moon-blue at night. By day the
// horizon is always warm, the top always blue, never fully blue; at night the stars fade in as the sun sets and out as the dawn rises.
import { hexToRgb, type Rgb } from "../skins/battleSkin";
import type { BattleLook, SkyStops } from "../skins/battleVisualConfig";

export type SkyMode = "day" | "night";

export interface SkyState {
  hour: number;
  /** Sine of the sun's elevation: 1 at noon, 0 at sunrise and sunset, negative at night. */
  sunHeight: number;
  /** Direction toward the sun: x east, y into the scene, z up. Below the horizon at night. */
  sunDir: Rgb;
  /** Direction toward the moon: opposite the sun, in the night half. */
  moonDir: Rgb;
  /** Direction toward the brighter of the two lights, for shadows. Always above the horizon. */
  lightDir: Rgb;
  /** Weights of the four stages, summing to 1. */
  weights: { night: number; dawn: number; day: number; dusk: number };
  low: Rgb;
  mid: Rgb;
  high: Rgb;
  /** The colour of the light, and how strong the direct part is (0 to 1). */
  lightColor: Rgb;
  direct: number;
  /** Opacity of a cast shadow. Never zero: a low sun throws long ones, and the moon throws faint ones. */
  shadow: number;
  /** What lit surfaces are multiplied by. About 1 at noon, a cool dim at night. */
  light: Rgb;
  /** Star opacity, 0 by day to 1 at night, and the sun's and the moon's own strength. */
  stars: number;
  sunStrength: number;
  moonStrength: number;
}

function smooth(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function add(a: Rgb, b: Rgb, k: number): Rgb {
  return [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
}

/** The sun's height (its sine) at an hour: a simple arc, up at 6 and down at 18. */
export function sunHeightAt(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  return Math.sin(((h - 6) / 12) * Math.PI);
}

/** The weights of the four stages at an hour. They always sum to 1. */
export function stageWeights(hour: number): SkyState["weights"] {
  const h = ((hour % 24) + 24) % 24;
  const s = sunHeightAt(h);
  const night = 1 - smooth(-0.16, 0.0, s);
  const day = smooth(0.14, 0.42, s);
  const twilight = Math.max(0, 1 - night - day);
  const morning = h < 12;
  return { night, dawn: morning ? twilight : 0, day, dusk: morning ? 0 : twilight };
}

/** Star opacity at an hour: out by day, fading in through dusk, full at night, fading out through dawn. */
export function starFade(hour: number): number {
  const s = sunHeightAt(hour);
  return 1 - smooth(-0.04, 0.2, s);
}

function stopOf(look: Readonly<BattleLook>, stage: keyof BattleLook["sky"], which: keyof SkyStops): Rgb {
  return hexToRgb(look.sky[stage][which]);
}

/** The sky at an hour. */
export function skyAt(look: Readonly<BattleLook>, hour: number): SkyState {
  const h = ((hour % 24) + 24) % 24;
  const s = sunHeightAt(h);
  const w = stageWeights(h);
  const blend = (which: keyof SkyStops): Rgb => {
    let c: Rgb = [0, 0, 0];
    for (const stage of ["night", "dawn", "day", "dusk"] as const) {
      c = add(c, stopOf(look, stage, which), w[stage]);
    }
    return c;
  };
  // The sun rises in the east (x +), crosses behind the field (into the scene), and sets in the west (x -).
  const p = (h - 6) / 12;
  const norm = (v: Rgb): Rgb => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const sx = Math.cos(p * Math.PI) * 0.85;
  const sunDir = norm([sx, 0.35, s]);
  const moonDir = norm([-sx, 0.35, -s]);
  const sunStrength = smooth(-0.06, 0.22, s);
  const moonStrength = smooth(0.02, -0.18, s);
  const lowSun = 1 - smooth(0.05, 0.6, s);
  const noon = hexToRgb(look.sun.noon);
  const warm = hexToRgb(look.sun.low);
  const sunColor = mix(noon, warm, lowSun);
  const moonColor = hexToRgb(look.moon.light);
  const lightColor = mix(moonColor, sunColor, sunStrength);
  const direct = Math.min(1, 0.32 + sunStrength * 0.68 + moonStrength * 0.18);
  const ambientDay: Rgb = [0.74, 0.8, 0.88];
  const ambientNight: Rgb = [0.2, 0.25, 0.4];
  const ambient = mix(ambientNight, mix(ambientDay, [0.82, 0.7, 0.66], lowSun * 0.7), Math.min(1, sunStrength * 1.2));
  const light: Rgb = [
    Math.min(1.1, ambient[0] * 0.55 + lightColor[0] * direct * 0.5),
    Math.min(1.1, ambient[1] * 0.55 + lightColor[1] * direct * 0.5),
    Math.min(1.1, ambient[2] * 0.55 + lightColor[2] * direct * 0.5),
  ];
  // Shadows: a low sun throws long dark ones, the moon faint ones. The cast direction is the brighter light's, lifted so it is never flat.
  const lightDir: Rgb = sunStrength >= moonStrength ? [sunDir[0], sunDir[1], Math.max(0.22, sunDir[2])] : [moonDir[0], moonDir[1], Math.max(0.3, moonDir[2])];
  const shadow = 0.18 + 0.2 * sunStrength;
  return {
    hour: h,
    sunHeight: s,
    sunDir,
    moonDir,
    lightDir: norm(lightDir),
    weights: w,
    low: blend("low"),
    mid: blend("mid"),
    high: blend("high"),
    lightColor,
    direct,
    shadow,
    light,
    stars: starFade(h),
    sunStrength,
    moonStrength,
  };
}

/** The sky mode a theatre asks for. Only the day cycle is live; `?sky=night` holds the clock at midnight. */
export function skyModeFor(_theater: string | undefined, param: string | null): SkyMode {
  return param === "night" ? "night" : "day";
}

/** The hour the battle's clock gives, from the look's start hour and, if it is running, the seconds since the battle began. */
export function hourAt(look: Readonly<BattleLook>, seconds: number, mode: SkyMode): number {
  if (mode === "night") {
    return 0;
  }
  return look.time.auto ? look.time.hour + (seconds / 60) * look.time.speed : look.time.hour;
}
