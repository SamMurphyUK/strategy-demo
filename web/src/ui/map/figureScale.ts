/** Zoomed campaign figures. The numbers match the sizes the board shipped with. */

export const FIGURE_CLASSES = ["infantry", "gun", "vehicle", "air", "sea"] as const;
export type FigureClass = (typeof FIGURE_CLASSES)[number];

export const FIGURE_CLASS_LABEL: Record<FigureClass, string> = {
  infantry: "Infantry",
  gun: "Guns",
  vehicle: "Vehicles",
  air: "Aircraft",
  sea: "Ships",
};

const BOOST = 1.4;
const BULK = 1.6;

export const DEFAULT_FIGURE_SCALE: Record<FigureClass, number> = {
  infantry: BOOST,
  gun: BOOST,
  vehicle: BOOST,
  air: BOOST * BULK,
  sea: BOOST * BULK,
};

const AIR = new Set(["fighter", "tactical_bomber", "strategic_bomber", "tac_bomber", "bomber"]);
const SEA = new Set(["submarine", "sub", "destroyer", "cruiser", "battleship", "carrier", "transport"]);
const GUN = new Set(["artillery", "aa", "aaa"]);
const VEHICLE = new Set(["tank", "armor", "mech_infantry"]);

export function figureClassOf(unitType: string): FigureClass {
  if (AIR.has(unitType)) {
    return "air";
  }
  if (SEA.has(unitType)) {
    return "sea";
  }
  if (GUN.has(unitType)) {
    return "gun";
  }
  if (VEHICLE.has(unitType)) {
    return "vehicle";
  }
  return "infantry";
}

export function clampFigureScale(value: number): number {
  if (!Number.isFinite(value)) {
    return BOOST;
  }
  return Math.min(4, Math.max(0.4, value));
}
