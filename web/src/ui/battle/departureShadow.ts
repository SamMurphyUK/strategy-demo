/** Climb, in board pixels, over which a departing plane's ground shadow fades out. */
export const DEPARTURE_SHADOW_PX = 24;

const AIR = new Set(["fighter", "tactical_bomber", "strategic_bomber"]);

/** How much ground shadow a departing plane still casts. 1 on the ground, 0 once it has climbed. */
export function departureShadowAlpha(ascentY: number): number {
  if (ascentY <= 0) {
    return 1;
  }
  return Math.max(0, 1 - ascentY / DEPARTURE_SHADOW_PX);
}

/** Ascent that should lift the shadow off a plane. Other units stay at 0. */
export function departureAscent(unit: { type: string; victoryAscentY?: number }): number {
  if (!AIR.has(unit.type)) {
    return 0;
  }
  return Math.max(0, unit.victoryAscentY ?? 0);
}
