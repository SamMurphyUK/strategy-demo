// How much of the diorama the Shogun board shows at a zoom. Pure.
//
// At the fitted board the picture is a clean strategic sheet: flat light, still water, no dressing,
// and the faction wash at its strongest. As the camera comes down and tips, the sun starts to
// shade, the water moves, the trees stand up, and the wash thins so the ground shows through.
//
// `closeness` is 0 at the fitted board and 1 once the camera has finished tipping (see
// boardCamera.ts). It is measured on the logarithm of the zoom, so each wheel notch moves it the
// same amount.
import { TILT_FULL } from "./boardCamera";

/** Zoom, as a multiple of the fitted view, where the board starts to dress and where it is full. */
export const DRESS_START = 1.15;
export const DRESS_FULL = TILT_FULL;

export interface ShogunDetail {
  /** 0 at the fitted board and above it, 1 on the table. */
  closeness: number;
  /** Sun shading, cast shadows, and cloud shadow. */
  relief: number;
  /** Swell and surf. */
  water: number;
  /** Trees, mountains, and buildings. They grow from the board as this rises. */
  props: number;
  /** Battle smoke and chimney smoke. Gone by the middle of the zoom range. */
  smoke: number;
  /** The miniature lens. Off until the camera is close. */
  focus: number;
}

function ramp(from: number, to: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

/** `k` is screen pixels per world unit, and `fitK` is the `k` that fits the board. */
export function shogunCloseness(k: number, fitK: number): number {
  const zoom = fitK > 0 ? k / fitK : 1;
  const t = Math.log(Math.max(zoom, 1e-6) / DRESS_START) / Math.log(DRESS_FULL / DRESS_START);
  return Math.min(1, Math.max(0, t));
}

export function shogunDetail(k: number, fitK: number): ShogunDetail {
  const c = shogunCloseness(k, fitK);
  return {
    closeness: c,
    relief: ramp(0.05, 0.45, c),
    water: ramp(0.1, 0.5, c),
    props: ramp(0.45, 0.8, c),
    smoke: ramp(0.4, 0.7, c),
    focus: ramp(0.55, 0.95, c),
  };
}
