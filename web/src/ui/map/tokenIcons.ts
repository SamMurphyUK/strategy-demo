// The unit icons from the silhouette sheet, drawn on the campaign map's tokens.
//
// The art is the same set of masks the unit chits use (theme/tokens/tokenArt.ts, built from the sheet by
// scripts/buildIconTokens.mjs): one drawing for every faction. A map token draws one in its own colours, a charcoal
// shadow under a parchment face, fitted into the disc. Until a mask has loaded `iconState` says "pending" and the
// token falls back to its old vector figure, so a token never paints blank.

import { halvingSteps } from "../theme/tokens/tokenGeometry";
import { artStatus, getArtMask, getTintedMask, subscribeTokenArt } from "../theme/tokens/tokenArt";
import { resolveTokenSpec, UNIT_TOKEN_SPEC } from "../theme/tokens/unitTokenSpec";

/** Unit ids the map and the rules know by another name than the token spec does. */
function specId(unitTypeId: string): string {
  switch (unitTypeId) {
    case "bomber":
      return "tactical_bomber";
    case "sub":
      return "submarine";
    case "armor":
      return "tank";
    case "aa":
      return "aaa";
    default:
      return unitTypeId;
  }
}

export function iconName(unitTypeId: string): string | null {
  return resolveTokenSpec(specId(unitTypeId), "axis").artName;
}

/** "ready" to draw, "pending" while the art loads, "none" when the unit has no icon (the old vector figure is drawn). */
export function iconState(unitTypeId: string): "ready" | "pending" | "none" {
  const name = iconName(unitTypeId);
  if (!name) return "none";
  const status = artStatus(name);
  return status === "ready" ? "ready" : status === "error" ? "none" : "pending";
}

/** Starts loading every icon, so the map's first paint already has them. */
export function preloadTokenIcons(): void {
  for (const id of Object.keys(UNIT_TOKEN_SPEC)) {
    const name = iconName(id);
    if (name) getArtMask(name);
  }
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const boxes = new Map<string, Box | null>();
const cropped = new Map<string, HTMLCanvasElement>();
const reduced = new Map<string, HTMLCanvasElement>();

// A repainted board after the art arrives must not reuse what was built from nothing.
subscribeTokenArt(() => {
  reduced.clear();
});

/** The tight box around a mask's ink. */
function inkBox(name: string, mask: HTMLCanvasElement): Box | null {
  if (boxes.has(name)) return boxes.get(name) ?? null;
  const ctx = mask.getContext("2d", { willReadFrequently: true });
  let box: Box | null = null;
  if (ctx) {
    const { data, width, height } = ctx.getImageData(0, 0, mask.width, mask.height);
    let x0 = width;
    let y0 = height;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > 24) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 >= 0) box = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  boxes.set(name, box);
  return box;
}

function cropOf(name: string, ink: string, box: Box): HTMLCanvasElement | null {
  const key = `${name}|${ink}`;
  const hit = cropped.get(key);
  if (hit) return hit;
  const tinted = getTintedMask(name, ink);
  if (!tinted) return null;
  const canvas = document.createElement("canvas");
  canvas.width = box.w;
  canvas.height = box.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(tinted, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  cropped.set(key, canvas);
  return canvas;
}

/** The icon cut to its ink and halved down to `w` by `h` px in steps, so thin masts and barrels survive the shrink. */
function reducedTo(name: string, ink: string, box: Box, w: number, h: number): HTMLCanvasElement | null {
  const key = `${name}|${ink}|${w}x${h}`;
  const hit = reduced.get(key);
  if (hit) return hit;
  let current: HTMLCanvasElement | null = cropOf(name, ink, box);
  if (!current) return null;
  for (const step of halvingSteps(current.width, current.height, w, h)) {
    const next = document.createElement("canvas");
    next.width = step.width;
    next.height = step.height;
    const ctx = next.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(current, 0, 0, step.width, step.height);
    current = next;
  }
  reduced.set(key, current);
  return current;
}

export interface IconPlace {
  /** The icon fits inside this box, keeping its shape. */
  maxW: number;
  maxH: number;
  /** Centre of the box. */
  cx: number;
  cy: number;
  /** When set, the icon's bottom edge sits here instead of being centred in the box (a hull on the waterline). */
  bottom?: number;
}

/** Draws a unit's icon in one colour. Returns false when it has none ready, so the caller can draw its fallback. */
export function drawIcon(ctx: CanvasRenderingContext2D, unitTypeId: string, ink: string, place: IconPlace): boolean {
  const name = iconName(unitTypeId);
  if (!name) return false;
  const art = getArtMask(name);
  if (!art) return false;
  const box = inkBox(name, art.mask);
  if (!box) return false;
  const scale = Math.min(place.maxW / box.w, place.maxH / box.h);
  const w = Math.max(1, Math.round(box.w * scale));
  const h = Math.max(1, Math.round(box.h * scale));
  const image = reducedTo(name, ink, box, w, h);
  if (!image) return false;
  const left = Math.round(place.cx - w / 2);
  const top = Math.round(place.bottom !== undefined ? place.bottom - h : place.cy - h / 2);
  const smoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(image, left, top);
  ctx.imageSmoothingEnabled = smoothing;
  return true;
}
