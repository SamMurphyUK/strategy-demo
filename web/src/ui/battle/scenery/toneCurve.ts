// A tone curve for baked scenery. The 16 military colours sit in a narrow band of lightness
// (about 66 to 205 out of 255), so a field baked from them has little figure and ground.
// This runs once after the bake. It pushes the dark colours down, the light ones up, and tints
// the shadows cool and the highlights warm. Pure arithmetic on RGBA bytes: no canvas, no DOM.

export interface ToneOptions {
  /** 0 leaves the pixels alone, 1 applies the full curve. */
  strength: number;
  /** The lightness band of the source art, 0 to 1. Anything outside it is clamped to the ends. */
  lowIn: number;
  highIn: number;
  /** Where that band lands, 0 to 1. A wider band than the input is the whole point. */
  lowOut: number;
  highOut: number;
  /** How much of the S the middle of the band gets. 0 is a straight stretch, 1 a full smoothstep. */
  curve: number;
  /** Cool shift in the shadows and warm shift in the highlights, as a share of 255. */
  split: number;
}

export const TONE_DEFAULTS: Readonly<ToneOptions> = {
  strength: 0.8,
  lowIn: 0.24,
  highIn: 0.82,
  lowOut: 0.14,
  highOut: 0.92,
  curve: 0.7,
  split: 0.055,
};

// Direction of the shift, made luma-neutral below so the split never moves lightness.
const COOL: readonly [number, number, number] = [-0.55, -0.1, 1];
const WARM: readonly [number, number, number] = [1, 0.35, -0.8];

function neutral(v: readonly [number, number, number]): [number, number, number] {
  const luma = 0.299 * v[0] + 0.587 * v[1] + 0.114 * v[2];
  return [v[0] - luma, v[1] - luma, v[2] - luma];
}

const COOL_SHIFT = neutral(COOL);
const WARM_SHIFT = neutral(WARM);

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** The lightness a source lightness (0 to 1) is moved to. Never decreases as the input rises. */
export function toneLuma(luma: number, options: Partial<ToneOptions> = {}): number {
  const o = { ...TONE_DEFAULTS, ...options };
  const span = Math.max(1e-6, o.highIn - o.lowIn);
  const t = clamp01((luma - o.lowIn) / span);
  const s = t * t * (3 - 2 * t);
  const shaped = t + (s - t) * o.curve;
  const out = o.lowOut + (o.highOut - o.lowOut) * shaped;
  return luma + (out - luma) * o.strength;
}

/**
 * A copy of `rgba` with the curve applied. Alpha is untouched and fully clear pixels are skipped.
 * The lightness of each pixel goes through `toneLuma`; the colour keeps its hue because the lightness
 * change is added to every channel alike. The split tint is luma-neutral.
 */
export function toneCurve(rgba: ArrayLike<number>, options: Partial<ToneOptions> = {}): Uint8ClampedArray<ArrayBuffer> {
  const o = { ...TONE_DEFAULTS, ...options };
  const out = new Uint8ClampedArray(rgba.length);
  const split = o.split * 255;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const r = rgba[i] as number;
    const g = rgba[i + 1] as number;
    const b = rgba[i + 2] as number;
    const a = rgba[i + 3] as number;
    out[i + 3] = a;
    if (a === 0) {
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      continue;
    }
    const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const moved = toneLuma(luma, o);
    const shift = (moved - luma) * 255;
    // 1 at the dark end of the band, 0 at the light end. Squared so the middle stays untinted.
    const place = clamp01((moved - o.lowOut) / Math.max(1e-6, o.highOut - o.lowOut));
    const cool = (1 - place) * (1 - place) * split * o.strength;
    const warm = place * place * split * o.strength;
    out[i] = r + shift + COOL_SHIFT[0] * cool + WARM_SHIFT[0] * warm;
    out[i + 1] = g + shift + COOL_SHIFT[1] * cool + WARM_SHIFT[1] * warm;
    out[i + 2] = b + shift + COOL_SHIFT[2] * cool + WARM_SHIFT[2] * warm;
  }
  return out;
}

/** The lightness of an RGB triple, 0 to 255. */
export function lumaOf(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}
