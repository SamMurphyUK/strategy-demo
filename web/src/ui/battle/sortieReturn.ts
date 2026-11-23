/** Progress where the attack run ends and the glide back to base begins. */
export const SORTIE_RETURN = 0.82;

export function planeWasShotDown(unit: {
  type?: string;
  isDestroyed?: boolean;
  isPermanentCasualty?: boolean;
  status?: string;
  currentHp?: number;
} | null): boolean {
  if (unit == null || unit.type === "carrier") {
    return false;
  }
  if (unit.isDestroyed || unit.isPermanentCasualty) {
    return true;
  }
  if (unit.status === "downed" || unit.status === "dead") {
    return true;
  }
  return (unit.currentHp ?? 1) <= 0;
}

/** A shot-down plane does not glide home to refuel. */
export function holdsReturnGlide(progress: number, shotDown: boolean): boolean {
  return shotDown && progress >= SORTIE_RETURN;
}
