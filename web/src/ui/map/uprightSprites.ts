// Upright side-profile sprites for LoD 2. Same palette and standing poses as the battle screen,
// drawn at integer pixels with smoothing off, feet on the plinth centre.
import { factionPalette } from "../theme/factionPalette";
import { MILITARY } from "../theme/militaryPalette";
import { SELECTED_COLOR } from "./mapStyle";
import { squadOffsets } from "./zoomLod";

const CHARCOAL = MILITARY.charcoal;
const STEEL = MILITARY.steel;
const SPRUCE = MILITARY.spruce;
const TAUPE = MILITARY.taupe;
const CREAM = MILITARY.cream;
const BROWN = MILITARY.brown;
const LEATHER = MILITARY.khaki;
const BRASS = MILITARY.brass;
const PLINTH = MILITARY.charcoal;
const GOLD = MILITARY.brass;
const GOLD_NUM = MILITARY.cream;
const TEAL_NUM = MILITARY.spruce;

export interface UprightPaint {
  unitType: string;
  factionId: string;
  count: number;
  x: number;
  y: number;
  tokenPx: number;
  dpr: number;
  selected: boolean;
  unmoved: boolean;
  active: boolean;
  fuel: number | null;
  loaded: boolean;
}

function withCrisp(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  draw: (at: (css: number) => number) => void,
): void {
  const scale = Math.max(1, Math.round(dpr));
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingEnabled = false;
  draw((css) => Math.round((css * dpr) / scale));
  ctx.restore();
}

function drawHardwareBadge(
  ctx: CanvasRenderingContext2D,
  label: string,
  left: number,
  top: number,
  numeral: string,
): void {
  ctx.font = "700 11px Courier New, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const w = Math.max(16, Math.ceil(ctx.measureText(label).width) + 8);
  const h = 13;
  ctx.fillStyle = PLINTH;
  ctx.fillRect(left, top, w, h);
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 1;
  ctx.strokeRect(left + 0.5, top + 0.5, w - 1, h - 1);
  ctx.fillStyle = numeral;
  ctx.textAlign = "center";
  ctx.fillText(label, left + w / 2, top + h / 2 + 0.5);
}

function drawInfantry(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.fillStyle = CHARCOAL;
  ctx.fillRect(-4, -5, 3, 5);
  ctx.fillRect(1, -5, 3, 5);
  ctx.fillStyle = TAUPE;
  ctx.fillRect(-4, -9, 8, 5);
  ctx.fillStyle = color;
  ctx.fillRect(-5, -16, 10, 8);
  ctx.fillStyle = LEATHER;
  ctx.fillRect(-5, -11, 10, 2);
  ctx.fillRect(-2, -16, 2, 5);
  ctx.fillStyle = CREAM;
  ctx.fillRect(-3, -20, 6, 5);
  ctx.fillStyle = color;
  ctx.fillRect(-4, -23, 8, 4);
  ctx.fillStyle = CHARCOAL;
  ctx.fillRect(-5, -20, 10, 2);
  ctx.fillStyle = BROWN;
  ctx.fillRect(-2, -13, 9, 3);
  ctx.fillStyle = STEEL;
  ctx.fillRect(7, -12, 8, 2);
  ctx.fillStyle = CREAM;
  ctx.fillRect(15, -13, 3, 1);
}

function drawArtillery(ctx: CanvasRenderingContext2D, color: string, flak: boolean): void {
  ctx.fillStyle = CHARCOAL;
  ctx.fillRect(-8, -6, 5, 6);
  ctx.fillRect(3, -6, 5, 6);
  ctx.fillStyle = STEEL;
  ctx.fillRect(-7, -5, 3, 4);
  ctx.fillRect(4, -5, 3, 4);
  ctx.fillStyle = BROWN;
  ctx.fillRect(-14, -4, 7, 2);
  ctx.fillStyle = TAUPE;
  ctx.fillRect(-6, -8, 14, 4);
  ctx.fillStyle = color;
  if (flak) {
    ctx.fillRect(1, -18, 3, 11);
    ctx.fillStyle = CHARCOAL;
    ctx.fillRect(0, -18, 5, 2);
  } else {
    ctx.fillRect(-2, -11, 16, 3);
    ctx.fillStyle = CHARCOAL;
    ctx.fillRect(12, -11, 4, 3);
  }
  ctx.fillStyle = color;
  ctx.fillRect(-12, -16, 5, 3);
  ctx.fillStyle = CREAM;
  ctx.fillRect(-11, -13, 3, 3);
  ctx.fillStyle = TAUPE;
  ctx.fillRect(-12, -10, 4, 4);
}

function drawArmor(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.fillStyle = CHARCOAL;
  ctx.fillRect(-14, -7, 28, 7);
  ctx.fillStyle = STEEL;
  for (let i = -10; i <= 10; i += 5) {
    ctx.fillRect(i, -6, 3, 5);
  }
  ctx.fillStyle = TAUPE;
  ctx.fillRect(-13, -11, 26, 5);
  ctx.fillStyle = color;
  ctx.fillRect(-11, -15, 22, 5);
  ctx.fillRect(-2, -20, 12, 6);
  ctx.fillStyle = CHARCOAL;
  ctx.fillRect(8, -18, 10, 2);
  ctx.fillStyle = TAUPE;
  ctx.fillRect(0, -22, 4, 3);
}

function drawFighter(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.fillStyle = TAUPE;
  ctx.fillRect(-8, -2, 14, 2);
  ctx.fillStyle = color;
  ctx.fillRect(-7, -5, 12, 3);
  ctx.fillRect(-11, -8, 20, 4);
  ctx.fillStyle = BRASS;
  ctx.fillRect(9, -7, 3, 3);
  ctx.fillStyle = color;
  ctx.fillRect(-13, -12, 4, 5);
  ctx.fillStyle = SPRUCE;
  ctx.fillRect(-3, -10, 6, 3);
  ctx.fillStyle = CREAM;
  ctx.fillRect(12, -10, 1, 6);
}

function drawBomber(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.fillStyle = TAUPE;
  ctx.fillRect(-12, -2, 22, 2);
  ctx.fillStyle = color;
  ctx.fillRect(-14, -6, 26, 4);
  ctx.fillRect(-6, -9, 16, 3);
  ctx.fillRect(-16, -11, 5, 6);
  ctx.fillStyle = SPRUCE;
  ctx.fillRect(-2, -10, 7, 3);
  ctx.fillStyle = CHARCOAL;
  ctx.fillRect(-8, -4, 3, 2);
  ctx.fillRect(6, -4, 3, 2);
}

function drawWarship(ctx: CanvasRenderingContext2D, color: string, unitType: string): void {
  const sub = unitType === "submarine";
  const carrier = unitType === "carrier";
  const hull = unitType === "battleship" ? 32 : sub ? 22 : 28;
  const left = -hull / 2;
  ctx.fillStyle = sub ? STEEL : color;
  ctx.fillRect(left, -5, hull, 5);
  ctx.fillStyle = CHARCOAL;
  ctx.fillRect(left, -2, hull, 2);
  if (sub) {
    ctx.fillStyle = STEEL;
    ctx.fillRect(-3, -9, 6, 4);
    return;
  }
  if (carrier || unitType === "transport") {
    ctx.fillStyle = TAUPE;
    ctx.fillRect(left + 2, -8, hull - 4, 3);
    if (carrier) {
      ctx.fillStyle = color;
      ctx.fillRect(4, -13, 5, 5);
    }
    return;
  }
  ctx.fillStyle = TAUPE;
  ctx.fillRect(-4, -11, 10, 6);
  ctx.fillStyle = CHARCOAL;
  ctx.fillRect(0, -15, 3, 4);
  ctx.fillStyle = STEEL;
  ctx.fillRect(6, -8, 6, 2);
  if (unitType === "battleship") {
    ctx.fillRect(-12, -8, 6, 2);
  }
}

function drawUprightBody(ctx: CanvasRenderingContext2D, unitType: string, color: string): void {
  switch (unitType) {
    case "artillery":
      drawArtillery(ctx, color, false);
      return;
    case "aaa":
      drawArtillery(ctx, color, true);
      return;
    case "tank":
      drawArmor(ctx, color);
      return;
    case "fighter":
      drawFighter(ctx, color);
      return;
    case "tactical_bomber":
    case "strategic_bomber":
      drawBomber(ctx, color);
      return;
    case "submarine":
    case "destroyer":
    case "cruiser":
    case "battleship":
    case "carrier":
    case "transport":
      drawWarship(ctx, color, unitType);
      return;
    default:
      drawInfantry(ctx, color);
  }
}

/** Foreshortened baseplate, then the upright sprite standing on its centre. */
export function drawUprightStack(ctx: CanvasRenderingContext2D, paint: UprightPaint): void {
  const radius = paint.tokenPx / 2;
  const rx = radius * 1.15;
  const ry = Math.max(2, radius * 0.65);
  const { x, y } = paint;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = MILITARY.charcoal;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x, y - ry * 0.08, rx * 0.78, ry * 0.62, 0, 0, Math.PI * 2);
  ctx.fillStyle = factionPalette(paint.factionId).primary;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = GOLD;
  ctx.stroke();

  const color = factionPalette(paint.factionId).primary;
  withCrisp(ctx, paint.dpr, (at) => {
    const figures = squadOffsets(paint.count).slice().sort((a, b) => a.y - b.y);
    for (const off of figures) {
      ctx.save();
      ctx.translate(at(x + off.x), at(y + off.y));
      drawUprightBody(ctx, paint.unitType, color);
      ctx.restore();
    }
    if (paint.count > 1) {
      drawHardwareBadge(ctx, `[${paint.count}]`, at(x + rx * 0.4), at(y + ry * 0.2), GOLD_NUM);
    }
    if (paint.fuel != null) {
      drawHardwareBadge(ctx, String(paint.fuel), at(x - rx - 4) - 20, at(y) - 6, paint.active ? TEAL_NUM : GOLD_NUM);
    }
  });

  if (paint.loaded) {
    const s = Math.max(3, Math.round(radius * 0.28));
    ctx.fillStyle = GOLD;
    ctx.fillRect(Math.round(x - rx * 0.55), Math.round(y - ry * 0.2), s, s);
  }
  if (paint.selected || paint.unmoved) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx + 3, ry + 2.5, 0, 0, Math.PI * 2);
    ctx.lineWidth = paint.selected ? 2.5 : 1.5;
    ctx.strokeStyle = paint.selected ? SELECTED_COLOR : "rgba(221, 207, 153, 0.9)";
    ctx.setLineDash(paint.selected ? [] : [4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}
