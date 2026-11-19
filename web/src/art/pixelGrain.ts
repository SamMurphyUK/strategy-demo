import type { MotionShifts } from "./skeletonSchema";

/**
 * One art pixel of a plate is one pixel of the battle board and of the motion-test lane.
 * The vector landscape is not scaled to match the plate.
 */
export const PLATE_DRAW_SCALE = 1 as const;

/** How far a repeated Retro Diffusion block may miss the grid before it is left alone. */
const ALIGNMENT = 0.92;

/** Largest block first, so a 4× plate collapses all the way to one art pixel. */
const BLOCK_CANDIDATES = [4, 3, 2] as const;

export type GrainOverride = "auto" | 1 | 2 | 3;

export interface RgbaImage {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface EdgeHits {
  total: number;
  aligned: number;
}

/** The override the import selector is holding. Auto keeps whatever the picture itself shows. */
export function resolveGrainBlock(detected: number, override: GrainOverride): number {
  return override === "auto" ? detected : override;
}

/** The Auto option, once a picture has been measured. */
export function autoGrainLabel(detected: number | null): string {
  if (detected == null) {
    return "Auto";
  }
  if (detected <= 1) {
    return "Auto (1×)";
  }
  return `Auto (${detected}× -> 1×)`;
}

function opaque(rgba: Uint8ClampedArray, offset: number): boolean {
  return (rgba[offset + 3] ?? 0) >= 128;
}

function samePixel(rgba: Uint8ClampedArray, a: number, b: number): boolean {
  return rgba[a] === rgba[b] && rgba[a + 1] === rgba[b + 1] && rgba[a + 2] === rgba[b + 2] && rgba[a + 3] === rgba[b + 3];
}

function trimmedBounds(rgba: Uint8ClampedArray, width: number, height: number): Bounds | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!opaque(rgba, (y * width + x) * 4)) {
        continue;
      }
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < minX ? null : { minX, minY, maxX, maxY };
}

function edgeHits(rgba: Uint8ClampedArray, width: number, bounds: Bounds, block: number, axis: "x" | "y"): EdgeHits {
  let total = 0;
  let aligned = 0;
  if (axis === "x") {
    for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
      for (let x = bounds.minX; x < bounds.maxX; x += 1) {
        const left = (y * width + x) * 4;
        if (samePixel(rgba, left, left + 4)) {
          continue;
        }
        total += 1;
        if ((x + 1) % block === 0) {
          aligned += 1;
        }
      }
    }
    return { total, aligned };
  }
  for (let y = bounds.minY; y < bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const above = (y * width + x) * 4;
      if (samePixel(rgba, above, above + width * 4)) {
        continue;
      }
      total += 1;
      if ((y + 1) % block === 0) {
        aligned += 1;
      }
    }
  }
  return { total, aligned };
}

function onGrid(hits: EdgeHits): boolean {
  return hits.total === 0 || hits.aligned / hits.total >= ALIGNMENT;
}

/**
 * The repeated block in a Retro Diffusion plate, or 1 when the picture is already one art pixel per pixel.
 * A candidate k from 4 down to 2 wins when the trimmed ink is a whole number of blocks, the ink starts on
 * that grid, and at least 92% of the colour changes sit on the block edges.
 */
export function detectPixelBlockSize(rgbaData: Uint8ClampedArray, width: number, height: number): number {
  if (width < 2 || height < 2 || rgbaData.length !== width * height * 4) {
    return 1;
  }
  const bounds = trimmedBounds(rgbaData, width, height);
  if (!bounds) {
    return 1;
  }
  const inkW = bounds.maxX - bounds.minX + 1;
  const inkH = bounds.maxY - bounds.minY + 1;
  for (const block of BLOCK_CANDIDATES) {
    if (inkW % block !== 0 || inkH % block !== 0 || bounds.minX % block !== 0 || bounds.minY % block !== 0) {
      continue;
    }
    const horizontal = edgeHits(rgbaData, width, bounds, block, "x");
    const vertical = edgeHits(rgbaData, width, bounds, block, "y");
    if (horizontal.total + vertical.total === 0) {
      continue;
    }
    if (onGrid(horizontal) && onGrid(vertical)) {
      return block;
    }
  }
  return 1;
}

/**
 * The pixel a block stands for. An odd block uses its center. An even block uses its top-left pixel,
 * which is the same colour as the center when the block is one repeated art pixel.
 */
function artPixelOffset(blockSize: number): number {
  return Math.floor((blockSize - 1) / 2);
}

/**
 * Collapse each `blockSize` square to the one pixel it repeats. No averaging: the sample is copied.
 * A block of 1 returns the same buffer. A picture smaller than one block is returned as it is.
 */
export function deupscaleRgbaToArtPixels(rgbaData: Uint8ClampedArray, width: number, height: number, blockSize: number): RgbaImage {
  const block = Math.floor(blockSize);
  const outW = Math.floor(width / block);
  const outH = Math.floor(height / block);
  if (block <= 1 || outW < 1 || outH < 1) {
    return { rgba: rgbaData, width, height };
  }
  const offset = artPixelOffset(block);
  const rgba = new Uint8ClampedArray(outW * outH * 4);
  for (let y = 0; y < outH; y += 1) {
    for (let x = 0; x < outW; x += 1) {
      const src = ((y * block + offset) * width + (x * block + offset)) * 4;
      const dst = (y * outW + x) * 4;
      rgba[dst] = rgbaData[src] ?? 0;
      rgba[dst + 1] = rgbaData[src + 1] ?? 0;
      rgba[dst + 2] = rgbaData[src + 2] ?? 0;
      rgba[dst + 3] = rgbaData[src + 3] ?? 0;
    }
  }
  return { rgba, width: outW, height: outH };
}

/** Detect the block, unless one was chosen, and collapse it. `blockSize` on the result is the factor actually used. */
export function deupscaleToNativeArtPixels(
  rgbaData: Uint8ClampedArray,
  width: number,
  height: number,
  blockSize = detectPixelBlockSize(rgbaData, width, height),
): RgbaImage & { blockSize: number } {
  const scaled = deupscaleRgbaToArtPixels(rgbaData, width, height, blockSize);
  const applied = scaled.width === width && scaled.height === height ? 1 : Math.floor(blockSize);
  return { ...scaled, blockSize: applied };
}

/** The same collapse, for a layer grid. Each cell of the result is the sample cell of its block. */
export function deupscaleGrid<T>(grid: readonly (readonly T[])[], blockSize: number): T[][] {
  const block = Math.floor(blockSize);
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  const outH = Math.floor(height / block);
  const outW = Math.floor(width / block);
  if (block <= 1 || outW < 1 || outH < 1) {
    return grid.map((row) => row.slice());
  }
  const offset = artPixelOffset(block);
  const out: T[][] = [];
  for (let y = 0; y < outH; y += 1) {
    const source = grid[y * block + offset] ?? [];
    const row: T[] = [];
    for (let x = 0; x < outW; x += 1) {
      row.push(source[x * block + offset] as T);
    }
    out.push(row);
  }
  return out;
}

/** A canvas point, divided onto the art-pixel grid and kept inside the new canvas. */
export function scaleArtPoint(
  point: { x: number; y: number },
  blockSize: number,
  size: { width: number; height: number },
): { x: number; y: number } {
  const block = Math.max(1, Math.floor(blockSize));
  return {
    x: Math.min(Math.max(0, size.width - 1), Math.max(0, Math.floor(point.x / block))),
    y: Math.min(Math.max(0, size.height - 1), Math.max(0, Math.floor(point.y / block))),
  };
}

/** Bob, recoil, and tread, divided by the same block. Tread stays at least one art pixel. */
export function scaleArtShifts(shifts: MotionShifts, blockSize: number): MotionShifts {
  const block = Math.max(1, Math.floor(blockSize));
  const divide = (value: number, least: number) => Math.max(least, Math.round(value / block));
  return {
    bobPx: divide(shifts.bobPx, 0),
    recoilPx: divide(shifts.recoilPx, 0),
    treadStride: divide(shifts.treadStride, 1),
  };
}
