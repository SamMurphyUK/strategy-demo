// Canvas drawing for the map's unit tokens. The colours, letters and silhouettes are in tokenStyle.ts.
//
//   land and air   a solid faction-coloured disc with a white silhouette
//   sea            a waterline hemisphere: darker lower half, white hull on the midline, a bold letter above
//   count pill     bottom-right, gold for the faction whose turn it is and black for the rest
import type { StackEntry } from "./geometry";
import {
  CARGO_DOT,
  hullFor,
  isActiveFaction,
  navalLetter,
  pillColors,
  pillFontPx,
  pillRadius,
  PILL_OFFSET,
  TOKEN_GOLD,
  TOKEN_INK,
  TOKEN_WHITE,
  tokenDisc,
  unitSilhouette,
} from "./tokenStyle";
import { unitDomain } from "./unitStacks";

const SERIF = 'Georgia, "Iowan Old Style", "Times New Roman", serif';
const MONO = 'ui-monospace, "Cascadia Mono", Consolas, monospace';
/** The ink ring that separates overlapping tokens. One and a half screen pixels, whatever the zoom. */
const SEPARATION_RING_PX = 1.5;

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

function paintFigure(ctx: CanvasRenderingContext2D, entry: StackEntry, x: number, y: number, d: number): void {
  ctx.fillStyle = TOKEN_WHITE;
  for (const part of unitSilhouette(entry.unit_type_id)) {
    fillPolygon(ctx, part, x, y, d);
  }
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

/** The disc and its silhouette, without a count. A 1.5px ink ring keeps overlapped tokens readable. */
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
  ctx.arc(x, y, r - SEPARATION_RING_PX / 2, 0, Math.PI * 2);
  ctx.fillStyle = tokenDisc(entry.faction_id);
  ctx.fill();
  const domain = unitDomain(entry.unit_type_id, paint.categories);
  if (domain === "sea") {
    paintSea(ctx, entry, x, y, d, paint.loaded ?? false);
  } else {
    paintFigure(ctx, entry, x, y, d);
  }
  ctx.beginPath();
  ctx.arc(x, y, r - SEPARATION_RING_PX / 2, 0, Math.PI * 2);
  ctx.lineWidth = SEPARATION_RING_PX;
  ctx.strokeStyle = TOKEN_INK;
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
  const cx = x + d * PILL_OFFSET;
  const cy = y + d * PILL_OFFSET;
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
