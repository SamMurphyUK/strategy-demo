import {
  AS_DRAWN_LUT,
  CLIP_KEYS,
  CLIP_LABEL,
  LAYER_NAME,
  LAYER_ORDER,
  cellsUnderWeapon,
  commonSlot,
  sheetSlot,
  type ClipKey,
  type FrameClips,
  type SpriteFrame,
} from "./frameClips";
import type { PartCategory, PixelPoint } from "./paperDoll";
import { EMBLEM_HEX, placementCells, type StampPlacement } from "./spriteStamps";

/** The layers whose parts must keep the skeleton's outline, pose by pose. */
export const OUTLINED_LAYERS = ["legs", "torso"] as const;
export type OutlinedLayer = (typeof OUTLINED_LAYERS)[number];

/** A named set of drawings for one layer: one drawing for every pose of the skeleton. */
export interface RigPart {
  id: string;
  name: string;
  layer: PartCategory;
  drawings: number[][];
}

export type LayerMoves = Record<PartCategory, PixelPoint>;

/** One frame of a clip: a pose of the skeleton, plus how far each layer is moved on this frame. */
export interface RigFrame {
  pose: number;
  move: LayerMoves;
  flash: boolean;
  /**
   * Hand-placed muzzle, in the muzzle layer's own space, before that layer moves.
   * Null on a soldier uses the tip of the weapon. The first of `muzzles` when there are several.
   */
  muzzle: PixelPoint | null;
  /** Every barrel tip, in the same space as `muzzle`. Absent on older frames, which have `muzzle` alone. */
  muzzles?: PixelPoint[];
  /** Exhaust on the hull, in the hull's own space, before the hull moves. */
  smoke?: PixelPoint;
  /** A section name, such as Idle 2 or Damage 1. Absent on the original clips. */
  name?: string;
}

/** One soldier out of the library: a part for each layer and a colour set, under a name. */
export interface RigBuild {
  id: string;
  name: string;
  wearing: Record<PartCategory, string>;
  /** The colour set it was saved in. The editor owns the list of colour sets. */
  colours: string;
}

export interface PartRig {
  unitId: string;
  width: number;
  height: number;
  /** Where the boots stand. The game card puts this pixel on its ground line. */
  feet: PixelPoint;
  poses: number;
  /** Per pose, where a layer sits compared with pose 0. One drawing is placed on every pose with these. */
  anchors: Record<PartCategory, PixelPoint[]>;
  /** Per pose, the pixels a legs or torso part has to cover. 1 is inside. */
  outlines: Record<OutlinedLayer, number[][]>;
  parts: RigPart[];
  wearing: Record<PartCategory, string>;
  clips: Record<ClipKey, RigFrame[]>;
  /** Saved choices of parts and colours, by name. */
  builds: RigBuild[];
  /** The layer a muzzle mark follows. Absent means the weapon, as on the soldier. */
  muzzleLayer?: PartCategory;
}

export interface RigFile {
  kind: "part-rig";
  version: 1;
  unitId: string;
  width: number;
  height: number;
  feet: PixelPoint;
  poses: number;
  anchors: Record<PartCategory, PixelPoint[]>;
  outlines: Record<OutlinedLayer, number[][]>;
  parts: { id: string; name: string; layer: PartCategory }[];
  wearing: Record<PartCategory, string>;
  clips: Record<ClipKey, RigFrame[]>;
  /** Files saved before builds existed have none. */
  builds?: RigBuild[];
  /** Files saved before vehicle layers have none, and the muzzles follow the weapon. */
  muzzleLayer?: PartCategory;
}

export interface PartFile {
  kind: "rig-part";
  version: 1;
  id: string;
  name: string;
  layer: PartCategory;
  width: number;
  height: number;
  drawings: number[][];
}

export function noMove(): LayerMoves {
  return { legs: { x: 0, y: 0 }, torso: { x: 0, y: 0 }, head: { x: 0, y: 0 }, weapon: { x: 0, y: 0 } };
}

function isOutlined(layer: PartCategory): layer is OutlinedLayer {
  return layer === "legs" || layer === "torso";
}

/** Slide a drawing. Pixels pushed off the frame are dropped. No movement returns the same array. */
export function shiftCells(cells: readonly number[], width: number, height: number, dx: number, dy: number): number[] {
  if (dx === 0 && dy === 0) {
    return cells as number[];
  }
  const out = new Array<number>(width * height).fill(0);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const slot = cells[y * width + x] ?? 0;
      const tx = x + dx;
      const ty = y + dy;
      if (slot !== 0 && tx >= 0 && ty >= 0 && tx < width && ty < height) {
        out[ty * width + tx] = slot;
      }
    }
  }
  return out;
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function boxOf(cells: readonly number[], width: number, height: number): Box | null {
  let box: Box | null = null;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((cells[y * width + x] ?? 0) === 0) {
        continue;
      }
      if (!box) {
        box = { x0: x, y0: y, x1: x, y1: y };
      } else {
        box.x0 = Math.min(box.x0, x);
        box.x1 = Math.max(box.x1, x);
        box.y1 = y;
      }
    }
  }
  return box;
}

/** The movement that turns one drawing into the other, pixel for pixel. Null when they are different drawings. */
export function exactShift(base: readonly number[], other: readonly number[], width: number, height: number): PixelPoint | null {
  const a = boxOf(base, width, height);
  const b = boxOf(other, width, height);
  if (!a && !b) {
    return { x: 0, y: 0 };
  }
  if (!a || !b) {
    return null;
  }
  const dx = b.x0 - a.x0;
  const dy = b.y0 - a.y0;
  if (a.x1 + dx !== b.x1 || a.y1 + dy !== b.y1) {
    return null;
  }
  for (let y = a.y0; y <= a.y1; y += 1) {
    for (let x = a.x0; x <= a.x1; x += 1) {
      if ((base[y * width + x] ?? 0) !== (other[(y + dy) * width + x + dx] ?? 0)) {
        return null;
      }
    }
  }
  return { x: dx, y: dy };
}

/** The movement that lines one drawing up with another as closely as it can. */
export function bestShift(base: readonly number[], other: readonly number[], width: number, height: number, reach = 8): PixelPoint {
  const cells: [number, number, number][] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const slot = base[y * width + x] ?? 0;
      if (slot !== 0) {
        cells.push([x, y, slot]);
      }
    }
  }
  let best: PixelPoint = { x: 0, y: 0 };
  let bestScore = -1;
  for (let dy = -reach; dy <= reach; dy += 1) {
    for (let dx = -reach; dx <= reach; dx += 1) {
      // A pixel landing on the same colour counts twice, and on another colour once.
      // The highest score is the fewest pixels that differ between the two drawings.
      let score = 0;
      for (const [x, y, slot] of cells) {
        const tx = x + dx;
        const ty = y + dy;
        if (tx < 0 || ty < 0 || tx >= width || ty >= height) {
          continue;
        }
        const there = other[ty * width + tx] ?? 0;
        if (there !== 0) {
          score += there === slot ? 2 : 1;
        }
      }
      const nearer = Math.abs(dx) + Math.abs(dy) < Math.abs(best.x) + Math.abs(best.y);
      if (score > bestScore || (score === bestScore && nearer)) {
        best = { x: dx, y: dy };
        bestScore = score;
      }
    }
  }
  return best;
}

/** The weapon pixel furthest right, then highest. */
function tipOf(cells: readonly number[], width: number, height: number): PixelPoint | null {
  let best: PixelPoint | null = null;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((cells[y * width + x] ?? 0) !== 0 && (!best || x > best.x)) {
        best = { x, y };
      }
    }
  }
  return best;
}

function outlineOf(layer: OutlinedLayer, drawing: readonly number[], weapon: readonly number[], width: number, height: number): number[] {
  const out = drawing.map((slot) => (slot !== 0 ? 1 : 0));
  if (layer === "torso") {
    for (const index of cellsUnderWeapon(drawing, weapon, width, height)) {
      out[index] = 1;
    }
  }
  return out;
}

export function partsOf(rig: PartRig, layer: PartCategory): RigPart[] {
  return rig.parts.filter((part) => part.layer === layer);
}

/** The part a layer is wearing. */
export function wornPart(rig: PartRig, layer: PartCategory): RigPart {
  const part = rig.parts.find((item) => item.id === rig.wearing[layer] && item.layer === layer) ?? partsOf(rig, layer)[0];
  if (!part) {
    throw new Error(`The rig has no ${LAYER_NAME[layer].toLowerCase()} part.`);
  }
  return part;
}

function blank(rig: PartRig): number[] {
  return new Array<number>(rig.width * rig.height).fill(0);
}

function drawingOf(rig: PartRig, layer: PartCategory, pose: number): number[] {
  return wornPart(rig, layer).drawings[pose] ?? blank(rig);
}

/** The barrel tips stored on a frame. An older frame has only `muzzle`. */
export function muzzlePoints(frame: RigFrame): PixelPoint[] {
  if (frame.muzzles && frame.muzzles.length > 0) {
    return frame.muzzles;
  }
  return frame.muzzle ? [frame.muzzle] : [];
}

/** Add a muzzle at this pixel, or take it off if one is already there. Points sit on `layer` and move with it. */
export function toggleMuzzle(frame: RigFrame, layer: PartCategory, x: number, y: number): RigFrame {
  const local = { x: x - frame.move[layer].x, y: y - frame.move[layer].y };
  const current = muzzlePoints(frame);
  const next = current.some((point) => point.x === local.x && point.y === local.y)
    ? current.filter((point) => point.x !== local.x || point.y !== local.y)
    : [...current, local];
  const cleared: RigFrame = { ...frame, muzzle: next[0] ? { x: next[0].x, y: next[0].y } : null };
  if (next.length === 0) {
    delete cleared.muzzles;
    return cleared;
  }
  cleared.muzzles = next.map((point) => ({ x: point.x, y: point.y }));
  return cleared;
}

/** Where the muzzles show on this frame, after the muzzle layer has moved. */
export function frameMuzzles(rig: PartRig, frame: RigFrame): PixelPoint[] {
  const layer = rig.muzzleLayer ?? "weapon";
  const stored = muzzlePoints(frame);
  if (stored.length > 0) {
    return stored.map((point) => ({ x: point.x + frame.move[layer].x, y: point.y + frame.move[layer].y }));
  }
  if (layer !== "weapon") {
    return [];
  }
  const tip = tipOf(drawingOf(rig, "weapon", frame.pose), rig.width, rig.height);
  return tip ? [{ x: tip.x + frame.move.weapon.x, y: tip.y + frame.move.weapon.y }] : [];
}

/** Turn a frame into pixels: each worn part's drawing for the pose, moved by the frame's movement. */
export function resolveFrame(rig: PartRig, frame: RigFrame): SpriteFrame {
  const layers = {} as Record<PartCategory, number[]>;
  for (const layer of LAYER_ORDER) {
    layers[layer] = shiftCells(drawingOf(rig, layer, frame.pose), rig.width, rig.height, frame.move[layer].x, frame.move[layer].y);
  }
  const tips = frameMuzzles(rig, frame);
  return {
    width: rig.width,
    height: rig.height,
    layers,
    muzzle: tips[0] ?? null,
    ...(tips.length > 1 ? { muzzles: tips } : {}),
    flash: frame.flash,
  };
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function freshPartId(rig: Pick<PartRig, "parts">, layer: PartCategory, name: string): string {
  const base = `${layer}_${slug(name) || "part"}`;
  let id = base;
  for (let count = 2; rig.parts.some((part) => part.id === id); count += 1) {
    id = `${base}_${count}`;
  }
  return id;
}

/**
 * Build the rig from painted frames. Every walking frame becomes a pose of the skeleton, and each
 * layer becomes a part with one drawing per pose. A frame in Idle or Firing that is a walking pose
 * moved about becomes that pose plus movement. A frame painted differently becomes its own pose.
 */
export function rigFromClips(clips: FrameClips): PartRig {
  const walk = clips.clips.walk;
  if (walk.length === 0) {
    throw new Error("Walking has no frames, so there is no skeleton to build.");
  }
  const { width, height } = clips;
  const drawings = { legs: [], torso: [], head: [], weapon: [] } as Record<PartCategory, number[][]>;
  const frames = { idle: [], walk: [], fire: [], damaged: [] } as Record<ClipKey, RigFrame[]>;

  const addPose = (frame: SpriteFrame): number => {
    for (const layer of LAYER_ORDER) {
      drawings[layer].push(frame.layers[layer].slice());
    }
    return drawings.legs.length - 1;
  };

  const pin = (frame: SpriteFrame, pose: number, move: LayerMoves): PixelPoint | null => {
    if (!frame.muzzle) {
      return null;
    }
    const placed = { x: frame.muzzle.x - move.weapon.x, y: frame.muzzle.y - move.weapon.y };
    const tip = tipOf(drawings.weapon[pose] ?? [], width, height);
    return tip && tip.x === placed.x && tip.y === placed.y ? null : placed;
  };

  for (const frame of walk) {
    const pose = addPose(frame);
    const move = noMove();
    frames.walk.push({ pose, move, flash: frame.flash, muzzle: pin(frame, pose, move) });
  }

  const asPose = (frame: SpriteFrame): RigFrame => {
    let found: { pose: number; move: LayerMoves; distance: number } | null = null;
    for (let pose = 0; pose < drawings.legs.length; pose += 1) {
      const move = noMove();
      let distance = 0;
      let fits = true;
      for (const layer of LAYER_ORDER) {
        const shift = exactShift(drawings[layer][pose] ?? [], frame.layers[layer], width, height);
        if (!shift) {
          fits = false;
          break;
        }
        move[layer] = shift;
        distance += Math.abs(shift.x) + Math.abs(shift.y);
      }
      if (fits && (!found || distance < found.distance)) {
        found = { pose, move, distance };
      }
    }
    if (found) {
      return { pose: found.pose, move: found.move, flash: frame.flash, muzzle: pin(frame, found.pose, found.move) };
    }
    const pose = addPose(frame);
    const move = noMove();
    return { pose, move, flash: frame.flash, muzzle: pin(frame, pose, move) };
  };

  for (const frame of clips.clips.idle) {
    frames.idle.push(asPose(frame));
  }
  for (const frame of clips.clips.fire) {
    frames.fire.push(asPose(frame));
  }
  for (const frame of clips.clips.damaged) {
    frames.damaged.push(asPose(frame));
  }

  const poses = drawings.legs.length;
  const anchors = {} as Record<PartCategory, PixelPoint[]>;
  for (const layer of LAYER_ORDER) {
    const first = drawings[layer][0] ?? [];
    anchors[layer] = drawings[layer].map((drawing, pose) => (pose === 0 ? { x: 0, y: 0 } : bestShift(first, drawing, width, height)));
  }
  const outlines = {
    legs: drawings.legs.map((drawing, pose) => outlineOf("legs", drawing, drawings.weapon[pose] ?? [], width, height)),
    torso: drawings.torso.map((drawing, pose) => outlineOf("torso", drawing, drawings.weapon[pose] ?? [], width, height)),
  };
  const parts: RigPart[] = LAYER_ORDER.map((layer) => ({
    id: `${layer}_original`,
    name: `Original ${LAYER_NAME[layer].toLowerCase()}`,
    layer,
    drawings: drawings[layer],
  }));
  return {
    unitId: clips.unitId,
    width,
    height,
    feet: { ...clips.feet },
    poses,
    anchors,
    outlines,
    parts,
    wearing: { legs: "legs_original", torso: "torso_original", head: "head_original", weapon: "weapon_original" },
    clips: frames,
    builds: [],
  };
}

function withPart(rig: PartRig, part: RigPart): PartRig {
  return { ...rig, parts: rig.parts.map((item) => (item.id === part.id ? part : item)) };
}

function withDrawing(rig: PartRig, part: RigPart, pose: number, cells: number[]): PartRig {
  return withPart(rig, { ...part, drawings: part.drawings.map((drawing, at) => (at === pose ? cells : drawing)) });
}

export function withRigFrame(rig: PartRig, clip: ClipKey, index: number, frame: RigFrame): PartRig {
  if (rig.clips[clip][index] === frame) {
    return rig;
  }
  return { ...rig, clips: { ...rig.clips, [clip]: rig.clips[clip].map((item, at) => (at === index ? frame : item)) } };
}

/** Every frame that shows a pose. Painting the pose changes all of them. */
export function framesOnPose(rig: PartRig, pose: number): { clip: ClipKey; index: number }[] {
  return CLIP_KEYS.flatMap((clip) => rig.clips[clip].flatMap((frame, index) => (frame.pose === pose ? [{ clip, index }] : [])));
}

/** A vehicle's Walking tab reads as Moving once Damaged has frames. */
export function isVehicleClipSet(clips: Record<ClipKey, readonly unknown[]>): boolean {
  return clips.damaged.length > 0;
}

export function clipTitle(key: ClipKey, vehicle: boolean): string {
  return vehicle && key === "walk" ? "Moving" : CLIP_LABEL[key];
}

export function describeFrames(
  frames: readonly { clip: ClipKey; index: number }[],
  title: (key: ClipKey) => string = (key) => CLIP_LABEL[key],
): string {
  const groups: { clip: ClipKey; indexes: number[] }[] = [];
  for (const item of frames) {
    const last = groups[groups.length - 1];
    if (last && last.clip === item.clip) {
      last.indexes.push(item.index);
    } else {
      groups.push({ clip: item.clip, indexes: [item.index] });
    }
  }
  return groups.map((group) => `${title(group.clip)} ${indexSpan(group.indexes)}`).join(", ");
}

function indexSpan(indexes: readonly number[]): string {
  const sorted = [...indexes].sort((left, right) => left - right);
  const runs: string[] = [];
  let start = sorted[0];
  let previous = sorted[0];
  if (start === undefined || previous === undefined) {
    return "";
  }
  const flush = (end: number) => {
    runs.push(start === end ? `${start}` : `${start}-${end}`);
  };
  for (const index of sorted.slice(1)) {
    if (index === previous + 1) {
      previous = index;
      continue;
    }
    flush(previous);
    start = index;
    previous = index;
  }
  flush(previous);
  return runs.join(", ");
}

function setOutlineMark(rig: PartRig, layer: PartCategory, pose: number, index: number, mark: 0 | 1): PartRig {
  if (!isOutlined(layer) || index < 0) {
    return rig;
  }
  const outline = rig.outlines[layer][pose];
  if (!outline || outline[index] === mark) {
    return rig;
  }
  const row = outline.slice();
  row[index] = mark;
  return {
    ...rig,
    outlines: {
      ...rig.outlines,
      [layer]: rig.outlines[layer].map((item, at) => (at === pose ? row : item)),
    },
  };
}

/** A painted edge-neighbour on the part, or 0 when the square no longer touches that part. */
function edgeNeighbourSlot(cells: readonly number[], width: number, height: number, x: number, y: number): number {
  const around = [
    [x - 1, y],
    [x + 1, y],
    [x, y - 1],
    [x, y + 1],
  ];
  for (const [nx, ny] of around) {
    if (nx === undefined || ny === undefined || nx < 0 || ny < 0 || nx >= width || ny >= height) {
      continue;
    }
    const slot = cells[ny * width + nx] ?? 0;
    if (slot !== 0) {
      return slot;
    }
  }
  return 0;
}

/** Write one pixel of the worn part. Other layers are left as they are. */
function writePartCell(rig: PartRig, frame: RigFrame, layer: PartCategory, x: number, y: number, slot: number): PartRig {
  const inFrame = (cx: number, cy: number) =>
    Number.isInteger(cx) && Number.isInteger(cy) && cx >= 0 && cy >= 0 && cx < rig.width && cy < rig.height;
  const px = x - frame.move[layer].x;
  const py = y - frame.move[layer].y;
  if (!inFrame(x, y) || !inFrame(px, py)) {
    return rig;
  }
  const part = wornPart(rig, layer);
  const drawing = part.drawings[frame.pose];
  if (!drawing) {
    return rig;
  }
  const next = Math.max(0, Math.min(13, Math.round(slot)));
  const index = py * rig.width + px;
  if ((drawing[index] ?? 0) === next) {
    return rig;
  }
  const cells = drawing.slice();
  cells[index] = next;
  return withDrawing(rig, part, frame.pose, cells);
}

/** Take this frame square off every worn part except `keep`. */
function clearOtherLayers(rig: PartRig, frame: RigFrame, keep: PartCategory, x: number, y: number): PartRig {
  let next = rig;
  for (const layer of LAYER_ORDER) {
    if (layer === keep) {
      continue;
    }
    next = writePartCell(next, frame, layer, x, y, 0);
  }
  return next;
}

function paintLands(rig: PartRig, frame: RigFrame, layer: PartCategory, x: number, y: number): boolean {
  const onCanvas = (cx: number, cy: number) =>
    Number.isInteger(cx) && Number.isInteger(cy) && cx >= 0 && cy >= 0 && cx < rig.width && cy < rig.height;
  const px = x - frame.move[layer].x;
  const py = y - frame.move[layer].y;
  return onCanvas(x, y) && onCanvas(px, py) && wornPart(rig, layer).drawings[frame.pose] !== undefined;
}

/**
 * Paint one pixel of the worn part, as seen on a frame. The frame's movement is taken off first.
 * A colour takes that square off the other layers. Clearing a square leaves the other layers.
 */
export function paintPart(rig: PartRig, frame: RigFrame, layer: PartCategory, x: number, y: number, slot: number): PartRig {
  const next = writePartCell(rig, frame, layer, x, y, slot);
  if (Math.max(0, Math.min(13, Math.round(slot))) === 0 || !paintLands(rig, frame, layer, x, y)) {
    return next;
  }
  return clearOtherLayers(next, frame, layer, x, y);
}

/** Clear the pixel on every layer's worn part. */
export function erasePart(rig: PartRig, frame: RigFrame, x: number, y: number): PartRig {
  return LAYER_ORDER.reduce((next, layer) => paintPart(next, frame, layer, x, y, 0), rig);
}

/**
 * Replace the connected squares of one colour on the worn part, as seen on a frame.
 * Squares join by their edges. A corner does not join them. The frame's movement is taken off first.
 */
export function fillPart(rig: PartRig, frame: RigFrame, layer: PartCategory, x: number, y: number, slot: number): PartRig {
  const inFrame = (cx: number, cy: number) =>
    Number.isInteger(cx) && Number.isInteger(cy) && cx >= 0 && cy >= 0 && cx < rig.width && cy < rig.height;
  const px = x - frame.move[layer].x;
  const py = y - frame.move[layer].y;
  if (!inFrame(x, y) || !inFrame(px, py)) {
    return rig;
  }
  const part = wornPart(rig, layer);
  const drawing = part.drawings[frame.pose];
  if (!drawing) {
    return rig;
  }
  const colour = Math.max(0, Math.min(13, Math.round(slot)));
  const width = rig.width;
  const start = py * width + px;
  const from = drawing[start] ?? 0;
  if (from === colour) {
    return rig;
  }
  const cells = drawing.slice();
  const seen = new Uint8Array(width * rig.height);
  const stack = [start];
  seen[start] = 1;
  while (stack.length > 0) {
    const index = stack.pop();
    if (index === undefined || (drawing[index] ?? 0) !== from) {
      continue;
    }
    cells[index] = colour;
    const cx = index % width;
    const cy = (index - cx) / width;
    const neighbours = [
      cx > 0 ? index - 1 : -1,
      cx < width - 1 ? index + 1 : -1,
      cy > 0 ? index - width : -1,
      cy < rig.height - 1 ? index + width : -1,
    ];
    for (const neighbour of neighbours) {
      if (neighbour >= 0 && seen[neighbour] === 0 && (drawing[neighbour] ?? 0) === from) {
        seen[neighbour] = 1;
        stack.push(neighbour);
      }
    }
  }
  let painted = withDrawing(rig, part, frame.pose, cells);
  // Recolouring ink takes those squares off the other layers. A fill of empty ground does not,
  // because that flood covers the canvas around the picture.
  if (colour !== 0 && from !== 0) {
    const move = frame.move[layer];
    for (let index = 0; index < cells.length; index += 1) {
      if (cells[index] === (drawing[index] ?? 0)) {
        continue;
      }
      const cx = index % width;
      const cy = (index - cx) / width;
      painted = clearOtherLayers(painted, frame, layer, cx + move.x, cy + move.y);
    }
  }
  return painted;
}

/** Idle's first frame. Layer splits are taken from this picture. */
export function idleSource(rig: PartRig): RigFrame {
  const idle = rig.clips.idle[0];
  if (idle) {
    return idle;
  }
  for (const key of CLIP_KEYS) {
    const frame = rig.clips[key][0];
    if (frame) {
      return frame;
    }
  }
  throw new Error("This sprite has no frames.");
}

function sameCells(a: readonly number[] | undefined, b: readonly number[] | undefined): boolean {
  if (!a || !b || a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false;
    }
  }
  return true;
}

/**
 * After a change to Idle 0's picture, write that picture onto every other pose that was
 * still a copy of it. A pose that has already been drawn differently stays as it is.
 */
export function feedIdleCopies(before: PartRig, after: PartRig): PartRig {
  const pose = idleSource(before).pose;
  let next = after;
  for (let other = 0; other < before.poses; other += 1) {
    if (other === pose) {
      continue;
    }
    const copy = LAYER_ORDER.every((layer) => {
      const worn = wornPart(before, layer);
      return sameCells(worn.drawings[other], worn.drawings[pose]);
    });
    if (!copy) {
      continue;
    }
    for (const layer of LAYER_ORDER) {
      const part = wornPart(next, layer);
      const cells = part.drawings[pose];
      if (cells) {
        next = withDrawing(next, part, other, cells.slice());
      }
    }
  }
  return next;
}

/**
 * Move the ink that shows inside a region onto one layer, on the pose this frame shows.
 * That square is taken off the other layers. A pixel already on that layer stays.
 * Filling the hole puts the colour back only where the part it left still touches the square.
 * A part moved off entirely is not painted back, and its outline no longer includes the square.
 * The rig is unchanged when nothing moves.
 */
export function sendShownToLayer(
  rig: PartRig,
  frame: RigFrame,
  region: { width: number; height: number; cells: ArrayLike<number> },
  to: PartCategory,
  heal: boolean,
): { rig: PartRig; moved: number } {
  if (region.width !== rig.width || region.height !== rig.height || region.cells.length !== rig.width * rig.height) {
    throw new Error(`The selection is ${region.width}×${region.height}. The frame is ${rig.width}×${rig.height}.`);
  }
  const shown = resolveFrame(rig, frame);
  const toIndex = LAYER_ORDER.indexOf(to);
  let next = rig;
  let moved = 0;
  const vacated: { layer: PartCategory; x: number; y: number }[] = [];
  for (let y = 0; y < rig.height; y += 1) {
    for (let x = 0; x < rig.width; x += 1) {
      if ((region.cells[y * rig.width + x] ?? 0) === 0) {
        continue;
      }
      let owner: PartCategory | null = null;
      let slot = 0;
      for (let index = LAYER_ORDER.length - 1; index >= 0; index -= 1) {
        const layer = LAYER_ORDER[index] ?? "legs";
        const value = shown.layers[layer][y * rig.width + x] ?? 0;
        if (value !== 0) {
          owner = layer;
          slot = value;
          break;
        }
      }
      if (!owner || owner === to) {
        continue;
      }
      const px = x - frame.move[to].x;
      const py = y - frame.move[to].y;
      const onPart = px >= 0 && py >= 0 && px < rig.width && py < rig.height;
      if (!onPart) {
        continue;
      }
      let step = writePartCell(next, frame, to, x, y, slot);
      step = clearOtherLayers(step, frame, to, x, y);
      if (isOutlined(to)) {
        step = setOutlineMark(step, to, frame.pose, py * rig.width + px, 1);
      }
      if (step === next) {
        continue;
      }
      next = step;
      vacated.push({ layer: owner, x, y });
      moved += 1;
    }
  }
  const restored = new Set<string>();
  if (heal) {
    const pending: { layer: PartCategory; x: number; y: number; slot: number }[] = [];
    for (const cell of vacated) {
      if (LAYER_ORDER.indexOf(cell.layer) >= toIndex) {
        continue;
      }
      const drawing = wornPart(next, cell.layer).drawings[frame.pose];
      if (!drawing) {
        continue;
      }
      const px = cell.x - frame.move[cell.layer].x;
      const py = cell.y - frame.move[cell.layer].y;
      const slot = edgeNeighbourSlot(drawing, rig.width, rig.height, px, py);
      if (slot !== 0) {
        pending.push({ layer: cell.layer, x: cell.x, y: cell.y, slot });
      }
    }
    for (const cell of pending) {
      next = writePartCell(next, frame, cell.layer, cell.x, cell.y, cell.slot);
      restored.add(`${cell.layer}:${cell.x}:${cell.y}`);
    }
  }
  for (const cell of vacated) {
    for (const layer of ["legs", "torso"] as const) {
      if (layer === to || restored.has(`${layer}:${cell.x}:${cell.y}`)) {
        continue;
      }
      const px = cell.x - frame.move[layer].x;
      const py = cell.y - frame.move[layer].y;
      if (px < 0 || py < 0 || px >= rig.width || py >= rig.height) {
        continue;
      }
      next = setOutlineMark(next, layer, frame.pose, py * rig.width + px, 0);
    }
  }
  return { rig: next, moved };
}

/**
 * The part of a box or lasso that sits on painted pixels. Empty ground cannot be selected.
 */
export function paintedSelection(
  shown: { width: number; height: number; layers: Record<PartCategory, ArrayLike<number>> },
  region: { width: number; height: number; cells: ArrayLike<number> },
): { width: number; height: number; cells: Uint8Array } {
  if (region.width !== shown.width || region.height !== shown.height || region.cells.length !== shown.width * shown.height) {
    throw new Error(`The selection is ${region.width}×${region.height}. The frame is ${shown.width}×${shown.height}.`);
  }
  const cells = new Uint8Array(shown.width * shown.height);
  for (let index = 0; index < cells.length; index += 1) {
    if ((region.cells[index] ?? 0) === 0) {
      continue;
    }
    const painted = LAYER_ORDER.some((name) => (shown.layers[name][index] ?? 0) !== 0);
    if (painted) {
      cells[index] = 1;
    }
  }
  return { width: shown.width, height: shown.height, cells };
}

/**
 * Move the ink under the brush onto one layer, keeping each pixel's colour.
 * That square is taken off the other layers. Empty ground stays empty.
 * A pixel already on that layer stays.
 */
export function claimBrush(
  rig: PartRig,
  frame: RigFrame,
  layer: PartCategory,
  x: number,
  y: number,
  size = 1,
  heal = false,
): PartRig {
  const span = Math.max(1, Math.min(8, Math.round(size) || 1));
  const origin = -Math.floor((span - 1) / 2);
  const cells = new Uint8Array(rig.width * rig.height);
  for (let dy = 0; dy < span; dy += 1) {
    for (let dx = 0; dx < span; dx += 1) {
      const cx = x + origin + dx;
      const cy = y + origin + dy;
      if (cx >= 0 && cy >= 0 && cx < rig.width && cy < rig.height) {
        cells[cy * rig.width + cx] = 1;
      }
    }
  }
  return sendShownToLayer(rig, frame, { width: rig.width, height: rig.height, cells }, layer, heal).rig;
}

/** Paint a square of the worn part, centred on the pixel under the pencil. */
export function paintBrush(
  rig: PartRig,
  frame: RigFrame,
  layer: PartCategory,
  x: number,
  y: number,
  slot: number,
  size = 1,
): PartRig {
  const span = Math.max(1, Math.min(8, Math.round(size) || 1));
  const origin = -Math.floor((span - 1) / 2);
  let next = rig;
  for (let dy = 0; dy < span; dy += 1) {
    for (let dx = 0; dx < span; dx += 1) {
      next = paintPart(next, frame, layer, x + origin + dx, y + origin + dy, slot);
    }
  }
  return next;
}

/**
 * Recolour the worn part's painted pixels on this pose. An outlined layer only changes
 * pixels inside the outline. Empty ground stays empty.
 */
export function fillLayerInk(rig: PartRig, frame: RigFrame, layer: PartCategory, slot: number): PartRig {
  const part = wornPart(rig, layer);
  const drawing = part.drawings[frame.pose];
  if (!drawing) {
    return rig;
  }
  const outline = isOutlined(layer) ? rig.outlines[layer][frame.pose] : null;
  const next = Math.max(0, Math.min(13, Math.round(slot)));
  let changed = false;
  const cells = drawing.slice();
  for (let index = 0; index < cells.length; index += 1) {
    if ((cells[index] ?? 0) === 0) {
      continue;
    }
    if (outline && outline[index] !== 1) {
      continue;
    }
    if (cells[index] !== next) {
      cells[index] = next;
      changed = true;
    }
  }
  return changed ? withDrawing(rig, part, frame.pose, cells) : rig;
}

/**
 * Move leftover sprite pixels onto `layer`. A pixel already on a layer other than `seat`
 * stays there. Pixels inside `region` stay where they are. Empty ground is left alone.
 */
export function claimUnselected(
  rig: PartRig,
  frame: RigFrame,
  layer: PartCategory,
  region: { width: number; height: number; cells: ArrayLike<number> } | null,
  seat: PartCategory,
): { rig: PartRig; moved: number } {
  if (region && (region.width !== rig.width || region.height !== rig.height || region.cells.length !== rig.width * rig.height)) {
    throw new Error(`The selection is ${region.width}×${region.height}. The frame is ${rig.width}×${rig.height}.`);
  }
  const shown = resolveFrame(rig, frame);
  let next = rig;
  let moved = 0;
  for (let y = 0; y < rig.height; y += 1) {
    for (let x = 0; x < rig.width; x += 1) {
      const index = y * rig.width + x;
      if (region && (region.cells[index] ?? 0) !== 0) {
        continue;
      }
      let owner: PartCategory | null = null;
      let slot = 0;
      for (let at = LAYER_ORDER.length - 1; at >= 0; at -= 1) {
        const name = LAYER_ORDER[at] ?? "legs";
        const value = shown.layers[name][index] ?? 0;
        if (value !== 0) {
          owner = name;
          slot = value;
          break;
        }
      }
      if (!owner || owner === layer || owner !== seat) {
        continue;
      }
      let step = writePartCell(next, frame, layer, x, y, slot);
      step = writePartCell(step, frame, owner, x, y, 0);
      if (step === next) {
        continue;
      }
      next = step;
      moved += 1;
    }
  }
  return { rig: next, moved };
}

/** Gun metal. Build Animation steps pixels of this slot along a tread or a propeller. */
export const STEEL_SLOT = 12;

export interface MotionBuild {
  /** Body shift on the second walk frame and on the shot. Positive is down. */
  bob: number;
  /** How far the weapon kicks back on the shot. The torso takes half. */
  recoil: number;
  /** How far gun metal steps on the first walk frame. */
  stride: number;
  /** Across a tread, or down toward the lower wingtip. */
  along: "x" | "y";
  /** The layer whose gun metal steps. The other layers bob. */
  links: PartCategory;
}

/**
 * Turn ink on the worn part into gun metal, inside a region of the frame.
 * Stripes keep every other column, counted from the feet. Empty cells stay empty.
 */
export function paintSteel(
  rig: PartRig,
  frame: RigFrame,
  layer: PartCategory,
  region: { width: number; height: number; cells: ArrayLike<number> },
  stripes: boolean,
  block = 1,
): PartRig {
  if (region.width !== rig.width || region.height !== rig.height || region.cells.length !== rig.width * rig.height) {
    throw new Error(`The selection is ${region.width}×${region.height}. The frame is ${rig.width}×${rig.height}.`);
  }
  const part = wornPart(rig, layer);
  const drawing = part.drawings[frame.pose];
  if (!drawing) {
    return rig;
  }
  const cells = drawing.slice();
  const move = frame.move[layer];
  const side = Math.max(1, Math.floor(block));
  let changed = false;
  for (let y = 0; y < rig.height; y += 1) {
    for (let x = 0; x < rig.width; x += 1) {
      if ((region.cells[y * rig.width + x] ?? 0) === 0) {
        continue;
      }
      const px = x - move.x;
      const py = y - move.y;
      if (px < 0 || py < 0 || px >= rig.width || py >= rig.height) {
        continue;
      }
      const index = py * rig.width + px;
      if ((cells[index] ?? 0) === 0 || cells[index] === STEEL_SLOT) {
        continue;
      }
      if (stripes) {
        const column = Math.floor((x - rig.feet.x) / side);
        if ((((column % 2) + 2) % 2) !== 0) {
          continue;
        }
      }
      cells[index] = STEEL_SLOT;
      changed = true;
    }
  }
  return changed ? withDrawing(rig, part, frame.pose, cells) : rig;
}

/**
 * The next phase of gun metal. Along a tread, each run of ink steps its gun metal to the right and
 * the colours it covered close up behind it. Toward the wingtip, each dash steps down and leaves a gap.
 * Gun metal that would leave the run, or the frame, is dropped.
 */
export function stepSteel(cells: readonly number[], width: number, height: number, stride: number, along: "x" | "y"): number[] {
  const step = Math.max(1, Math.floor(stride));
  if (along === "y") {
    const next = cells.map((slot) => (slot === STEEL_SLOT ? 0 : slot));
    for (let y = 0; y < height; y += 1) {
      const below = y + step;
      if (below >= height) {
        continue;
      }
      for (let x = 0; x < width; x += 1) {
        if ((cells[y * width + x] ?? 0) === STEEL_SLOT) {
          next[below * width + x] = STEEL_SLOT;
        }
      }
    }
    return next;
  }
  const body = fillBehind(cells);
  const next = cells.slice();
  for (let y = 0; y < height; y += 1) {
    let start = 0;
    while (start < width) {
      if ((cells[y * width + start] ?? 0) === 0) {
        start += 1;
        continue;
      }
      let end = start;
      while (end + 1 < width && (cells[y * width + end + 1] ?? 0) !== 0) {
        end += 1;
      }
      const colours: number[] = [];
      let steel = false;
      for (let x = start; x <= end; x += 1) {
        const slot = cells[y * width + x] ?? 0;
        if (slot === STEEL_SLOT) {
          steel = true;
        } else if (slot !== 0) {
          colours.push(slot);
        }
      }
      if (steel) {
        let used = 0;
        let last = 0;
        for (let x = start; x <= end; x += 1) {
          const index = y * width + x;
          if (x - step >= start && (cells[y * width + (x - step)] ?? 0) === STEEL_SLOT) {
            next[index] = STEEL_SLOT;
            continue;
          }
          const colour = colours[used] ?? (last || body || STEEL_SLOT);
          used += 1;
          last = colour;
          next[index] = colour;
        }
      }
      start = end + 1;
    }
  }
  return next;
}

/**
 * Replace Walking and Firing from one pose. The first walk frame steps gun metal on `links`.
 * The second shifts every other layer by the bob. Firing kicks the weapon back, the torso half as far,
 * and bobs the same layers. Idle is left as it is.
 */
export function buildMotion(rig: PartRig, frame: RigFrame, motion: MotionBuild): PartRig {
  const bob = Math.trunc(motion.bob);
  const recoil = Math.max(0, Math.trunc(motion.recoil));
  const half = Math.round(recoil / 2);
  const sourceDrawing = wornPart(rig, motion.links).drawings[frame.pose] ?? blank(rig);
  const stepped = stepSteel(sourceDrawing, rig.width, rig.height, motion.stride, motion.along);
  const steppedChanged = stepped.some((slot, index) => slot !== (sourceDrawing[index] ?? 0));
  let next = rig;
  let stepPose = frame.pose;
  if (steppedChanged) {
    next = withExtraPose(rig, frame.pose);
    stepPose = next.poses - 1;
    next = withDrawing(next, wornPart(next, motion.links), stepPose, stepped);
  }
  const bobMove = noMove();
  for (const name of LAYER_ORDER) {
    if (name !== motion.links) {
      bobMove[name] = { x: 0, y: bob };
    }
  }
  const fireMove = noMove();
  for (const name of LAYER_ORDER) {
    if (name !== motion.links) {
      fireMove[name] = { x: 0, y: bob };
    }
  }
  fireMove.torso = motion.links === "torso" ? { x: -half, y: 0 } : { x: -half, y: bob };
  fireMove.weapon = motion.links === "weapon" ? { x: -recoil, y: 0 } : { x: -recoil, y: bob };
  const muzzle = frame.muzzle ? { x: frame.muzzle.x, y: frame.muzzle.y } : null;
  const muzzles = frame.muzzles?.map((point) => ({ x: point.x, y: point.y }));
  const marks = muzzles && muzzles.length > 0 ? { muzzle: muzzles[0] ?? null, muzzles } : { muzzle };
  return {
    ...next,
    clips: {
      ...next.clips,
      walk: [
        { pose: stepPose, move: noMove(), flash: false, ...marks },
        { pose: frame.pose, move: bobMove, flash: false, ...marks },
      ],
      fire: [{ pose: frame.pose, move: fireMove, flash: true, ...marks }],
    },
  };
}

function fillBehind(cells: readonly number[]): number {
  const counts = new Map<number, number>();
  let best = 0;
  let most = 0;
  for (const slot of cells) {
    if (slot === 0 || slot === STEEL_SLOT) {
      continue;
    }
    const count = (counts.get(slot) ?? 0) + 1;
    counts.set(slot, count);
    if (count > most) {
      most = count;
      best = slot;
    }
  }
  return best;
}

function withExtraPose(rig: PartRig, pose: number): PartRig {
  const parts = rig.parts.map((part) => ({
    ...part,
    drawings: [...part.drawings, (part.drawings[pose] ?? blank(rig)).slice()],
  }));
  const anchors = {} as Record<PartCategory, PixelPoint[]>;
  for (const layer of LAYER_ORDER) {
    const from = rig.anchors[layer][pose] ?? { x: 0, y: 0 };
    anchors[layer] = [...rig.anchors[layer], { x: from.x, y: from.y }];
  }
  return {
    ...rig,
    poses: rig.poses + 1,
    parts,
    anchors,
    outlines: {
      legs: [...rig.outlines.legs, (rig.outlines.legs[pose] ?? blank(rig)).slice()],
      torso: [...rig.outlines.torso, (rig.outlines.torso[pose] ?? blank(rig)).slice()],
    },
  };
}

/** Move one layer on one frame. This is a number on the frame, so it stays when the part is swapped. */
export function moveLayer(frame: RigFrame, layer: PartCategory, dx: number, dy: number): RigFrame {
  if (dx === 0 && dy === 0) {
    return frame;
  }
  return { ...frame, move: { ...frame.move, [layer]: { x: frame.move[layer].x + dx, y: frame.move[layer].y + dy } } };
}

export function clearMoves(frame: RigFrame): RigFrame {
  return LAYER_ORDER.every((layer) => frame.move[layer].x === 0 && frame.move[layer].y === 0) ? frame : { ...frame, move: noMove() };
}

/** A copy of the frame with the head and torso one pixel higher. */
export function breathFrame(frame: RigFrame): RigFrame {
  return moveLayer(moveLayer({ ...frame }, "head", 0, -1), "torso", 0, -1);
}

/** A copy of the frame with the weapon two pixels back and the flash on. */
export function shotFrame(frame: RigFrame): RigFrame {
  return { ...moveLayer(frame, "weapon", -2, 0), flash: true };
}

/** Slide the worn part's drawing on one pose. This changes the drawing, so every frame on the pose follows. */
export function slideDrawing(rig: PartRig, layer: PartCategory, pose: number, dx: number, dy: number): PartRig {
  const part = wornPart(rig, layer);
  const drawing = part.drawings[pose];
  if (!drawing || (dx === 0 && dy === 0) || !drawing.some((slot) => slot !== 0)) {
    return rig;
  }
  return withDrawing(rig, part, pose, shiftCells(drawing, rig.width, rig.height, dx, dy));
}

/** Paint the worn torso under the worn weapon on every pose, so any weapon can sit over it. */
export function fillTorsoUnderWeapon(rig: PartRig): PartRig {
  const torso = wornPart(rig, "torso");
  const weapon = wornPart(rig, "weapon");
  let changed = false;
  const drawings = torso.drawings.map((drawing, pose) => {
    const fill = commonSlot(drawing);
    const under = fill === 0 ? [] : cellsUnderWeapon(drawing, weapon.drawings[pose] ?? [], rig.width, rig.height);
    if (under.length === 0) {
      return drawing;
    }
    changed = true;
    const cells = drawing.slice();
    for (const index of under) {
      cells[index] = fill;
    }
    return cells;
  });
  return changed ? withPart(rig, { ...torso, drawings }) : rig;
}

function pictureCells(
  layer: PartCategory,
  rgba: Uint8ClampedArray,
  pictureWidth: number,
  left: number,
  width: number,
  height: number,
): number[] {
  const cells = new Array<number>(width * height).fill(0);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * pictureWidth + left + x) * 4;
      cells[y * width + x] = sheetSlot(rgba[offset] ?? 0, rgba[offset + 1] ?? 0, rgba[offset + 2] ?? 0, rgba[offset + 3] ?? 0, layer);
    }
  }
  return cells;
}

function drawnChannels(hex: string): [number, number, number] {
  const body = hex.replace("#", "");
  return [Number.parseInt(body.slice(0, 2), 16), Number.parseInt(body.slice(2, 4), 16), Number.parseInt(body.slice(4, 6), 16)];
}

/**
 * Paint each stamp onto the layer that already covers that pixel, on the idle pose.
 * A pixel with nothing under it goes on `fallback`, which is the body the picture was seated on.
 * The rig is unchanged when the stamps are already there.
 */
export function paintCoveringStamps(rig: PartRig, stamps: readonly StampPlacement[], fallback: PartCategory = "torso"): PartRig {
  if (stamps.length === 0 || rig.poses < 1) {
    return rig;
  }
  const pose = 0;
  const drawings = {} as Record<PartCategory, number[]>;
  for (const layer of LAYER_ORDER) {
    drawings[layer] = drawingOf(rig, layer, pose).slice();
  }
  const count = rig.width * rig.height;
  const ink = new Uint8Array(count);
  for (const layer of LAYER_ORDER) {
    const drawing = drawings[layer];
    for (let index = 0; index < count; index += 1) {
      if ((drawing[index] ?? 0) !== 0) {
        ink[index] = 1;
      }
    }
  }
  const onSprite = (x: number, y: number) => x >= 0 && y >= 0 && x < rig.width && y < rig.height && ink[y * rig.width + x] === 1;
  let changed = false;
  for (const placement of stamps) {
    for (const cell of placementCells({ width: rig.width, height: rig.height }, placement, onSprite)) {
      const index = cell.y * rig.width + cell.x;
      let owner: PartCategory | null = null;
      for (let at = LAYER_ORDER.length - 1; at >= 0; at -= 1) {
        const layer = LAYER_ORDER[at] ?? fallback;
        if ((drawings[layer][index] ?? 0) !== 0) {
          owner = layer;
          break;
        }
      }
      const target = owner ?? fallback;
      const [red, green, blue] = drawnChannels(EMBLEM_HEX[cell.slot] ?? "#000000");
      const slot = nearestDrawnSlot(red, green, blue);
      if ((drawings[target][index] ?? 0) === slot) {
        continue;
      }
      drawings[target][index] = slot;
      changed = true;
    }
  }
  if (!changed) {
    return rig;
  }
  let next = rig;
  for (const layer of LAYER_ORDER) {
    const part = wornPart(next, layer);
    const before = part.drawings[pose] ?? [];
    if (drawings[layer].some((value, index) => value !== (before[index] ?? 0))) {
      next = withDrawing(next, part, pose, drawings[layer]);
    }
  }
  for (const layer of OUTLINED_LAYERS) {
    const outline = next.outlines[layer][pose];
    if (!outline) {
      continue;
    }
    const drawing = drawings[layer];
    let dirty = false;
    const filled = outline.slice();
    for (let index = 0; index < count; index += 1) {
      if ((drawing[index] ?? 0) !== 0 && filled[index] !== 1) {
        filled[index] = 1;
        dirty = true;
      }
    }
    if (dirty) {
      next = {
        ...next,
        outlines: {
          ...next.outlines,
          [layer]: next.outlines[layer].map((item, at) => (at === pose ? filled : item)),
        },
      };
    }
  }
  return next;
}

/** Nearest of the 13 editor colours. Slot 0 stays empty, so ink never lands on it. */
function nearestDrawnSlot(r: number, g: number, b: number): number {
  let best = 1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let slot = 1; slot <= 13; slot += 1) {
    const [tr, tg, tb] = drawnChannels(AS_DRAWN_LUT[slot] ?? "#000000");
    const distance = (r - tr) ** 2 + (g - tg) ** 2 + (b - tb) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = slot;
    }
  }
  return best;
}

/** One still picture as a rig. Every pixel sits on the torso. The other layers start empty. */
export function rigFromPicture(unitId: string, rgba: Uint8ClampedArray, width: number, height: number): PartRig {
  if (width < 1 || height < 1 || rgba.length < width * height * 4) {
    throw new Error(`The picture is ${width}×${height}, which does not match its pixels.`);
  }
  const torso = new Array<number>(width * height).fill(0);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    const alpha = rgba[offset + 3] ?? 0;
    if (alpha < 128) {
      continue;
    }
    torso[index] = nearestDrawnSlot(rgba[offset] ?? 0, rgba[offset + 1] ?? 0, rgba[offset + 2] ?? 0);
  }
  const empty = new Array<number>(width * height).fill(0);
  let footX = Math.floor(width / 2);
  let footY = height - 1;
  for (let y = height - 1; y >= 0; y -= 1) {
    let left = -1;
    let right = -1;
    for (let x = 0; x < width; x += 1) {
      if (torso[y * width + x] !== 0) {
        if (left < 0) {
          left = x;
        }
        right = x;
      }
    }
    if (left >= 0) {
      footX = Math.floor((left + right) / 2);
      footY = y;
      break;
    }
  }
  const drawings: Record<PartCategory, number[][]> = {
    legs: [empty.slice()],
    torso: [torso],
    head: [empty.slice()],
    weapon: [empty.slice()],
  };
  const parts: RigPart[] = LAYER_ORDER.map((layer) => ({
    id: layer === "torso" ? "torso_picture" : `${layer}_empty`,
    name: layer === "torso" ? "Picture" : `Empty ${LAYER_NAME[layer].toLowerCase()}`,
    layer,
    drawings: drawings[layer],
  }));
  return {
    unitId,
    width,
    height,
    feet: { x: footX, y: footY },
    poses: 1,
    anchors: { legs: [{ x: 0, y: 0 }], torso: [{ x: 0, y: 0 }], head: [{ x: 0, y: 0 }], weapon: [{ x: 0, y: 0 }] },
    outlines: { legs: [empty.slice()], torso: [empty.slice()] },
    parts,
    wearing: { legs: "legs_empty", torso: "torso_picture", head: "head_empty", weapon: "weapon_empty" },
    clips: { idle: [{ pose: 0, move: noMove(), flash: false, muzzle: null }], walk: [], fire: [], damaged: [] },
    builds: [],
  };
}

/** Move the loaded picture off the torso and onto `layer`. The torso is left empty. */
export function seatPicture(rig: PartRig, layer: PartCategory): PartRig {
  if (layer === "torso") {
    return rig;
  }
  const source = wornPart(rig, "torso");
  const target = wornPart(rig, layer);
  const blank = (drawing: number[]) => drawing.map(() => 0);
  return {
    ...rig,
    parts: rig.parts.map((part) => {
      if (part.id === target.id) {
        return { ...part, name: "Picture", drawings: source.drawings.map((drawing) => drawing.slice()) };
      }
      if (part.id === source.id) {
        return { ...part, name: "Empty torso", drawings: source.drawings.map(blank) };
      }
      return part;
    }),
  };
}

/** Rename the empty parts to the layers the editor is showing. The picture keeps its name. */
export function renameEmptyParts(rig: PartRig, labelFor: (layer: PartCategory) => string | null): PartRig {
  return {
    ...rig,
    parts: rig.parts.map((part) => {
      const label = labelFor(part.layer);
      if (!label || part.name === "Picture" || !part.name.startsWith("Empty ")) {
        return part;
      }
      const name = `Empty ${label.toLowerCase()}`;
      return name === part.name ? part : { ...part, name };
    }),
  };
}

function stillFrames(count: number): RigFrame[] {
  return Array.from({ length: count }, () => ({ pose: 0, move: noMove(), flash: false, muzzle: null }));
}

/**
 * Idle 4, Moving 8, Firing 2, Damaged 2.
 * Every frame shows the still picture (pose 0) and keeps its own movement, so a later edit does not alias.
 */
export function withVehicleClips(rig: PartRig): PartRig {
  return {
    ...rig,
    clips: {
      idle: stillFrames(4),
      walk: stillFrames(8),
      fire: stillFrames(2),
      damaged: stillFrames(2),
    },
  };
}

/** Put a frame-sized picture onto the worn part, on the pose a frame shows. */
export function placePicture(
  rig: PartRig,
  frame: RigFrame,
  layer: PartCategory,
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): PartRig {
  if (width !== rig.width || height !== rig.height) {
    throw new Error(`The picture is ${width}×${height}. A frame is ${rig.width}×${rig.height}.`);
  }
  const part = wornPart(rig, layer);
  const cells = shiftCells(pictureCells(layer, rgba, width, 0, width, height), width, height, -frame.move[layer].x, -frame.move[layer].y);
  return withDrawing(rig, part, frame.pose, cells);
}

export function wearPart(rig: PartRig, layer: PartCategory, id: string): PartRig {
  if (rig.wearing[layer] === id || !rig.parts.some((part) => part.id === id && part.layer === layer)) {
    return rig;
  }
  return { ...rig, wearing: { ...rig.wearing, [layer]: id } };
}

function addPart(rig: PartRig, layer: PartCategory, name: string, drawings: number[][]): PartRig {
  const label = name.trim() || `${LAYER_NAME[layer]} ${partsOf(rig, layer).length + 1}`;
  const part: RigPart = { id: freshPartId(rig, layer, label), name: label, layer, drawings };
  return { ...rig, parts: [...rig.parts, part], wearing: { ...rig.wearing, [layer]: part.id } };
}

/** Copy the worn part under a new name and wear the copy. It starts on the same outline, pose for pose. */
export function copyPart(rig: PartRig, layer: PartCategory, name: string): PartRig {
  return addPart(
    rig,
    layer,
    name,
    wornPart(rig, layer).drawings.map((drawing) => drawing.slice()),
  );
}

/**
 * Make a part from a picture and wear it. A picture one frame wide is one drawing, and the
 * skeleton places it on every pose. A strip one frame wide per pose is drawn pose by pose.
 */
export function partFromPicture(
  rig: PartRig,
  layer: PartCategory,
  name: string,
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): PartRig {
  if (height === rig.height && width === rig.width) {
    const drawing = pictureCells(layer, rgba, width, 0, rig.width, rig.height);
    const drawings = rig.anchors[layer].map((anchor) => shiftCells(drawing, rig.width, rig.height, anchor.x, anchor.y).slice());
    return addPart(rig, layer, name, drawings);
  }
  if (height === rig.height && width === rig.width * rig.poses) {
    const drawings = Array.from({ length: rig.poses }, (_, pose) =>
      pictureCells(layer, rgba, width, pose * rig.width, rig.width, rig.height),
    );
    return addPart(rig, layer, name, drawings);
  }
  throw new Error(
    `The picture is ${width}×${height}. A part is ${rig.width}×${rig.height} for one drawing, or ${rig.width * rig.poses}×${rig.height} for one drawing per pose.`,
  );
}

/** Make a part from finished drawings, one for every pose, and wear it. */
export function partFromDrawings(rig: PartRig, layer: PartCategory, name: string, drawings: readonly (readonly number[])[]): PartRig {
  if (drawings.length !== rig.poses || drawings.some((drawing) => drawing.length !== rig.width * rig.height)) {
    throw new Error(
      `These drawings do not fit the rig. It needs ${rig.poses} drawings of ${rig.width}×${rig.height}, and got ${drawings.length}.`,
    );
  }
  return addPart(
    rig,
    layer,
    name,
    drawings.map((drawing) => drawing.slice()),
  );
}

export function renamePart(rig: PartRig, id: string, name: string): PartRig {
  const part = rig.parts.find((item) => item.id === id);
  const label = name.trim();
  return !part || label === "" || part.name === label ? rig : withPart(rig, { ...part, name: label });
}

/** Take a part out of the library. The last part of a layer stays. */
export function removePart(rig: PartRig, id: string): PartRig {
  const part = rig.parts.find((item) => item.id === id);
  if (!part) {
    return rig;
  }
  const others = partsOf(rig, part.layer).filter((item) => item.id !== id);
  const fallback = others[0];
  if (!fallback) {
    throw new Error(`“${part.name}” is the only ${LAYER_NAME[part.layer].toLowerCase()} part.`);
  }
  return {
    ...rig,
    parts: rig.parts.filter((item) => item.id !== id),
    wearing: rig.wearing[part.layer] === id ? { ...rig.wearing, [part.layer]: fallback.id } : rig.wearing,
  };
}

/**
 * Save what the rig is wearing, and the colour set, under a name.
 * A name already in use is saved over. Capitals and spaces at the ends do not make a new name.
 */
export function saveBuild(rig: PartRig, name: string, colours: string): PartRig {
  const label = name.trim();
  if (label === "") {
    throw new Error("Type a name for the build first.");
  }
  const wearing = { ...rig.wearing };
  const existing = rig.builds.find((build) => build.name.toLowerCase() === label.toLowerCase());
  if (existing) {
    return { ...rig, builds: rig.builds.map((build) => (build === existing ? { ...existing, name: label, wearing, colours } : build)) };
  }
  const base = slug(label) || "build";
  let id = base;
  for (let count = 2; rig.builds.some((build) => build.id === id); count += 1) {
    id = `${base}_${count}`;
  }
  return { ...rig, builds: [...rig.builds, { id, name: label, wearing, colours }] };
}

/** The layers of a build whose part is no longer in the library. */
export function buildGaps(rig: PartRig, build: RigBuild): PartCategory[] {
  return LAYER_ORDER.filter((layer) => !rig.parts.some((part) => part.id === build.wearing[layer] && part.layer === layer));
}

/** Put a saved build's parts on. A layer whose part has been deleted keeps what it is wearing. */
export function wearBuild(rig: PartRig, id: string): PartRig {
  const build = rig.builds.find((item) => item.id === id);
  if (!build) {
    return rig;
  }
  return LAYER_ORDER.reduce((next, layer) => wearPart(next, layer, build.wearing[layer]), rig);
}

export function removeBuild(rig: PartRig, id: string): PartRig {
  return rig.builds.some((build) => build.id === id) ? { ...rig, builds: rig.builds.filter((build) => build.id !== id) } : rig;
}

/** The saved build that matches what the rig is wearing in these colours, if there is one. */
export function wornBuild(rig: PartRig, colours: string): RigBuild | null {
  return (
    rig.builds.find((build) => build.colours === colours && LAYER_ORDER.every((layer) => build.wearing[layer] === rig.wearing[layer])) ??
    null
  );
}

/** Use one pose's drawing on every pose of the worn part, placed by the skeleton. */
export function spreadDrawing(rig: PartRig, layer: PartCategory, pose: number): PartRig {
  const part = wornPart(rig, layer);
  const drawing = part.drawings[pose];
  const from = rig.anchors[layer][pose];
  if (!drawing || !from) {
    return rig;
  }
  const drawings = part.drawings.map((current, at) => {
    const to = rig.anchors[layer][at];
    return at === pose || !to ? current : shiftCells(drawing, rig.width, rig.height, to.x - from.x, to.y - from.y).slice();
  });
  return withPart(rig, { ...part, drawings });
}

export interface OutlineFit {
  /** Painted pixels that fall outside the outline. */
  outside: number;
  /** Outline pixels with nothing painted. */
  missing: number;
}

/** How a legs or torso part sits on the skeleton's outline, on one pose or across all of them. */
export function outlineFit(rig: PartRig, part: RigPart, pose?: number): OutlineFit | null {
  if (!isOutlined(part.layer)) {
    return null;
  }
  const fit = { outside: 0, missing: 0 };
  const poses = pose === undefined ? part.drawings.map((_, at) => at) : [pose];
  for (const at of poses) {
    const outline = rig.outlines[part.layer][at];
    const drawing = part.drawings[at];
    if (!outline || !drawing) {
      continue;
    }
    for (let index = 0; index < outline.length; index += 1) {
      const painted = (drawing[index] ?? 0) !== 0;
      if (painted && outline[index] !== 1) {
        fit.outside += 1;
      } else if (!painted && outline[index] === 1) {
        fit.missing += 1;
      }
    }
  }
  return fit;
}

/** Clear every pixel of the worn legs or torso that falls outside the outline, on all poses. */
export function trimToOutline(rig: PartRig, layer: PartCategory): PartRig {
  if (!isOutlined(layer)) {
    return rig;
  }
  const part = wornPart(rig, layer);
  let changed = false;
  const drawings = part.drawings.map((drawing, pose) => {
    const outline = rig.outlines[layer][pose];
    if (!outline || !drawing.some((slot, index) => slot !== 0 && outline[index] !== 1)) {
      return drawing;
    }
    changed = true;
    return drawing.map((slot, index) => (outline[index] === 1 ? slot : 0));
  });
  return changed ? withPart(rig, { ...part, drawings }) : rig;
}

/**
 * Take the skeleton's outline again from the worn legs or torso, pose by pose.
 * Use it after the walk itself has been redrawn, so new parts are held to the cleaned-up shape.
 */
export function retakeOutline(rig: PartRig, layer: PartCategory): PartRig {
  if (!isOutlined(layer)) {
    return rig;
  }
  const part = wornPart(rig, layer);
  const weapon = wornPart(rig, "weapon");
  let changed = false;
  const outlines = Array.from({ length: rig.poses }, (_, pose) => {
    const current = rig.outlines[layer][pose];
    const next = outlineOf(layer, part.drawings[pose] ?? blank(rig), weapon.drawings[pose] ?? blank(rig), rig.width, rig.height);
    if (current && next.every((inside, index) => inside === current[index])) {
      return current;
    }
    changed = true;
    return next;
  });
  return changed ? { ...rig, outlines: { ...rig.outlines, [layer]: outlines } } : rig;
}

/**
 * Give a frame a pose of its own, so it can be repainted without changing the frames it was copied from.
 * Every part in the library gets a drawing for the new pose, with the frame's movement drawn in.
 */
export function ownPose(rig: PartRig, clip: ClipKey, index: number): PartRig {
  const frame = rig.clips[clip][index];
  if (!frame) {
    return rig;
  }
  const pose = rig.poses;
  const moved = (layer: PartCategory, cells: readonly number[]) =>
    shiftCells(cells, rig.width, rig.height, frame.move[layer].x, frame.move[layer].y).slice();
  const parts = rig.parts.map((part) => ({
    ...part,
    drawings: [...part.drawings, moved(part.layer, part.drawings[frame.pose] ?? blank(rig))],
  }));
  const anchors = {} as Record<PartCategory, PixelPoint[]>;
  for (const layer of LAYER_ORDER) {
    const from = rig.anchors[layer][frame.pose] ?? { x: 0, y: 0 };
    anchors[layer] = [...rig.anchors[layer], { x: from.x + frame.move[layer].x, y: from.y + frame.move[layer].y }];
  }
  const outlines = {
    legs: [...rig.outlines.legs, moved("legs", rig.outlines.legs[frame.pose] ?? blank(rig))],
    torso: [...rig.outlines.torso, moved("torso", rig.outlines.torso[frame.pose] ?? blank(rig))],
  };
  const next: PartRig = { ...rig, poses: pose + 1, parts, anchors, outlines };
  return withRigFrame(next, clip, index, { ...frame, pose, move: noMove() });
}

/** A part as one strip, a frame wide per pose. This is the picture saved beside the part. */
export function partStrip(rig: PartRig, part: RigPart): { width: number; height: number; cells: number[] } {
  const width = rig.width * rig.poses;
  const cells = new Array<number>(width * rig.height).fill(0);
  part.drawings.forEach((drawing, pose) => {
    for (let y = 0; y < rig.height; y += 1) {
      for (let x = 0; x < rig.width; x += 1) {
        cells[y * width + pose * rig.width + x] = drawing[y * rig.width + x] ?? 0;
      }
    }
  });
  return { width, height: rig.height, cells };
}

export function toRigFile(rig: PartRig): RigFile {
  return {
    kind: "part-rig",
    version: 1,
    unitId: rig.unitId,
    width: rig.width,
    height: rig.height,
    feet: rig.feet,
    poses: rig.poses,
    anchors: rig.anchors,
    outlines: rig.outlines,
    parts: rig.parts.map((part) => ({ id: part.id, name: part.name, layer: part.layer })),
    wearing: rig.wearing,
    clips: rig.clips,
    builds: rig.builds,
    ...(rig.muzzleLayer ? { muzzleLayer: rig.muzzleLayer } : {}),
  };
}

/** One file that holds the rig and every part, so Download and Open can round-trip without the dev server. */
export function rigBundle(rig: PartRig): { rig: RigFile; parts: PartFile[] } {
  return { rig: toRigFile(rig), parts: rig.parts.map((part) => toPartFile(rig, part)) };
}

/** Open a file written by `rigBundle`. */
export function rigFromBundle(value: unknown): PartRig {
  if (!isRecord(value) || !("rig" in value) || !Array.isArray(value.parts)) {
    throw new Error("That file is not a rig with its parts.");
  }
  return assembleRig(value.rig, value.parts);
}

export function toPartFile(rig: PartRig, part: RigPart): PartFile {
  return {
    kind: "rig-part",
    version: 1,
    id: part.id,
    name: part.name,
    layer: part.layer,
    width: rig.width,
    height: rig.height,
    drawings: part.drawings,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPoint(value: unknown): value is PixelPoint {
  return isRecord(value) && Number.isInteger(value.x) && Number.isInteger(value.y);
}

function isLayer(value: unknown): value is PartCategory {
  return typeof value === "string" && (LAYER_ORDER as readonly string[]).includes(value);
}

function readCells(value: unknown, size: number, top: number, what: string): number[] {
  if (!Array.isArray(value) || value.length !== size || !value.every((slot) => Number.isInteger(slot) && slot >= 0 && slot <= top)) {
    throw new Error(`${what} is not the right size.`);
  }
  return value.slice() as number[];
}

export function readPartFile(value: unknown): PartFile {
  if (!isRecord(value) || value.kind !== "rig-part" || value.version !== 1) {
    throw new Error("That file is not a part.");
  }
  const { id, name, layer, width, height, drawings } = value;
  if (
    typeof id !== "string" ||
    !/^[a-zA-Z0-9_]+$/.test(id) ||
    typeof name !== "string" ||
    !isLayer(layer) ||
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Array.isArray(drawings)
  ) {
    throw new Error("The part file is missing its name, layer, size or drawings.");
  }
  return {
    kind: "rig-part",
    version: 1,
    id,
    name,
    layer,
    width,
    height,
    drawings: drawings.map((drawing, pose) => readCells(drawing, width * height, 13, `“${name}” pose ${pose}`)),
  };
}

function readBuilds(value: unknown): RigBuild[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("The rig's builds are not a list.");
  }
  return value.map((build) => {
    if (
      !isRecord(build) ||
      typeof build.id !== "string" ||
      !/^[a-zA-Z0-9_]+$/.test(build.id) ||
      typeof build.name !== "string" ||
      build.name.trim() === "" ||
      typeof build.colours !== "string" ||
      !isRecord(build.wearing)
    ) {
      throw new Error("A saved build is missing its name, colours or parts.");
    }
    const wearing = {} as Record<PartCategory, string>;
    for (const layer of LAYER_ORDER) {
      const id = build.wearing[layer];
      if (typeof id !== "string") {
        throw new Error(`The build “${build.name}” has no ${layer} part.`);
      }
      wearing[layer] = id;
    }
    return { id: build.id, name: build.name, wearing, colours: build.colours };
  });
}

/** Put a saved rig back together from its file and the part files it lists. */
export function assembleRig(value: unknown, partFiles: readonly unknown[]): PartRig {
  if (!isRecord(value) || value.kind !== "part-rig" || value.version !== 1) {
    throw new Error("That file is not a rig.");
  }
  const { unitId, width, height, feet, poses, anchors, outlines, wearing, clips } = value;
  if (
    typeof unitId !== "string" ||
    typeof width !== "number" ||
    typeof height !== "number" ||
    typeof poses !== "number" ||
    !isPoint(feet) ||
    !isRecord(anchors) ||
    !isRecord(outlines) ||
    !isRecord(wearing) ||
    !isRecord(clips)
  ) {
    throw new Error("The rig file is missing its size, poses or clips.");
  }
  const parts: RigPart[] = partFiles.map((file) => {
    const part = readPartFile(file);
    if (part.width !== width || part.height !== height || part.drawings.length !== poses) {
      throw new Error(`“${part.name}” does not have one ${width}×${height} drawing for each of the ${poses} poses.`);
    }
    return { id: part.id, name: part.name, layer: part.layer, drawings: part.drawings };
  });
  const rig: PartRig = {
    unitId,
    width,
    height,
    feet: { x: feet.x, y: feet.y },
    poses,
    anchors: {} as Record<PartCategory, PixelPoint[]>,
    outlines: { legs: [], torso: [] },
    parts,
    wearing: {} as Record<PartCategory, string>,
    clips: { idle: [], walk: [], fire: [], damaged: [] },
    builds: readBuilds(value.builds),
  };
  for (const layer of LAYER_ORDER) {
    const list = anchors[layer];
    if (!Array.isArray(list) || list.length !== poses || !list.every(isPoint)) {
      throw new Error(`The ${layer} anchors do not cover the ${poses} poses.`);
    }
    rig.anchors[layer] = list.map((point) => ({ x: point.x, y: point.y }));
    const worn = wearing[layer];
    const fallback = parts.find((part) => part.layer === layer);
    if (!fallback) {
      throw new Error(`The rig has no ${layer} part.`);
    }
    rig.wearing[layer] = parts.some((part) => part.id === worn && part.layer === layer) ? String(worn) : fallback.id;
  }
  for (const layer of OUTLINED_LAYERS) {
    const list = outlines[layer];
    if (!Array.isArray(list) || list.length !== poses) {
      throw new Error(`The ${layer} outline does not cover the ${poses} poses.`);
    }
    rig.outlines[layer] = list.map((outline, pose) => readCells(outline, width * height, 1, `The ${layer} outline on pose ${pose}`));
  }
  for (const key of CLIP_KEYS) {
    const listed = clips[key] ?? (key === "damaged" ? [] : undefined);
    if (!Array.isArray(listed)) {
      throw new Error(`The ${CLIP_LABEL[key]} clip is not a list of frames.`);
    }
    const list = listed;
    rig.clips[key] = list.map((frame, index) => {
      if (
        !isRecord(frame) ||
        !Number.isInteger(frame.pose) ||
        (frame.pose as number) < 0 ||
        (frame.pose as number) >= poses ||
        !isRecord(frame.move)
      ) {
        throw new Error(`${CLIP_LABEL[key]} ${index} does not name a pose.`);
      }
      const move = noMove();
      for (const layer of LAYER_ORDER) {
        const point = frame.move[layer];
        if (isPoint(point)) {
          move[layer] = { x: point.x, y: point.y };
        }
      }
      const stored = Array.isArray(frame.muzzles) ? frame.muzzles.filter(isPoint).map((point) => ({ x: point.x, y: point.y })) : [];
      const muzzle = isPoint(frame.muzzle) ? { x: frame.muzzle.x, y: frame.muzzle.y } : (stored[0] ?? null);
      const name = typeof frame.name === "string" ? frame.name.trim() : "";
      const smoke = isPoint(frame.smoke) ? { x: frame.smoke.x, y: frame.smoke.y } : undefined;
      return {
        pose: frame.pose as number,
        move,
        flash: frame.flash === true,
        muzzle,
        ...(stored.length > 0 ? { muzzles: stored } : {}),
        ...(smoke ? { smoke } : {}),
        ...(name !== "" ? { name } : {}),
      };
    });
  }
  if (LAYER_ORDER.includes(value.muzzleLayer as PartCategory)) {
    rig.muzzleLayer = value.muzzleLayer as PartCategory;
  }
  return rig;
}
