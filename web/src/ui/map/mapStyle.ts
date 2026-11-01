// Colours for the layered map. Pure, so the highlight rules are testable.
import { type FactionKey, factionPalette, resolveFaction } from "../theme/factionPalette";
import type { HighlightMode } from "./geometry";

export const OCEAN_COLOR = "#b3c6c3";
export const LAND_PARCHMENT = "#e6e1d6";
export const COASTLINE_COLOR = "#1a1a18";
export const COASTLINE_WIDTH_PX = 1.5;
export const BORDER_COLOR = "rgba(26, 26, 24, 0.72)";
export const NAVAL_BORDER_COLOR = "rgba(26, 26, 24, 0.5)";
export const SELECTED_COLOR = "rgba(255, 255, 0, 0.85)";
export const HOVER_COLOR = "rgba(255, 224, 96, 0.9)";
/** Inner tint under the outline, so a hovered or selected region reads as a shape, not only a line. */
export const SELECTED_TINT = "rgba(255, 214, 51, 0.24)";
export const HOVER_TINT = "rgba(255, 214, 51, 0.12)";

const OWNED_ALPHA = 0.62;
const DIMMED_ALPHA = 0.25;

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgba(rgb: [number, number, number], a: number): string {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Math.round(a * 1000) / 1000})`;
}

function lighten(rgb: [number, number, number], amount: number): [number, number, number] {
  return [
    Math.round(rgb[0] + (255 - rgb[0]) * amount),
    Math.round(rgb[1] + (255 - rgb[1]) * amount),
    Math.round(rgb[2] + (255 - rgb[2]) * amount),
  ];
}

const REACHABLE: [number, number, number] = [242, 38, 31];
/** Legal destinations while moving. The red wash stays for a highlight that does not say it is a move. */
const MOVE_BLUE: [number, number, number] = [36, 112, 210];
const SEA_TARGET: [number, number, number] = [60, 110, 140];

function moveWash(mode: HighlightMode): [number, number, number] {
  return mode.kind === "move" && mode.tone === "move" ? MOVE_BLUE : REACHABLE;
}

/** Fill for a land region, or null to leave the parchment showing (unclaimed land). */
export function landFill(regionId: string, owner: string, mode: HighlightMode): string | null {
  // The ring colour reads clearly on parchment; the darker primary goes muddy at map alpha.
  const base = owner === "" ? null : hexToRgb(factionPalette(owner).ring);
  if (mode.kind === "move") {
    if (regionId === mode.from) {
      return base ? rgba(lighten(base, 0.18), OWNED_ALPHA) : rgba([255, 255, 255], 0.35);
    }
    if (mode.legal.includes(regionId)) {
      return rgba(moveWash(mode), regionId === mode.hover ? 0.68 : 0.52);
    }
    return base ? rgba(base, DIMMED_ALPHA) : null;
  }
  if (mode.kind === "mobilize") {
    if (mode.legal.includes(regionId)) {
      return rgba(base ?? REACHABLE, regionId === mode.hover ? 0.62 : 0.45);
    }
    return base ? rgba(base, DIMMED_ALPHA) : null;
  }
  return base ? rgba(base, OWNED_ALPHA) : null;
}

/** Fill for a sea zone: a faint wash normally, so the zone reads against open ocean, and the move highlight. */
export function seaFill(regionId: string, mode: HighlightMode): string {
  if (mode.kind === "move") {
    if (regionId === mode.from) {
      return rgba([255, 255, 255], 0.3);
    }
    if (mode.legal.includes(regionId)) {
      return rgba(moveWash(mode), regionId === mode.hover ? 0.6 : 0.42);
    }
  }
  if (mode.kind === "mobilize" && mode.legal.includes(regionId)) {
    return rgba(SEA_TARGET, regionId === mode.hover ? 0.55 : 0.4);
  }
  return rgba([255, 255, 255], 0.1);
}

// ---------------------------------------------------------------
// War-room parchment pass: the baked base map (see mapBake.ts)
// ---------------------------------------------------------------

/** Muted maritime slate-blue the grain is blended into. */
export const SEA_BASE_COLOR = "#B6C4CC";
/** Thin pale rules between sea zones. */
export const SEA_SEAM_COLOR = "rgba(235, 245, 250, 0.75)";
export const SEA_SEAM_WIDTH = 1;
/** Soft shadow that lifts the land off the water. Blur and offset are in map units. */
export const COAST_SHADOW = { color: "rgba(20, 30, 35, 0.35)", blur: 5, offset: 2 } as const;

/** Desaturated vintage tints, one per faction. Unowned and neutral land is sun-bleached parchment. */
export const FACTION_TINT: Record<FactionKey, string> = {
  JAP: "#C8BE9E",
  USSR: "#B59482",
  GER: "#98A4A6",
  UK: "#CEBE98",
  US: "#9EB092",
  NEUTRAL: "#D8D2C5",
};

/** The base tint of land held by `owner` (any faction id the scenario uses; "" is neutral). */
export function landTint(owner: string): string {
  return FACTION_TINT[resolveFaction(owner)];
}

/**
 * Neutral and decorative land: a fine 45-degree dark-sepia hatch over the parchment, under the grain. Width and
 * spacing are in map units, so it scales with the map like the rest of the printed sheet.
 */
export const NEUTRAL_HATCH = { color: "rgba(78, 54, 28, 0.24)", width: 0.5, spacing: 3 } as const;

/** Aged inner border: a wide pass and a tight pass, stroked along the inside of each territory. */
export const BURN_PASSES = [
  { color: "rgba(35, 28, 18, 0.18)", width: 8 },
  { color: "rgba(35, 28, 18, 0.15)", width: 4 },
] as const;

/** Airbrushed territory borders: a wide sepia smudge, then a sharp charcoal line. */
export const BORDER_PASSES = [
  { color: "rgba(45, 38, 28, 0.25)", width: 4 },
  { color: "#2B2620", width: 1.2 },
] as const;

export const COAST_INK = { color: "#1A1815", width: 1.6 } as const;

/** Fades land that a move or mobilize highlight does not offer, over the baked fills. */
export const LAND_WASH = "rgba(216, 210, 197, 0.55)";
/** Fades the land layer while the editor works on the sea layer. */
export const EDITOR_LAND_DIM = "rgba(182, 196, 204, 0.7)";

/** Fill for a land region under a move or mobilize highlight, or null when the baked tint should show. */
export function highlightLandFill(regionId: string, owner: string, mode: HighlightMode): string | null {
  if (mode.kind === "none") {
    return null;
  }
  const picked = mode.kind === "move" ? regionId === mode.from || mode.legal.includes(regionId) : mode.legal.includes(regionId);
  return picked ? landFill(regionId, owner, mode) : null;
}

/** Fill for a sea zone under a highlight, or null when it is not part of one. */
export function highlightSeaFill(regionId: string, mode: HighlightMode): string | null {
  if (mode.kind === "none") {
    return null;
  }
  const picked = mode.kind === "move" ? regionId === mode.from || mode.legal.includes(regionId) : mode.legal.includes(regionId);
  return picked ? seaFill(regionId, mode) : null;
}
