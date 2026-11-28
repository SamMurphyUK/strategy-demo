// Where each standing figure is on the screen, for picking. Pure data, no React, no canvas.
//
// A figure on the diorama is an upright picture: a billboard that stays standing however far the camera tilts, so its place on
// the screen is its own box, not the ring of the base it stands on. The painter records each figure's box as it draws it, and the
// pointer is tested against those boxes, front-most first, so a crowded stack never takes the tooltip or the click from the
// figure beside it and the wide base under it never answers for a figure at all.
import type { SpriteBox } from "./seaOverlap";

export interface SpriteHit {
  regionId: string;
  copyDx: number;
  stackKey: string;
  /** The picture's box in screen px, trimmed to a tight hull (see `hull`). */
  box: SpriteBox;
}

let live: SpriteHit[] = [];
let building: SpriteHit[] = [];

/** The share of a picture's box, on each side, that is margin around the figure itself. */
const MARGIN_X = 0.17;
const MARGIN_TOP = 0.04;
const MARGIN_BOTTOM = 0.08;

/** A tight hull inside a picture's box: the figure's own width and height, not its transparent corners. */
export function hull(box: SpriteBox): SpriteBox {
  return {
    left: box.left + box.width * MARGIN_X,
    top: box.top + box.height * MARGIN_TOP,
    width: box.width * (1 - 2 * MARGIN_X),
    height: box.height * (1 - MARGIN_TOP - MARGIN_BOTTOM),
  };
}

/** A paint pass begins: the boxes of the last one are kept for picking until this one is done. */
export function beginSpriteBoxes(): void {
  building = [];
}

/** `vectorKey` is `region|copyDx|stackKey`, as the painter names a stack. */
export function recordSpriteBox(vectorKey: string, box: SpriteBox): void {
  const [regionId, copy, ...rest] = vectorKey.split("|");
  const copyDx = Number(copy);
  if (!regionId || rest.length === 0 || !Number.isFinite(copyDx)) {
    return;
  }
  building.push({ regionId, copyDx, stackKey: rest.join("|"), box: hull(box) });
}

export function commitSpriteBoxes(): void {
  live = building;
}

export function getSpriteBoxes(): readonly SpriteHit[] {
  return live;
}

/** The figure under a screen point: of all that cover it, the one standing nearest the camera (its feet lowest on the screen). */
export function spriteAt(point: { x: number; y: number }, boxes: readonly SpriteHit[] = live): SpriteHit | null {
  let best: SpriteHit | null = null;
  let bestFeet = -Infinity;
  for (const item of boxes) {
    const { left, top, width, height } = item.box;
    if (point.x < left || point.x > left + width || point.y < top || point.y > top + height) {
      continue;
    }
    const feet = top + height;
    if (feet > bestFeet) {
      best = item;
      bestFeet = feet;
    }
  }
  return best;
}
