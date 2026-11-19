import { MILITARY } from "../ui/theme/militaryPalette";
import { ARCHETYPE_LAYERS, layerLabel, type ArchetypeKey } from "./archetypeLayers";
import { GEN_KEY, GEN_MARGIN, GEN_MAX_SIDE, GEN_MIN_SIDE, type GenBox, type GenPicture } from "./partGen";
import { activeEntries, nearestSlot, slotHex, type CellMask, type UnitPaintDocument } from "./pixelPaint";
import type { PaletteSlotKey, SpriteFrameGrid } from "./skeletonSchema";
import { FACTION_MILITARY_MAPPINGS } from "./starterParts";
import { hasParts } from "./vehicleParts";

/** How far past the worn part a new one may reach, in canvas pixels. A plate is drawn larger than a rifleman, so the steps are too. */
export const VEHICLE_GEN_ROOMS = [0, 2, 4, 8, 12] as const;

export interface VehicleGenRequest {
  layer: string;
  /** Pixels past the worn part that are open to repainting. Not used when there is a selection. */
  room: number;
  /** A box or lasso selection. When it holds any cell, those cells are the ones open to repainting. */
  selection?: CellMask | null;
}

/** One picture to send for a new part of a vehicle, and the mask of pixels that may be repainted. */
export interface VehicleGenPlan {
  layer: string;
  /** Whether the open pixels are the selection. Otherwise they are the worn part and the room around it. */
  fromSelection: boolean;
  /** The part of the canvas the picture shows. */
  box: GenBox;
  /** One byte a canvas cell, row by row. 1 is open to repainting. */
  zone: Uint8Array;
  /** How many cells are open. */
  open: number;
  canvas: { width: number; height: number };
  /** Where the box starts in the picture. A small crop is padded out, with the box in the middle. */
  originX: number;
  originY: number;
  width: number;
  height: number;
  /** RGBA with no clear pixels. The key colour is behind the unit. */
  input: Uint8ClampedArray;
  /** RGBA. Solid where the picture may be repainted, clear everywhere else. */
  mask: Uint8ClampedArray;
}

export interface VehicleGenResult {
  /** The new idle drawing for the layer, the size of the canvas. */
  grid: SpriteFrameGrid;
  /** Open pixels that came back painted. */
  painted: number;
  /** Open pixels that came back as background, and are empty in the new part. */
  cleared: number;
}

/**
 * The layers drawn into the picture: the one being replaced and everything under it. Layers above
 * are left off, so the new part is drawn whole and they go back on top of it afterwards.
 */
export function vehicleShownLayers(archetype: ArchetypeKey, layer: string): string[] {
  const order = ARCHETYPE_LAYERS[archetype];
  const at = order.indexOf(layer);
  return at < 0 ? [] : order.slice(0, at + 1);
}

function grow(cells: Uint8Array, width: number, height: number, room: number): Uint8Array {
  if (room <= 0) {
    return cells.slice();
  }
  const across = new Uint8Array(cells.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (cells[y * width + x] === 0) {
        continue;
      }
      across.fill(1, y * width + Math.max(0, x - room), y * width + Math.min(width - 1, x + room) + 1);
    }
  }
  const out = new Uint8Array(cells.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (across[y * width + x] === 0) {
        continue;
      }
      for (let ty = Math.max(0, y - room); ty <= Math.min(height - 1, y + room); ty += 1) {
        out[ty * width + x] = 1;
      }
    }
  }
  return out;
}

function rgbOf(hex: string): [number, number, number] {
  const rgb = Number.parseInt(hex.slice(1, 7), 16);
  return [(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255];
}

const STRIP: readonly [number, number, number][] = Object.values(MILITARY).map(rgbOf);

function distance(r: number, g: number, b: number, to: readonly [number, number, number]): number {
  return (r - to[0]) ** 2 + (g - to[1]) ** 2 + (b - to[2]) ** 2;
}

/** A pixel is background when it is nearer the key colour than any colour on the military strip. */
export function isVehicleKeyColour(r: number, g: number, b: number): boolean {
  const key = distance(r, g, b, GEN_KEY);
  return STRIP.every((ink) => distance(r, g, b, ink) > key);
}

/** One side of the crop: everything shown when it fits, or the widest window round the open pixels. */
function span(zoneLo: number, zoneHi: number, inkLo: number, inkHi: number, size: number, side: string): { start: number; length: number } {
  const lo = Math.max(0, Math.min(zoneLo, inkLo) - GEN_MARGIN);
  const hi = Math.min(size - 1, Math.max(zoneHi, inkHi) + GEN_MARGIN);
  if (hi - lo + 1 <= GEN_MAX_SIDE) {
    return { start: lo, length: hi - lo + 1 };
  }
  const need = zoneHi - zoneLo + 1;
  if (need > GEN_MAX_SIDE) {
    throw new Error(`The pixels open to repainting are ${need} ${side}. A picture can be ${GEN_MAX_SIDE} at most. Select a smaller area.`);
  }
  const start = Math.max(0, Math.min(size - GEN_MAX_SIDE, Math.round((zoneLo + zoneHi + 1) / 2 - GEN_MAX_SIDE / 2)));
  return { start, length: GEN_MAX_SIDE };
}

/**
 * Work out the picture to send for a new part of a vehicle, an aircraft, or a ship. The picture
 * shows the idle pose up to the layer being replaced, in the country's colours. The mask opens the
 * worn part and the room around it, or the selection when there is one.
 */
export function planVehiclePart(doc: UnitPaintDocument, request: VehicleGenRequest): VehicleGenPlan {
  if (!hasParts(doc) || !doc.layers) {
    throw new Error("A part is generated for a layered vehicle, aircraft, or ship.");
  }
  const shownLayers = vehicleShownLayers(doc.archetype, request.layer);
  if (shownLayers.length === 0) {
    throw new Error(`"${request.layer}" is not a layer of this skeleton.`);
  }
  const { width, height } = doc.blueprint.canvasSize;
  const label = layerLabel(doc.archetype, request.layer).toLowerCase();
  const selection = request.selection;
  const selected =
    selection && selection.width === width && selection.height === height && selection.cells.some((cell) => cell !== 0) ? selection : null;
  let zone: Uint8Array;
  if (selected) {
    zone = Uint8Array.from(selected.cells, (cell) => (cell !== 0 ? 1 : 0));
  } else {
    const own = new Uint8Array(width * height);
    const worn = doc.layers.idle[request.layer] ?? [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (worn[y]?.[x] != null) {
          own[y * width + x] = 1;
        }
      }
    }
    const room = Math.max(0, Math.min(VEHICLE_GEN_ROOMS[VEHICLE_GEN_ROOMS.length - 1] ?? 0, Math.round(request.room)));
    zone = grow(own, width, height, room);
  }
  const shown: (PaletteSlotKey | null)[] = new Array<PaletteSlotKey | null>(width * height).fill(null);
  for (const name of shownLayers) {
    const grid = doc.layers.idle[name] ?? [];
    for (let y = 0; y < height; y += 1) {
      const row = grid[y];
      if (!row) {
        continue;
      }
      for (let x = 0; x < width; x += 1) {
        const slot = row[x];
        if (slot != null) {
          shown[y * width + x] = slot;
        }
      }
    }
  }
  let open = 0;
  let zx0 = width;
  let zy0 = height;
  let zx1 = -1;
  let zy1 = -1;
  let ix0 = width;
  let iy0 = height;
  let ix1 = -1;
  let iy1 = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (zone[index] === 1) {
        open += 1;
        zx0 = Math.min(zx0, x);
        zx1 = Math.max(zx1, x);
        zy0 = Math.min(zy0, y);
        zy1 = Math.max(zy1, y);
      }
      if (shown[index] != null) {
        ix0 = Math.min(ix0, x);
        ix1 = Math.max(ix1, x);
        iy0 = Math.min(iy0, y);
        iy1 = Math.max(iy1, y);
      }
    }
  }
  if (open === 0) {
    throw new Error(`Nothing is drawn on the ${label} yet. Select where it goes with Box or Lasso, and the selection is what gets painted.`);
  }
  const across = span(zx0, zx1, ix1 < 0 ? zx0 : ix0, ix1 < 0 ? zx1 : ix1, width, "wide");
  const down = span(zy0, zy1, iy1 < 0 ? zy0 : iy0, iy1 < 0 ? zy1 : iy1, height, "tall");
  const box: GenBox = { x: across.start, y: down.start, width: across.length, height: down.length };
  const pictureWidth = Math.max(GEN_MIN_SIDE, box.width);
  const pictureHeight = Math.max(GEN_MIN_SIDE, box.height);
  const originX = Math.floor((pictureWidth - box.width) / 2);
  const originY = Math.floor((pictureHeight - box.height) / 2);
  const input = new Uint8ClampedArray(pictureWidth * pictureHeight * 4);
  const mask = new Uint8ClampedArray(pictureWidth * pictureHeight * 4);
  for (let index = 0; index < pictureWidth * pictureHeight; index += 1) {
    input.set([GEN_KEY[0], GEN_KEY[1], GEN_KEY[2], 255], index * 4);
  }
  const mapping = FACTION_MILITARY_MAPPINGS[doc.blueprint.factionId];
  const colours = new Map<PaletteSlotKey, [number, number, number]>();
  for (let y = 0; y < box.height; y += 1) {
    for (let x = 0; x < box.width; x += 1) {
      const from = (box.y + y) * width + box.x + x;
      const to = ((originY + y) * pictureWidth + originX + x) * 4;
      const slot = shown[from];
      if (slot != null) {
        let rgb = colours.get(slot);
        if (!rgb) {
          rgb = rgbOf(slotHex(mapping, slot));
          colours.set(slot, rgb);
        }
        input.set(rgb, to);
      }
      if (zone[from] === 1) {
        mask.set([255, 255, 255, 255], to);
      }
    }
  }
  return {
    layer: request.layer,
    fromSelection: selected !== null,
    box,
    zone,
    open,
    canvas: { width, height },
    originX,
    originY,
    width: pictureWidth,
    height: pictureHeight,
    input,
    mask,
  };
}

/**
 * Read the picture that came back into a new idle drawing for the layer. Only the open pixels are
 * read. Each one is snapped to the country's seven slots, or left empty where the key colour or a
 * clear pixel came back. Everything outside the open pixels keeps what the layer wore.
 */
export function harvestVehiclePart(doc: UnitPaintDocument, plan: VehicleGenPlan, picture: GenPicture): VehicleGenResult {
  if (!hasParts(doc) || !doc.layers) {
    throw new Error("A part is generated for a layered vehicle, aircraft, or ship.");
  }
  const { width, height } = doc.blueprint.canvasSize;
  if (plan.canvas.width !== width || plan.canvas.height !== height) {
    throw new Error("The canvas changed size after the picture was sent, so it no longer lines up.");
  }
  const scale = picture.width / plan.width;
  if (!Number.isInteger(scale) || scale < 1 || picture.height !== plan.height * scale || picture.rgba.length !== picture.width * picture.height * 4) {
    throw new Error(`The picture came back ${picture.width}×${picture.height}. The one sent was ${plan.width}×${plan.height}.`);
  }
  const worn = doc.layers.idle[plan.layer] ?? [];
  const grid: SpriteFrameGrid = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => worn[y]?.[x] ?? null),
  );
  const palette = activeEntries(FACTION_MILITARY_MAPPINGS[doc.blueprint.factionId]);
  const middle = Math.floor(scale / 2);
  let painted = 0;
  let cleared = 0;
  for (let y = 0; y < plan.box.height; y += 1) {
    const row = grid[plan.box.y + y];
    if (!row) {
      continue;
    }
    for (let x = 0; x < plan.box.width; x += 1) {
      const cx = plan.box.x + x;
      if (plan.zone[(plan.box.y + y) * width + cx] !== 1) {
        continue;
      }
      const offset = (((plan.originY + y) * scale + middle) * picture.width + (plan.originX + x) * scale + middle) * 4;
      const r = picture.rgba[offset] ?? 0;
      const g = picture.rgba[offset + 1] ?? 0;
      const b = picture.rgba[offset + 2] ?? 0;
      if ((picture.rgba[offset + 3] ?? 0) >= 128 && !isVehicleKeyColour(r, g, b)) {
        row[cx] = nearestSlot(r, g, b, palette);
        painted += 1;
      } else {
        row[cx] = null;
        cleared += 1;
      }
    }
  }
  if (painted === 0) {
    throw new Error(`The picture came back with nothing painted where the ${layerLabel(doc.archetype, plan.layer).toLowerCase()} goes.`);
  }
  return { grid, painted, cleared };
}
