// Figure-ground separation for upright units. The palette stays the 16-colour strip.
// A 1px ink outline stops a red hull melting into red land, and bright top planes shift toward parchment.

/** 1px silhouette ink. */
export const SPRITE_OUTLINE = "#1A1614";
/** Top-plane pixels at or above this luma shift toward parchment. Midtones stay faction-coloured. */
export const HIGHLIGHT_LUMA = 0.65;

const CREAM = [0xdd, 0xcf, 0x99] as const;
const CHARCOAL = [0x4b, 0x3d, 0x44] as const;
const OUTLINE = [0x1a, 0x16, 0x14] as const;

/** Rec.709 weights on straight 0–255 channels. This is the sprite recolor curve's L. */
export function spriteLuma(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Move a highlight toward cream. A midtone or shadow is returned unchanged. */
export function liftHighlightPixel(r: number, g: number, b: number): [number, number, number] {
  const luma = spriteLuma(r, g, b);
  if (luma <= HIGHLIGHT_LUMA) {
    return [r, g, b];
  }
  const amount = Math.min(1, (luma - HIGHLIGHT_LUMA) / (1 - HIGHLIGHT_LUMA)) * 0.7;
  return [
    Math.round(r + (CREAM[0] - r) * amount),
    Math.round(g + (CREAM[1] - g) * amount),
    Math.round(b + (CREAM[2] - b) * amount),
  ];
}

/**
 * Lift highlight pixels, then paint a 1px outline on every transparent pixel that touches
 * an opaque pixel on a 4-neighbor (no diagonals). The source silhouette is not overwritten.
 */
export function separateFigure(data: Uint8ClampedArray, width: number, height: number): void {
  const count = width * height;
  const alpha = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const offset = i * 4;
    alpha[i] = data[offset + 3];
    if (data[offset + 3] > 16) {
      const [r, g, b] = liftHighlightPixel(data[offset], data[offset + 1], data[offset + 2]);
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
    }
  }
  const opaque = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return false;
    }
    return alpha[y * width + x] > 16;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (opaque(x, y)) {
        continue;
      }
      if (opaque(x - 1, y) || opaque(x + 1, y) || opaque(x, y - 1) || opaque(x, y + 1)) {
        const offset = (y * width + x) * 4;
        data[offset] = OUTLINE[0];
        data[offset + 1] = OUTLINE[1];
        data[offset + 2] = OUTLINE[2];
        data[offset + 3] = 255;
      }
    }
  }
}

function hexByte(n: number): string {
  return Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
}

function channels(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * The territory interior, pulled 20% toward charcoal so a unit of the same faction sits in front of it.
 * The 16 palette entries are unchanged; this is only the fill mixed from two of them.
 */
export function sunkTerritoryFill(hex: string): string {
  const [r, g, b] = channels(hex);
  const t = 0.2;
  const mix = (channel: number, ink: number) => Math.round(channel + (ink - channel) * t);
  return `#${hexByte(mix(r, CHARCOAL[0]))}${hexByte(mix(g, CHARCOAL[1]))}${hexByte(mix(b, CHARCOAL[2]))}`;
}

/** Feet of an upright figure, in the bake canvas. One pixel of padding remains for the outline. */
export const SPRITE_BAKE = { width: 80, height: 56, originX: 40, originY: 52 } as const;

/**
 * Draw one voxel figure into an OffscreenCanvas, then apply the highlight lift and the ink outline.
 * Returns null where OffscreenCanvas is unavailable, so the caller paints the figure directly.
 */
export function bakeUnitSprite(
  face: 1 | -1,
  draw: (ctx: CanvasRenderingContext2D) => void,
): CanvasImageSource | null {
  if (typeof OffscreenCanvas === "undefined") {
    return null;
  }
  const { width, height, originX, originY } = SPRITE_BAKE;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return null;
  }
  ctx.imageSmoothingEnabled = false;
  ctx.save();
  ctx.translate(originX, originY);
  if (face < 0) {
    ctx.scale(-1, 1);
  }
  draw(ctx as unknown as CanvasRenderingContext2D);
  ctx.restore();
  const image = ctx.getImageData(0, 0, width, height);
  separateFigure(image.data, width, height);
  ctx.putImageData(image, 0, 0);
  return canvas;
}
