/**
 * March and firing signals from the battle drawer.
 * drawInfantry, drawTank, and the skeleton poser all read these numbers.
 */

export const MARCH_STEP_RATE = 11;
export const MARCH_BOB_PX = 2.5;
export const LEG_SWING_PX = 3.5;
/** Rifle slope while marching. drawInfantry rotates by this while isMarching. */
export const MARCH_RIFLE_RAD = -0.4;
export const TANK_VIBE_RATE = 18;
export const TANK_VIBE_PX = 0.6;
export const TRACK_SCROLL_RATE = 24;
export const TRACK_SCROLL_SPAN = 6;
/** Ready-station turret swivel. drawTank multiplies the ready sine by this. */
export const TURRET_SWIVEL_RAD = 0.14;
export const RECOIL_DECAY = 2.4;
export const INFANTRY_KICK_PX = 3.5;
export const TANK_KICK_PX = 5.2;
export const BARREL_RECOIL_PX = 4.2;
/** drawProceduralUnit blooms the muzzle only above this recoil. */
export const MUZZLE_BLOOM_RECOIL = 0.25;

export function stepSin(time: number, phase = 0): number {
  return Math.sin(time * MARCH_STEP_RATE + phase);
}

export function marchCycle(time: number, phase = 0): { bob: number; legSwing: number } {
  const step = stepSin(time, phase);
  return {
    bob: Math.abs(step) * MARCH_BOB_PX,
    legSwing: step * LEG_SWING_PX,
  };
}

export function tankVibe(time: number, phase = 0): number {
  return Math.sin(time * TANK_VIBE_RATE + phase) * TANK_VIBE_PX;
}

export function trackScroll(time: number): number {
  return Math.floor((time * TRACK_SCROLL_RATE) % TRACK_SCROLL_SPAN);
}

/** Unwrapped tread crawl. The battle marks use trackScroll; the skeleton scrolls by this. */
export function trackCrawl(time: number): number {
  return Math.floor(time * TRACK_SCROLL_RATE);
}

export function turretSwivelRad(readyAnimProgress: number): number {
  return Math.sin(readyAnimProgress * Math.PI * 2) * TURRET_SWIVEL_RAD;
}

export function decayRecoil(recoil: number, deltaTime: number): number {
  return recoil > 0 ? Math.max(0, recoil - deltaTime * RECOIL_DECAY) : 0;
}

export function infantryKick(recoil: number): number {
  return recoil > 0 ? -recoil * INFANTRY_KICK_PX : 0;
}

export function tankKick(recoil: number): { x: number; y: number } {
  if (recoil <= 0) {
    return { x: 0, y: 0 };
  }
  return {
    x: -recoil * TANK_KICK_PX + Math.sin(recoil * Math.PI * 7) * (recoil * 2.2),
    y: Math.cos(recoil * Math.PI * 5) * (recoil * 1.4),
  };
}

export function barrelRecoilPx(recoil: number): number {
  return recoil > 0 ? recoil * BARREL_RECOIL_PX : 0;
}
