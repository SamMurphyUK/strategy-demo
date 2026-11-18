import type { SpriteFrameGrid, SpriteFrameKey } from "./skeletonSchema";

/**
 * A soldier is four layers. The game still plays the four flat frames.
 * Legs are a drawing for each step. Head, torso, and the rifle only shift.
 * Both boots keep their toes pointing right. Nothing here rotates.
 */
export const INFANTRY_LAYER_KEYS = ["legs", "torso", "head", "hands_weapon"] as const;

export type InfantryLayerKey = (typeof INFANTRY_LAYER_KEYS)[number];

/** Legs, then tunic, then head. The rifle paints last so it sits in front. */
export const LAYER_PAINT_ORDER: readonly InfantryLayerKey[] = ["legs", "torso", "head", "hands_weapon"];

export const LAYER_LABEL: Record<InfantryLayerKey, string> = {
  legs: "Legs",
  torso: "Torso",
  head: "Head",
  hands_weapon: "Hands and weapon",
};

export type InfantryLayerStack = Record<InfantryLayerKey, SpriteFrameGrid>;

export type InfantryLayerFrames = Record<SpriteFrameKey, InfantryLayerStack>;

interface PixelShift {
  dx: number;
  dy: number;
}

/**
 * Offsets from the idle layer. Move 1 reaches forward and up.
 * The head lags the tunic by a pixel. Move 2 drops onto the standing leg.
 * Fire leaves the head planted and pulls the rifle further than the tunic.
 */
const BODY_SHIFT: Record<Exclude<SpriteFrameKey, "idle">, Record<Exclude<InfantryLayerKey, "legs">, PixelShift>> = {
  move_1: {
    torso: { dx: 1, dy: -1 },
    head: { dx: 0, dy: -1 },
    hands_weapon: { dx: -1, dy: -1 },
  },
  move_2: {
    torso: { dx: 0, dy: 1 },
    head: { dx: 0, dy: 1 },
    hands_weapon: { dx: 1, dy: 1 },
  },
  fire: {
    torso: { dx: -1, dy: 0 },
    head: { dx: 0, dy: 0 },
    hands_weapon: { dx: -2, dy: 0 },
  },
};

export function emptyGrid(width: number, height: number): SpriteFrameGrid {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => null));
}

export function emptyLayerStack(width: number, height: number): InfantryLayerStack {
  return {
    legs: emptyGrid(width, height),
    torso: emptyGrid(width, height),
    head: emptyGrid(width, height),
    hands_weapon: emptyGrid(width, height),
  };
}

export function cloneGrid(grid: SpriteFrameGrid): SpriteFrameGrid {
  return grid.map((row) => row.slice());
}

export function cloneLayerStack(stack: InfantryLayerStack): InfantryLayerStack {
  return {
    legs: cloneGrid(stack.legs),
    torso: cloneGrid(stack.torso),
    head: cloneGrid(stack.head),
    hands_weapon: cloneGrid(stack.hands_weapon),
  };
}

export function cloneLayerFrames(frames: InfantryLayerFrames): InfantryLayerFrames {
  return {
    idle: cloneLayerStack(frames.idle),
    move_1: cloneLayerStack(frames.move_1),
    move_2: cloneLayerStack(frames.move_2),
    fire: cloneLayerStack(frames.fire),
  };
}

export function gridHasInk(grid: SpriteFrameGrid): boolean {
  return grid.some((row) => row.some((cell) => cell != null));
}

export function topLayerAt(stack: InfantryLayerStack, x: number, y: number): InfantryLayerKey | null {
  for (let index = LAYER_PAINT_ORDER.length - 1; index >= 0; index -= 1) {
    const key = LAYER_PAINT_ORDER[index];
    if (key && stack[key]?.[y]?.[x] != null) {
      return key;
    }
  }
  return null;
}

export function compositeLayers(stack: InfantryLayerStack): SpriteFrameGrid {
  const height = stack.legs.length;
  const width = stack.legs[0]?.length ?? 0;
  const grid = emptyGrid(width, height);
  for (const key of LAYER_PAINT_ORDER) {
    const layer = stack[key];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const slot = layer[y]?.[x];
        if (slot == null) {
          continue;
        }
        const row = grid[y];
        if (row) {
          row[x] = slot;
        }
      }
    }
  }
  return grid;
}

export function framesFromLayers(frames: InfantryLayerFrames): Record<SpriteFrameKey, SpriteFrameGrid> {
  return {
    idle: compositeLayers(frames.idle),
    move_1: compositeLayers(frames.move_1),
    move_2: compositeLayers(frames.move_2),
    fire: compositeLayers(frames.fire),
  };
}

export function shiftGrid(source: SpriteFrameGrid, dx: number, dy: number): SpriteFrameGrid {
  const height = source.length;
  const width = source[0]?.length ?? 0;
  const next = emptyGrid(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const slot = source[y]?.[x];
      if (slot == null) {
        continue;
      }
      const destX = x + dx;
      const destY = y + dy;
      if (destX < 0 || destY < 0 || destX >= width || destY >= height) {
        continue;
      }
      const row = next[destY];
      if (row) {
        row[destX] = slot;
      }
    }
  }
  return next;
}

/**
 * Planted boots, a pixel wider. Each boot moves as a block, so the toe stays on the right.
 * Pixels on the split stay put.
 */
export function widenStance(source: SpriteFrameGrid, splitX: number): SpriteFrameGrid {
  const height = source.length;
  const width = source[0]?.length ?? 0;
  const next = emptyGrid(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const slot = source[y]?.[x];
      if (slot == null) {
        continue;
      }
      const dx = x < splitX ? -1 : x > splitX ? 1 : 0;
      const destX = x + dx;
      if (destX < 0 || destX >= width) {
        continue;
      }
      const row = next[y];
      if (row) {
        row[destX] = slot;
      }
    }
  }
  return next;
}

/**
 * Write move 1, move 2, and fire from the idle head, tunic, and rifle.
 * A leg drawing already on move 1 or move 2 is kept. An empty one copies the idle legs.
 * Fire plants the idle legs a little wider.
 */
export function buildMarch(source: InfantryLayerFrames, splitX: number): InfantryLayerFrames {
  const idle = cloneLayerStack(source.idle);
  return {
    idle,
    move_1: poseFromIdle(idle, source.move_1, "move_1", splitX),
    move_2: poseFromIdle(idle, source.move_2, "move_2", splitX),
    fire: poseFromIdle(idle, source.fire, "fire", splitX),
  };
}

function poseFromIdle(
  idle: InfantryLayerStack,
  existing: InfantryLayerStack,
  frame: Exclude<SpriteFrameKey, "idle">,
  splitX: number,
): InfantryLayerStack {
  const shift = BODY_SHIFT[frame];
  const legs = frame === "fire" || !gridHasInk(existing.legs) ? plantedLegs(idle.legs, frame, splitX) : cloneGrid(existing.legs);
  return {
    legs,
    torso: shiftGrid(idle.torso, shift.torso.dx, shift.torso.dy),
    head: shiftGrid(idle.head, shift.head.dx, shift.head.dy),
    hands_weapon: shiftGrid(idle.hands_weapon, shift.hands_weapon.dx, shift.hands_weapon.dy),
  };
}

function plantedLegs(idleLegs: SpriteFrameGrid, frame: Exclude<SpriteFrameKey, "idle">, splitX: number): SpriteFrameGrid {
  if (frame === "fire") {
    return widenStance(idleLegs, splitX);
  }
  return cloneGrid(idleLegs);
}
