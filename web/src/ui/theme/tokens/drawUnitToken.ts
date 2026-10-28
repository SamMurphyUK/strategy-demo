// Renders a unit chit for a faction: ring and fill drawn as vectors in the faction colours, the shared
// silhouette tinted with the faction's ink, and a serif unit letter when the silhouette leaves room.
//
// One art file serves every faction. Results are cached per unit, faction and pixel size, and are only
// cached once the art has loaded, so a first paint never freezes in a half-finished state.

import { factionPalette, resolveFaction, type FactionPalette } from "../factionPalette";
import { artStatus, getArtMask, getTintedMask } from "./tokenArt";
import {
  FALLBACK_CAP_HEIGHT,
  LETTER_CAP_HEIGHT,
  LETTER_TOP_BASELINE,
  SERIF_CAP_RATIO,
  halvingSteps,
  ringWidthPx,
  tokenCanvasSize,
} from "./tokenGeometry";
import { resolveTokenSpec } from "./unitTokenSpec";

export const TOKEN_SERIF = 'Georgia, "Iowan Old Style", "Palatino Linotype", "Times New Roman", serif';

export interface TokenRequest {
  unitTypeId: string;
  factionId: string;
  /** Circle diameter in CSS pixels. The canvas is wider than this so silhouettes can overhang. */
  size: number;
  dpr?: number;
}

export interface RenderedToken {
  canvas: HTMLCanvasElement;
  /** False while the art is still loading. Do not cache incomplete tokens. */
  complete: boolean;
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function smooth(ctx: CanvasRenderingContext2D): void {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
}

/** Shrinks by repeated halving so thin features (masts, barrels) keep their weight. */
function downscale(source: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement {
  let current = source;
  for (const step of halvingSteps(source.width, source.height, width, height)) {
    const next = makeCanvas(step.width, step.height);
    const ctx = next.getContext("2d");
    if (!ctx) return current;
    smooth(ctx);
    ctx.drawImage(current, 0, 0, step.width, step.height);
    current = next;
  }
  return current;
}

function drawLetter(
  ctx: CanvasRenderingContext2D,
  letter: string,
  palette: FactionPalette,
  cx: number,
  cy: number,
  d: number,
  centred: boolean,
): void {
  const cap = (centred ? FALLBACK_CAP_HEIGHT : LETTER_CAP_HEIGHT) * d;
  const baseline = centred ? cy + cap / 2 : cy + LETTER_TOP_BASELINE * d;
  ctx.font = `700 ${cap / SERIF_CAP_RATIO}px ${TOKEN_SERIF}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = palette.ink;
  ctx.fillText(letter, cx, baseline);
}

const rendered = new Map<string, HTMLCanvasElement>();

export function renderUnitToken(request: TokenRequest): RenderedToken {
  const dpr = request.dpr ?? (typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);
  const key = `${request.unitTypeId}|${resolveFaction(request.factionId)}|${request.size}|${dpr}`;
  const hit = rendered.get(key);
  if (hit) return { canvas: hit, complete: true };
  const result = paintToken(request, dpr);
  if (result.complete) rendered.set(key, result.canvas);
  return result;
}

function paintToken(request: TokenRequest, dpr: number): RenderedToken {
  const palette = factionPalette(request.factionId);
  const spec = resolveTokenSpec(request.unitTypeId, palette.side);
  const { width, height } = tokenCanvasSize(request.size, dpr);
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return { canvas, complete: true };
  smooth(ctx);

  const d = height;
  const cx = width / 2;
  const cy = height / 2;
  const ringW = ringWidthPx(height, dpr);

  ctx.beginPath();
  ctx.arc(cx, cy, d / 2 - ringW / 2, 0, Math.PI * 2);
  ctx.fillStyle = palette.fill;
  ctx.fill();
  ctx.lineWidth = ringW;
  ctx.strokeStyle = palette.ring;
  ctx.stroke();

  const status = spec.artName ? artStatus(spec.artName) : "ready";
  const art = spec.artName ? getArtMask(spec.artName) : null;
  if (art && spec.artName) {
    if (art.letterFits) drawLetter(ctx, spec.letter, palette, cx, cy, d, false);
    const tinted = getTintedMask(spec.artName, palette.ink);
    if (tinted) ctx.drawImage(downscale(tinted, width, height), 0, 0);
  } else if (!spec.artName || status === "error") {
    drawLetter(ctx, spec.letter, palette, cx, cy, d, true);
  }
  return { canvas, complete: status !== "loading" };
}

const dataUrls = new Map<string, string>();

/** PNG data URL for SVG <image> counters. Cached once complete. */
export function tokenUrl(unitTypeId: string, factionId: string, size: number, dpr?: number): string {
  const ratio = dpr ?? (typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);
  const key = `${unitTypeId}|${resolveFaction(factionId)}|${size}|${ratio}`;
  const cached = dataUrls.get(key);
  if (cached) return cached;
  const { canvas, complete } = renderUnitToken({ unitTypeId, factionId, size, dpr: ratio });
  const url = canvas.toDataURL("image/png");
  if (complete) dataUrls.set(key, url);
  return url;
}

/** Draws a token centred on (x, y) in a 2D context, for canvas map counters. */
export function drawUnitToken(
  ctx: CanvasRenderingContext2D,
  unitTypeId: string,
  factionId: string,
  x: number,
  y: number,
  size: number,
  dpr = 1,
): void {
  const { canvas } = renderUnitToken({ unitTypeId, factionId, size, dpr });
  ctx.drawImage(canvas, x - canvas.width / dpr / 2, y - canvas.height / dpr / 2, canvas.width / dpr, canvas.height / dpr);
}
