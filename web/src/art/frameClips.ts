import { MILITARY } from "../ui/theme/militaryPalette";
import { SPRITE_BAKE } from "../ui/map/figureGround";
import {
  FACTION_LUTS,
  PART_CATEGORIES,
  layoutWalkGrid,
  quantizePixel,
  retintWalkSlot,
  type PartCategory,
  type PixelPoint,
} from "./paperDoll";

/** Legs first, the weapon last. A later layer covers an earlier one. */
export const LAYER_ORDER: readonly PartCategory[] = PART_CATEGORIES;

export const LAYER_NAME: Record<PartCategory, string> = {
  legs: "Legs",
  torso: "Torso",
  head: "Head",
  weapon: "Weapon",
};

export type ClipKey = "idle" | "walk" | "fire" | "damaged";
export const CLIP_KEYS: readonly ClipKey[] = ["idle", "walk", "fire", "damaged"];
export const CLIP_LABEL: Record<ClipKey, string> = {
  idle: "Idle",
  walk: "Walking",
  fire: "Firing",
  damaged: "Damaged",
};

/** One frame at the sheet's own size. Each layer holds the semantic slots 0–13. */
export interface SpriteFrame {
  width: number;
  height: number;
  layers: Record<PartCategory, number[]>;
  muzzle: PixelPoint | null;
  /** Further barrel tips, in the same space as `muzzle`. Absent when the frame has one muzzle or none. */
  muzzles?: PixelPoint[];
  flash: boolean;
}

export interface FrameClips {
  unitId: string;
  width: number;
  height: number;
  /** Where the boots stand. The game card puts this pixel on its ground line. */
  feet: PixelPoint;
  clips: Record<ClipKey, SpriteFrame[]>;
}

export interface SpriteFrameFile {
  kind: "sprite-frame";
  version: 1;
  width: number;
  height: number;
  layers: Record<PartCategory, number[]>;
  muzzle: PixelPoint | null;
  muzzles?: PixelPoint[];
  flash: boolean;
}

export interface FrameClipsFile {
  kind: "sprite-clips";
  version: 1;
  unitId: string;
  width: number;
  height: number;
  feet: PixelPoint;
  clips: Record<ClipKey, string[]>;
  /** Exhaust, in the picture's pixels. The hull is still when a puff frame is shown. */
  smoke?: PixelPoint;
  /** Barrel tip, in the picture's pixels, on the frame where the flash is drawn. */
  muzzle?: PixelPoint;
  /** Fire-clip indexes that draw the muzzle flash. */
  flashFrames?: number[];
  /** Idle and fire indexes that let the exhaust rise. */
  puffFrames?: { idle: number[]; fire: number[] };
}

/**
 * jap_walk.png's own colours, one slot each per layer, so splitting the sheet loses nothing.
 * The same hex can sit in two slots: the helmet and the tunic share a colour, and so do the
 * tunic shadow and the gun shadow.
 */
const SHEET_SLOT: Record<string, number> = {
  a78a5e: 1,
  a9a25d: 2,
  "4b3d44": 3,
  "645355": 4,
  "846d59": 6,
  ddcf99: 8,
  b87a60: 10,
  "4e5463": 12,
};

const SHEET_SLOT_ON: Partial<Record<PartCategory, Record<string, number>>> = {
  head: { a9a25d: 11 },
  weapon: { "4b3d44": 13, a78a5e: 7 },
};

/** Slot to colour for the sheet's own colours. Frame 0 drawn with this matches jap_walk.png pixel for pixel. */
export const AS_DRAWN_LUT: readonly string[] = (() => {
  const lut = [...FACTION_LUTS.JAP];
  for (const [hex, slot] of Object.entries(SHEET_SLOT)) {
    lut[slot] = `#${hex}`;
  }
  for (const table of Object.values(SHEET_SLOT_ON)) {
    for (const [hex, slot] of Object.entries(table)) {
      lut[slot] = `#${hex}`;
    }
  }
  return lut;
})();

/** The sheet's colours keep their own slot. Anything else snaps to the nearest doll colour. */
export function sheetSlot(r: number, g: number, b: number, a: number, layer: PartCategory): number {
  if (a < 128) {
    return 0;
  }
  const hex = [r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("");
  const exact = SHEET_SLOT_ON[layer]?.[hex] ?? SHEET_SLOT[hex];
  if (exact !== undefined) {
    return exact;
  }
  const slot = quantizePixel(r, g, b, a, layer);
  return slot === 0 ? 0 : retintWalkSlot(slot, layer);
}

export function emptyFrame(width: number, height: number): SpriteFrame {
  const blank = () => new Array<number>(width * height).fill(0);
  return {
    width,
    height,
    layers: { legs: blank(), torso: blank(), head: blank(), weapon: blank() },
    muzzle: null,
    flash: false,
  };
}

export function cloneFrame(frame: SpriteFrame): SpriteFrame {
  return {
    width: frame.width,
    height: frame.height,
    layers: {
      legs: frame.layers.legs.slice(),
      torso: frame.layers.torso.slice(),
      head: frame.layers.head.slice(),
      weapon: frame.layers.weapon.slice(),
    },
    muzzle: frame.muzzle ? { ...frame.muzzle } : null,
    ...(frame.muzzles && frame.muzzles.length > 1 ? { muzzles: frame.muzzles.map((point) => ({ ...point })) } : {}),
    flash: frame.flash,
  };
}

/** The fourth cell of the walk sheet. It leads the walk, and Idle starts as a copy of it. */
const WALK_LEAD_CELL = 3;

/**
 * Split the 4×2 walk sheet into eight frames at full size.
 * Every opaque sheet pixel lands on the layer the segmenter gave it, in the same place.
 * The fourth cell leads the walk. Idle starts as a copy of that frame. Firing starts empty.
 */
export function clipsFromWalkSheet(rgba: Uint8ClampedArray, width: number, height: number, unitId: string): FrameClips {
  const sheet = layoutWalkGrid(rgba, width, height);
  const cell = sheet.height;
  const walk: SpriteFrame[] = [];
  for (let index = 0; index < 8; index += 1) {
    const frame = emptyFrame(cell, cell);
    for (let y = 0; y < cell; y += 1) {
      for (let x = 0; x < cell; x += 1) {
        const source = y * sheet.width + index * cell + x;
        const offset = source * 4;
        const alpha = sheet.rgba[offset + 3] ?? 0;
        if (alpha < 128) {
          continue;
        }
        const layer = sheet.mask[source] ?? "torso";
        frame.layers[layer][y * cell + x] = sheetSlot(
          sheet.rgba[offset] ?? 0,
          sheet.rgba[offset + 1] ?? 0,
          sheet.rgba[offset + 2] ?? 0,
          alpha,
          layer,
        );
      }
    }
    frame.muzzle = muzzleOf(frame);
    walk.push(frame);
  }
  const ordered = walk.slice(WALK_LEAD_CELL).concat(walk.slice(0, WALK_LEAD_CELL));
  const first = ordered[0] ?? emptyFrame(cell, cell);
  return {
    unitId,
    width: cell,
    height: cell,
    feet: feetOf(first),
    clips: { idle: [cloneFrame(first)], walk: ordered, fire: [], damaged: [] },
  };
}

/** The bottom row of the figure, halfway between its outer pixels. */
export function feetOf(frame: SpriteFrame): PixelPoint {
  const flat = composite(frame);
  for (let y = frame.height - 1; y >= 0; y -= 1) {
    let left = -1;
    let right = -1;
    for (let x = 0; x < frame.width; x += 1) {
      if ((flat[y * frame.width + x] ?? 0) !== 0) {
        if (left < 0) left = x;
        right = x;
      }
    }
    if (left >= 0) {
      return { x: Math.round((left + right) / 2), y };
    }
  }
  return { x: Math.floor(frame.width / 2), y: frame.height - 1 };
}

/** The weapon pixel furthest right, then highest. */
export function muzzleOf(frame: SpriteFrame): PixelPoint | null {
  let best: PixelPoint | null = null;
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      if ((frame.layers.weapon[y * frame.width + x] ?? 0) === 0) {
        continue;
      }
      if (!best || x > best.x) {
        best = { x, y };
      }
    }
  }
  return best;
}

/** Flatten the layers. Legs, then torso, then head, then the weapon on top. */
export function composite(frame: SpriteFrame): number[] {
  const out = new Array<number>(frame.width * frame.height).fill(0);
  for (const layer of LAYER_ORDER) {
    const cells = frame.layers[layer];
    for (let index = 0; index < out.length; index += 1) {
      const slot = cells[index] ?? 0;
      if (slot !== 0) {
        out[index] = slot;
      }
    }
  }
  return out;
}

function inside(frame: SpriteFrame, x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < frame.width && y < frame.height;
}

/** Write one slot onto one layer. Slot 0 clears that layer's pixel. */
export function paintCell(frame: SpriteFrame, layer: PartCategory, x: number, y: number, slot: number): SpriteFrame {
  if (!inside(frame, x, y)) {
    return frame;
  }
  const index = y * frame.width + x;
  const next = Math.max(0, Math.min(13, Math.round(slot)));
  if ((frame.layers[layer][index] ?? 0) === next) {
    return frame;
  }
  const cells = frame.layers[layer].slice();
  cells[index] = next;
  return { ...frame, layers: { ...frame.layers, [layer]: cells } };
}

/** Clear the pixel on every layer, so the square is empty. */
export function eraseCell(frame: SpriteFrame, x: number, y: number): SpriteFrame {
  if (!inside(frame, x, y)) {
    return frame;
  }
  const index = y * frame.width + x;
  if (!LAYER_ORDER.some((layer) => (frame.layers[layer][index] ?? 0) !== 0)) {
    return frame;
  }
  const layers = { ...frame.layers };
  for (const layer of LAYER_ORDER) {
    if ((layers[layer][index] ?? 0) !== 0) {
      const cells = layers[layer].slice();
      cells[index] = 0;
      layers[layer] = cells;
    }
  }
  return { ...frame, layers };
}

/** Slide one layer. Pixels pushed off the frame are dropped. */
export function nudgeLayer(frame: SpriteFrame, layer: PartCategory, dx: number, dy: number): SpriteFrame {
  const source = frame.layers[layer];
  if ((dx === 0 && dy === 0) || !source.some((slot) => slot !== 0)) {
    return frame;
  }
  const cells = new Array<number>(source.length).fill(0);
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const slot = source[y * frame.width + x] ?? 0;
      const tx = x + dx;
      const ty = y + dy;
      if (slot !== 0 && tx >= 0 && ty >= 0 && tx < frame.width && ty < frame.height) {
        cells[ty * frame.width + tx] = slot;
      }
    }
  }
  const moved = { ...frame, layers: { ...frame.layers, [layer]: cells } };
  if (layer === "weapon" && frame.muzzle) {
    moved.muzzle = { x: frame.muzzle.x + dx, y: frame.muzzle.y + dy };
  }
  return moved;
}

/**
 * The weapon pixels that sit over the body with no torso drawn under them.
 * A pixel counts when torso lies on both sides of it along its row, or above and below it in its column.
 * A stock or barrel that pokes out past the body is left alone.
 */
export function cellsUnderWeapon(torso: readonly number[], weapon: readonly number[], width: number, height: number): number[] {
  const body = torso.map((slot) => slot !== 0);
  const out: number[] = [];
  // A filled pixel can close a gap in its own row or column, so repeat until nothing new turns up.
  for (;;) {
    const rowMin = new Array<number>(height).fill(width);
    const rowMax = new Array<number>(height).fill(-1);
    const colMin = new Array<number>(width).fill(height);
    const colMax = new Array<number>(width).fill(-1);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (!body[y * width + x]) {
          continue;
        }
        rowMin[y] = Math.min(rowMin[y] ?? width, x);
        rowMax[y] = Math.max(rowMax[y] ?? -1, x);
        colMin[x] = Math.min(colMin[x] ?? height, y);
        colMax[x] = Math.max(colMax[x] ?? -1, y);
      }
    }
    const found: number[] = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if ((weapon[index] ?? 0) === 0 || body[index]) {
          continue;
        }
        const inRow = x > (rowMin[y] ?? width) && x < (rowMax[y] ?? -1);
        const inColumn = y > (colMin[x] ?? height) && y < (colMax[x] ?? -1);
        if (inRow || inColumn) {
          found.push(index);
        }
      }
    }
    if (found.length === 0) {
      return out.sort((a, b) => a - b);
    }
    for (const index of found) {
      body[index] = true;
      out.push(index);
    }
  }
}

/** The colour a layer uses most. 0 when the layer is empty. */
export function commonSlot(cells: readonly number[]): number {
  const counts = new Map<number, number>();
  let fill = 0;
  let most = 0;
  for (const slot of cells) {
    if (slot === 0) {
      continue;
    }
    const count = (counts.get(slot) ?? 0) + 1;
    counts.set(slot, count);
    if (count > most) {
      most = count;
      fill = slot;
    }
  }
  return fill;
}

/**
 * Paint the tunic behind the weapon. Every weapon pixel over the body gets the torso's
 * most common colour underneath, so moving the weapon shows a body.
 */
export function fillTorsoUnderWeapon(frame: SpriteFrame): SpriteFrame {
  const torso = frame.layers.torso;
  const fill = commonSlot(torso);
  const under = fill === 0 ? [] : cellsUnderWeapon(torso, frame.layers.weapon, frame.width, frame.height);
  if (under.length === 0) {
    return frame;
  }
  const cells = torso.slice();
  for (const index of under) {
    cells[index] = fill;
  }
  return { ...frame, layers: { ...frame.layers, torso: cells } };
}

/** A starting point for the second idle frame: the head and torso rise one pixel. */
export function breathFrom(frame: SpriteFrame): SpriteFrame {
  return nudgeLayer(nudgeLayer(cloneFrame(frame), "head", 0, -1), "torso", 0, -1);
}

/** A starting point for a shot: the weapon kicks back two pixels and the flash shows. */
export function shotFrom(frame: SpriteFrame): SpriteFrame {
  return { ...nudgeLayer(cloneFrame(frame), "weapon", -2, 0), flash: true };
}

/** Put a picture onto one layer. It must be the frame's size. Clear pixels empty that layer. */
export function placeLayerImage(
  frame: SpriteFrame,
  layer: PartCategory,
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): SpriteFrame {
  if (width !== frame.width || height !== frame.height) {
    throw new Error(`The picture is ${width}×${height}. This frame is ${frame.width}×${frame.height}.`);
  }
  const cells = new Array<number>(width * height).fill(0);
  for (let index = 0; index < cells.length; index += 1) {
    const offset = index * 4;
    cells[index] = sheetSlot(rgba[offset] ?? 0, rgba[offset + 1] ?? 0, rgba[offset + 2] ?? 0, rgba[offset + 3] ?? 0, layer);
  }
  const next = { ...frame, layers: { ...frame.layers, [layer]: cells } };
  return layer === "weapon" ? { ...next, muzzle: muzzleOf(next) ?? frame.muzzle } : next;
}

const FLASH: readonly (readonly [number, number, string])[] = [
  [1, 0, MILITARY.cream],
  [2, 0, MILITARY.cream],
  [3, 0, MILITARY.brass],
  [1, -1, MILITARY.brass],
  [2, 1, MILITARY.cream],
];

/** The flash in front of a barrel tip. It can sit past the picture's edge. */
export function muzzleFlashPixels(tip: PixelPoint): { x: number; y: number; hex: string }[] {
  return FLASH.map(([dx, dy, hex]) => ({ x: tip.x + dx, y: tip.y + dy, hex }));
}

/** A short exhaust wisp. Later phases are higher and drift back, toward the left. */
const EXHAUST: readonly (readonly (readonly [number, number, string])[])[] = [
  [
    [0, -2, MILITARY.charcoal],
    [-1, -3, MILITARY.taupe],
  ],
  [
    [-1, -5, MILITARY.charcoal],
    [0, -6, MILITARY.feldgrau],
    [-2, -4, MILITARY.taupe],
  ],
  [
    [-2, -8, MILITARY.taupe],
    [-1, -9, MILITARY.feldgrau],
    [-3, -7, MILITARY.charcoal],
  ],
];

export function exhaustPuff(phase: number): readonly (readonly [number, number, string])[] {
  const index = Math.min(EXHAUST.length - 1, Math.max(0, Math.floor(phase)));
  return EXHAUST[index] ?? EXHAUST[0];
}

function writeHex(out: Uint8ClampedArray, offset: number, hex: string): void {
  const rgb = Number.parseInt(hex.slice(1, 7), 16);
  out[offset] = (rgb >> 16) & 255;
  out[offset + 1] = (rgb >> 8) & 255;
  out[offset + 2] = rgb & 255;
  out[offset + 3] = 255;
}

/** The frame in a faction's colours, with the muzzle flash when the frame has one. */
export function frameRgba(frame: SpriteFrame, lut: readonly string[]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(frame.width * frame.height * 4);
  const flat = composite(frame);
  for (let index = 0; index < flat.length; index += 1) {
    const hex = lut[flat[index] ?? 0];
    if ((flat[index] ?? 0) !== 0 && hex) {
      writeHex(out, index * 4, hex);
    }
  }
  const tips = frame.muzzles && frame.muzzles.length > 0 ? frame.muzzles : frame.muzzle ? [frame.muzzle] : [];
  if (frame.flash) {
    for (const tip of tips) {
      for (const pixel of muzzleFlashPixels(tip)) {
        if (inside(frame, pixel.x, pixel.y)) {
          writeHex(out, (pixel.y * frame.width + pixel.x) * 4, pixel.hex);
        }
      }
    }
  }
  return out;
}

/** The 80×56 game card. The feet pixel lands on the card's ground point. */
export function cardRgba(frame: SpriteFrame, lut: readonly string[], feet: PixelPoint): Uint8ClampedArray {
  const { width, height, originX, originY } = SPRITE_BAKE;
  const out = new Uint8ClampedArray(width * height * 4);
  const source = frameRgba(frame, lut);
  const ox = originX - feet.x;
  const oy = originY - feet.y;
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const from = (y * frame.width + x) * 4;
      if ((source[from + 3] ?? 0) === 0) {
        continue;
      }
      const tx = x + ox;
      const ty = y + oy;
      if (tx < 0 || ty < 0 || tx >= width || ty >= height) {
        continue;
      }
      out.set(source.subarray(from, from + 4), (ty * width + tx) * 4);
    }
  }
  return out;
}

export function frameFileName(clip: ClipKey, index: number): string {
  return `${clip}_${index}`;
}

export function toFrameFile(frame: SpriteFrame): SpriteFrameFile {
  return {
    kind: "sprite-frame",
    version: 1,
    width: frame.width,
    height: frame.height,
    layers: frame.layers,
    muzzle: frame.muzzle,
    ...(frame.muzzles && frame.muzzles.length > 1 ? { muzzles: frame.muzzles.map((point) => ({ ...point })) } : {}),
    flash: frame.flash,
  };
}

export function toClipsFile(clips: FrameClips): FrameClipsFile {
  return {
    kind: "sprite-clips",
    version: 1,
    unitId: clips.unitId,
    width: clips.width,
    height: clips.height,
    feet: clips.feet,
    clips: {
      idle: clips.clips.idle.map((_, index) => frameFileName("idle", index)),
      walk: clips.clips.walk.map((_, index) => frameFileName("walk", index)),
      fire: clips.clips.fire.map((_, index) => frameFileName("fire", index)),
      damaged: clips.clips.damaged.map((_, index) => frameFileName("damaged", index)),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPoint(value: unknown): value is PixelPoint {
  return isRecord(value) && Number.isInteger(value.x) && Number.isInteger(value.y);
}

export function fromFrameFile(value: unknown): SpriteFrame {
  if (!isRecord(value) || value.kind !== "sprite-frame" || value.version !== 1) {
    throw new Error("That file is not a sprite frame.");
  }
  const width = value.width;
  const height = value.height;
  if (typeof width !== "number" || typeof height !== "number" || !isRecord(value.layers)) {
    throw new Error("The sprite frame has no size or layers.");
  }
  const frame = emptyFrame(width, height);
  for (const layer of LAYER_ORDER) {
    const cells = value.layers[layer];
    if (
      !Array.isArray(cells) ||
      cells.length !== width * height ||
      !cells.every((slot) => Number.isInteger(slot) && slot >= 0 && slot <= 13)
    ) {
      throw new Error(`The ${layer} layer is not ${width}×${height} slots.`);
    }
    frame.layers[layer] = cells.slice() as number[];
  }
  frame.muzzle = isPoint(value.muzzle) ? { x: value.muzzle.x, y: value.muzzle.y } : null;
  if (Array.isArray(value.muzzles)) {
    const points = value.muzzles.filter(isPoint).map((point) => ({ x: point.x, y: point.y }));
    if (points.length > 1) {
      frame.muzzles = points;
    }
  }
  frame.flash = value.flash === true;
  return frame;
}

export function readClipsFile(value: unknown): FrameClipsFile {
  if (!isRecord(value) || value.kind !== "sprite-clips" || value.version !== 1 || !isRecord(value.clips) || !isPoint(value.feet)) {
    throw new Error("That file is not a sprite clip list.");
  }
  const clips = {} as Record<ClipKey, string[]>;
  for (const key of CLIP_KEYS) {
    const names = value.clips[key];
    if (key === "damaged" && names === undefined) {
      clips[key] = [];
      continue;
    }
    if (!Array.isArray(names) || !names.every((name) => typeof name === "string" && /^(idle|walk|fire|damaged)_\d+$/.test(name))) {
      throw new Error(`The ${CLIP_LABEL[key]} list is not frame names.`);
    }
    clips[key] = names as string[];
  }
  const smoke = isPoint(value.smoke) ? { x: value.smoke.x, y: value.smoke.y } : undefined;
  const muzzle = isPoint(value.muzzle) ? { x: value.muzzle.x, y: value.muzzle.y } : undefined;
  const flashFrames = indexList(value.flashFrames);
  const puffIdle = isRecord(value.puffFrames) ? indexList(value.puffFrames.idle) : undefined;
  const puffFire = isRecord(value.puffFrames) ? indexList(value.puffFrames.fire) : undefined;
  const puffFrames = puffIdle || puffFire ? { idle: puffIdle ?? [], fire: puffFire ?? [] } : undefined;
  return {
    kind: "sprite-clips",
    version: 1,
    unitId: String(value.unitId),
    width: Number(value.width),
    height: Number(value.height),
    feet: { x: value.feet.x, y: value.feet.y },
    clips,
    ...(smoke ? { smoke } : {}),
    ...(muzzle ? { muzzle } : {}),
    ...(flashFrames ? { flashFrames } : {}),
    ...(puffFrames ? { puffFrames } : {}),
  };
}

function indexList(value: unknown): number[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || !value.every((item) => Number.isInteger(item) && (item as number) >= 0)) {
    return undefined;
  }
  return value as number[];
}
