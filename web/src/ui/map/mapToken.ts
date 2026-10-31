// Canvas drawing for the map's unit tokens. The colours, letters and silhouettes are in tokenStyle.ts.
//
//   land and air   a solid faction-coloured disc with a white silhouette
//   sea            a waterline hemisphere: darker lower half, white hull on the midline, a bold letter above
//   count pill     bottom-right, gold for the faction whose turn it is and black for the rest
import { factionPalette } from "../theme/factionPalette";
import { artStatus, getTintedMask } from "../theme/tokens/tokenArt";
import { halvingSteps } from "../theme/tokens/tokenGeometry";
import { planePolygon } from "./facilityBadge";
import type { StackEntry } from "./geometry";
import {
  CARGO_DOT,
  hullFor,
  isActiveFaction,
  landArtFor,
  navalLetter,
  pillColors,
  pillFontPx,
  pillRadius,
  planeScale,
  TOKEN_GOLD,
  TOKEN_INK,
  TOKEN_WHITE,
  tokenDisc,
} from "./tokenStyle";
import { unitDomain } from "./unitStacks";

const SERIF = 'Georgia, "Iowan Old Style", "Times New Roman", serif';
const MONO = 'ui-monospace, "Cascadia Mono", Consolas, monospace';
/** The silhouette fills this share of the disc's diameter. */
const SILHOUETTE_SHARE = 0.62;

export interface TokenPaint {
  dpr: number;
  /** The faction whose turn it is, for the count pill. */
  activeFactionId: string;
  /** Per-token categories (unit type id to land, air or sea) from the scenario. */
  categories?: Record<string, string>;
  /** A transport with cargo aboard gets a dot at the top left. */
  loaded?: boolean;
}

// ---------------------------------------------------------------
// White silhouettes cut from the unit art
// ---------------------------------------------------------------

interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

const cropCache = new WeakMap<HTMLCanvasElement, Crop | null>();

/** The bounding box of the opaque pixels, so the silhouette can be centred and fitted. */
function opaqueBounds(canvas: HTMLCanvasElement): Crop | null {
  if (cropCache.has(canvas)) {
    return cropCache.get(canvas) ?? null;
  }
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  let crop: Crop | null = null;
  if (ctx) {
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let x0 = width;
    let y0 = height;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > 24) {
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
          y0 = Math.min(y0, y);
          y1 = Math.max(y1, y);
        }
      }
    }
    if (x1 >= x0 && y1 >= y0) {
      crop = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    }
  }
  cropCache.set(canvas, crop);
  return crop;
}

const sprites = new Map<string, HTMLCanvasElement>();

/** The white silhouette of an art file, cropped, and shrunk by halving until it is `px` on its long side. */
function silhouetteSprite(art: string, px: number): HTMLCanvasElement | null {
  const key = `${art}|${px}`;
  const hit = sprites.get(key);
  if (hit) {
    return hit;
  }
  const mask = getTintedMask(art, TOKEN_WHITE);
  const crop = mask ? opaqueBounds(mask) : null;
  if (!mask || !crop) {
    return null;
  }
  const scale = px / Math.max(crop.w, crop.h);
  const width = Math.max(1, Math.round(crop.w * scale));
  const height = Math.max(1, Math.round(crop.h * scale));
  let current = document.createElement("canvas");
  current.width = crop.w;
  current.height = crop.h;
  current.getContext("2d")!.drawImage(mask, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
  for (const step of halvingSteps(crop.w, crop.h, width, height)) {
    const next = document.createElement("canvas");
    next.width = step.width;
    next.height = step.height;
    const nctx = next.getContext("2d")!;
    nctx.imageSmoothingEnabled = true;
    nctx.imageSmoothingQuality = "high";
    nctx.drawImage(current, 0, 0, step.width, step.height);
    current = next;
  }
  sprites.set(key, current);
  return current;
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

function paintLand(ctx: CanvasRenderingContext2D, entry: StackEntry, x: number, y: number, d: number, dpr: number): void {
  const allies = factionPalette(entry.faction_id).side === "allies";
  const art = landArtFor(entry.unit_type_id, allies);
  if (art && artStatus(art) !== "error") {
    const fit = d * SILHOUETTE_SHARE;
    const sprite = silhouetteSprite(art, Math.max(2, Math.round(fit * dpr)));
    if (sprite) {
      // The sprite is `fit * dpr` device pixels on its long side, and the context is already scaled by dpr.
      const w = sprite.width / dpr;
      const h = sprite.height / dpr;
      ctx.drawImage(sprite, x - w / 2, y - h / 2, w, h);
    }
    return;
  }
  whiteLetter(ctx, (entry.unit_type_id.charAt(0) || "?").toUpperCase(), x, y, d * 0.5);
}

function paintAir(ctx: CanvasRenderingContext2D, entry: StackEntry, x: number, y: number, d: number): void {
  const { sx, sy } = planeScale(entry.unit_type_id);
  const half = (d * SILHOUETTE_SHARE) / 2;
  ctx.fillStyle = TOKEN_WHITE;
  ctx.beginPath();
  planePolygon().forEach((p, i) => {
    const px = x + p.x * sx * half;
    const py = y + p.y * sy * half;
    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  });
  ctx.closePath();
  ctx.fill();
}

/** The waterline hemisphere: the darker sea below the midline, a wavy waterline, the white hull and the letter. */
function paintSea(ctx: CanvasRenderingContext2D, entry: StackEntry, x: number, y: number, d: number, loaded: boolean): void {
  const r = d / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r - Math.max(0.5, d * 0.02), 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = "rgba(8, 22, 38, 0.38)";
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

  ctx.fillStyle = TOKEN_WHITE;
  for (const part of hullFor(entry.unit_type_id)) {
    fillPolygon(ctx, part, x, y, d);
  }
  whiteLetter(ctx, navalLetter(entry.unit_type_id), x, y - d * 0.3, d * 0.27);
  if (loaded && entry.unit_type_id === "transport") {
    ctx.beginPath();
    ctx.arc(x + CARGO_DOT.x * d, y + CARGO_DOT.y * d, Math.max(1.8, CARGO_DOT.r * d), 0, Math.PI * 2);
    ctx.fillStyle = TOKEN_GOLD;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = TOKEN_WHITE;
    ctx.stroke();
  }
}

/** The disc and its silhouette, without a count. Used by tokens and by the collapsed bubble's lead unit. */
export function drawTokenFace(
  ctx: CanvasRenderingContext2D,
  entry: StackEntry,
  x: number,
  y: number,
  d: number,
  paint: TokenPaint,
): void {
  const r = d / 2;
  const rim = Math.max(1, d * 0.045);
  ctx.beginPath();
  ctx.arc(x, y, r - rim / 2, 0, Math.PI * 2);
  ctx.fillStyle = tokenDisc(entry.faction_id);
  ctx.fill();
  const domain = unitDomain(entry.unit_type_id, paint.categories);
  if (domain === "sea") {
    paintSea(ctx, entry, x, y, d, paint.loaded ?? false);
  } else if (domain === "air") {
    paintAir(ctx, entry, x, y, d);
  } else {
    paintLand(ctx, entry, x, y, d, paint.dpr);
  }
  ctx.beginPath();
  ctx.arc(x, y, r - rim / 2, 0, Math.PI * 2);
  ctx.lineWidth = rim;
  ctx.strokeStyle = TOKEN_INK;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, r - rim * 1.6, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(0.6, rim * 0.5);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
  ctx.stroke();
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
  const colors = pillColors(active);
  const radius = pillRadius(d);
  const cx = x + d * 0.36;
  const cy = y + d * 0.36;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = colors.fill;
  ctx.fill();
  ctx.lineWidth = Math.max(1.2, radius * 0.2);
  ctx.strokeStyle = colors.rim;
  ctx.stroke();
  ctx.fillStyle = colors.text;
  ctx.font = `700 ${pillFontPx(d)}px ${MONO}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(count), cx, cy + 0.5);
}

/** A whole token: shadowed disc, silhouette and count pill. */
export function drawMapToken(
  ctx: CanvasRenderingContext2D,
  entry: StackEntry,
  x: number,
  y: number,
  d: number,
  paint: TokenPaint,
): void {
  ctx.save();
  ctx.shadowColor = "rgba(26, 24, 21, 0.5)";
  ctx.shadowBlur = 3 * paint.dpr;
  ctx.shadowOffsetY = 1 * paint.dpr;
  ctx.beginPath();
  ctx.arc(x, y, d / 2, 0, Math.PI * 2);
  ctx.fillStyle = tokenDisc(entry.faction_id);
  ctx.fill();
  ctx.restore();
  drawTokenFace(ctx, entry, x, y, d, paint);
  drawCountPill(ctx, entry.count, x, y, d, isActiveFaction(entry.faction_id, paint.activeFactionId));
}
