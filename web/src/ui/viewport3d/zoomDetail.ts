// How much of the diorama shows at a zoom. Pure.
//
// High above the board the picture is a clean strategic sheet: flat territories, sharp borders,
// counters. As the camera comes down and tips, the table dressing rises out of it: trees and
// mountains grow, the sun starts to shade, the water moves, and close in the lens narrows to a
// miniature's shallow focus. Every number here is 0 at altitude and 1 on the table, except
// `flatten`, which runs the other way.
//
// The measure is `closeness`: how far the zoom has travelled from the fitted board to the closest
// zoom the player can reach, on a log scale. A wide monitor fits the board at a larger scale than a
// laptop does, and this keeps the fitted board clean and the closest view fully dressed on both.

export interface BoardDetail {
  /** 0 at the fitted board (and anywhere above it), 1 at the closest zoom. */
  closeness: number;
  /** Strategic clean-up: a smoother sheet. 1 at altitude. */
  flatten: number;
  /** Trees, mountains, and buildings. They grow from the board as this rises. */
  props: number;
  /** Sun shading, cast shadows, and cloud shadow. */
  relief: number;
  /** Swell and surf. */
  water: number;
  /** Battle smoke and chimney smoke. */
  smoke: number;
  /** Darkened corners. */
  vignette: number;
  /** Shallow focus above and below the middle of the screen. */
  focus: number;
}

function ramp(from: number, to: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

/** 0 at `fitK` or below, 1 at `maxK` or above. */
export function closeness(k: number, fitK: number, maxK: number): number {
  const fit = fitK > 0 ? fitK : 1;
  const span = Math.log(Math.max(maxK, fit * 1.5) / fit);
  return Math.min(1, Math.max(0, Math.log(Math.max(k, 1e-6) / fit) / span));
}

/** `k` is screen pixels per world unit; `fitK` and `maxK` are the fitted and the closest zoom. */
export function boardDetail(k: number, fitK: number, maxK: number): BoardDetail {
  const c = closeness(k, fitK, maxK);
  return {
    closeness: c,
    flatten: 1 - ramp(0.02, 0.3, c),
    props: ramp(0.1, 0.46, c),
    relief: ramp(0.06, 0.4, c),
    water: ramp(0.12, 0.5, c),
    smoke: ramp(0.08, 0.36, c),
    vignette: ramp(0.4, 0.85, c),
    focus: ramp(0.46, 0.9, c),
  };
}

/** True when something on the board moves on its own at this zoom, so frames must keep coming. */
export function boardAnimates(detail: BoardDetail): boolean {
  return detail.water > 0 || detail.relief > 0 || detail.smoke > 0;
}
