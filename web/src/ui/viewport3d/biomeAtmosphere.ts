// The weather of the ground the camera is over. Pure, except the flurries' pool (flurries.ts).
//
// The grade is colour only: no fog, no exposure, no light moved, so nothing flickers and the sun stays where it is. The camera's
// biome is read over a wide ring round its target and damped over a few seconds, so crossing a border never snaps the colour.
import type { Vec2 } from "../map/geometry";
import type { Biome } from "./geography";

export interface BiomeWeather {
  /** 0 to 1: how much of the ring is desert. */
  desert: number;
  /** 0 to 1: how much of it is snow, tundra or ice. */
  snow: number;
}

export const CALM: Readonly<BiomeWeather> = Object.freeze({ desert: 0, snow: 0 });

/** The ring's radius in world units, wide enough that a single territory never decides it. */
export const WEATHER_RADIUS = 45;

/** The share of a ring of points (and its middle) that is desert, and that is snow. */
export function sampleWeather(biomeAt: (p: Vec2) => Biome, centre: Vec2, radius = WEATHER_RADIUS, points = 16): BiomeWeather {
  let desert = 0;
  let snow = 0;
  let total = 0;
  const count = (p: Vec2, weight: number) => {
    const biome = biomeAt(p);
    if (biome === "desert") {
      desert += weight;
    } else if (biome === "ice" || biome === "tundra") {
      snow += weight;
    }
    total += weight;
  };
  count(centre, 2);
  for (let ring = 1; ring <= 2; ring++) {
    for (let i = 0; i < points; i++) {
      const angle = (i / points) * Math.PI * 2 + ring * 0.4;
      count({ x: centre.x + Math.cos(angle) * radius * (ring / 2), y: centre.y + Math.sin(angle) * radius * (ring / 2) * 0.8 }, 1);
    }
  }
  return { desert: desert / total, snow: snow / total };
}

/** One step of an exponential approach: `tau` seconds to cover about two thirds of the way. */
export function damp(current: number, target: number, dt: number, tau = 3): number {
  const step = 1 - Math.exp(-Math.max(0, dt) / Math.max(1e-3, tau));
  return current + (target - current) * step;
}

/** The weather after `dt` seconds, moving toward `target`. */
export function dampWeather(current: BiomeWeather, target: BiomeWeather, dt: number, tau = 3): BiomeWeather {
  return { desert: damp(current.desert, target.desert, dt, tau), snow: damp(current.snow, target.snow, dt, tau) };
}
