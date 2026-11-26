// The attackers walking to the fight. Pure.
//
// A combat move puts the attackers in the territory they will fight in, but the map should not show them
// there until they have got there. Until the fight is opened, an attacker's counter stands where it started,
// on its origin territory. When the camera sets off for the battle, the counter walks from there to its place
// in the target territory over the same time as the zoom, so the army arrives as the view does.
import type { Vec2 } from "./geometry";
import type { PlacedCounter, RegionLayout } from "./mapRenderer";
import { worldToScreen, type View } from "./viewMath";

export interface TravelOrigin {
  unitType: string;
  /** The anchor of the territory the unit set out from, in world units. */
  from: Vec2;
}

export interface TravelPlan {
  /** The territory the attackers fight in. */
  regionId: string;
  attackerId: string;
  origins: readonly TravelOrigin[];
  /** When the walk began, in milliseconds. Null until the fight is opened: the attackers stand at their origin. */
  startMs: number | null;
  durationMs: number;
}

/** 0 at the origin, 1 arrived. */
export function travelProgress(plan: Pick<TravelPlan, "startMs" | "durationMs">, nowMs: number): number {
  if (plan.startMs == null) {
    return 0;
  }
  const share = (nowMs - plan.startMs) / Math.max(1, plan.durationMs);
  const t = Math.min(1, Math.max(0, share));
  return t * t * (3 - 2 * t);
}

/** Where a counter is, on its walk from `from` (screen) to its place. */
export function walkPosition(from: Vec2, to: Vec2, progress: number): Vec2 {
  return { x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress };
}

/**
 * The layouts with the walking attackers moved along their way. Layouts without a plan are returned as they
 * are, and the counters of a layout that has one are copied, never changed in place.
 */
export function applyTravel(layouts: RegionLayout[], plans: readonly TravelPlan[], view: View, nowMs: number): RegionLayout[] {
  if (plans.length === 0) {
    return layouts;
  }
  return layouts.map((layout) => {
    const plan = plans.find((item) => item.regionId === layout.region.id);
    if (!plan) {
      return layout;
    }
    const progress = travelProgress(plan, nowMs);
    if (progress >= 1) {
      return layout;
    }
    const used = new Map<string, number>();
    const counters = layout.counters.map((counter): PlacedCounter => {
      const { entry } = counter.slot;
      if (entry.faction_id !== plan.attackerId) {
        return counter;
      }
      const matches = plan.origins.filter((origin) => origin.unitType === entry.unit_type_id);
      if (matches.length === 0) {
        return counter;
      }
      // Several orders of one type set out from different places: the counters take them in turn.
      const index = used.get(entry.unit_type_id) ?? 0;
      used.set(entry.unit_type_id, index + 1);
      const origin = matches[index % matches.length];
      const from = worldToScreen(view, origin.from);
      const at = walkPosition(from, counter, progress);
      return { ...counter, x: at.x, y: at.y };
    });
    return { ...layout, counters };
  });
}
