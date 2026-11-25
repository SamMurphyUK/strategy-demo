// The two sheets of the pixel chart that are painted on a canvas: each territory's id, and each
// territory's climate zone. The numbers that go into them are worked out in pixieSheet.ts.
import * as THREE from "three";
import type { Rect, RegionShape } from "../map/geometry";
import { mapToLonLat } from "./geography";
import { climateZoneOf, climateZoneOfRegion, regionIdBytes, snapRegionIds, unitRgb, ZONE_INK } from "./pixieSheet";

/** Bitmap pixels per world unit for the id sheet. A border is found between two of the chart's texels, so this only has to place it. */
const ID_SHEET_SCALE = 2;
/** World units between two samples of the climate behind the territories. */
const ZONE_STEP = 4;
/** How far one climate runs into the next, in world units. The dither works across this band. */
const ZONE_BLUR = 3;

function sheet(bounds: Rect, scale: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D | null; toWorld(): void } {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bounds.w * scale));
  canvas.height = Math.max(1, Math.round(bounds.h * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const sx = canvas.width / bounds.w;
  const sy = canvas.height / bounds.h;
  return { canvas, ctx, toWorld: () => ctx?.setTransform(sx, 0, 0, sy, -bounds.x * sx, -bounds.y * sy) };
}

/**
 * Every territory and sea zone filled with its own id (see regionIdBytes). The chart draws a
 * border where two neighbouring texels hold different ids, so the line is one texel wide at any
 * zoom. The soft edge a canvas gives every fill is taken off, so no texel holds half an id.
 */
export function regionIdCanvas(bounds: Rect, regions: readonly RegionShape[], paths: ReadonlyMap<string, Path2D>): HTMLCanvasElement {
  const { canvas, ctx, toWorld } = sheet(bounds, ID_SHEET_SCALE);
  if (!ctx) {
    return canvas;
  }
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  toWorld();
  const valid = new Set<number>();
  // The sea first, so a territory's own shore is the land's where the two shapes overlap.
  const ordered = [...regions.keys()].sort((a, b) => Number(regions[a].type === "land") - Number(regions[b].type === "land"));
  for (const index of ordered) {
    const region = regions[index];
    const path = paths.get(region.id);
    if (!path) {
      continue;
    }
    const [r, g, b] = regionIdBytes(index, region.type === "sea");
    valid.add(r | (g << 8) | (b << 16));
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fill(path, "evenodd");
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  snapRegionIds(image.data, canvas.width, canvas.height, valid);
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/**
 * The climate zone of every place, in the colours of `ZONE_INK`: the climate the latitude gives
 * behind, each territory's own zone over it, and a blur so one zone runs into the next.
 */
export function climateZoneCanvas(bounds: Rect, regions: readonly RegionShape[], paths: ReadonlyMap<string, Path2D>): HTMLCanvasElement {
  const { canvas, ctx, toWorld } = sheet(bounds, 1);
  if (!ctx) {
    return canvas;
  }
  // Behind the territories: water, and land that nobody holds.
  const columns = Math.max(1, Math.round(bounds.w / ZONE_STEP));
  const rows = Math.max(1, Math.round(bounds.h / ZONE_STEP));
  const behind = document.createElement("canvas");
  behind.width = columns;
  behind.height = rows;
  const small = behind.getContext("2d");
  if (small) {
    const image = small.createImageData(columns, rows);
    const inks = ZONE_INK.map(unitRgb);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < columns; x++) {
        const { lon, lat } = mapToLonLat({ x: bounds.x + ((x + 0.5) / columns) * bounds.w, y: bounds.y + ((y + 0.5) / rows) * bounds.h });
        const ink = inks[climateZoneOf(undefined, lon, lat)];
        const at = (y * columns + x) * 4;
        image.data[at] = ink[0] * 255;
        image.data[at + 1] = ink[1] * 255;
        image.data[at + 2] = ink[2] * 255;
        image.data[at + 3] = 255;
      }
    }
    small.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(behind, 0, 0, canvas.width, canvas.height);
  }
  toWorld();
  for (const region of regions) {
    const path = paths.get(region.id);
    if (region.type !== "land" || !path) {
      continue;
    }
    ctx.fillStyle = ZONE_INK[climateZoneOfRegion(region)];
    ctx.fill(path, "evenodd");
  }

  // The blur, with the neighbouring copies of the world drawn in so the sheet joins at the seam.
  const out = document.createElement("canvas");
  out.width = canvas.width;
  out.height = canvas.height;
  const soft = out.getContext("2d");
  if (!soft) {
    return canvas;
  }
  soft.drawImage(canvas, 0, 0);
  if (typeof soft.filter === "string") {
    soft.filter = `blur(${ZONE_BLUR}px)`;
    for (const dx of [-canvas.width, 0, canvas.width]) {
      soft.drawImage(canvas, dx, 0);
    }
    soft.filter = "none";
  }
  return out;
}

/** The id sheet as a texture. An id is read whole or not at all, so nothing is smoothed. */
export function idSheetTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}
