import { MILITARY } from "../ui/theme/militaryPalette";
import { frameRgba, LAYER_ORDER, type SpriteFrame } from "./frameClips";
import { GEN_KEY } from "./partGen";
import type { PartCategory } from "./paperDoll";

/** Four columns, the same count as the walk sheet. A shorter clip stays on one row. */
export const PURPLE_COLUMNS = 4;
/** Magenta between the frames and the colour row, so the row is not part of a cell. */
export const PURPLE_GAP = 8;
/** One side of a colour in the row under the frames. */
export const PURPLE_SWATCH = 8;

/** The 16 colours, in palette order. The row under the frames. */
export const PURPLE_PALETTE: readonly string[] = Object.values(MILITARY);

export interface PurpleSheet {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  columns: number;
  rows: number;
}

/** How many columns and rows a clip of this length uses. */
export function purpleSheetGrid(count: number): { columns: number; rows: number } {
  const columns = Math.min(PURPLE_COLUMNS, Math.max(1, count));
  const rows = Math.max(1, Math.ceil(Math.max(count, 1) / columns));
  return { columns, rows };
}

/**
 * One clip as a magenta sheet. Empty pixels are the generator key colour.
 * `layers` are the only parts painted; the rest of each frame stays magenta.
 * Movement is already in the frames. Flash is drawn only when `flash` is set.
 * The 16 colours sit in a row under the grid.
 */
export function purpleSheet(
  frames: readonly SpriteFrame[],
  layers: readonly PartCategory[],
  lut: readonly string[],
  options?: { flash?: boolean },
): PurpleSheet {
  const first = frames[0];
  if (!first) {
    throw new Error("This clip has no frames.");
  }
  if (frames.some((item) => item.width !== first.width || item.height !== first.height)) {
    throw new Error("Every frame on the purple sheet has to be the same size.");
  }
  const { columns, rows } = purpleSheetGrid(frames.length);
  const gridW = columns * first.width;
  const gridH = rows * first.height;
  const width = Math.max(gridW, PURPLE_PALETTE.length * PURPLE_SWATCH);
  const height = gridH + PURPLE_GAP + PURPLE_SWATCH;
  const rgba = new Uint8ClampedArray(width * height * 4);
  fillKey(rgba);
  const flash = options?.flash === true;
  frames.forEach((item, at) => {
    const painted = frameRgba(onlyLayers(item, layers, flash), lut);
    blitOpaque(rgba, width, painted, item.width, item.height, (at % columns) * item.width, Math.floor(at / columns) * item.height);
  });
  paintPalette(rgba, width, gridH + PURPLE_GAP);
  return { rgba, width, height, columns, rows };
}

function onlyLayers(frame: SpriteFrame, layers: readonly PartCategory[], flash: boolean): SpriteFrame {
  const empty = new Array<number>(frame.width * frame.height).fill(0);
  const next = {
    legs: empty.slice(),
    torso: empty.slice(),
    head: empty.slice(),
    weapon: empty.slice(),
  };
  for (const layer of layers) {
    if (LAYER_ORDER.includes(layer)) {
      next[layer] = frame.layers[layer] ?? empty;
    }
  }
  return {
    ...frame,
    layers: next,
    flash: flash && frame.flash,
    muzzle: flash ? frame.muzzle : null,
    muzzles: flash ? frame.muzzles : undefined,
  };
}

function fillKey(rgba: Uint8ClampedArray): void {
  for (let index = 0; index < rgba.length; index += 4) {
    rgba[index] = GEN_KEY[0];
    rgba[index + 1] = GEN_KEY[1];
    rgba[index + 2] = GEN_KEY[2];
    rgba[index + 3] = 255;
  }
}

function blitOpaque(
  dest: Uint8ClampedArray,
  destWidth: number,
  src: Uint8ClampedArray,
  srcWidth: number,
  srcHeight: number,
  originX: number,
  originY: number,
): void {
  for (let y = 0; y < srcHeight; y += 1) {
    for (let x = 0; x < srcWidth; x += 1) {
      const from = (y * srcWidth + x) * 4;
      if ((src[from + 3] ?? 0) === 0) {
        continue;
      }
      const to = ((originY + y) * destWidth + originX + x) * 4;
      dest[to] = src[from] ?? 0;
      dest[to + 1] = src[from + 1] ?? 0;
      dest[to + 2] = src[from + 2] ?? 0;
      dest[to + 3] = 255;
    }
  }
}

function paintPalette(rgba: Uint8ClampedArray, width: number, originY: number): void {
  PURPLE_PALETTE.forEach((hex, at) => {
    const rgb = Number.parseInt(hex.slice(1, 7), 16);
    const r = (rgb >> 16) & 255;
    const g = (rgb >> 8) & 255;
    const b = rgb & 255;
    for (let y = 0; y < PURPLE_SWATCH; y += 1) {
      for (let x = 0; x < PURPLE_SWATCH; x += 1) {
        const to = ((originY + y) * width + at * PURPLE_SWATCH + x) * 4;
        rgba[to] = r;
        rgba[to + 1] = g;
        rgba[to + 2] = b;
        rgba[to + 3] = 255;
      }
    }
  });
}
