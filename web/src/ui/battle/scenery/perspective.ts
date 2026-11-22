// The battle stage as a low, one-point perspective. Pure arithmetic: nothing here touches a canvas.
//
// The board is 1280 wide. The horizon sits at y 114 and the field runs down to y 530. Units
// stand on horizontal lanes and never leave them. What changes with depth is the ground:
//   - lines that run away from the viewer (trenches, parapets, wire, field lines, side streets)
//     lean in along rays, a little less steeply than a true one-point vanishing point on the horizon
//     (see RAY_FLOOR), so a trench stays a strip at the far end;
//   - rows that run across the field are squeezed together near the horizon;
//   - craters and puddles are ellipses, flatter than they are wide;
//   - a unit is a little smaller on the back lane than on the front lane.

/** The horizon, and the middle of the board. Rows are squeezed toward this line. */
export const VANISH = { x: 640, y: 114 } as const;
/**
 * How much of its lean a receding line has left at the horizon. 0 would send every line to a
 * point on the horizon. At 0.2 the lines lean 20% less steeply than that, and the point they
 * would meet at sits above the horizon, at y 10, where nothing is drawn.
 */
export const RAY_FLOOR = 0.2;
/** A trench is this wide on the bottom edge of the field, and this wide at the horizon. */
export const TRACK_WIDTH_FRONT = 12;
export const TRACK_WIDTH_BACK = 10;
/** Bottom of the field. Rays are anchored here, so a line keeps its old x at the bottom edge. */
export const FIELD_BOTTOM = 530;
/** Where the land meets the sea strip. The front lane stands here. */
export const SHORE_Y = 525;

/** How hard rows are squeezed toward the horizon. 1 is a flat plan. */
export const FORESHORTEN = 1.55;

/** A unit on the back lane, and on the front lane, relative to its own size. */
export const LANE_SCALE_BACK = 0.85;
export const LANE_SCALE_FRONT = 1.05;

/** A crater is this much shorter than it is wide. */
export const CRATER_RATIO = 0.42;
/** A ground decal is this much of its flat size at the horizon, and this much at the bottom of the field. */
export const DECAL_SCALE_BACK = 0.8;
export const DECAL_SCALE_FRONT = 1.2;

/** Contact shadow under a unit. */
export const SHADOW_RGB = "26, 22, 20";
export const SHADOW_ALPHA = 0.32;

/** Haze over the far ground: how deep it reaches, and how strong it is on the horizon line. */
export const HAZE_DEPTH = 110;
export const HAZE_ALPHA = 0.36;
/** Haze above the horizon, over the skyline. Shorter and lighter. */
export const SKY_HAZE_DEPTH = 26;
export const SKY_HAZE_ALPHA = 0.3;

const SPAN = FIELD_BOTTOM - VANISH.y;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** 0 on the horizon, 1 at the bottom of the field. */
export function fieldDepth(y: number): number {
  return clamp01((y - VANISH.y) / SPAN);
}

/**
 * Where a row of the flat plan lands on the board. The horizon and the bottom edge stay put.
 * Rows near the horizon are squeezed together and rows near the viewer are spread apart.
 */
export function squashY(y: number): number {
  if (y <= VANISH.y || y >= FIELD_BOTTOM) {
    return y;
  }
  return VANISH.y + SPAN * fieldDepth(y) ** FORESHORTEN;
}

/** The row of the flat plan that lands on a board row. The inverse of squashY. */
export function unsquashY(y: number): number {
  if (y <= VANISH.y || y >= FIELD_BOTTOM) {
    return y;
  }
  return VANISH.y + SPAN * fieldDepth(y) ** (1 / FORESHORTEN);
}

/** How much taller a thing of one plan pixel is at this plan row. Never quite zero. */
export function squashSlope(y: number): number {
  if (y <= VANISH.y || y >= FIELD_BOTTOM) {
    return 1;
  }
  return Math.max(0.08, FORESHORTEN * fieldDepth(y) ** (FORESHORTEN - 1));
}

/** How much of its bottom-edge offset from the middle a receding line keeps on this board row. */
export function rayScale(y: number): number {
  return RAY_FLOOR + (1 - RAY_FLOOR) * Math.max(0, (y - VANISH.y) / SPAN);
}

/** Width in pixels of a trench on this board row: 10 at the horizon, 12 on the bottom edge. */
export function trackWidth(y: number): number {
  return TRACK_WIDTH_BACK + (TRACK_WIDTH_FRONT - TRACK_WIDTH_BACK) * fieldDepth(y);
}

/** The x a receding line has on this board row, when it stands at `x` on the bottom edge. */
export function rayX(x: number, y: number): number {
  return VANISH.x + (x - VANISH.x) * rayScale(y);
}

/** How big a unit stands on this lane: 0.85 on the horizon side, 1.05 on the shore. */
export function laneScale(y: number): number {
  const t = clamp01((y - VANISH.y) / (SHORE_Y - VANISH.y));
  return LANE_SCALE_BACK + (LANE_SCALE_FRONT - LANE_SCALE_BACK) * t;
}

/** Every battle unit, on top of the lane size. */
export const BATTLE_UNIT_BOOST = 1.2;

/** Parked size on this row: a fifth larger than the old picture, and a little larger toward the bottom. */
export function battleUnitScale(y: number): number {
  return BATTLE_UNIT_BOOST * laneScale(y);
}

/** How big a crater or puddle of a given flat size is on this board row. */
export function decalScale(y: number): number {
  return DECAL_SCALE_BACK + (DECAL_SCALE_FRONT - DECAL_SCALE_BACK) * fieldDepth(y);
}

/** The ellipse a round decal makes at this board row. */
export function decalRadii(radius: number, y: number): { rx: number; ry: number } {
  const rx = Math.max(1, radius * decalScale(y));
  return { rx, ry: Math.max(1, rx * CRATER_RATIO) };
}

export interface HazeBand {
  y: number;
  height: number;
  alpha: number;
}

/**
 * Bands of haze, strongest on the line they start from. `from` is the horizon for ground haze.
 * For sky haze pass `direction` -1: the bands climb above the line and are strongest at it.
 */
export function hazeBands(depth: number, peak: number, step = 6, direction: 1 | -1 = 1): HazeBand[] {
  const count = Math.max(1, Math.ceil(depth / step));
  const bands: HazeBand[] = [];
  for (let i = 0; i < count; i += 1) {
    const fade = 1 - i / count;
    const alpha = Math.round(peak * fade * fade * 1000) / 1000;
    bands.push({
      y: direction === 1 ? VANISH.y + i * step : VANISH.y - (i + 1) * step,
      height: step,
      alpha,
    });
  }
  return bands;
}
