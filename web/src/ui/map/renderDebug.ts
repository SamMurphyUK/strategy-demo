/** Session switches for the Z panel. They are not saved. */

export interface DrawFlags {
  anims: boolean;
  cliffs: boolean;
  /** The old cliff: the land silhouette filled once for every pixel of the drop. Slow while zooming. */
  stamp: boolean;
  shore: boolean;
  figures: boolean;
  /** Zoomed figures are copies of one picture for each kind. Off, every figure is its own SVG node. */
  sheet: boolean;
  arrows: boolean;
}

export interface DrawSample {
  fps: number;
  /** The slowest frame in the last window. A zoom shows here before it shows in the average. */
  worstMs: number;
  frameMs: number;
  paintMs: number;
  /** Base map, cliffs, and the copy into the held picture. The canvas settles its queued drawing on that copy. */
  landMs: number;
  shoreMs: number;
  figureMs: number;
  arrowMs: number;
  idleMs: number;
  lod: number;
  zoom: number;
  px: string;
}

export type PaintTimes = Pick<DrawSample, "paintMs" | "landMs" | "shoreMs" | "figureMs" | "arrowMs">;

const NO_PAINT: PaintTimes = { paintMs: 0, landMs: 0, shoreMs: 0, figureMs: 0, arrowMs: 0 };

const EMPTY: DrawSample = {
  fps: 0,
  worstMs: 0,
  frameMs: 0,
  ...NO_PAINT,
  idleMs: 0,
  lod: 0,
  zoom: 1,
  px: "",
};

let flags: DrawFlags = { anims: true, cliffs: true, stamp: false, shore: true, figures: true, sheet: true, arrows: true };
let sample: DrawSample = EMPTY;
/** The slowest paint since the panel last read. One slow frame in a zoom is the number that matters. */
let paint: PaintTimes = NO_PAINT;
let idleMs = 0;

const flagListeners = new Set<() => void>();
const sampleListeners = new Set<() => void>();

export function getDrawFlags(): DrawFlags {
  return flags;
}

export function subscribeDrawFlags(listener: () => void): () => void {
  flagListeners.add(listener);
  return () => flagListeners.delete(listener);
}

export function setDrawFlag(key: keyof DrawFlags, on: boolean): void {
  if (flags[key] === on) {
    return;
  }
  flags = { ...flags, [key]: on };
  flagListeners.forEach((listener) => listener());
}

export function getDrawSample(): DrawSample {
  return sample;
}

export function subscribeDrawSample(listener: () => void): () => void {
  sampleListeners.add(listener);
  return () => sampleListeners.delete(listener);
}

export function notePaint(next: PaintTimes): void {
  if (next.paintMs >= paint.paintMs) {
    paint = next;
  }
}

export function noteIdle(ms: number): void {
  idleMs = Math.max(idleMs, ms);
}

/** The Z panel reads this. It does not belong in the map paint's dependency list. */
export function publishDrawSample(next: Pick<DrawSample, "fps" | "worstMs" | "frameMs" | "lod" | "zoom" | "px">): void {
  // A window with paints shows its slowest one. A still camera keeps the last paint on the panel.
  sample = { ...sample, ...next, ...(paint.paintMs > 0 ? paint : null), idleMs };
  paint = NO_PAINT;
  idleMs = 0;
  sampleListeners.forEach((listener) => listener());
}
