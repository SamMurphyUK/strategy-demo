/**
 * Shelf pictures are painted above the canvas. The flag's charcoal fade does not cover them,
 * so the overlay has to fade and then drop those pictures itself.
 */
export function victoryVectorOpacity(active: boolean, stage: string, fade: number): string {
  if (!active) return "";
  if (stage === "FLAG_SCREEN") return "0";
  if (stage === "FADE_TO_BLACK") return String(Math.max(0, 1 - Math.min(1, fade)));
  return "";
}

export function victoryClearsVectors(active: boolean, stage: string): boolean {
  return active && stage === "FLAG_SCREEN";
}
