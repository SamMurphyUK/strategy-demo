/**
 * Muzzle flash and exhaust for a `_QUICK` clip, in CSS pixels relative to the feet.
 * Picture marks come from the clip. The pixels are muzzleFlashPixels and exhaustPuff.
 * Guns point toward +x; the caller mirrors with scale(face, 1).
 */

import { exhaustPuff, muzzleFlashPixels } from "./frameClips";

export interface QuickFxPoint {
  x: number;
  y: number;
}

export interface QuickFxMarks {
  smoke: QuickFxPoint | null;
  muzzle: QuickFxPoint | null;
  /** Fire-clip indexes that draw the muzzle flash. Empty draws none. */
  flashFrames: readonly number[];
  puffFrames: { idle: readonly number[]; fire: readonly number[] };
}

export const QUIET_QUICK_FX: QuickFxMarks = {
  smoke: null,
  muzzle: null,
  flashFrames: [],
  puffFrames: { idle: [], fire: [] },
};

/** Same gate as the procedural battle bloom (`animRecoil > 0.25`). */
export const QUICK_BLOOM_RECOIL = 0.25;

/** A procedural tank about 48px wide used an 18px bloom and a 4px core. */
const BLOOM_FIT_PX = 48;
const BLOOM_RADIUS_PX = 18;
const BLOOM_CORE_PX = 4;

export type QuickFxPose = "idle" | "walk" | "fire";
export type QuickFxKind = "muzzle" | "smoke";

export interface QuickFxRect {
  /** CSS pixels relative to the feet, before face mirroring. */
  x: number;
  y: number;
  w: number;
  h: number;
  hex: string;
  kind: QuickFxKind;
}

export interface QuickFxOptions {
  damaged?: boolean;
  rootX?: number;
  rootY?: number;
}

export interface QuickMuzzleBloom {
  radius: number;
  core: number;
}

function listedPhase(marks: QuickFxMarks, pose: QuickFxPose, frame: number): number | null {
  const list = pose === "idle" ? marks.puffFrames.idle : pose === "fire" ? marks.puffFrames.fire : [];
  const phase = list.indexOf(frame);
  return phase < 0 ? null : phase;
}

/** Puff phases to stamp. Walk has none unless the hull is hurt. */
function puffPhases(marks: QuickFxMarks, pose: QuickFxPose, frame: number, options: QuickFxOptions): number[] {
  if (!marks.smoke) {
    return [];
  }
  const phases = new Set<number>();
  const listed = listedPhase(marks, pose, frame);
  if (listed != null) {
    phases.add(listed);
  }
  if (options.damaged) {
    // The whole wisp: a hurt hull smokes on every picture, including walk.
    phases.add(0);
    phases.add(1);
    phases.add(2);
  }
  return [...phases];
}

/** Picture pixel relative to the feet, scaled with the sprite. */
export function quickAnchor(
  point: QuickFxPoint,
  feet: QuickFxPoint,
  pixelScale: number,
  rootX = 0,
  rootY = 0,
): QuickFxPoint {
  return {
    x: (point.x - feet.x + rootX) * pixelScale,
    y: (point.y - feet.y + rootY) * pixelScale,
  };
}

/**
 * Flash and exhaust rectangles. A wisp offset uses at least one CSS pixel so the rise
 * still reads when the battle board draws the art smaller than its own pixels.
 */
export function quickFxRects(
  marks: QuickFxMarks,
  feet: QuickFxPoint,
  pose: QuickFxPose,
  frame: number,
  pixelScale: number,
  options: QuickFxOptions = {},
): QuickFxRect[] {
  if (!(pixelScale > 0)) {
    return [];
  }
  const drift = Math.max(pixelScale, 1);
  // Two CSS pixels when the sprite is small, so a three-pixel wisp is still a mark on the board.
  const cell = Math.max(pixelScale, 2);
  const rootX = options.rootX ?? 0;
  const rootY = options.rootY ?? 0;
  const rects: QuickFxRect[] = [];
  const place = (anchor: QuickFxPoint, x: number, y: number, hex: string, kind: QuickFxKind) => {
    const origin = quickAnchor(anchor, feet, pixelScale, rootX, rootY);
    rects.push({
      x: origin.x + (x - anchor.x) * drift,
      y: origin.y + (y - anchor.y) * drift,
      w: cell,
      h: cell,
      hex,
      kind,
    });
  };

  if (marks.smoke) {
    for (const phase of puffPhases(marks, pose, frame, options)) {
      for (const [dx, dy, hex] of exhaustPuff(phase)) {
        place(marks.smoke, marks.smoke.x + dx, marks.smoke.y + dy, hex, "smoke");
      }
    }
  }
  if (pose === "fire" && marks.muzzle && marks.flashFrames.includes(frame)) {
    for (const pixel of muzzleFlashPixels(marks.muzzle)) {
      place(marks.muzzle, pixel.x, pixel.y, pixel.hex, "muzzle");
    }
  }
  return rects;
}

/**
 * Radial bloom in CSS pixels. `fit` is 1 when the sprite is about 48px wide,
 * which is the procedural tank the old 18px bloom was drawn on.
 */
export function quickMuzzleBloom(artWidth: number, pixelScale: number, recoil: number): QuickMuzzleBloom | null {
  if (!(recoil > QUICK_BLOOM_RECOIL) || !(artWidth > 0) || !(pixelScale > 0)) {
    return null;
  }
  const fit = (artWidth * pixelScale) / BLOOM_FIT_PX;
  return {
    radius: BLOOM_RADIUS_PX * recoil * fit,
    core: BLOOM_CORE_PX * recoil * fit,
  };
}
