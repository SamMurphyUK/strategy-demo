// Colours, letters and silhouettes for the map's unit tokens. Pure: the canvas drawing is in mapToken.ts.
//
//   Land and air  a solid disc in the faction's colour with a white silhouette in the middle
//   Sea           a "waterline hemisphere": the disc, a darker lower half, the white hull sitting on the midline
//                 and a bold classification letter above it
//   Count pill    bottom-right: gold with black text for the faction whose turn it is, black with gold otherwise
import { type FactionKey, resolveFaction } from "../theme/factionPalette";
import type { Vec2 } from "./geometry";

/** Disc colours by faction. */
export const TOKEN_DISC: Record<FactionKey, string> = {
  USSR: "#4D1913",
  GER: "#35393A",
  UK: "#C59B61",
  US: "#586949",
  JAP: "#8C4A27",
  NEUTRAL: "#6E675C",
};

export const TOKEN_INK = "#1A1815";
export const TOKEN_WHITE = "#FFFFFF";
export const TOKEN_GOLD = "#E2B53C";

export function tokenDisc(factionId: string): string {
  return TOKEN_DISC[resolveFaction(factionId)];
}

export interface PillColors {
  fill: string;
  text: string;
  rim: string;
}

/** The count pill: gold, black text, white rim on the active faction's units; black, white text, gold rim on the rest. */
export function pillColors(active: boolean): PillColors {
  return active
    ? { fill: TOKEN_GOLD, text: "#000000", rim: TOKEN_WHITE }
    : { fill: "#000000", text: TOKEN_WHITE, rim: TOKEN_GOLD };
}

/** True when `factionId` is the faction whose turn it is. */
export function isActiveFaction(factionId: string, activeFactionId: string): boolean {
  return activeFactionId !== "" && resolveFaction(factionId) === resolveFaction(activeFactionId);
}

// ---------------------------------------------------------------
// Pill and token sizes, relative to the token's diameter
// ---------------------------------------------------------------

/** The pill's centre, from the token's centre, as a share of the diameter. Bottom-right, clear of the silhouette. */
export const PILL_OFFSET = 0.36;

/** Radius of the count pill. The floor is half the old 6.5, and the rest stays in proportion to the token. */
export function pillRadius(tokenPx: number): number {
  return Math.max(3.25, tokenPx * 0.27);
}

export function pillFontPx(tokenPx: number): number {
  return Math.max(4, pillRadius(tokenPx) * 1.15);
}

// ---------------------------------------------------------------
// Sea units
// ---------------------------------------------------------------

const NAVAL_LETTERS: Record<string, string> = {
  battleship: "B",
  cruiser: "C",
  carrier: "A",
  destroyer: "D",
  submarine: "S",
  sub: "S",
  transport: "T",
};

/** The bold classification letter above a ship's hull. */
export function navalLetter(unitTypeId: string): string {
  return NAVAL_LETTERS[unitTypeId] ?? (unitTypeId.charAt(0) || "?").toUpperCase();
}

/**
 * A hull silhouette as polygons in units of the token's diameter, centred on the token. y = 0 is the waterline
 * (the token's horizontal midline), y < 0 is up. Every part sits within about 0.46 of the centre.
 */
export type Hull = Vec2[][];

const poly = (...pairs: [number, number][]): Vec2[] => pairs.map(([x, y]) => ({ x, y }));

const HULLS: Record<string, Hull> = {
  destroyer: [
    poly([-0.4, -0.07], [0.2, -0.07], [0.42, -0.12], [0.34, 0.05], [-0.34, 0.05]),
    poly([-0.08, -0.07], [-0.08, -0.15], [0.1, -0.15], [0.1, -0.07]),
    poly([-0.24, -0.07], [-0.24, -0.13], [-0.16, -0.13], [-0.16, -0.07]),
  ],
  cruiser: [
    poly([-0.43, -0.07], [0.24, -0.07], [0.45, -0.12], [0.36, 0.06], [-0.37, 0.06]),
    poly([-0.12, -0.07], [-0.12, -0.17], [0.08, -0.17], [0.08, -0.07]),
    poly([-0.32, -0.07], [-0.32, -0.12], [-0.2, -0.12], [-0.2, -0.07]),
    poly([0.14, -0.07], [0.14, -0.12], [0.3, -0.12], [0.3, -0.07]),
  ],
  battleship: [
    poly([-0.45, -0.07], [0.26, -0.07], [0.46, -0.12], [0.38, 0.06], [-0.39, 0.06]),
    poly([-0.1, -0.07], [-0.1, -0.2], [0.04, -0.2], [0.04, -0.07]),
    poly([-0.34, -0.07], [-0.34, -0.13], [-0.2, -0.13], [-0.2, -0.07]),
    poly([0.1, -0.07], [0.1, -0.13], [0.24, -0.13], [0.24, -0.07]),
  ],
  carrier: [
    poly([-0.46, -0.09], [0.46, -0.09], [0.46, -0.04], [0.36, 0.06], [-0.4, 0.06]),
    poly([0.14, -0.09], [0.14, -0.2], [0.26, -0.2], [0.26, -0.09]),
  ],
  submarine: [
    poly([-0.42, 0], [-0.3, -0.07], [0.3, -0.07], [0.44, -0.01], [0.3, 0.07], [-0.3, 0.07]),
    poly([-0.08, -0.07], [-0.06, -0.15], [0.08, -0.15], [0.1, -0.07]),
  ],
  transport: [
    poly([-0.4, -0.07], [0.3, -0.07], [0.42, -0.1], [0.34, 0.06], [-0.34, 0.06]),
    poly([-0.3, -0.07], [-0.3, -0.15], [-0.1, -0.15], [-0.1, -0.07]),
    poly([0, -0.07], [0, -0.15], [0.16, -0.15], [0.16, -0.07]),
    poly([0.2, -0.07], [0.2, -0.13], [0.26, -0.13], [0.26, -0.07]),
  ],
};

/** The hull for a sea unit. `sub` is a submarine. An unknown ship gets a destroyer's. */
export function hullFor(unitTypeId: string): Hull {
  const id = unitTypeId === "sub" ? "submarine" : unitTypeId;
  return HULLS[id] ?? HULLS.destroyer;
}

/** Where the cargo dot of a loaded transport sits, from the token's centre, in token diameters. */
export const CARGO_DOT = { x: -0.3, y: -0.3, r: 0.08 } as const;

// ---------------------------------------------------------------
// White vector silhouettes, one per roster piece
// ---------------------------------------------------------------

/** Roster id used for the drawing. `tank` is armor, `submarine` is sub, `aaa` is aa. */
export function silhouetteId(unitTypeId: string): string {
  switch (unitTypeId) {
    case "tank":
      return "armor";
    case "aaa":
      return "aa";
    case "submarine":
      return "sub";
    case "bomber":
      return "tactical_bomber";
    default:
      return unitTypeId;
  }
}

/**
 * White silhouette polygons, in units of the token diameter, centred on the token. y < 0 is up.
 * Land and air are figures; sea is the hull that sits on the waterline.
 */
const SILHOUETTES: Record<string, Hull> = {
  // A standing rifleman: head, torso, legs, rifle.
  infantry: [
    poly([-0.07, -0.34], [-0.02, -0.4], [0.05, -0.34], [0.05, -0.26], [-0.07, -0.26]),
    poly([-0.09, -0.26], [0.07, -0.26], [0.08, -0.02], [-0.08, -0.02]),
    poly([-0.08, -0.02], [-0.14, 0.22], [-0.04, 0.22], [0, 0.06], [0.05, 0.22], [0.15, 0.22], [0.08, -0.02]),
    poly([0.06, -0.16], [0.32, -0.22], [0.34, -0.16], [0.08, -0.1]),
  ],
  // A halftrack: cab, bed, track, and a gun over the bed.
  mech_infantry: [
    poly([-0.34, -0.16], [-0.06, -0.16], [-0.02, -0.02], [-0.34, -0.02]),
    poly([-0.04, -0.1], [0.3, -0.1], [0.34, 0.02], [-0.06, 0.02]),
    poly([-0.38, 0.02], [0.38, 0.02], [0.36, 0.14], [-0.36, 0.14]),
    poly([-0.28, 0.05], [-0.16, 0.05], [-0.16, 0.11], [-0.28, 0.11]),
    poly([0.1, 0.05], [0.24, 0.05], [0.24, 0.11], [0.1, 0.11]),
    poly([0.02, -0.1], [0.36, -0.28], [0.4, -0.22], [0.08, -0.04]),
  ],
  // A gun: two wheels, a trail, and a long barrel.
  artillery: [
    poly([-0.16, -0.02], [-0.16, 0.14], [-0.02, 0.14], [-0.02, -0.02]),
    poly([0.06, -0.02], [0.06, 0.14], [0.2, 0.14], [0.2, -0.02]),
    poly([-0.06, 0.04], [0.22, 0.16], [0.26, 0.1], [0, -0.02]),
    poly([-0.04, -0.06], [0.4, -0.2], [0.42, -0.14], [-0.02, 0]),
  ],
  // A tank: hull, turret, long barrel.
  armor: [
    poly([-0.4, -0.02], [0.36, -0.02], [0.4, 0.08], [0.28, 0.16], [-0.32, 0.16], [-0.4, 0.06]),
    poly([-0.12, -0.16], [0.14, -0.16], [0.16, -0.02], [-0.14, -0.02]),
    poly([0.1, -0.12], [0.44, -0.16], [0.44, -0.1], [0.12, -0.06]),
  ],
  // An anti-aircraft carriage with two barrels in a V.
  aa: [
    poly([-0.22, 0.04], [0.22, 0.04], [0.18, 0.16], [-0.18, 0.16]),
    poly([-0.06, 0.04], [0.06, 0.04], [0.04, -0.06], [-0.04, -0.06]),
    poly([-0.04, -0.04], [-0.22, -0.34], [-0.14, -0.36], [0.02, -0.06]),
    poly([0.04, -0.04], [0.22, -0.34], [0.14, -0.36], [-0.02, -0.06]),
  ],
  // A slim single-seat fighter: pointed nose, swept wings, one tail.
  fighter: [
    poly([0, -0.4], [0.05, -0.08], [0.04, 0.28], [-0.04, 0.28], [-0.05, -0.08]),
    poly([-0.4, -0.02], [0, -0.14], [0.4, -0.02], [0.28, 0.06], [0, 0], [-0.28, 0.06]),
    poly([-0.1, 0.2], [0.1, 0.2], [0.08, 0.34], [-0.08, 0.34]),
  ],
  // A dive bomber: cranked wings, a bomb underneath, a single tail.
  tactical_bomber: [
    poly([0, -0.34], [0.07, -0.06], [0.06, 0.26], [-0.06, 0.26], [-0.07, -0.06]),
    poly([-0.42, 0.02], [-0.16, -0.08], [0, -0.02], [0.16, -0.08], [0.42, 0.02], [0.16, 0.08], [0, 0.02], [-0.16, 0.08]),
    poly([-0.05, 0.08], [0.05, 0.08], [0.04, 0.18], [-0.04, 0.18]),
    poly([-0.12, 0.16], [0.12, 0.16], [0.08, 0.32], [-0.08, 0.32]),
  ],
  // A heavy bomber: long straight wings, four engines, a twin tail.
  strategic_bomber: [
    poly([0, -0.28], [0.08, -0.04], [0.07, 0.22], [-0.07, 0.22], [-0.08, -0.04]),
    poly([-0.46, -0.02], [0.46, -0.02], [0.46, 0.06], [-0.46, 0.06]),
    poly([-0.34, -0.08], [-0.26, -0.08], [-0.26, 0.1], [-0.34, 0.1]),
    poly([-0.16, -0.08], [-0.08, -0.08], [-0.08, 0.1], [-0.16, 0.1]),
    poly([0.08, -0.08], [0.16, -0.08], [0.16, 0.1], [0.08, 0.1]),
    poly([0.26, -0.08], [0.34, -0.08], [0.34, 0.1], [0.26, 0.1]),
    poly([-0.16, 0.16], [-0.08, 0.16], [-0.1, 0.34], [-0.18, 0.34]),
    poly([0.08, 0.16], [0.16, 0.16], [0.18, 0.34], [0.1, 0.34]),
  ],
};

/** The white silhouette for a unit type. Sea units are their hulls. An unknown type is a small diamond. */
export function unitSilhouette(unitTypeId: string): Hull {
  const id = silhouetteId(unitTypeId);
  if (id === "sub" || id === "destroyer" || id === "cruiser" || id === "battleship" || id === "carrier" || id === "transport") {
    return hullFor(id);
  }
  return SILHOUETTES[id] ?? [poly([-0.12, 0], [0, -0.16], [0.12, 0], [0, 0.16])];
}
