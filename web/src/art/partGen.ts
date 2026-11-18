import { AS_DRAWN_LUT, LAYER_NAME, LAYER_ORDER, commonSlot, sheetSlot } from "./frameClips";
import type { PartCategory } from "./paperDoll";
import { shiftCells, wornPart, type PartRig } from "./partRig";

/** The longest side the inpainting tool takes. */
export const GEN_MAX_SIDE = 256;
/** No picture is sent smaller than this on either side. */
export const GEN_MIN_SIDE = 64;
/** Painted behind the figure. No colour on the sheet is near it, so it reads back as empty. */
export const GEN_KEY: readonly [number, number, number] = [255, 0, 255];
/** Empty pixels kept around the figure in each cell of the picture. */
export const GEN_MARGIN = 3;
export const GEN_ROOM_MAX = 6;

/** One drawing the skeleton places on every pose, or a drawing for each pose. */
export type GenSpread = "one" | "each";

export interface GenRequest {
  layer: PartCategory;
  spread: GenSpread;
  /** The pose that is sent when one drawing is asked for. */
  pose: number;
  /** How many pixels past the worn head or weapon the new one may reach. Legs and torsos keep the outline. */
  room: number;
}

export interface GenBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One picture to send: the poses side by side, and the mask of pixels that may be repainted. */
export interface GenSheet {
  poses: number[];
  columns: number;
  /** Where the first pose's cell starts. A small picture is padded out, with the poses in the middle. */
  originX: number;
  originY: number;
  width: number;
  height: number;
  /** RGBA with no clear pixels. The key colour is behind the figure. */
  input: Uint8ClampedArray;
  /** RGBA. Solid where the picture may be repainted, clear everywhere else. */
  mask: Uint8ClampedArray;
}

export interface GenPlan {
  layer: PartCategory;
  spread: GenSpread;
  pose: number;
  /** The part of the frame each cell of a picture shows. */
  box: GenBox;
  /** By pose, the frame pixels that may be repainted. 1 is inside. Poses that are not sent are empty. */
  zones: number[][];
  sheets: GenSheet[];
}

export interface GenPicture {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface GenResult {
  /** One drawing for every pose of the rig. */
  drawings: number[][];
  /** Pixels taken from the pictures. */
  painted: number;
  /** Outline pixels filled from the worn part: hidden under another layer, or left empty by the pictures. */
  kept: number;
}

function isOutlined(layer: PartCategory): layer is "legs" | "torso" {
  return layer === "legs" || layer === "torso";
}

/** The layers drawn into the picture. A weapon is sent alone. Everything else is sent without the weapon across it. */
export function shownLayers(layer: PartCategory): PartCategory[] {
  return layer === "weapon" ? ["weapon"] : LAYER_ORDER.filter((name) => name !== "weapon");
}

function spread(cells: readonly boolean[], width: number, height: number, room: number): boolean[] {
  if (room <= 0) {
    return cells.slice();
  }
  const out = new Array<boolean>(width * height).fill(false);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!cells[y * width + x]) {
        continue;
      }
      for (let ty = Math.max(0, y - room); ty <= Math.min(height - 1, y + room); ty += 1) {
        for (let tx = Math.max(0, x - room); tx <= Math.min(width - 1, x + room); tx += 1) {
          out[ty * width + tx] = true;
        }
      }
    }
  }
  return out;
}

function drawingOf(rig: PartRig, layer: PartCategory, pose: number): readonly number[] {
  return wornPart(rig, layer).drawings[pose] ?? [];
}

/**
 * The pixels of one pose that may be repainted for a new part.
 * Legs and torsos get the skeleton's outline, less the pixels a layer above them hides. A head
 * gets the worn head and the empty pixels within reach of it, and never the body. A weapon gets
 * the worn weapon and everything within reach of it.
 */
export function genZone(rig: PartRig, layer: PartCategory, pose: number, room: number): number[] {
  const size = rig.width * rig.height;
  if (isOutlined(layer)) {
    const outline = rig.outlines[layer][pose] ?? [];
    const above = shownLayers(layer)
      .slice(LAYER_ORDER.indexOf(layer) + 1)
      .map((name) => drawingOf(rig, name, pose));
    return Array.from({ length: size }, (_, index) => (outline[index] === 1 && above.every((cells) => (cells[index] ?? 0) === 0) ? 1 : 0));
  }
  const own = drawingOf(rig, layer, pose);
  const reach = Math.max(0, Math.min(GEN_ROOM_MAX, Math.round(room)));
  const grown = spread(
    Array.from({ length: size }, (_, index) => (own[index] ?? 0) !== 0),
    rig.width,
    rig.height,
    reach,
  );
  if (layer === "weapon") {
    return grown.map((inside) => (inside ? 1 : 0));
  }
  const body = (["legs", "torso"] as const).map((name) => ({ cells: drawingOf(rig, name, pose), outline: rig.outlines[name][pose] ?? [] }));
  return grown.map((inside, index) => {
    const onBody = body.some(({ cells, outline }) => (cells[index] ?? 0) !== 0 || outline[index] === 1);
    return inside && ((own[index] ?? 0) !== 0 || !onBody) ? 1 : 0;
  });
}

function shownSlots(rig: PartRig, layer: PartCategory, pose: number): number[] {
  const out = new Array<number>(rig.width * rig.height).fill(0);
  for (const name of shownLayers(layer)) {
    const cells = drawingOf(rig, name, pose);
    for (let index = 0; index < out.length; index += 1) {
      const slot = cells[index] ?? 0;
      if (slot !== 0) {
        out[index] = slot;
      }
    }
  }
  if (layer !== "weapon") {
    // With the weapon off, the torso has holes where it lay. They are sent filled in, so the body reads as whole.
    const outline = rig.outlines.torso[pose] ?? [];
    const fill = commonSlot(drawingOf(rig, "torso", pose)) || 2;
    for (let index = 0; index < out.length; index += 1) {
      if (out[index] === 0 && outline[index] === 1) {
        out[index] = fill;
      }
    }
  }
  return out;
}

function rgbOf(hex: string): [number, number, number] {
  const rgb = Number.parseInt(hex.slice(1, 7), 16);
  return [(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255];
}

const INK: readonly [number, number, number][] = AS_DRAWN_LUT.slice(1).map(rgbOf);

function distance(r: number, g: number, b: number, to: readonly [number, number, number]): number {
  return (r - to[0]) ** 2 + (g - to[1]) ** 2 + (b - to[2]) ** 2;
}

/** A pixel is background when it is nearer the key colour than any colour on the sheet. */
export function isKeyColour(r: number, g: number, b: number): boolean {
  const key = distance(r, g, b, GEN_KEY);
  return INK.every((ink) => distance(r, g, b, ink) > key);
}

function columnsFor(count: number, maxColumns: number, maxRows: number): number {
  for (let columns = Math.min(maxColumns, Math.ceil(Math.sqrt(count))); columns < maxColumns; columns += 1) {
    if (Math.ceil(count / columns) <= maxRows) {
      return columns;
    }
  }
  return maxColumns;
}

/**
 * Work out the pictures to send for a new part. The poses sit side by side, cropped to the figure,
 * and as many go in one picture as its size allows. The mask marks the pixels the new part may cover.
 */
export function planGeneration(rig: PartRig, request: GenRequest): GenPlan {
  const { layer } = request;
  const name = LAYER_NAME[layer].toLowerCase();
  if (isOutlined(layer) && request.spread === "one") {
    throw new Error(`${LAYER_NAME[layer]} parts are drawn again on every pose, so a new one needs a drawing for each pose.`);
  }
  if (!Number.isInteger(request.pose) || request.pose < 0 || request.pose >= rig.poses) {
    throw new Error(`The rig has no pose ${request.pose}.`);
  }
  const poses = request.spread === "one" ? [request.pose] : Array.from({ length: rig.poses }, (_, pose) => pose);
  const size = rig.width * rig.height;
  const zones: number[][] = Array.from({ length: rig.poses }, () => []);
  const shown = new Map<number, number[]>();
  let x0 = rig.width;
  let y0 = rig.height;
  let x1 = -1;
  let y1 = -1;
  let editable = 0;
  for (const pose of poses) {
    const zone = genZone(rig, layer, pose, request.room);
    const slots = shownSlots(rig, layer, pose);
    zones[pose] = zone;
    shown.set(pose, slots);
    for (let index = 0; index < size; index += 1) {
      if (zone[index] === 1) {
        editable += 1;
      }
      if (zone[index] !== 1 && (slots[index] ?? 0) === 0) {
        continue;
      }
      const x = index % rig.width;
      const y = Math.floor(index / rig.width);
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  if (editable === 0) {
    throw new Error(`The worn ${name} part is empty here, so there is nothing to draw a new one over.`);
  }
  const box: GenBox = {
    x: Math.max(0, x0 - GEN_MARGIN),
    y: Math.max(0, y0 - GEN_MARGIN),
    width: 0,
    height: 0,
  };
  box.width = Math.min(rig.width - 1, x1 + GEN_MARGIN) - box.x + 1;
  box.height = Math.min(rig.height - 1, y1 + GEN_MARGIN) - box.y + 1;
  const maxColumns = Math.floor(GEN_MAX_SIDE / box.width);
  const maxRows = Math.floor(GEN_MAX_SIDE / box.height);
  if (maxColumns < 1 || maxRows < 1) {
    throw new Error(`One pose is ${box.width}×${box.height}. A picture can be ${GEN_MAX_SIDE}×${GEN_MAX_SIDE} at most.`);
  }
  const capacity = maxColumns * maxRows;
  const sheets: GenSheet[] = [];
  for (let start = 0; start < poses.length; start += capacity) {
    const batch = poses.slice(start, start + capacity);
    const columns = columnsFor(batch.length, maxColumns, maxRows);
    const rows = Math.ceil(batch.length / columns);
    // A lone head or weapon is a small crop. It is centred on a picture of a workable size.
    const width = Math.max(GEN_MIN_SIDE, columns * box.width);
    const height = Math.max(GEN_MIN_SIDE, rows * box.height);
    const originX = Math.floor((width - columns * box.width) / 2);
    const originY = Math.floor((height - rows * box.height) / 2);
    const input = new Uint8ClampedArray(width * height * 4);
    const mask = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < width * height; index += 1) {
      input.set([GEN_KEY[0], GEN_KEY[1], GEN_KEY[2], 255], index * 4);
    }
    batch.forEach((pose, at) => {
      const left = originX + (at % columns) * box.width;
      const top = originY + Math.floor(at / columns) * box.height;
      const zone = zones[pose] ?? [];
      const slots = shown.get(pose) ?? [];
      for (let y = 0; y < box.height; y += 1) {
        for (let x = 0; x < box.width; x += 1) {
          const from = (box.y + y) * rig.width + box.x + x;
          const to = ((top + y) * width + left + x) * 4;
          const slot = slots[from] ?? 0;
          const hex = AS_DRAWN_LUT[slot];
          if (slot !== 0 && hex) {
            input.set(rgbOf(hex), to);
          }
          if (zone[from] === 1) {
            mask.set([255, 255, 255, 255], to);
          }
        }
      }
    });
    sheets.push({ poses: batch, columns, originX, originY, width, height, input, mask });
  }
  return { layer, spread: request.spread, pose: request.pose, box, zones, sheets };
}

function readSheet(
  rig: PartRig,
  plan: GenPlan,
  sheet: GenSheet,
  picture: GenPicture,
  tally: { painted: number; kept: number },
): number[][] {
  const scale = picture.width / sheet.width;
  if (
    !Number.isInteger(scale) ||
    scale < 1 ||
    picture.height !== sheet.height * scale ||
    picture.rgba.length !== picture.width * picture.height * 4
  ) {
    throw new Error(`The picture came back ${picture.width}×${picture.height}. The one sent was ${sheet.width}×${sheet.height}.`);
  }
  const { layer, box } = plan;
  const middle = Math.floor(scale / 2);
  return sheet.poses.map((pose, at) => {
    const cells = new Array<number>(rig.width * rig.height).fill(0);
    const zone = plan.zones[pose] ?? [];
    const worn = drawingOf(rig, layer, pose);
    const fill = commonSlot(worn) || 2;
    const left = sheet.originX + (at % sheet.columns) * box.width;
    const top = sheet.originY + Math.floor(at / sheet.columns) * box.height;
    const outline = isOutlined(layer) ? (rig.outlines[layer][pose] ?? []) : null;
    for (let y = 0; y < box.height; y += 1) {
      for (let x = 0; x < box.width; x += 1) {
        const index = (box.y + y) * rig.width + box.x + x;
        if (zone[index] === 1) {
          const offset = (((top + y) * scale + middle) * picture.width + (left + x) * scale + middle) * 4;
          const r = picture.rgba[offset] ?? 0;
          const g = picture.rgba[offset + 1] ?? 0;
          const b = picture.rgba[offset + 2] ?? 0;
          if ((picture.rgba[offset + 3] ?? 0) >= 128 && !isKeyColour(r, g, b)) {
            cells[index] = sheetSlot(r, g, b, 255, layer);
            tally.painted += 1;
            continue;
          }
        }
        if (outline?.[index] === 1) {
          // A legs or torso part covers its whole outline. A pixel hidden under another layer,
          // or left empty by the picture, takes the worn part's colour.
          cells[index] = (worn[index] ?? 0) || fill;
          tally.kept += 1;
        }
      }
    }
    return cells;
  });
}

/**
 * Read the pictures that came back into drawings for a new part, one for every pose of the rig.
 * Only pixels inside the plan's zones are read, so legs and torsos come out on the skeleton's
 * outline whatever else was painted. The key colour and clear pixels are empty.
 */
export function harvestPart(rig: PartRig, plan: GenPlan, pictures: readonly GenPicture[]): GenResult {
  if (pictures.length !== plan.sheets.length) {
    throw new Error(`${plan.sheets.length} pictures were sent and ${pictures.length} came back.`);
  }
  const tally = { painted: 0, kept: 0 };
  const byPose = new Map<number, number[]>();
  plan.sheets.forEach((sheet, at) => {
    const picture = pictures[at];
    if (!picture) {
      return;
    }
    readSheet(rig, plan, sheet, picture, tally).forEach((cells, index) => {
      const pose = sheet.poses[index];
      if (pose !== undefined) {
        byPose.set(pose, cells);
      }
    });
  });
  if (tally.painted === 0) {
    throw new Error(`The picture came back with nothing painted where the ${LAYER_NAME[plan.layer].toLowerCase()} goes.`);
  }
  const blank = () => new Array<number>(rig.width * rig.height).fill(0);
  if (plan.spread === "one") {
    const drawing = byPose.get(plan.pose) ?? blank();
    const from = rig.anchors[plan.layer][plan.pose] ?? { x: 0, y: 0 };
    const drawings = Array.from({ length: rig.poses }, (_, pose) => {
      const to = rig.anchors[plan.layer][pose] ?? from;
      return shiftCells(drawing, rig.width, rig.height, to.x - from.x, to.y - from.y).slice();
    });
    return { drawings, ...tally };
  }
  return { drawings: Array.from({ length: rig.poses }, (_, pose) => byPose.get(pose) ?? blank()), ...tally };
}
