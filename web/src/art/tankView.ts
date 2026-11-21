import { MILITARY } from "../ui/theme/militaryPalette";
import { frameRgba } from "./frameClips";
import type { PartCategory } from "./paperDoll";
import { assembleRig, resolveFrame, wornPart, type PartRig } from "./partRig";
import type { VehicleMode } from "./vehicleMotion";

const charcoal = Number.parseInt(MILITARY.charcoal.slice(1), 16);
const CHAR_R = (charcoal >> 16) & 255;
const CHAR_G = (charcoal >> 8) & 255;
const CHAR_B = charcoal & 255;

export interface TankViewInput {
  rigId: string;
  artWidth: number;
  artHeight: number;
  idle: OffscreenCanvas[];
  walk: OffscreenCanvas[];
  fire: OffscreenCanvas[];
  /** Traced frames get blob pictures so the SVG ladder can move each part. A pixel tank leaves this empty. */
  vectorBase: string | null;
}

export interface TankLayerSource {
  role: "tracks" | "torso" | "head" | "weapon";
  href: string;
  resolution: number;
}

interface TankRasterUrls {
  tracksIdle: string;
  tracksWalk: string[];
  torso: string;
  head: string;
  weapon: string;
}

export interface TankView {
  artWidth: number;
  artHeight: number;
  resolution: number;
  raster: {
    tracksIdle: OffscreenCanvas;
    tracksWalk: OffscreenCanvas[];
    torso: OffscreenCanvas;
    head: OffscreenCanvas;
    weapon: OffscreenCanvas;
    /** Pictures for the SVG ladder. Null on a pixel tank, which stays on the canvas. */
    urls: TankRasterUrls | null;
  };
}

const rigs = new Map<string, Promise<PartRig | null>>();

async function readJson(url: string): Promise<unknown | null> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  }
}

function rigFor(unitId: string): Promise<PartRig | null> {
  const hit = rigs.get(unitId);
  if (hit) {
    return hit;
  }
  const pending = fetchRig(unitId);
  rigs.set(unitId, pending);
  return pending;
}

async function fetchRig(unitId: string): Promise<PartRig | null> {
  if (!/^[a-z0-9_]+$/.test(unitId)) {
    return null;
  }
  const base = `/assets/units/rigs/${unitId}`;
  const json = await readJson(`${base}/rig.json`);
  if (!json || typeof json !== "object") {
    return null;
  }
  const listed = (json as { parts?: { id?: unknown }[] }).parts;
  if (!Array.isArray(listed)) {
    return null;
  }
  const parts: unknown[] = [];
  for (const part of listed) {
    if (!part || typeof part !== "object" || typeof part.id !== "string") {
      return null;
    }
    const file = await readJson(`${base}/part_${part.id}.json`);
    if (!file) {
      return null;
    }
    parts.push(file);
  }
  try {
    return assembleRig(json, parts);
  } catch {
    return null;
  }
}

function drawingMask(rig: PartRig, layer: PartCategory, pose: number): Uint8Array {
  const drawings = wornPart(rig, layer).drawings;
  const cells = drawings[pose] ?? drawings[0] ?? [];
  const mask = new Uint8Array(rig.width * rig.height);
  const count = Math.min(mask.length, cells.length);
  for (let i = 0; i < count; i += 1) {
    if ((cells[i] ?? 0) !== 0) {
      mask[i] = 1;
    }
  }
  return mask;
}

function combine(a: Uint8Array, b: Uint8Array, op: "or" | "and-not"): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i += 1) {
    const on = op === "or" ? a[i] || b[i] : a[i] && !b[i];
    out[i] = on ? 1 : 0;
  }
  return out;
}

function frameAt<T>(frames: readonly T[], index: number): T | null {
  if (frames.length < 1) {
    return null;
  }
  const wrapped = ((index % frames.length) + frames.length) % frames.length;
  return frames[wrapped] ?? null;
}

function pixelsOf(canvas: OffscreenCanvas, cache: Map<OffscreenCanvas, ImageData>): ImageData {
  const hit = cache.get(canvas);
  if (hit) {
    return hit;
  }
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("The picture could not be read.");
  }
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  cache.set(canvas, image);
  return image;
}

function blank(width: number, height: number): { canvas: OffscreenCanvas; image: ImageData } {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("The picture could not be opened.");
  }
  const image = context.createImageData(width, height);
  return { canvas, image };
}

function finish(layer: { canvas: OffscreenCanvas; image: ImageData }): OffscreenCanvas {
  const context = layer.canvas.getContext("2d");
  context?.putImageData(layer.image, 0, 0);
  return layer.canvas;
}

function paintMask(
  dest: Uint8ClampedArray,
  destWidth: number,
  artWidth: number,
  artHeight: number,
  resolution: number,
  mask: Uint8Array,
  paint: (offset: number) => void,
  onlyEmpty: boolean,
): void {
  for (let y = 0; y < artHeight; y += 1) {
    for (let x = 0; x < artWidth; x += 1) {
      if (!mask[y * artWidth + x]) {
        continue;
      }
      for (let oy = 0; oy < resolution; oy += 1) {
        const row = (y * resolution + oy) * destWidth;
        for (let ox = 0; ox < resolution; ox += 1) {
          const offset = (row + x * resolution + ox) * 4;
          if (onlyEmpty && dest[offset + 3] !== 0) {
            continue;
          }
          paint(offset);
        }
      }
    }
  }
}

function copyMasked(src: ImageData, mask: Uint8Array, artWidth: number, artHeight: number, resolution: number, dest: Uint8ClampedArray): void {
  paintMask(dest, src.width, artWidth, artHeight, resolution, mask, (offset) => {
    if ((src.data[offset + 3] ?? 0) === 0) {
      return;
    }
    dest[offset] = src.data[offset] ?? 0;
    dest[offset + 1] = src.data[offset + 1] ?? 0;
    dest[offset + 2] = src.data[offset + 2] ?? 0;
    dest[offset + 3] = src.data[offset + 3] ?? 0;
  }, false);
}

function paintCharcoal(src: ImageData, mask: Uint8Array, artWidth: number, artHeight: number, resolution: number, dest: Uint8ClampedArray): void {
  paintMask(dest, src.width, artWidth, artHeight, resolution, mask, (offset) => {
    // Only the solid body. A soft edge would blend with the skirt and leave a dark line at rest.
    if ((src.data[offset + 3] ?? 0) < 250) {
      return;
    }
    dest[offset] = CHAR_R;
    dest[offset + 1] = CHAR_G;
    dest[offset + 2] = CHAR_B;
    dest[offset + 3] = 255;
  }, true);
}

function layerFrom(
  src: ImageData,
  mask: Uint8Array,
  skirt: Uint8Array | null,
  artWidth: number,
  artHeight: number,
  resolution: number,
): OffscreenCanvas {
  const layer = blank(src.width, src.height);
  copyMasked(src, mask, artWidth, artHeight, resolution, layer.image.data);
  if (skirt) {
    paintCharcoal(src, skirt, artWidth, artHeight, resolution, layer.image.data);
  }
  return finish(layer);
}

async function pngUrl(canvas: OffscreenCanvas): Promise<string> {
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return URL.createObjectURL(blob);
}

export function tankRasterLayers(
  view: TankView,
  mode: VehicleMode,
  frame: number,
): { tracks: OffscreenCanvas; torso: OffscreenCanvas; head: OffscreenCanvas; weapon: OffscreenCanvas } {
  const tracks = mode === "moving" ? frameAt(view.raster.tracksWalk, frame) ?? view.raster.tracksIdle : view.raster.tracksIdle;
  return { tracks, torso: view.raster.torso, head: view.raster.head, weapon: view.raster.weapon };
}

/** Split pictures for the SVG ladder. Null when this unit stays on the canvas. */
export function tankLayerSources(view: TankView, mode: VehicleMode, frame: number): TankLayerSource[] | null {
  const urls = view.raster.urls;
  if (!urls) {
    return null;
  }
  const tracks = mode === "moving" ? frameAt(urls.tracksWalk, frame) ?? urls.tracksIdle : urls.tracksIdle;
  return [
    { role: "tracks", href: tracks, resolution: view.resolution },
    { role: "torso", href: urls.torso, resolution: view.resolution },
    { role: "head", href: urls.head, resolution: view.resolution },
    { role: "weapon", href: urls.weapon, resolution: view.resolution },
  ];
}

export async function buildTankView(input: TankViewInput): Promise<TankView | null> {
  try {
    return await assembleView(input);
  } catch {
    return null;
  }
}

export interface PaintedRig {
  width: number;
  height: number;
  feet: { x: number; y: number };
  idle: OffscreenCanvas;
  walk: OffscreenCanvas[];
  fire: OffscreenCanvas[];
  view: TankView;
}

/** Paint a rig's own drawings into separated layers. No frame files are written. */
export async function buildPaintedRig(unitId: string, lut: readonly string[], withPictures: boolean): Promise<PaintedRig | null> {
  try {
    return await paintRig(unitId, lut, withPictures);
  } catch {
    return null;
  }
}

/**
 * Split one flattened picture with its seed rig.
 * Returns null when the picture's size is not the rig, or too little of the rig's ink is present.
 */
export async function splitStillView(unitId: string, canvas: OffscreenCanvas, withPictures: boolean): Promise<TankView | null> {
  try {
    const rig = await rigFor(unitId);
    if (!rig || !aligned(canvas, rig)) {
      return null;
    }
    return await buildTankView({
      rigId: unitId,
      artWidth: rig.width,
      artHeight: rig.height,
      idle: [canvas],
      walk: [],
      fire: [],
      vectorBase: withPictures ? "still" : null,
    });
  } catch {
    return null;
  }
}

async function assembleView(input: TankViewInput): Promise<TankView | null> {
  const sample = input.idle[0] ?? input.walk[0] ?? input.fire[0];
  if (!sample || input.artWidth < 1 || input.artHeight < 1) {
    return null;
  }
  const resolution = sample.width / input.artWidth;
  const res = Math.round(resolution);
  if (res < 1 || Math.abs(resolution - res) > 0.01 || sample.height !== input.artHeight * res) {
    return null;
  }
  const rig = await rigFor(input.rigId);
  if (!rig || rig.width !== input.artWidth || rig.height !== input.artHeight) {
    return null;
  }
  const frames = [...input.idle, ...input.walk, ...input.fire];
  if (frames.some((frame) => frame.width !== input.artWidth * res || frame.height !== input.artHeight * res)) {
    return null;
  }

  const width = rig.width;
  const height = rig.height;
  const legs = drawingMask(rig, "legs", 0);
  const torsoDraw = drawingMask(rig, "torso", 0);
  const headDraw = drawingMask(rig, "head", 0);
  const weapon = drawingMask(rig, "weapon", 0);
  const upper = combine(headDraw, weapon, "or");
  const torso = combine(torsoDraw, upper, "and-not");
  const head = combine(headDraw, weapon, "and-not");
  const body = combine(torsoDraw, upper, "or");
  const tracks = combine(legs, body, "and-not");
  const overTracks = combine(torso, combine(head, weapon, "or"), "or");
  const overTorso = combine(head, weapon, "or");
  const poses = wornPart(rig, "legs").drawings.length;
  const cache = new Map<OffscreenCanvas, ImageData>();
  const idleSrc = pixelsOf(input.idle[0] ?? sample, cache);
  const tracksIdle = layerFrom(idleSrc, tracks, overTracks, width, height, res);
  const torsoCanvas = layerFrom(idleSrc, torso, overTorso, width, height, res);
  const headCanvas = layerFrom(idleSrc, head, weapon, width, height, res);
  const weaponCanvas = layerFrom(idleSrc, weapon, null, width, height, res);
  const tracksWalk = input.walk.map((frame, index) => {
    const pose = index + 1 < poses ? index + 1 : 0;
    const mask = pose === 0 ? tracks : combine(drawingMask(rig, "legs", pose), body, "and-not");
    return layerFrom(pixelsOf(frame, cache), mask, overTracks, width, height, res);
  });

  const walkLayers = tracksWalk.length > 0 ? tracksWalk : [tracksIdle];
  let urls: TankRasterUrls | null = null;
  if (input.vectorBase) {
    const [tracksIdleUrl, torsoUrl, headUrl, weaponUrl, tracksWalkUrls] = await Promise.all([
      pngUrl(tracksIdle),
      pngUrl(torsoCanvas),
      pngUrl(headCanvas),
      pngUrl(weaponCanvas),
      Promise.all(walkLayers.map((layer) => pngUrl(layer))),
    ]);
    urls = {
      tracksIdle: tracksIdleUrl,
      tracksWalk: tracksWalkUrls,
      torso: torsoUrl,
      head: headUrl,
      weapon: weaponUrl,
    };
  }

  return {
    artWidth: width,
    artHeight: height,
    resolution: res,
    raster: {
      tracksIdle,
      tracksWalk: walkLayers,
      torso: torsoCanvas,
      head: headCanvas,
      weapon: weaponCanvas,
      urls,
    },
  };
}

function aligned(canvas: OffscreenCanvas, rig: PartRig): boolean {
  const res = canvas.width / rig.width;
  const rounded = Math.round(res);
  if (rounded < 1 || Math.abs(res - rounded) > 0.01 || canvas.height !== rig.height * rounded) {
    return false;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return false;
  }
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let hit = 0;
  let total = 0;
  for (const layer of ["legs", "torso", "head", "weapon"] as const) {
    const mask = drawingMask(rig, layer, 0);
    for (let index = 0; index < mask.length; index += 1) {
      if (!mask[index]) {
        continue;
      }
      total += 1;
      const x = (index % rig.width) * rounded;
      const y = Math.floor(index / rig.width) * rounded;
      if ((pixels[(y * canvas.width + x) * 4 + 3] ?? 0) >= 128) {
        hit += 1;
      }
    }
  }
  return total > 0 && hit / total >= 0.45;
}

function paintFlat(frame: ReturnType<typeof resolveFrame>, lut: readonly string[]): OffscreenCanvas {
  const rgba = frameRgba(frame, lut);
  const canvas = new OffscreenCanvas(frame.width, frame.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("The browser would not open a canvas.");
  }
  const image = ctx.createImageData(frame.width, frame.height);
  image.data.set(rgba);
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function cellsToCanvas(
  cells: readonly number[],
  width: number,
  height: number,
  lut: readonly string[],
  skirt: Uint8Array | null,
): OffscreenCanvas {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("The browser would not open a canvas.");
  }
  const image = ctx.createImageData(width, height);
  const data = image.data;
  const count = width * height;
  for (let index = 0; index < count; index += 1) {
    const slot = cells[index] ?? 0;
    const offset = index * 4;
    if (slot !== 0) {
      const rgb = Number.parseInt((lut[slot] ?? "#000000").slice(1, 7), 16);
      data[offset] = (rgb >> 16) & 255;
      data[offset + 1] = (rgb >> 8) & 255;
      data[offset + 2] = rgb & 255;
      data[offset + 3] = 255;
    } else if (skirt?.[index]) {
      data[offset] = CHAR_R;
      data[offset + 1] = CHAR_G;
      data[offset + 2] = CHAR_B;
      data[offset + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

async function paintRig(unitId: string, lut: readonly string[], withPictures: boolean): Promise<PaintedRig | null> {
  const rig = await rigFor(unitId);
  const idleFrame = rig?.clips.idle[0] ?? rig?.clips.walk[0];
  if (!rig || !idleFrame) {
    return null;
  }
  const idleResolved = resolveFrame(rig, idleFrame);
  const width = rig.width;
  const height = rig.height;
  const torsoDraw = drawingMask(rig, "torso", 0);
  const headDraw = drawingMask(rig, "head", 0);
  const weaponMask = drawingMask(rig, "weapon", 0);
  const overTorso = combine(headDraw, weaponMask, "or");
  const overTracks = combine(torsoDraw, overTorso, "or");
  const tracksIdle = cellsToCanvas(idleResolved.layers.legs, width, height, lut, overTracks);
  const torsoCanvas = cellsToCanvas(idleResolved.layers.torso, width, height, lut, overTorso);
  const headCanvas = cellsToCanvas(idleResolved.layers.head, width, height, lut, weaponMask);
  const weaponCanvas = cellsToCanvas(idleResolved.layers.weapon, width, height, lut, null);
  const walkFrames = rig.clips.walk.length > 0 ? rig.clips.walk : [idleFrame];
  const fireFrames = rig.clips.fire.length > 0 ? rig.clips.fire : [idleFrame];
  const tracksWalk = walkFrames.map((frame) => cellsToCanvas(resolveFrame(rig, frame).layers.legs, width, height, lut, overTracks));
  const idle = paintFlat(idleResolved, lut);
  const walk = walkFrames.map((frame) => paintFlat(resolveFrame(rig, frame), lut));
  const fire = fireFrames.map((frame) => paintFlat(resolveFrame(rig, frame), lut));
  let urls: TankRasterUrls | null = null;
  if (withPictures) {
    const [tracksIdleUrl, torsoUrl, headUrl, weaponUrl, tracksWalkUrls] = await Promise.all([
      pngUrl(tracksIdle),
      pngUrl(torsoCanvas),
      pngUrl(headCanvas),
      pngUrl(weaponCanvas),
      Promise.all(tracksWalk.map((layer) => pngUrl(layer))),
    ]);
    urls = { tracksIdle: tracksIdleUrl, tracksWalk: tracksWalkUrls, torso: torsoUrl, head: headUrl, weapon: weaponUrl };
  }
  return {
    width,
    height,
    feet: { x: rig.feet.x, y: rig.feet.y },
    idle,
    walk,
    fire,
    view: {
      artWidth: width,
      artHeight: height,
      resolution: 1,
      raster: { tracksIdle, tracksWalk, torso: torsoCanvas, head: headCanvas, weapon: weaponCanvas, urls },
    },
  };
}
