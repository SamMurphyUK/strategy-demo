// Canvas drawing for the map's unit tokens. The colours, letters and silhouettes are in tokenStyle.ts.
//
//   land and air   a solid faction-coloured disc with a white silhouette
//   sea            a waterline hemisphere: darker lower half, white hull on the midline, a bold letter above
//   count pill     bottom-right, gold for the faction whose turn it is and black for the rest
import { factionPalette } from "../theme/factionPalette";
import { MILITARY } from "../theme/militaryPalette";
import type { StackEntry } from "./geometry";
import {
  CARGO_DOT,
  hullFor,
  isActiveFaction,
  navalLetter,
  pillFontPx,
  pillRadius,
  PILL_OFFSET,
  TOKEN_WHITE,
  unitSilhouette,
} from "./tokenStyle";
import { unitDomain } from "./unitStacks";

const SERIF = 'Georgia, "Iowan Old Style", "Times New Roman", serif';
const MONO = '"Courier New", "JetBrains Mono", ui-monospace, monospace';
const PLINTH = MILITARY.charcoal;
const BRASS = MILITARY.brass;
const GOLD_NUM = MILITARY.cream;
const TEAL_NUM = MILITARY.spruce;
/** Tokens draw a tenth smaller than their slot, so a crowded coast does not stack discs on top of each other. */
const FACE_SCALE = 0.9;
const PARCHMENT = MILITARY.cream;
const faceCache = new Map<string, CanvasImageSource>();

export interface TokenPaint {
  dpr: number;
  /** The faction whose turn it is, for the count pill. */
  activeFactionId: string;
  /** Per-token categories (unit type id to land, air or sea) from the scenario. */
  categories?: Record<string, string>;
  /** A transport with cargo aboard gets a dot at the top left. */
  loaded?: boolean;
  /** Pieces aboard a transport. Draws the `[⚓+n]` pill when it is above zero. */
  cargoCount?: number;
  /** Remaining movement for an aircraft. Omit it for land and sea. */
  fuel?: number | null;
}

// ---------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------

function fillPolygon(ctx: CanvasRenderingContext2D, points: { x: number; y: number }[], x: number, y: number, d: number): void {
  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(x + p.x * d, y + p.y * d) : ctx.lineTo(x + p.x * d, y + p.y * d)));
  ctx.closePath();
  ctx.fill();
}

function whiteLetter(ctx: CanvasRenderingContext2D, letter: string, x: number, y: number, px: number): void {
  ctx.font = `700 ${px}px ${SERIF}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = TOKEN_WHITE;
  ctx.fillText(letter, x, y + px * 0.04);
}

function paintFigure(ctx: CanvasRenderingContext2D, entry: StackEntry, x: number, y: number, d: number, color: string): void {
  ctx.fillStyle = color;
  for (const part of unitSilhouette(entry.unit_type_id)) {
    fillPolygon(ctx, part, x, y, d);
  }
}

function paintHull(ctx: CanvasRenderingContext2D, entry: StackEntry, x: number, y: number, d: number, color: string): void {
  ctx.fillStyle = color;
  for (const part of hullFor(entry.unit_type_id)) {
    fillPolygon(ctx, part, x, y, d);
  }
}

/** The waterline hemisphere: the darker sea below the midline, a wavy waterline, the white hull and the letter. */
function drawCargoPill(ctx: CanvasRenderingContext2D, x: number, y: number, d: number, count: number): void {
  const label = `⚓+${count}`;
  ctx.save();
  ctx.font = `700 ${Math.max(8, d * 0.22)}px ${MONO}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const w = Math.max(d * 0.7, ctx.measureText(label).width + d * 0.18);
  const h = Math.max(11, d * 0.28);
  const left = x - w / 2;
  const top = y - d * 0.72;
  ctx.fillStyle = PLINTH;
  ctx.fillRect(left, top, w, h);
  ctx.lineWidth = 1;
  ctx.strokeStyle = BRASS;
  ctx.strokeRect(left + 0.5, top + 0.5, w - 1, h - 1);
  ctx.fillStyle = GOLD_NUM;
  ctx.fillText(label, x, top + h / 2 + 0.5);
  ctx.restore();
}

function paintSea(
  ctx: CanvasRenderingContext2D,
  entry: StackEntry,
  x: number,
  y: number,
  d: number,
  loaded: boolean,
  cargoCount: number,
): void {
  const r = d / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r - Math.max(0.5, d * 0.02), 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = "rgba(78, 84, 99, 0.55)";
  ctx.fillRect(x - r, y, d, r);
  // The waterline: a short wave across the midline.
  ctx.beginPath();
  const waves = 5;
  for (let i = 0; i <= waves * 8; i++) {
    const t = i / (waves * 8);
    const px = x - r + t * d;
    const py = y + Math.sin(t * waves * Math.PI * 2) * d * 0.012;
    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.lineWidth = Math.max(0.8, d * 0.03);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
  ctx.stroke();
  ctx.restore();

  paintHull(ctx, entry, x + 1.5, y + 1.5, d, MILITARY.charcoal);
  paintHull(ctx, entry, x, y, d, PARCHMENT);
  whiteLetter(ctx, navalLetter(entry.unit_type_id), x, y - d * 0.3, d * 0.27);
  if (loaded && entry.unit_type_id === "transport") {
    ctx.beginPath();
    ctx.arc(x + CARGO_DOT.x * d, y + CARGO_DOT.y * d, Math.max(1.8, CARGO_DOT.r * d), 0, Math.PI * 2);
    ctx.fillStyle = MILITARY.brass;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = TOKEN_WHITE;
    ctx.stroke();
    if (cargoCount > 0) {
      drawCargoPill(ctx, x, y, d, cargoCount);
    }
  }
}

function enamelRings(ctx: CanvasRenderingContext2D, x: number, y: number, d: number): void {
  const r = d / 2;
  // 1.5px outer, 1.5px faction gap, 0.75px hairline. The hairline centre sits 3.375px in,
  // so a world-view token smaller than 7.5px scales the stack instead of asking for a negative radius.
  const fit = r >= 3.75 ? 1 : r / 3.75;
  if (!(fit > 0)) {
    return;
  }
  const outerW = 1.5 * fit;
  const gap = 1.5 * fit;
  const hair = 0.75 * fit;
  const outerR = r - outerW / 2;
  const hairR = outerR - outerW / 2 - gap - hair / 2;
  if (outerR <= 0 || hairR <= 0) {
    return;
  }
  ctx.beginPath();
  ctx.arc(x, y, outerR, 0, Math.PI * 2);
  ctx.lineWidth = outerW;
  ctx.strokeStyle = MILITARY.charcoal;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, hairR, 0, Math.PI * 2);
  ctx.lineWidth = hair;
  ctx.strokeStyle = MILITARY.charcoal;
  ctx.stroke();
}

/** The disc and its silhouette, without a count. A dark outer ring, a faction gap, then a hairline. */
export function drawTokenFace(
  ctx: CanvasRenderingContext2D,
  entry: StackEntry,
  x: number,
  y: number,
  d: number,
  paint: TokenPaint,
): void {
  const r = d / 2;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = factionPalette(entry.faction_id).primary;
  ctx.fill();
  const domain = unitDomain(entry.unit_type_id, paint.categories);
  if (domain === "sea") {
    paintSea(ctx, entry, x, y, d, paint.loaded ?? false, paint.cargoCount ?? 0);
  } else {
    paintFigure(ctx, entry, x + 1.5, y + 1.5, d, MILITARY.charcoal);
    paintFigure(ctx, entry, x, y, d, PARCHMENT);
  }
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.82, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = "rgba(75, 61, 68, 0.16)";
  let seed = 17;
  for (let i = 0; i < entry.unit_type_id.length; i++) {
    seed = (seed + entry.unit_type_id.charCodeAt(i) * 13) % 2147483647;
  }
  for (let i = 0; i < 16; i++) {
    seed = (seed * 16807 + 11) % 2147483647;
    const u = (seed % 1000) / 1000;
    seed = (seed * 16807 + 11) % 2147483647;
    const v = (seed % 1000) / 1000;
    ctx.fillRect(x - r + u * d, y - r + v * d, 1, 1);
  }
  ctx.restore();
  ctx.imageSmoothingEnabled = false;
  enamelRings(ctx, x, y, d);
}

function layerContext(size: number): { image: CanvasImageSource; ctx: CanvasRenderingContext2D } | null {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d");
    if (ctx) {
      return { image: canvas, ctx: ctx as unknown as CanvasRenderingContext2D };
    }
  }
  if (typeof document === "undefined") {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  return ctx ? { image: canvas, ctx } : null;
}

function bakedFace(entry: StackEntry, d: number, paint: TokenPaint): CanvasImageSource | null {
  const size = Math.ceil(d + 8);
  const key = `${entry.unit_type_id}|${entry.faction_id}|${size}|${paint.loaded ? 1 : 0}|${paint.cargoCount ?? 0}|${paint.categories?.[entry.unit_type_id] ?? ""}`;
  const cached = faceCache.get(key);
  if (cached) {
    return cached;
  }
  const layer = layerContext(size);
  if (!layer) {
    return null;
  }
  layer.ctx.imageSmoothingEnabled = false;
  drawTokenFace(layer.ctx as CanvasRenderingContext2D, entry, size / 2, size / 2, d, paint);
  faceCache.set(key, layer.image);
  return layer.image;
}

/** Remaining fuel, top-left, so it sits clear of the count pill. */
export function drawFuelPill(ctx: CanvasRenderingContext2D, fuel: number, x: number, y: number, d: number): void {
  const radius = pillRadius(d);
  const cx = x - d * PILL_OFFSET;
  const cy = y - d * PILL_OFFSET;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = PLINTH;
  ctx.fill();
  ctx.lineWidth = Math.max(1, radius * 0.16);
  ctx.strokeStyle = BRASS;
  ctx.stroke();
  ctx.fillStyle = TEAL_NUM;
  ctx.font = `700 ${pillFontPx(d)}px ${MONO}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(fuel), cx, cy + 0.5);
}

/** The count pill at a token's bottom-right. Drawn for every stack, a lone unit included. */
export function drawCountPill(
  ctx: CanvasRenderingContext2D,
  count: number,
  x: number,
  y: number,
  d: number,
  active: boolean,
): void {
  const radius = pillRadius(d);
  const cx = x + d * PILL_OFFSET;
  const cy = y + d * PILL_OFFSET;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = PLINTH;
  ctx.fill();
  ctx.lineWidth = Math.max(1, radius * 0.16);
  ctx.strokeStyle = BRASS;
  ctx.stroke();
  ctx.fillStyle = active ? TEAL_NUM : GOLD_NUM;
  ctx.font = `700 ${pillFontPx(d)}px ${MONO}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(count), cx, cy + 0.5);
}

/** A whole token: cached enamel face, silhouette and count pill. The face is a tenth smaller than the slot. */
export function drawMapToken(
  ctx: CanvasRenderingContext2D,
  entry: StackEntry,
  x: number,
  y: number,
  d: number,
  paint: TokenPaint,
): void {
  const face = d * FACE_SCALE;
  const image = bakedFace(entry, face, paint);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  if (image) {
    const size = Math.ceil(face + 8);
    ctx.drawImage(image, x - size / 2, y - size / 2);
  } else {
    drawTokenFace(ctx, entry, x, y, face, paint);
  }
  ctx.restore();
  drawCountPill(ctx, entry.count, x, y, face, isActiveFaction(entry.faction_id, paint.activeFactionId));
  if (paint.fuel != null) {
    drawFuelPill(ctx, paint.fuel, x, y, face);
  }
}
