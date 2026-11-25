// The standing figures on canvases of their own, for a board that casts them or lines them.
//
// The map stamps every figure onto one canvas with the badges and rings drawn over them (see
// MapView.tsx). A shadow or an outline has to come from the figure's picture and nothing else, so
// the same pictures are stamped a second time here: all of them at half size on a clear canvas for
// the shadows, and the figures of a marked stack, pixel for pixel, for the outline.
//
// The layout is pure. Only `createFigureCards` touches a canvas.
import type { FigureCard, FigureCards, OutlineSlot } from "./boardLayer";
import type { FigureStamp } from "./figureSheet";

/** A stack to mark. A hover names the world copy it is on; a selection is marked on whichever copy shows most. */
export interface StackPick {
  kind: "selected" | "hover";
  regionId: string;
  key: string;
  copyDx?: number;
}

/** Size of the shadow canvas against the frame. Half is enough: the shadow is soft, and it is a quarter of the pixels to upload. */
export const FIGURE_MASK_SCALE = 0.5;
/** Longest side of one stack's rectangle, in device pixels. Past it the stack is not marked. */
export const MAX_OUTLINE_SIDE = 1024;

/** The stack a figure belongs to: its id without the place in the stack. */
export function stackOfFigure(id: string): string {
  const cut = id.lastIndexOf(":");
  return cut < 0 ? id : id.slice(0, cut);
}

/** True when a stack key (`region|copy|slot`) is the picked stack. */
export function stackMatches(stack: string, pick: StackPick): boolean {
  const head = `${pick.regionId}|`;
  const tail = `|${pick.key}`;
  if (stack.length < head.length + tail.length || !stack.startsWith(head) || !stack.endsWith(tail)) {
    return false;
  }
  const copy = stack.slice(head.length, stack.length - tail.length);
  if (!/^-?\d+(\.\d+)?$/.test(copy)) {
    return false;
  }
  return pick.copyDx === undefined || Number(copy) === pick.copyDx;
}

export interface OutlineLayout {
  slots: OutlineSlot[];
  /** For each slot, the cards drawn in it, as indices into the list given. */
  members: number[][];
  /** The canvas the slots need. */
  width: number;
  height: number;
}

/**
 * A rectangle on the frame for each picked stack, and a place for it on the outline canvas. The
 * rectangle is the stack's figures with `margin` of clear space round them, cut to the frame. A
 * hover on the stack that is already selected is dropped, and so is a stack with no figure in view.
 */
export function layoutOutline(
  cards: readonly FigureCard[],
  picks: readonly StackPick[],
  frameWidth: number,
  frameHeight: number,
  margin: number,
): OutlineLayout {
  const layout: OutlineLayout = { slots: [], members: [], width: 0, height: 0 };
  let selectedStack = "";
  const ordered = [...picks].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "selected" ? -1 : 1));
  for (const pick of ordered) {
    // The stack's figures on each world copy in view.
    const copies = new Map<string, number[]>();
    cards.forEach((card, index) => {
      const stack = stackOfFigure(card.id);
      if (stackMatches(stack, pick)) {
        const list = copies.get(stack);
        if (list) {
          list.push(index);
        } else {
          copies.set(stack, [index]);
        }
      }
    });
    let best: { stack: string; members: number[]; x: number; y: number; w: number; h: number } | null = null;
    for (const [stack, members] of copies) {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const index of members) {
        const card = cards[index];
        x0 = Math.min(x0, card.left);
        y0 = Math.min(y0, card.top);
        x1 = Math.max(x1, card.left + card.w);
        y1 = Math.max(y1, card.top + card.h);
      }
      const x = Math.max(0, Math.floor(x0 - margin));
      const y = Math.max(0, Math.floor(y0 - margin));
      const w = Math.min(frameWidth, Math.ceil(x1 + margin)) - x;
      const h = Math.min(frameHeight, Math.ceil(y1 + margin)) - y;
      if (w <= 0 || h <= 0 || w > MAX_OUTLINE_SIDE || h > MAX_OUTLINE_SIDE) {
        continue;
      }
      if (!best || w * h > best.w * best.h) {
        best = { stack, members, x, y, w, h };
      }
    }
    if (!best) {
      continue;
    }
    if (pick.kind === "selected") {
      selectedStack = best.stack;
    } else if (best.stack === selectedStack) {
      continue;
    }
    layout.slots.push({ kind: pick.kind, x: best.x, y: best.y, w: best.w, h: best.h, atlasX: layout.width, atlasY: 0 });
    layout.members.push(best.members);
    layout.width += best.w;
    layout.height = Math.max(layout.height, best.h);
  }
  return layout;
}

export interface FigureCardRequest {
  /** The frame in device pixels. */
  width: number;
  height: number;
  /** The figures' opacity this frame, 0 to 1. Under half, nothing casts. */
  fade: number;
  /** Stamp every figure for the shadows. */
  shadows: boolean;
  /** The stacks to mark. Empty leaves the outline canvas alone. */
  picks: readonly StackPick[];
  /** Clear space round a marked stack, in device pixels: room for the line and the wash. */
  margin: number;
}

export interface FigureCardPainter {
  /** What the board reads. Changed in place by `paint` and `clear`. */
  readonly cards: FigureCards;
  paint(stamps: readonly FigureStamp[], request: FigureCardRequest): void;
  clear(): void;
}

function drawStamp(ctx: CanvasRenderingContext2D, stamp: FigureStamp, originX: number, originY: number, scale: number): void {
  if (stamp.mirror) {
    ctx.setTransform(-scale, 0, 0, scale, (stamp.left + stamp.w - originX) * scale, (stamp.top - originY) * scale);
  } else {
    ctx.setTransform(scale, 0, 0, scale, (stamp.left - originX) * scale, (stamp.top - originY) * scale);
  }
  ctx.drawImage(stamp.plate, 0, 0, stamp.w, stamp.h);
}

/** The canvases, and the painter that fills them from what `stampFigures` last drew. */
export function createFigureCards(): FigureCardPainter {
  const cards: FigureCards = { mask: null, maskScale: FIGURE_MASK_SCALE, cards: [], atlas: null, slots: [] };
  let mask: HTMLCanvasElement | null = null;
  let atlas: HTMLCanvasElement | null = null;

  const clear = () => {
    cards.mask = null;
    cards.cards = [];
    cards.atlas = null;
    cards.slots = [];
  };

  const paint = (stamps: readonly FigureStamp[], request: FigureCardRequest) => {
    clear();
    const fade = Math.min(1, Math.max(0, request.fade));
    if (stamps.length === 0 || fade <= 0 || request.width <= 0 || request.height <= 0) {
      return;
    }
    const list: FigureCard[] = stamps.map((stamp) => ({
      id: stamp.id,
      left: stamp.left,
      top: stamp.top,
      w: stamp.w,
      h: stamp.h,
      feetX: stamp.feetX,
      feetY: stamp.feetY,
    }));
    if (request.shadows) {
      mask ??= document.createElement("canvas");
      const w = Math.max(1, Math.ceil(request.width * FIGURE_MASK_SCALE));
      const h = Math.max(1, Math.ceil(request.height * FIGURE_MASK_SCALE));
      if (mask.width !== w || mask.height !== h) {
        mask.width = w;
        mask.height = h;
      }
      const ctx = mask.getContext("2d");
      if (ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, w, h);
        ctx.imageSmoothingEnabled = true;
        for (const stamp of stamps) {
          ctx.globalAlpha = fade * stamp.opacity;
          drawStamp(ctx, stamp, 0, 0, FIGURE_MASK_SCALE);
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        cards.mask = mask;
        cards.cards = list;
      }
    }
    if (request.picks.length > 0) {
      const layout = layoutOutline(list, request.picks, request.width, request.height, request.margin);
      if (layout.slots.length > 0) {
        atlas ??= document.createElement("canvas");
        // The canvas only grows, in steps, so the board keeps one texture while a stack is dragged.
        const w = Math.max(atlas.width, Math.ceil(layout.width / 128) * 128);
        const h = Math.max(atlas.height, Math.ceil(layout.height / 128) * 128);
        if (atlas.width !== w || atlas.height !== h) {
          atlas.width = w;
          atlas.height = h;
        }
        const ctx = atlas.getContext("2d");
        if (ctx) {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, w, h);
          ctx.imageSmoothingEnabled = false;
          layout.slots.forEach((slot, i) => {
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.beginPath();
            ctx.rect(slot.atlasX, slot.atlasY, slot.w, slot.h);
            ctx.clip();
            for (const index of layout.members[i]) {
              const stamp = stamps[index];
              ctx.globalAlpha = fade * stamp.opacity;
              drawStamp(ctx, stamp, slot.x - slot.atlasX, slot.y - slot.atlasY, 1);
            }
            ctx.restore();
          });
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.globalAlpha = 1;
          cards.atlas = atlas;
          cards.slots = layout.slots;
        }
      }
    }
  };

  return { cards, paint, clear };
}
