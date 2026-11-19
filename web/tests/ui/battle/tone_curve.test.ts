import { describe, expect, it } from "vitest";
import { MILITARY } from "../../../src/ui/theme/militaryPalette";
import { lumaOf, toneCurve, toneLuma, TONE_DEFAULTS } from "../../../src/ui/battle/scenery/toneCurve";

function bytes(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The 16 military colours as an RGBA strip, plus a clear pixel and a half-clear pixel. */
function strip(): Uint8ClampedArray {
  const colours = Object.values(MILITARY).map(bytes);
  const rgba = new Uint8ClampedArray((colours.length + 2) * 4);
  colours.forEach(([r, g, b], i) => rgba.set([r, g, b, 255], i * 4));
  rgba.set([80, 120, 40, 0], colours.length * 4);
  rgba.set([200, 60, 60, 128], (colours.length + 1) * 4);
  return rgba;
}

function lumas(rgba: ArrayLike<number>, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) out.push(lumaOf(rgba[i * 4] as number, rgba[i * 4 + 1] as number, rgba[i * 4 + 2] as number));
  return out;
}

describe("toneCurve", () => {
  it("never makes a lighter source darker", () => {
    let last = -1;
    for (let v = 0; v <= 1.0001; v += 0.005) {
      const next = toneLuma(v);
      expect(next).toBeGreaterThanOrEqual(last);
      last = next;
    }
    // Grey pixels keep their order after the byte round trip too, give or take rounding.
    const grey = new Uint8ClampedArray(256 * 4);
    for (let v = 0; v < 256; v += 1) grey.set([v, v, v, 255], v * 4);
    const tones = lumas(toneCurve(grey), 256);
    for (let v = 1; v < 256; v += 1) expect(tones[v] ?? 0).toBeGreaterThanOrEqual((tones[v - 1] ?? 0) - 1.2);
  });

  it("keeps alpha exactly and leaves clear pixels alone", () => {
    const source = strip();
    const out = toneCurve(source);
    for (let i = 3; i < source.length; i += 4) expect(out[i]).toBe(source[i]);
    const clear = Object.values(MILITARY).length * 4;
    expect([...out.slice(clear, clear + 4)]).toEqual([80, 120, 40, 0]);
  });

  it("widens the lightness range of the palette", () => {
    const source = strip();
    const count = Object.values(MILITARY).length;
    const before = lumas(source, count);
    const after = lumas(toneCurve(source), count);
    const spread = (list: number[]) => Math.max(...list) - Math.min(...list);
    expect(spread(after)).toBeGreaterThan(spread(before) * 1.2);
    expect(Math.min(...after)).toBeLessThan(Math.min(...before));
    expect(Math.max(...after)).toBeGreaterThan(Math.max(...before) - 6);
  });

  it("does not wash the palette to grey", () => {
    const source = strip();
    const out = toneCurve(source);
    const sat = (rgba: ArrayLike<number>, i: number) => Math.max(rgba[i * 4] as number, rgba[i * 4 + 1] as number, rgba[i * 4 + 2] as number) - Math.min(rgba[i * 4] as number, rgba[i * 4 + 1] as number, rgba[i * 4 + 2] as number);
    const count = Object.values(MILITARY).length;
    let before = 0;
    let after = 0;
    for (let i = 0; i < count; i += 1) {
      before += sat(source, i);
      after += sat(out, i);
    }
    expect(after).toBeGreaterThan(before * 0.8);
  });

  it("keeps each colour's hue family", () => {
    const [r, g, b] = bytes(MILITARY.crimson);
    const out = toneCurve(new Uint8ClampedArray([r, g, b, 255]));
    expect(out[0] ?? 0).toBeGreaterThan(out[1] ?? 255);
    expect(out[0] ?? 0).toBeGreaterThan(out[2] ?? 255);
  });

  it("is deterministic and leaves its input alone", () => {
    const source = strip();
    const copy = new Uint8ClampedArray(source);
    expect([...toneCurve(source)]).toEqual([...toneCurve(source)]);
    expect([...source]).toEqual([...copy]);
  });

  it("does nothing at strength 0", () => {
    const source = strip();
    expect([...toneCurve(source, { strength: 0, split: 0 })]).toEqual([...source]);
  });

  it("tints shadows cooler than highlights", () => {
    const dark = toneCurve(new Uint8ClampedArray([100, 100, 100, 255]), { ...TONE_DEFAULTS, split: 0.1 });
    const light = toneCurve(new Uint8ClampedArray([190, 190, 190, 255]), { ...TONE_DEFAULTS, split: 0.1 });
    expect((dark[2] ?? 0) - (dark[0] ?? 0)).toBeGreaterThan(0);
    expect((light[0] ?? 0) - (light[2] ?? 0)).toBeGreaterThan(0);
  });
});
