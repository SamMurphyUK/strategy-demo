/**
 * Neutral land keeps its garrison off the map until someone is fighting there.
 * The territory inspector still lists those units.
 */
export function concealNeutralGarrison(owner: string, isLand: boolean, atWar: boolean): boolean {
  if (!isLand || atWar) {
    return false;
  }
  const id = owner.trim().toLowerCase();
  return id === "" || id === "neutral" || id === "independent";
}
