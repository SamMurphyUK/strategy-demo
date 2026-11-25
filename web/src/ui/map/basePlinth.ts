// The turned base a standing figure is mounted on, the way a tabletop miniature is: a dark wood
// disc with a bevelled rim, a thin metal ring let into it, and the faction's colour in the middle.
//
// It is drawn with flat fills and strokes only, seen from the board's angle as an ellipse. The
// numbers come from the map's visual settings (see mapVisualConfig.ts), already worked out as a
// PlinthLook, so this file knows nothing of the store.
import { MILITARY } from "../theme/militaryPalette";
import type { PlinthLook } from "./mapVisualConfig";

export interface PlinthShape {
  /** Centre of the base's top face, and its radii across and down the screen, in CSS pixels. */
  x: number;
  y: number;
  rx: number;
  ry: number;
  /** The faction's colour, as #RRGGBB. */
  color: string;
}

type PlinthContext = Pick<CanvasRenderingContext2D, "save" | "restore" | "beginPath" | "ellipse" | "fill" | "stroke"> & {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  globalAlpha: number;
  lineCap?: CanvasLineCap;
};

function channels(hex: string): [number, number, number] {
  return [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16)];
}

/** A colour between two, as #RRGGBB. */
export function mixHex(a: string, b: string, t: number): string {
  const from = channels(a);
  const to = channels(b);
  const share = Math.min(1, Math.max(0, t));
  return `#${from
    .map((value, i) =>
      Math.round(value + (to[i] - value) * share)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`.toUpperCase();
}

/** Ebony for the wall of the disc, walnut for its top, and the pale edge a bevel catches. */
export const PLINTH_EBONY = mixHex(MILITARY.charcoal, "#000000", 0.42);
export const PLINTH_WALNUT = mixHex(MILITARY.charcoal, MILITARY.brown, 0.22);
export const PLINTH_BEVEL = mixHex(MILITARY.brown, MILITARY.tan, 0.35);
/** The pale line round a base's outer and inner rim. Light enough to part it from dark ground. */
export const PLINTH_EDGE = mixHex(PLINTH_BEVEL, MILITARY.cream, 0.45);
export const PLINTH_BRASS =mixHex(MILITARY.brass, MILITARY.cream, 0.18);

/** The colour of the inner ring: the faction's own at 0, brass at 1. */
export function plinthRingColor(faction: string, brass: number): string {
  return mixHex(mixHex(faction, MILITARY.cream, 0.3), PLINTH_BRASS, brass);
}

export interface PlinthParts {
  /** How far the wall shows below the top face. */
  wall: number;
  /** Radii of the brass ring's outer edge, and of the faction field inside it. */
  ring: { rx: number; ry: number };
  field: { rx: number; ry: number };
}

/** The sizes of a plinth's parts. The ring is a hair wide and never under a pixel. */
export function plinthParts(shape: PlinthShape, look: PlinthLook): PlinthParts {
  const rim = Math.min(0.6, Math.max(0, look.rim));
  const ring = { rx: shape.rx * (1 - rim), ry: shape.ry * (1 - rim) };
  const band = Math.max(1, shape.rx * 0.07);
  return {
    wall: Math.min(3, Math.max(1, shape.ry * 0.22)),
    ring,
    field: { rx: Math.max(0.5, ring.rx - band), ry: Math.max(0.5, ring.ry - band * (shape.ry / Math.max(shape.rx, 1e-6))) },
  };
}

/**
 * The mark under a ship, in place of a base: a faint wash of the faction's colour and a ring, flat on
 * the water. A ship sits in the sea, not on a plinth, so it has no wall, no wood, and no brass.
 */
export function drawWaterlineRing(ctx: PlinthContext, shape: PlinthShape): void {
  const { x, y, rx, ry } = shape;
  const full = Math.PI * 2;
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, full);
  ctx.fillStyle = shape.color;
  ctx.fill();
  ctx.globalAlpha = 0.62;
  ctx.lineWidth = Math.max(1.5, rx * 0.06);
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, full);
  ctx.strokeStyle = shape.color;
  ctx.stroke();
  ctx.globalAlpha = 0.34;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(x, y, rx * 0.86, ry * 0.86, 0, 0, full);
  ctx.strokeStyle = PLINTH_EDGE;
  ctx.stroke();
  ctx.restore();
}

/** Draws the base. The figure is drawn after it, standing on its centre. */
export function drawBasePlinth(ctx: PlinthContext, look: PlinthLook, shape: PlinthShape): void {
  const { x, y, rx, ry } = shape;
  const parts = plinthParts(shape, look);
  const full = Math.PI * 2;
  ctx.save();
  // A soft contact shadow: two dark ellipses, wide and faint then close and firmer, so the base sits on the ground.
  ctx.fillStyle = "#000000";
  ctx.globalAlpha = 0.14;
  ctx.beginPath();
  ctx.ellipse(x, y + parts.wall + ry * 0.2, rx * 1.28, ry * 1.4, 0, 0, full);
  ctx.fill();
  ctx.globalAlpha = 0.22;
  ctx.beginPath();
  ctx.ellipse(x, y + parts.wall + ry * 0.1, rx * 1.12, ry * 1.18, 0, 0, full);
  ctx.fill();
  ctx.globalAlpha = 1;
  // The wall of the disc, seen below its top face.
  ctx.beginPath();
  ctx.ellipse(x, y + parts.wall, rx, ry, 0, 0, full);
  ctx.fillStyle = PLINTH_EBONY;
  ctx.fill();
  // The top face: walnut out to the edge.
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, full);
  ctx.fillStyle = PLINTH_WALNUT;
  ctx.fill();
  // The bevel: the near edge of the top catches the light, the far edge falls away dark.
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.5, rx - 0.5), Math.max(0.5, ry - 0.5), 0, 0.12 * Math.PI, 0.88 * Math.PI);
  ctx.strokeStyle = PLINTH_BEVEL;
  ctx.globalAlpha = 0.55;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.5, rx - 0.5), Math.max(0.5, ry - 0.5), 0, 1.12 * Math.PI, 1.88 * Math.PI);
  ctx.strokeStyle = PLINTH_EBONY;
  ctx.globalAlpha = 0.7;
  ctx.stroke();
  ctx.globalAlpha = 1;
  // A light edge all the way round the outside, so the dark base parts from dark ground.
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, full);
  ctx.strokeStyle = PLINTH_EDGE;
  ctx.globalAlpha = 0.85;
  ctx.stroke();
  ctx.globalAlpha = 1;
  // The faction's ring, just inside the rim.
  const band = Math.max(1, rx * 0.07);
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.5, (rx + parts.ring.rx) / 2), Math.max(0.5, (ry + parts.ring.ry) / 2), 0, 0, full);
  ctx.lineWidth = band;
  ctx.strokeStyle = shape.color;
  ctx.stroke();
  // The ring let into the wood, and the faction's colour inside it.
  ctx.beginPath();
  ctx.ellipse(x, y, parts.ring.rx, parts.ring.ry, 0, 0, full);
  ctx.fillStyle = plinthRingColor(shape.color, look.brass);
  ctx.fill();
  // A light line round the inside of the ring where it meets the field.
  ctx.beginPath();
  ctx.ellipse(x, y, parts.ring.rx, parts.ring.ry, 0, 0, full);
  ctx.lineWidth = 1;
  ctx.strokeStyle = PLINTH_EDGE;
  ctx.globalAlpha = 0.6;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.ellipse(x, y, parts.field.rx, parts.field.ry, 0, 0, full);
  ctx.fillStyle = shape.color;
  ctx.fill();
  // Satin: one soft highlight along the rim on the side the lamp is, tighter and brighter as the finish gets glossier.
  if (look.sheen > 0.01) {
    const mid = (rx + parts.ring.rx) / 2;
    const midY = (ry + parts.ring.ry) / 2;
    const centre = 1.3 * Math.PI;
    ctx.beginPath();
    ctx.ellipse(x, y, mid, midY, 0, centre - look.sheenArc / 2, centre + look.sheenArc / 2);
    ctx.lineWidth = Math.max(1, (rx - parts.ring.rx) * 0.45);
    ctx.lineCap = "round";
    ctx.strokeStyle = MILITARY.cream;
    ctx.globalAlpha = look.sheen;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}
