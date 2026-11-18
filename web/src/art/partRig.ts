import {
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
  /** A hand-placed muzzle, before the weapon's movement. Null uses the tip of the barrel. */
  muzzle: PixelPoint | null;
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

/** Turn a frame into pixels: each worn part's drawing for the pose, moved by the frame's movement. */
export function resolveFrame(rig: PartRig, frame: RigFrame): SpriteFrame {
  const layers = {} as Record<PartCategory, number[]>;
  for (const layer of LAYER_ORDER) {
    layers[layer] = shiftCells(drawingOf(rig, layer, frame.pose), rig.width, rig.height, frame.move[layer].x, frame.move[layer].y);
  }
  const tip = frame.muzzle ?? tipOf(drawingOf(rig, "weapon", frame.pose), rig.width, rig.height);
  return {
    width: rig.width,
    height: rig.height,
    layers,
    muzzle: tip ? { x: tip.x + frame.move.weapon.x, y: tip.y + frame.move.weapon.y } : null,
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
  const frames = { idle: [], walk: [], fire: [] } as Record<ClipKey, RigFrame[]>;

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

export function describeFrames(frames: readonly { clip: ClipKey; index: number }[]): string {
  return frames.map((item) => `${CLIP_LABEL[item.clip]} ${item.index}`).join(", ");
}

/** Paint one pixel of the worn part, as seen on a frame. The frame's movement is taken off first. */
export function paintPart(rig: PartRig, frame: RigFrame, layer: PartCategory, x: number, y: number, slot: number): PartRig {
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

/** Clear the pixel on every layer's worn part. */
export function erasePart(rig: PartRig, frame: RigFrame, x: number, y: number): PartRig {
  return LAYER_ORDER.reduce((next, layer) => paintPart(next, frame, layer, x, y, 0), rig);
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
  };
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
    !/^[a-z0-9_]+$/.test(id) ||
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
      !/^[a-z0-9_]+$/.test(build.id) ||
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
    clips: { idle: [], walk: [], fire: [] },
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
    const list = clips[key];
    if (!Array.isArray(list)) {
      throw new Error(`The ${CLIP_LABEL[key]} clip is not a list of frames.`);
    }
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
      return {
        pose: frame.pose as number,
        move,
        flash: frame.flash === true,
        muzzle: isPoint(frame.muzzle) ? { x: frame.muzzle.x, y: frame.muzzle.y } : null,
      };
    });
  }
  return rig;
}
