// The land as a grid of cells, drawn once and then read by index.
//
// A point-in-path test walks the whole coastline. That is right for a click, which happens once.
// A ship asks forty times on every draw whether its picture overlaps the shore, so those questions
// read this grid instead.
import type { Rect, Vec2 } from "./geometry";
import { isLandAt } from "./hitTest";
import type { MasterLand } from "./svgLandLoader";

/** Cells per world unit. A ship's overlap grid samples several screen pixels apart, so a third of a unit is ample. */
export const LAND_MASK_SCALE = 3;

export interface LandMask {
  /** One byte per cell, row by row. Non-zero is land. */
  cells: Uint8Array;
  columns: number;
  rows: number;
  /** The world rectangle the grid covers. */
  box: Rect;
}

/** Whether the cell under a world point is land. A point outside the grid is water. */
export function landMaskHit(mask: LandMask, p: Vec2): boolean {
  const column = Math.floor(((p.x - mask.box.x) / mask.box.w) * mask.columns);
  const row = Math.floor(((p.y - mask.box.y) / mask.box.h) * mask.rows);
  if (column < 0 || row < 0 || column >= mask.columns || row >= mask.rows) {
    return false;
  }
  return mask.cells[row * mask.columns + column] !== 0;
}

const masks = new WeakMap<MasterLand, LandMask | null>();

function buildLandMask(land: MasterLand): LandMask | null {
  const box = land.viewBox;
  const columns = Math.max(1, Math.round(box.w * LAND_MASK_SCALE));
  const rows = Math.max(1, Math.round(box.h * LAND_MASK_SCALE));
  const canvas = document.createElement("canvas");
  canvas.width = columns;
  canvas.height = rows;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return null;
  }
  ctx.setTransform(columns / box.w, 0, 0, rows / box.h, (-box.x * columns) / box.w, (-box.y * rows) / box.h);
  ctx.fillStyle = "#000";
  ctx.fill(land.masterLandPath);
  const pixels = ctx.getImageData(0, 0, columns, rows).data;
  const cells = new Uint8Array(columns * rows);
  for (let i = 0; i < cells.length; i += 1) {
    cells[i] = pixels[i * 4 + 3] >= 128 ? 1 : 0;
  }
  return { cells, columns, rows, box };
}

/**
 * Whether a world point is on land, to the nearest mask cell. For a picture's overlap with the shore.
 * A click or an editor check needs the exact coastline and uses `isLandAt`.
 */
export function landMaskAt(land: MasterLand, p: Vec2): boolean {
  let mask = masks.get(land);
  if (mask === undefined) {
    mask = buildLandMask(land);
    masks.set(land, mask);
  }
  return mask ? landMaskHit(mask, p) : isLandAt(land, p);
}
