import { projectionScales, type View } from "./viewMath";

/** A ship fades its inland part once more than this share of the picture is on land. */
export const SEA_LAND_SHARE = 0.4;
/** Opacity of the part that sits on land. The part over water stays solid. */
export const SEA_LAND_ALPHA = 0.3;

export interface SpriteBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The picture's rectangle in the same pixels as its feet. Facing mirrors around the feet. */
export function spriteScreenBox(
  feetX: number,
  feetY: number,
  width: number,
  height: number,
  feetSpriteX: number,
  feetSpriteY: number,
  scale: number,
  face: 1 | -1,
): SpriteBox {
  const x0 = feetX + face * -feetSpriteX * scale;
  const x1 = feetX + face * (-feetSpriteX + width) * scale;
  const y0 = feetY - feetSpriteY * scale;
  const y1 = feetY + (-feetSpriteY + height) * scale;
  const left = Math.min(x0, x1);
  const top = Math.min(y0, y1);
  return { left, top, width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
}

/** Share of a grid inside `box` for which `onLand` is true. */
export function landShareOf(
  box: SpriteBox,
  columns: number,
  rows: number,
  onLand: (x: number, y: number) => boolean,
): number {
  const cols = Math.max(1, Math.floor(columns));
  const rowCount = Math.max(1, Math.floor(rows));
  if (box.width <= 0 || box.height <= 0) {
    return 0;
  }
  let land = 0;
  const total = cols * rowCount;
  for (let row = 0; row < rowCount; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = box.left + ((col + 0.5) / cols) * box.width;
      const y = box.top + ((row + 0.5) / rowCount) * box.height;
      if (onLand(x, y)) {
        land += 1;
      }
    }
  }
  return land / total;
}

/** Opacity for the inland part, or null when the picture is not far enough onto land to fade. */
export function seaLandOpacity(share: number): number | null {
  if (!(share > SEA_LAND_SHARE)) {
    return null;
  }
  return SEA_LAND_ALPHA;
}

/**
 * Whether a ship fades its inland part. It does once more than SEA_LAND_SHARE of its picture is on land,
 * with exceptions that keep it solid. A cliff that only ends at the ship does not fade it: if the land
 * along the hull reaches in from one end alone, three columns of eight or fewer, and the far end is
 * clear water, the ship is lying off the edge of a cliff and not running along it. Land only behind
 * the masts, with the hull on water, does not fade it either.
 */
export function shouldFadeAtShore(
  box: SpriteBox,
  onLand: (x: number, y: number) => boolean,
  columns = 8,
  rows = 5,
): boolean {
  const cols = Math.max(1, Math.floor(columns));
  const rowCount = Math.max(1, Math.floor(rows));
  if (box.width <= 0 || box.height <= 0) {
    return false;
  }
  // The hull is the lower part of the picture: the masts and the funnels stand above it, and land behind
  // them is a hill, not the shore. The edge of a cliff is judged along the hull.
  const hullFrom = Math.floor(rowCount * 0.4);
  const hullRows = rowCount - hullFrom;
  const colLand: number[] = [];
  let land = 0;
  for (let col = 0; col < cols; col += 1) {
    let inHull = 0;
    for (let row = 0; row < rowCount; row += 1) {
      const x = box.left + ((col + 0.5) / cols) * box.width;
      const y = box.top + ((row + 0.5) / rowCount) * box.height;
      if (onLand(x, y)) {
        land += 1;
        if (row >= hullFrom) {
          inHull += 1;
        }
      }
    }
    colLand.push(inHull / hullRows);
  }
  if (!(land / (cols * rowCount) > SEA_LAND_SHARE)) {
    return false;
  }
  // A column is land along the hull when at least two fifths of it is.
  const isLand = colLand.map((share) => share >= 0.4);
  const landColumns = isLand.filter(Boolean).length;
  if (landColumns === 0) {
    // Land only behind the masts: the hull is on water, so the ship stays solid.
    return colLand.some((share) => share > 0.1);
  }
  let fromStart = 0;
  while (fromStart < cols && isLand[fromStart]) {
    fromStart += 1;
  }
  let fromEnd = 0;
  while (fromEnd < cols && isLand[cols - 1 - fromEnd]) {
    fromEnd += 1;
  }
  const edgeCap = Math.ceil(cols * 0.375);
  const atOneEnd = landColumns === fromStart || landColumns === fromEnd;
  if (atOneEnd && landColumns <= edgeCap) {
    const far = landColumns === fromStart ? colLand.slice(cols - edgeCap) : colLand.slice(0, edgeCap);
    const farLand = far.reduce((sum, share) => sum + share, 0) / far.length;
    if (farLand <= 0.1) {
      return false;
    }
  }
  return true;
}

/** World units to screen pixels, including one wrapped copy shifted by `copyDx`. */
export function landScreenTransform(view: View, copyDx: number): string {
  const { sx, sy } = projectionScales(view.k);
  const e = -(view.x - copyDx) * sx;
  const f = -view.y * sy;
  return `matrix(${sx} 0 0 ${sy} ${e} ${f})`;
}
