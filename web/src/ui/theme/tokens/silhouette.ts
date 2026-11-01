// Pure pixel logic for turning the supplied token art into a recolourable silhouette mask.
//
// Each source PNG is three flat colours on a transparent background: dark ink (silhouette and letter),
// a mid-tone ring and a near-white fill, with anti-aliased edges. We keep only the ink, as alpha, and
// let the renderer redraw ring and fill in the owning faction's colours. No DOM here.

export interface ArtColors {
  ink: number; // luma 0-255
  ring: number;
  fill: number;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number; // exclusive
  y1: number; // exclusive
}

export function lumaOf(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** The three dominant opaque colours, ordered dark -> light as ink, ring, fill. Null when the art is not that shape. */
export function detectArtColors(data: ArrayLike<number>): ArtColors | null {
  const counts = new Map<number, number>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] !== 255) continue;
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (top.length < 3) return null;
  const lumas = top
    .map(([key]) => lumaOf((key >> 16) & 255, (key >> 8) & 255, key & 255))
    .sort((a, b) => a - b);
  return { ink: lumas[0], ring: lumas[1], fill: lumas[2] };
}

/**
 * RGBA output with black rgb and alpha = silhouette coverage. A pixel is ink when it is darker than the
 * ring; ring-to-ink is a linear ramp so anti-aliased edges stay smooth. Fill and ring pixels drop out.
 */
export function extractSilhouetteAlpha(data: ArrayLike<number>, colors: ArtColors): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data.length);
  // Guard against a ring so close to the ink that the ramp degenerates.
  const ringLuma = colors.ring - colors.ink >= 24 ? colors.ring : (colors.ink + colors.fill) / 2;
  const span = Math.max(1, ringLuma - colors.ink);
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha === 0) continue;
    const luma = lumaOf(data[i], data[i + 1], data[i + 2]);
    const cover = Math.min(1, Math.max(0, (ringLuma - luma) / span));
    out[i + 3] = Math.round(alpha * cover);
  }
  return out;
}

/** Share of pixels in `rect` whose alpha is at least half. */
export function coverageFraction(rgba: ArrayLike<number>, width: number, height: number, rect: Rect): number {
  const x0 = Math.max(0, Math.floor(rect.x0));
  const y0 = Math.max(0, Math.floor(rect.y0));
  const x1 = Math.min(width, Math.ceil(rect.x1));
  const y1 = Math.min(height, Math.ceil(rect.y1));
  let total = 0;
  let covered = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      total++;
      if (rgba[(y * width + x) * 4 + 3] >= 128) covered++;
    }
  }
  return total === 0 ? 0 : covered / total;
}
