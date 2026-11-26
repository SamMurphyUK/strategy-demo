import { describe, expect, it } from "vitest";
import { BIOME_FILES, packBiome } from "../../../src/ui/viewport3d/terrainTextures";

describe("biome sets", () => {
  it("names the nine files of the three sets", () => {
    const files = Object.values(BIOME_FILES).flat();
    expect(files).toHaveLength(9);
    expect(new Set(files).size).toBe(9);
    expect(files.every((file) => file.endsWith("_1k.jpg"))).toBe(true);
  });
  it("packs the normal, the roughness, and only the centred luminance of the diffuse", () => {
    const px = (r: number, g: number, b: number) => [r, g, b, 255];
    const diffuse = [...px(200, 40, 40), ...px(20, 20, 20), ...px(110, 110, 110), ...px(110, 110, 110)];
    const normal = [...px(128, 128, 255), ...px(90, 160, 255), ...px(128, 128, 255), ...px(128, 128, 255)];
    const rough = [...px(10, 0, 0), ...px(200, 0, 0), ...px(100, 0, 0), ...px(100, 0, 0)];
    const out = packBiome(diffuse, normal, rough, 2);
    expect(out).toHaveLength(16);
    expect([out[0], out[1], out[2]]).toEqual([128, 128, 10]);
    expect([out[4], out[5], out[6]]).toEqual([90, 160, 200]);
    // A bright pixel is above the middle, a dark one below, and none of the hue is kept.
    expect(out[3]).toBeGreaterThan(128);
    expect(out[7]).toBeLessThan(128);
  });
});
