// Pure decisions for dragging a stack: how the guide line wraps, and when a drop
// commits immediately instead of asking how many to split off.
import type { Rect, Vec2 } from "./geometry";
import { type View, worldToScreen } from "./viewMath";

/** A drop of one unit, or a count the player already chose, moves at once. A larger untouched stack asks. */
export function dragDropAction(stackCount: number, adjusted: boolean): "commit" | "split" {
  if (stackCount <= 1 || adjusted) {
    return "commit";
  }
  return "split";
}

export interface UnitDrag {
  regionId: string;
  max: number;
  count: number;
  adjusted: boolean;
  legal: readonly string[];
}

export type UnitDragResult =
  | { type: "cancel" }
  | { type: "commit"; target: string; count: number }
  | { type: "split"; target: string; count: number };

/** Where a released drag goes: back to the map, straight into a move, or into the split popover. */
export function finishUnitDrag(drag: UnitDrag, targetRegionId: string): UnitDragResult {
  if (targetRegionId === "" || targetRegionId === drag.regionId || !drag.legal.includes(targetRegionId)) {
    return { type: "cancel" };
  }
  if (dragDropAction(drag.max, drag.adjusted) === "commit") {
    return { type: "commit", target: targetRegionId, count: drag.count };
  }
  return { type: "split", target: targetRegionId, count: drag.max };
}

/** Half of a stack, rounded up, and never zero. */
export function halfStack(count: number): number {
  return Math.max(1, Math.ceil(count / 2));
}

/** A move count stays between 1 and the number that can still move. */
export function clampMoveCount(count: number, max: number): number {
  const cap = Math.max(1, Math.trunc(max));
  if (!Number.isFinite(count)) {
    return cap;
  }
  return Math.min(cap, Math.max(1, Math.trunc(count)));
}

/**
 * Screen position of the origin slot on the world copy closest to the cursor.
 * The map is drawn three times across, so the guide takes the short wrap instead of crossing the sheet.
 */
export function guideOriginScreen(originWorld: Vec2, cursorScreen: Vec2, view: View, bounds: Rect, wrap: boolean): Vec2 {
  if (!wrap || bounds.w <= 0) {
    return worldToScreen(view, originWorld);
  }
  let best = worldToScreen(view, originWorld);
  let bestD = Infinity;
  for (const n of [-1, 0, 1]) {
    const screen = worldToScreen(view, { x: originWorld.x + n * bounds.w, y: originWorld.y });
    const d = (screen.x - cursorScreen.x) ** 2 + (screen.y - cursorScreen.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = screen;
    }
  }
  return best;
}
