/** Session switches for the Z panel. They are not saved. */

export interface DrawFlags {
  anims: boolean;
  shore: boolean;
  figures: boolean;
  arrows: boolean;
}

export interface DrawSample {
  fps: number;
  frameMs: number;
  paintMs: number;
  shoreMs: number;
  figureMs: number;
  arrowMs: number;
  idleMs: number;
  lod: number;
  zoom: number;
  px: string;
}

const EMPTY: DrawSample = {
  fps: 0,
  frameMs: 0,
  paintMs: 0,
  shoreMs: 0,
  figureMs: 0,
  arrowMs: 0,
  idleMs: 0,
  lod: 0,
  zoom: 1,
  px: "",
};

let flags: DrawFlags = { anims: true, shore: true, figures: true, arrows: true };
let sample: DrawSample = EMPTY;
let paint: Pick<DrawSample, "paintMs" | "shoreMs" | "figureMs" | "arrowMs"> = {
  paintMs: 0,
  shoreMs: 0,
  figureMs: 0,
  arrowMs: 0,
};
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

export function notePaint(next: Pick<DrawSample, "paintMs" | "shoreMs" | "figureMs" | "arrowMs">): void {
  paint = next;
}

export function noteIdle(ms: number): void {
  idleMs = ms;
}

/** The Z panel reads this. It does not belong in the map paint's dependency list. */
export function publishDrawSample(next: Pick<DrawSample, "fps" | "frameMs" | "lod" | "zoom" | "px">): void {
  sample = { ...next, ...paint, idleMs };
  sampleListeners.forEach((listener) => listener());
}
