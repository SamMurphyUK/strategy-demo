import { describe, expect, it } from "vitest";
import { deupscaleToNativeArtPixels, detectPixelBlockSize } from "./pixelGrain";

function upscale(rgba: Uint8ClampedArray, width: number, height: number, block: number): Uint8ClampedArray {
  const outW = width * block;
  const outH = height * block;
  const out = new Uint8ClampedArray(outW * outH * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const src = (y * width + x) * 4;
      for (let dy = 0; dy < block; dy += 1) {
        for (let dx = 0; dx < block; dx += 1) {
          const dst = ((y * block + dy) * outW + (x * block + dx)) * 4;
          out[dst] = rgba[src] ?? 0;
          out[dst + 1] = rgba[src + 1] ?? 0;
          out[dst + 2] = rgba[src + 2] ?? 0;
          out[dst + 3] = rgba[src + 3] ?? 0;
        }
      }
    }
  }
  return out;
}

function keys(rgba: Uint8ClampedArray): string[] {
  const found = new Set<string>();
  for (let index = 0; index < rgba.length; index += 4) {
    if ((rgba[index + 3] ?? 0) < 128) {
      continue;
    }
    found.add(`${rgba[index]},${rgba[index + 1]},${rgba[index + 2]},${rgba[index + 3]}`);
  }
  return [...found].sort();
}

describe("pixel grain", () => {
  it("collapses a 2× plate of 206×130 to the 103×65 art pixels it repeats", () => {
    const width = 103;
    const height = 65;
    const art = new Uint8ClampedArray(width * height * 4);
    const paint = (x: number, y: number, red: number, green: number, blue: number) => {
      const offset = (y * width + x) * 4;
      art[offset] = red;
      art[offset + 1] = green;
      art[offset + 2] = blue;
      art[offset + 3] = 255;
    };
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        paint(x, y, 90, 96, 70);
      }
    }
    for (let y = 28; y < 48; y += 1) {
      for (let x = 8; x < 78; x += 1) {
        paint(x, y, 70, 74, 48);
      }
    }
    for (let y = 18; y < 28; y += 1) {
      paint(9, y, 40, 36, 28);
    }

    const doubled = upscale(art, width, height, 2);
    expect(doubled.length).toBe(206 * 130 * 4);
    expect(detectPixelBlockSize(doubled, 206, 130)).toBe(2);

    const native = deupscaleToNativeArtPixels(doubled, 206, 130);
    expect(native.blockSize).toBe(2);
    expect(native.width).toBe(103);
    expect(native.height).toBe(65);
    expect(native.rgba).toEqual(art);
    expect(keys(native.rgba)).toEqual(keys(art));
  });

  it("leaves a 1× sprite at the size it was drawn", () => {
    const width = 48;
    const height = 48;
    const art = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        const on = (x + y) % 2 === 0;
        art[offset] = on ? 28 : 196;
        art[offset + 1] = on ? 36 : 168;
        art[offset + 2] = on ? 24 : 64;
        art[offset + 3] = 255;
      }
    }
    expect(detectPixelBlockSize(art, width, height)).toBe(1);
    const kept = deupscaleToNativeArtPixels(art, width, height);
    expect(kept.blockSize).toBe(1);
    expect(kept.width).toBe(48);
    expect(kept.height).toBe(48);
    expect(kept.rgba).toBe(art);

    const flat = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < flat.length; index += 4) {
      flat[index] = 70;
      flat[index + 1] = 74;
      flat[index + 2] = 48;
      flat[index + 3] = 255;
    }
    expect(detectPixelBlockSize(flat, width, height)).toBe(1);
    expect(deupscaleToNativeArtPixels(flat, width, height).rgba).toBe(flat);
  });
});
