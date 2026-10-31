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

/** Radius of the count pill, never smaller than a legible dot. */
export function pillRadius(tokenPx: number): number {
  return Math.max(6.5, tokenPx * 0.27);
}

export function pillFontPx(tokenPx: number): number {
  return Math.max(8, pillRadius(tokenPx) * 1.15);
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

/** The hull for a sea unit. An unknown ship gets a destroyer's. */
export function hullFor(unitTypeId: string): Hull {
  return HULLS[unitTypeId] ?? HULLS.destroyer;
}

/** Where the cargo dot of a loaded transport sits, from the token's centre, in token diameters. */
export const CARGO_DOT = { x: -0.3, y: -0.3, r: 0.08 } as const;

// ---------------------------------------------------------------
// Air units, and the art for land units
// ---------------------------------------------------------------

/** How much wider (sx) and longer (sy) than the base plane each aircraft is drawn. Fighters are slim, bombers broad. */
export function planeScale(unitTypeId: string): { sx: number; sy: number } {
  switch (unitTypeId) {
    case "fighter":
      return { sx: 0.7, sy: 1 };
    case "strategic_bomber":
      return { sx: 1.3, sy: 1.12 };
    default:
      return { sx: 1, sy: 0.96 };
  }
}

/** The art file (no extension) whose silhouette stands for a land unit, or null when it is drawn another way. */
export function landArtFor(unitTypeId: string, allies: boolean): string | null {
  switch (unitTypeId) {
    case "infantry":
    case "mech_infantry":
      return allies ? "allies_inf_ii" : "axis_inf_ii";
    case "artillery":
      return "axis_art";
    case "tank":
    case "armor":
      return "axis_tank";
    case "aa":
    case "aaa":
      return "axis_aa";
    default:
      return null;
  }
}
