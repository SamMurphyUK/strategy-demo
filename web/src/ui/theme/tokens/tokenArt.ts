// Loads each token PNG once and reduces it to a silhouette mask (ink only, as alpha), cropped to the token
// frame. The ring and fill baked into the PNGs are discarded; the renderer redraws them per faction.

import {
  ARTBOARD,
  ART_CIRCLE,
  LETTER_BOX,
  LETTER_CLEAR_LIMIT,
  TOKEN_HALF_WIDTH,
} from "./tokenGeometry";
import { coverageFraction, detectArtColors, extractSilhouetteAlpha } from "./silhouette";

export interface ArtMask {
  /** Silhouette alpha, token-frame crop at source resolution. */
  mask: HTMLCanvasElement;
  /** False when the silhouette runs through the top of the circle, where the letter goes. */
  letterFits: boolean;
}

type Entry = { status: "loading" } | { status: "error" } | ({ status: "ready" } & ArtMask);

const entries = new Map<string, Entry>();
const tinted = new Map<string, HTMLCanvasElement>();
const listeners = new Set<() => void>();
let version = 0;

function bump(): void {
  version++;
  for (const listener of listeners) listener();
}

export function subscribeTokenArt(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getTokenArtVersion(): number {
  return version;
}

export function artUrl(name: string): string {
  return `${import.meta.env.BASE_URL}assets/units/${name}.png`;
}

function buildMask(img: HTMLImageElement): ArtMask | null {
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  const scale = width / ARTBOARD.width;
  const full = document.createElement("canvas");
  full.width = width;
  full.height = height;
  const ctx = full.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  const pixels = ctx.getImageData(0, 0, width, height);
  const colors = detectArtColors(pixels.data);
  if (!colors) return null;
  const alpha = extractSilhouetteAlpha(pixels.data, colors);

  const d = ART_CIRCLE.diameter * scale;
  const cx = ART_CIRCLE.cx * scale;
  const cy = ART_CIRCLE.cy * scale;
  const letterFits =
    coverageFraction(alpha, width, height, {
      x0: cx - LETTER_BOX.halfWidth * d,
      x1: cx + LETTER_BOX.halfWidth * d,
      y0: cy + LETTER_BOX.top * d,
      y1: cy + LETTER_BOX.bottom * d,
    }) < LETTER_CLEAR_LIMIT;

  pixels.data.set(alpha);
  ctx.putImageData(pixels, 0, 0);

  const mask = document.createElement("canvas");
  mask.width = Math.round(2 * TOKEN_HALF_WIDTH * d);
  mask.height = Math.round(d);
  const mctx = mask.getContext("2d");
  if (!mctx) return null;
  mctx.drawImage(full, Math.round(mask.width / 2 - cx), Math.round(mask.height / 2 - cy));
  return { mask, letterFits };
}

/** Starts loading on first request. Returns null until the art is ready (or if it failed). */
export function getArtMask(name: string): ArtMask | null {
  const entry = entries.get(name);
  if (entry) return entry.status === "ready" ? entry : null;
  entries.set(name, { status: "loading" });
  const img = new Image();
  img.onload = () => {
    const result = buildMask(img);
    entries.set(name, result ? { status: "ready", ...result } : { status: "error" });
    bump();
  };
  img.onerror = () => {
    entries.set(name, { status: "error" });
    bump();
  };
  img.src = artUrl(name);
  return null;
}

/** "loading" art means the token should not be cached or finalised yet. */
export function artStatus(name: string): "loading" | "ready" | "error" {
  getArtMask(name);
  return entries.get(name)?.status ?? "loading";
}

/** The silhouette filled with one ink colour. Cached per art and colour. */
export function getTintedMask(name: string, ink: string): HTMLCanvasElement | null {
  const art = getArtMask(name);
  if (!art) return null;
  const key = `${name}|${ink}`;
  let canvas = tinted.get(key);
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.width = art.mask.width;
    canvas.height = art.mask.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = ink;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(art.mask, 0, 0);
    tinted.set(key, canvas);
  }
  return canvas;
}
