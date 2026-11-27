// The battlefield's zones, from the old 2D battle's framework. Pure.
//
// Two trench lines run from the front lip toward the horizon, converging. The strip between them is no man's land: darker, cratered, empty of
// units. Each army's ground is everything outside its own line: the attacker's field is left of the left line, the defender's right of the
// right one. The rank columns step outward from a trench line toward the edge, rank I nearest. Unit lanes, scatter, craters and haze are all
// driven from these zones. World coordinates: x across, y into the scene (the front lip is the lowest y), z up.
export type ZoneName = "attackerFrontZone" | "defenderFrontZone" | "noMansLandZone";
export type TrenchSide = "attacker" | "defender";

export interface TrenchGeometry {
  /** Half the gap between the two lines at the front lip (y = yFront) and at the far end (y = yBack). */
  halfFront: number;
  halfBack: number;
  yFront: number;
  yBack: number;
}

/** Half the gap between the trench lines at depth y. It runs straight between the two ends, so the lines converge toward the horizon. */
export function trenchHalfWidth(y: number, g: TrenchGeometry): number {
  const span = g.yBack - g.yFront;
  const t = span === 0 ? 0 : (y - g.yFront) / span;
  return g.halfFront + (g.halfBack - g.halfFront) * t;
}

/** x of a side's trench line at depth y: the attacker's is to the left of the middle, the defender's to the right. */
export function trenchLineX(side: TrenchSide, y: number, g: TrenchGeometry): number {
  const h = trenchHalfWidth(y, g);
  return side === "attacker" ? -h : h;
}

/** Which zone a ground point is in. */
export function zoneAt(x: number, y: number, g: TrenchGeometry): ZoneName {
  const h = trenchHalfWidth(y, g);
  if (Math.abs(x) < h) {
    return "noMansLandZone";
  }
  return x < 0 ? "attackerFrontZone" : "defenderFrontZone";
}

/** The depth at which the two lines would meet, where the gap closes to nothing. Infinity when they do not converge. */
export function convergenceY(g: TrenchGeometry): number {
  const slope = (g.halfBack - g.halfFront) / (g.yBack - g.yFront);
  return slope >= 0 ? Infinity : g.yFront - g.halfFront / slope;
}

/** How far a point has receded toward the horizon, 0 at the front lip and 1 at the far end. */
export function recession(y: number, g: TrenchGeometry): number {
  const span = g.yBack - g.yFront;
  return Math.min(1, Math.max(0, span === 0 ? 0 : (y - g.yFront) / span));
}

/**
 * x of a rank column at depth y. Rank I is nearest its trench line, II, III and IV step outward toward the screen edge, `gap` apart, the first
 * `offset` beyond the line.
 */
export function rankColumnX(side: TrenchSide, rank: number, y: number, g: TrenchGeometry, gap: number, offset: number): number {
  const r = Math.min(4, Math.max(1, Math.round(rank)));
  const out = trenchHalfWidth(y, g) + offset + (r - 1) * gap;
  return side === "attacker" ? -out : out;
}

/** The share of the haze over a point at depth y: nothing at the front, the full amount at the horizon. */
export function hazeAt(y: number, g: TrenchGeometry, mist: number): number {
  const t = recession(y, g);
  return mist * t * t;
}

/** The scale of a unit at depth y against one at the front lip: smaller as it recedes, never below `floor`. */
export function depthScaleAt(y: number, g: TrenchGeometry, back: number): number {
  return 1 + (back - 1) * Math.sqrt(recession(y, g));
}

/**
 * The ground's height at a point: the trench lips stand a little proud of the field, and no man's land between them is sunk into a trough.
 * It fades out toward the front lip, where the trench starts. The ground shader runs the same sum.
 */
export function reliefHeight(x: number, y: number, g: TrenchGeometry, lipHeight: number, troughDepth: number): number {
  const half = trenchHalfWidth(y, g);
  const d = Math.abs(x) - half;
  const smooth = (a: number, b: number, v: number) => {
    const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const start = smooth(g.yFront, g.yFront + 3, y);
  const trough = -troughDepth * (1 - smooth(-0.35, -0.05, d));
  const lip = lipHeight * Math.exp(-(d * d) / 0.12);
  return (trough + lip) * start;
}
