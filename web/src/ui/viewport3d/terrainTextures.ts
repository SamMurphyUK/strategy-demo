// The three CC0 biome sets for the close-up ground (Poly Haven, 1K): aerial_sand, forrest_ground_01, snow_02. Each is
// three pictures: a diffuse, a GL normal, and a roughness. The board has few texture units to spare, so each set is
// packed into one RGBA texture:
//
//   red, green  the normal's x and y, as the file has them (0.5 is flat)
//   blue        the roughness
//   alpha       the diffuse's luminance against its own average, centred on 0.5
//
// The diffuse colour itself is never used. The board's palette stays the albedo, and only this centred luminance is let
// modulate it (see albedoDetailStrength), so the photographs carry relief and grain and none of their hue. Every texture
// is NoColorSpace, as the whole board is. A set that fails to load leaves its texture null, and the shader falls back to
// the procedural fields in skins/dioramaPbr.ts.
import * as THREE from "three";

export type BiomeSet = "sand" | "grass" | "snow";

/** The files of each set, in the order diffuse, normal, roughness. */
export const BIOME_FILES: Readonly<Record<BiomeSet, readonly [string, string, string]>> = Object.freeze({
  sand: ["aerial_sand_diff_1k.jpg", "aerial_sand_nor_gl_1k.jpg", "aerial_sand_rough_1k.jpg"],
  grass: ["forrest_ground_01_diff_1k.jpg", "forrest_ground_01_nor_gl_1k.jpg", "forrest_ground_01_rough_1k.jpg"],
  snow: ["snow_02_diff_1k.jpg", "snow_02_nor_gl_1k.jpg", "snow_02_rough_1k.jpg"],
});

export const TERRAIN_BASE = "/assets/terrain/";

/** How strongly the luminance is spread into the alpha channel: a photo's variation is a few tenths at most. */
const LUMA_GAIN = 2.5;

/** Packs a set's three RGBA pixel buffers (all `size` square) into one RGBA buffer. Pure. */
export function packBiome(diffuse: ArrayLike<number>, normal: ArrayLike<number>, rough: ArrayLike<number>, size: number): Uint8Array {
  const count = size * size;
  const luma = new Float32Array(count);
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    luma[i] = (diffuse[o] * 0.299 + diffuse[o + 1] * 0.587 + diffuse[o + 2] * 0.114) / 255;
    sum += luma[i];
  }
  const mean = count > 0 ? sum / count : 0.5;
  const out = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    out[o] = normal[o];
    out[o + 1] = normal[o + 1];
    out[o + 2] = rough[o];
    out[o + 3] = Math.round(Math.min(1, Math.max(0, 0.5 + (luma[i] - mean) * LUMA_GAIN)) * 255);
  }
  return out;
}

async function pixelsOf(url: string): Promise<{ data: Uint8ClampedArray; size: number }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url}: ${response.status}`);
  }
  const bitmap = await createImageBitmap(await response.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("no 2d context");
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return { data: ctx.getImageData(0, 0, canvas.width, canvas.height).data, size: canvas.width };
}

/** One set as a texture, or null if any of its files is missing or they disagree in size. */
export async function loadBiome(set: BiomeSet, base = TERRAIN_BASE, anisotropy = 4): Promise<THREE.DataTexture | null> {
  try {
    const [diffuse, normal, rough] = await Promise.all(BIOME_FILES[set].map((file) => pixelsOf(base + file)));
    if (diffuse.size !== normal.size || diffuse.size !== rough.size || diffuse.size <= 0) {
      return null;
    }
    const texture = new THREE.DataTexture(packBiome(diffuse.data, normal.data, rough.data, diffuse.size), diffuse.size, diffuse.size, THREE.RGBAFormat);
    texture.colorSpace = THREE.NoColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = anisotropy;
    texture.needsUpdate = true;
    return texture;
  } catch {
    return null;
  }
}

export interface BiomeTextures {
  sand: THREE.DataTexture | null;
  grass: THREE.DataTexture | null;
  snow: THREE.DataTexture | null;
}

export async function loadBiomeTextures(anisotropy = 4): Promise<BiomeTextures> {
  const [sand, grass, snow] = await Promise.all([loadBiome("sand", TERRAIN_BASE, anisotropy), loadBiome("grass", TERRAIN_BASE, anisotropy), loadBiome("snow", TERRAIN_BASE, anisotropy)]);
  return { sand, grass, snow };
}

/** All three sets are there: the shader reads them. Otherwise it keeps the procedural fields. */
export function haveBiomes(textures: BiomeTextures | null): textures is { sand: THREE.DataTexture; grass: THREE.DataTexture; snow: THREE.DataTexture } {
  return textures !== null && textures.sand !== null && textures.grass !== null && textures.snow !== null;
}
