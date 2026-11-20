import { composite } from "./frameClips";
import { emblemCells, type EmblemBitmap } from "./emblems";
import type { PartCategory } from "./paperDoll";
import { resolveFrame, wornPart, type PartRig, type RigFrame } from "./partRig";
import type { EmblemSlotKey } from "./skeletonSchema";

/**
 * The Stamp tool for the frame editor: national emblems on a part, at the frame's own size. No DOM.
 *
 * A frame holds slots 0–13, and the files are read back only when every cell is in that range. The
 * emblem's six colours are fixed ones that no slot holds exactly, crimson and cream above all. So each
 * emblem colour goes to a slot whose colour is the same in every country's table, the nearest that
 * keeps the dark outline, the lit edge and the shaded edge apart:
 *
 *   dark     charcoal   → 13 gun shadow (charcoal, exact)
 *   red      crimson    →  5 gear (plum, the darkest red the soldier carries)
 *   red lit  terracotta → 10 skin shadow (terracotta, exact)
 *   white    cream      →  9 skin mid (tan, the lightest fixed colour)
 *   white shaded bone   →  8 skin highlight (bone, exact)
 *   blue     steel      → 12 gun metal (steel, exact)
 *   grey     feldgrau   →  4 webbing (taupe, the nearest grey every country shares)
 *   moss     spruce     →  7 wood (khaki, the nearest green-brown every country shares)
 *
 * The emblem keeps its shape and its lighting in every colour set, but the red reads as plum and the
 * white as tan. The sheet's own colours (As drawn) put cream in slot 8, so there the white and its
 * shaded edge swap.
 */
export const EMBLEM_FRAME_SLOT: Readonly<Record<EmblemSlotKey, number>> = {
  emblem_dark: 13,
  emblem_red: 5,
  emblem_red_light: 10,
  emblem_white: 9,
  emblem_white_shade: 8,
  emblem_blue: 12,
  emblem_grey: 4,
  emblem_moss: 7,
};

/**
 * Hinomaru, darker. The disc is terracotta, slot 10, the exact shadow of the Japan uniform.
 * The rim, including its shaded edge, is tan, slot 9, one step darker than cream.
 */
export const JAP_DARKER_FRAME_SLOT: Readonly<Record<EmblemSlotKey, number>> = {
  ...EMBLEM_FRAME_SLOT,
  emblem_red: EMBLEM_FRAME_SLOT.emblem_red_light,
  emblem_white_shade: EMBLEM_FRAME_SLOT.emblem_white,
};

/** The frame slots a stamp writes. Only the darker Hinomaru leaves the shared table. */
export function frameSlotsFor(emblemId: string): Readonly<Record<EmblemSlotKey, number>> {
  return emblemId === "jap_hinomaru_darker" ? JAP_DARKER_FRAME_SLOT : EMBLEM_FRAME_SLOT;
}

export interface FrameStampCell {
  x: number;
  y: number;
  slot: number;
}

/**
 * The cells a stamp centred on (x, y) would write, in frame pixels. Cells the layer cannot reach on
 * this frame (its movement has pushed that part of the drawing off the edge) are left out, as are
 * cells off the sprite when `onlySprite` is on. The hover preview and the stamp both use this.
 */
export function frameStampCells(
  rig: PartRig,
  frame: RigFrame,
  layer: PartCategory,
  bitmap: EmblemBitmap,
  x: number,
  y: number,
  onlySprite: boolean,
  slots: Readonly<Record<EmblemSlotKey, number>> = EMBLEM_FRAME_SLOT,
): FrameStampCell[] {
  const move = frame.move[layer];
  const reach = (cx: number, cy: number) => {
    const px = cx - move.x;
    const py = cy - move.y;
    return px >= 0 && py >= 0 && px < rig.width && py < rig.height;
  };
  const shown = onlySprite ? composite(resolveFrame(rig, frame)) : null;
  const onlyOn = (cx: number, cy: number) => reach(cx, cy) && (!shown || (shown[cy * rig.width + cx] ?? 0) !== 0);
  return emblemCells(bitmap, { x, y }, { width: rig.width, height: rig.height }, { onlyOn }).map((cell) => ({
    x: cell.x,
    y: cell.y,
    slot: slots[cell.slot],
  }));
}

/**
 * Stamp an emblem onto the worn part of a layer, on the pose the frame shows. Like the pencil, the
 * frame's movement is taken off first, so every frame on that pose shows the emblem in the same place
 * on the part. The rig comes back unchanged when nothing would be written.
 */
export function stampFramePart(
  rig: PartRig,
  frame: RigFrame,
  layer: PartCategory,
  bitmap: EmblemBitmap,
  x: number,
  y: number,
  onlySprite: boolean,
  slots: Readonly<Record<EmblemSlotKey, number>> = EMBLEM_FRAME_SLOT,
): PartRig {
  const part = wornPart(rig, layer);
  const drawing = part.drawings[frame.pose];
  if (!drawing) {
    return rig;
  }
  const move = frame.move[layer];
  let cells: number[] | null = null;
  for (const cell of frameStampCells(rig, frame, layer, bitmap, x, y, onlySprite, slots)) {
    const index = (cell.y - move.y) * rig.width + (cell.x - move.x);
    if ((drawing[index] ?? 0) === cell.slot) {
      continue;
    }
    cells ??= drawing.slice();
    cells[index] = cell.slot;
  }
  if (!cells) {
    return rig;
  }
  const changed = cells;
  const drawings = part.drawings.map((item, pose) => (pose === frame.pose ? changed : item));
  return { ...rig, parts: rig.parts.map((item) => (item.id === part.id ? { ...part, drawings } : item)) };
}

/** The preview cells as straight RGBA at the frame's size, faint, in the colour set on screen. */
export function stampPreviewRgba(
  cells: readonly FrameStampCell[],
  width: number,
  height: number,
  lut: readonly string[],
  alpha = 190,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  for (const { x, y, slot } of cells) {
    const hex = lut[slot];
    if (!hex || x < 0 || y < 0 || x >= width || y >= height) {
      continue;
    }
    const rgb = Number.parseInt(hex.slice(1, 7), 16);
    out.set([(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, alpha], (y * width + x) * 4);
  }
  return out;
}
