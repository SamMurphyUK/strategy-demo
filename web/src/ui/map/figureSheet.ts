// One picture for each clip frame, stamped for every figure that shows it.
//
// A figure on the zoomed map is a traced SVG file. As its own SVG node, the browser draws that
// file again for every man and every tank on every camera step. Here each file is drawn once, at
// the size the map shows it, and every figure of that kind is a copy of that picture.
import type { VehicleSvgUnit } from "../../art/fieldVehicleStage";

/** Where one figure's picture lands, in device pixels. */
export interface StampBox {
  left: number;
  top: number;
  w: number;
  h: number;
  /** The picture is flipped around the feet. */
  mirror: boolean;
}

/**
 * The picture's rectangle for a figure with its feet at `unit.x, unit.y` (CSS pixels).
 * Whole device pixels, so a copy keeps the traced edges sharp.
 */
export function figureStampBox(unit: VehicleSvgUnit, dpr: number): StampBox | null {
  const part = unit.parts[0];
  if (!part || !(unit.unitScale > 0) || !(dpr > 0)) {
    return null;
  }
  const scale = unit.unitScale * dpr;
  const w = Math.max(1, Math.round(part.width * scale));
  const h = Math.max(1, Math.round(part.height * scale));
  const feetX = Math.round(unit.x * dpr);
  const feetY = Math.round(unit.y * dpr);
  const dx = Math.round((unit.rootX + part.x) * scale);
  const dy = Math.round((unit.rootY + part.y) * scale);
  const mirror = (unit.face ?? 1) < 0;
  return { left: mirror ? feetX - dx - w : feetX + dx, top: feetY + dy, w, h, mirror };
}

/** The land, for fading the inland part of a ship. One entry in `copies` for each wrapped map on screen. */
export interface ShoreStencil {
  path: Path2D;
  /** Opacity of the inland part, 0–1. */
  alpha: number;
  /** World units to CSS pixels: x' = x * sx + e, y' = y * sy + f. */
  copies: { sx: number; sy: number; e: number; f: number }[];
}

interface Source {
  image: HTMLImageElement;
  ready: boolean;
  /** Sizes asked for before the file arrived, as "w|h". */
  wanted: Set<string>;
}

/** Enough for every faction, type, and frame at two sizes. Past it the sheet starts again. */
const PLATE_LIMIT = 1600;

const sources = new Map<string, Source>();
const plates = new Map<string, HTMLCanvasElement>();
/** The picture each figure showed last. It stays up while the next frame's file is on its way. */
let shown = new Map<string, HTMLCanvasElement>();
let dirty = false;
let scratch: HTMLCanvasElement | null = null;

function draw(source: Source, href: string, w: number, h: number): HTMLCanvasElement | null {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }
  ctx.drawImage(source.image, 0, 0, w, h);
  if (plates.size >= PLATE_LIMIT) {
    plates.clear();
  }
  plates.set(`${href}|${w}|${h}`, canvas);
  return canvas;
}

function plateFor(href: string, w: number, h: number): HTMLCanvasElement | null {
  const hit = plates.get(`${href}|${w}|${h}`);
  if (hit) {
    return hit;
  }
  let source = sources.get(href);
  if (!source) {
    const image = new Image();
    const made: Source = { image, ready: false, wanted: new Set() };
    source = made;
    sources.set(href, made);
    image.onload = () => {
      made.ready = true;
      for (const size of made.wanted) {
        const [width, height] = size.split("|").map(Number);
        draw(made, href, width, height);
      }
      made.wanted.clear();
      dirty = true;
    };
    image.onerror = () => {
      made.wanted.clear();
    };
    image.src = href;
  }
  if (source.ready) {
    return draw(source, href, w, h);
  }
  source.wanted.add(`${w}|${h}`);
  return null;
}

/** True once after a picture arrives that a figure was waiting for. The map redraws its figures then. */
export function takeFigureSheetDirty(): boolean {
  const was = dirty;
  dirty = false;
  return was;
}

/** A ship's picture with the part over land thinned to the stencil's opacity. */
function fadeInland(plate: HTMLCanvasElement, box: StampBox, shore: ShoreStencil, dpr: number): HTMLCanvasElement | null {
  if (!scratch) {
    scratch = document.createElement("canvas");
  }
  if (scratch.width < box.w || scratch.height < box.h) {
    scratch.width = Math.max(scratch.width, box.w);
    scratch.height = Math.max(scratch.height, box.h);
  }
  const ctx = scratch.getContext("2d");
  if (!ctx) {
    return null;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, scratch.width, scratch.height);
  ctx.imageSmoothingEnabled = false;
  if (box.mirror) {
    ctx.setTransform(-1, 0, 0, 1, box.w, 0);
  }
  ctx.drawImage(plate, 0, 0, box.w, box.h);
  ctx.globalCompositeOperation = "destination-out";
  ctx.globalAlpha = 1 - Math.min(1, Math.max(0, shore.alpha));
  ctx.fillStyle = "#000";
  for (const copy of shore.copies) {
    ctx.setTransform(copy.sx * dpr, 0, 0, copy.sy * dpr, copy.e * dpr - box.left, copy.f * dpr - box.top);
    ctx.fill(shore.path);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  return scratch;
}

/**
 * Draw every figure onto `ctx`, back to front in the order given. `ctx` is in device pixels and
 * its `globalAlpha` is kept, so the caller's fade applies.
 */
/** Puts the picture's top at the right height when `lean` shortens it toward the feet. */
function placeFigure(ctx: CanvasRenderingContext2D, box: StampBox, feetY: number, lean: number): void {
  const ty = feetY + (box.top - feetY) * lean;
  if (box.mirror) {
    ctx.setTransform(-1, 0, 0, lean, box.left + box.w, ty);
  } else {
    ctx.setTransform(1, 0, 0, lean, box.left, ty);
  }
}

/** One figure as `stampFigures` last drew it: its picture, and the rectangle it filled after the lean. */
export interface FigureStamp {
  id: string;
  plate: HTMLCanvasElement;
  /** Device pixels from the canvas's top-left corner. */
  left: number;
  top: number;
  w: number;
  h: number;
  feetX: number;
  feetY: number;
  mirror: boolean;
  opacity: number;
}

/**
 * The figures of `units` that the last `stampFigures` put on the canvas, back to front. A figure
 * whose picture has not arrived is not in the list. Call it with the same `dpr` and `lean`.
 */
export function shownFigureStamps(units: readonly VehicleSvgUnit[], dpr: number, lean = 1): FigureStamp[] {
  const out: FigureStamp[] = [];
  for (const unit of units) {
    const box = figureStampBox(unit, dpr);
    const part = unit.parts[0];
    const plate = shown.get(unit.id);
    if (!box || !part || !plate) {
      continue;
    }
    const feetY = Math.round(unit.y * dpr);
    out.push({
      id: unit.id,
      plate,
      left: box.left,
      top: feetY + (box.top - feetY) * lean,
      w: box.w,
      h: box.h * lean,
      feetX: Math.round(unit.x * dpr),
      feetY,
      mirror: box.mirror,
      opacity: part.opacity != null ? part.opacity : 1,
    });
  }
  return out;
}

export function stampFigures(
  ctx: CanvasRenderingContext2D,
  units: readonly VehicleSvgUnit[],
  dpr: number,
  shore: ShoreStencil | null,
  lean = 1,
): void {
  const next = new Map<string, HTMLCanvasElement>();
  const fade = ctx.globalAlpha;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  for (const unit of units) {
    const box = figureStampBox(unit, dpr);
    const part = unit.parts[0];
    if (!box || !part) {
      continue;
    }
    const plate = plateFor(part.href, box.w, box.h) ?? shown.get(unit.id) ?? null;
    if (!plate) {
      continue;
    }
    next.set(unit.id, plate);
    const feetY = Math.round(unit.y * dpr);
    ctx.globalAlpha = part.opacity != null && part.opacity < 1 ? fade * part.opacity : fade;
    if (unit.shoreFade && shore) {
      const faded = fadeInland(plate, box, shore, dpr);
      if (faded) {
        placeFigure(ctx, box, feetY, lean);
        ctx.drawImage(faded, 0, 0, box.w, box.h);
        continue;
      }
    }
    placeFigure(ctx, box, feetY, lean);
    ctx.drawImage(plate, 0, 0, box.w, box.h);
  }
  ctx.restore();
  ctx.globalAlpha = fade;
  shown = next;
}
