// The two sheets the board's shaders read: the baked base map, and a coast mask.
import * as THREE from "three";
import type { Rect } from "../map/geometry";
import type { MasterLand } from "../map/svgLandLoader";

/** Bitmap pixels per world unit for the baked sheet on the board. */
export const BOARD_BAKE_SCALE = 3;
/** Bitmap pixels per world unit for the coast mask. */
const MASK_SCALE = 2;
/** Blur of the mask's green channel, in world units: the line of foam at the cliff's foot. */
const EDGE_BLUR = 1.1;
/** Blur of the blue channel: how far out the surf starts. */
const SHORE_BLUR = 4.2;

/**
 * Land as a three-channel mask. Red is the land itself, green is the land with a soft edge (0.5 on
 * the coast), and blue is the land blurred wide, so its value says how near a piece of water is to
 * a shore. The world repeats sideways, so the neighbours are drawn in before the blur.
 */
export function coastMaskCanvas(land: MasterLand, bounds: Rect): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bounds.w * MASK_SCALE));
  canvas.height = Math.max(1, Math.round(bounds.h * MASK_SCALE));
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return canvas;
  }
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const sx = canvas.width / bounds.w;
  const sy = canvas.height / bounds.h;
  const lay = (color: string, blurWorld: number) => {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.filter = blurWorld > 0 ? `blur(${(blurWorld * sx).toFixed(2)}px)` : "none";
    ctx.fillStyle = color;
    for (const dx of [-bounds.w, 0, bounds.w]) {
      ctx.setTransform(sx, 0, 0, sy, (dx - bounds.x) * sx, -bounds.y * sy);
      ctx.fill(land.masterLandPath);
    }
    ctx.restore();
  };
  lay("#ff0000", 0);
  lay("#00ff00", EDGE_BLUR);
  lay("#0000ff", SHORE_BLUR);
  return canvas;
}

/** A sheet that covers the world once and repeats sideways. Colours are read as they are stored. */
export function sheetTexture(canvas: HTMLCanvasElement, mipmaps: boolean, anisotropy = 1): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  texture.generateMipmaps = mipmaps;
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
}

/** A 2D canvas the map painted, to lay over the board texel for texel. Its colour is premultiplied. */
export function overlayTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.premultiplyAlpha = true;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/** One clear texel, for an overlay slot with no canvas. */
export function clearTexture(): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}
