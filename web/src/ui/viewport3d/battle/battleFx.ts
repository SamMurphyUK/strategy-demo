// The combat juice of the battle stage, as pure functions of time: recoil spring, muzzle light, hit-stop, camera thud, and the
// slow curl-noise smoke that stays on the field. No Three.js and no combat state; the stage feeds them times and reads numbers.
import { clampLuma, type Rgb } from "../skins/battleSkin";

/** Seconds in one frame at 60 Hz. */
export const FRAME = 1 / 60;

/** Pitch of a firing unit, in radians, `t` seconds after the shot: a kick back that rings down on a spring. `amount` is battleRecoilPitch. */
export function recoilPitch(t: number, amount = 1): number {
  if (t < 0) {
    return 0;
  }
  return 0.16 * amount * Math.exp(-8.5 * t) * Math.cos(26 * t);
}

/** How far a firing unit is pushed back along its barrel, in stage units. Always back, never forward. */
export function recoilKick(t: number, amount = 1): number {
  return t < 0 ? 0 : 0.09 * amount * Math.exp(-11 * t);
}

/** Brightness of a muzzle's point light, 1 at the shot to 0 at 90 ms. */
export function muzzleLight(t: number): number {
  if (t < 0 || t > 0.09) {
    return 0;
  }
  const u = t / 0.09;
  return (1 - u) * (1 - u);
}

/** The pixel burst's frame (0 to 3) at `t`, or -1 when the burst is over. Four frames of 25 ms, so it is crisp and brief. */
export function muzzleFrame(t: number): number {
  if (t < 0 || t >= 0.1) {
    return -1;
  }
  return Math.floor(t / 0.025);
}

/** A heavy hit: a destroyed unit, a hard-hitting piece, or two hit points in one blow. */
export function isHeavyHit(type: string, damage: number, destroyed: boolean): boolean {
  return destroyed || damage >= 2 || type === "tank" || type === "armor" || type === "strategic_bomber" || type === "artillery";
}

/**
 * The hit-stop: a few frames in which the stage's own clock stands still. `advance` takes the real frame time and returns the
 * time the stage should move by.
 */
export class HitStop {
  private hold = 0;

  trigger(frames: number): void {
    this.hold = Math.max(this.hold, Math.max(0, frames) * FRAME);
  }

  get holding(): boolean {
    return this.hold > 0;
  }

  advance(dt: number): number {
    if (this.hold <= 0) {
      return dt;
    }
    this.hold -= dt;
    return 0;
  }
}

/** The camera's damped thud: a downward dip that rings out in under half a second. `amount` is battleCameraThud. */
export function cameraThud(t: number, amount = 1): number {
  if (t < 0) {
    return 0;
  }
  return -0.16 * amount * Math.exp(-9 * t) * Math.cos(30 * t);
}

// --- Smoke -----------------------------------------------------------------------------------------------------------

function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Smooth value noise in 2D, 0 to 1. */
export function vnoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** The curl of the noise field: a divergence-free velocity, so smoke curls and never pools. */
export function curl(x: number, y: number, t: number): [number, number] {
  const e = 0.05;
  const n = (px: number, py: number) => vnoise(px + t * 0.07, py - t * 0.05);
  const dx = (n(x + e, y) - n(x - e, y)) / (2 * e);
  const dy = (n(x, y + e) - n(x, y - e)) / (2 * e);
  return [dy, -dx];
}

export interface SmokePuff {
  x: number;
  y: number;
  z: number;
  age: number;
  life: number;
  size: number;
  /** 0 is pale dust, 1 is dark shell smoke. */
  dark: number;
}

/** Advances a puff by `dt`: it rises, widens, and is pushed round by the curl field. A puff dies when `age >= life`. */
export function stepSmoke(p: SmokePuff, dt: number, seconds: number): void {
  const [cx, cz] = curl(p.x * 0.45, p.z * 0.45, seconds);
  p.x += cx * 0.55 * dt;
  p.z += cz * 0.55 * dt;
  p.y += (0.16 - p.age * 0.006) * dt;
  p.size += 0.09 * dt;
  p.age += dt;
}

/** Opacity of a puff over its life: it comes up fast, holds, and goes slowly. Scaled by battleSmokeStrength. */
export function smokeAlpha(p: Pick<SmokePuff, "age" | "life">, strength: number): number {
  const u = Math.min(1, Math.max(0, p.age / p.life));
  const rise = Math.min(1, u / 0.08);
  const fall = 1 - Math.pow(Math.max(0, (u - 0.5) / 0.5), 1.6);
  return 0.5 * rise * fall * Math.min(1.6, Math.max(0, strength));
}

/** The smoke's colour: dust to shell smoke, held at or under the skin's smoke ceiling (0.88). */
export function smokeColor(dark: number, ceiling: number): Rgb {
  const pale: Rgb = [0.66, 0.64, 0.58];
  const deep: Rgb = [0.3, 0.27, 0.27];
  const c: Rgb = [pale[0] + (deep[0] - pale[0]) * dark, pale[1] + (deep[1] - pale[1]) * dark, pale[2] + (deep[2] - pale[2]) * dark];
  return clampLuma(c, ceiling);
}

/** Persistent ground marks (craters and scorch) carry across rounds; the oldest give way past `max`. */
export interface GroundMark {
  x: number;
  d: number;
  radius: number;
  /** 0 is a scorch, 1 is a crater. */
  kind: 0 | 1;
  turn: number;
}

export function addGroundMark(marks: GroundMark[], mark: GroundMark, max: number): GroundMark[] {
  const next = [...marks, mark];
  return next.length > max ? next.slice(next.length - max) : next;
}
