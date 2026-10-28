// Colours for the layered map. Pure, so the highlight rules are testable.
import { factionPalette } from "../theme/factionPalette";
import type { HighlightMode } from "./geometry";

export const OCEAN_COLOR = "#b3c6c3";
export const LAND_PARCHMENT = "#e6e1d6";
export const COASTLINE_COLOR = "#1a1a18";
export const COASTLINE_WIDTH_PX = 1.5;
export const BORDER_COLOR = "rgba(26, 26, 24, 0.72)";
export const NAVAL_BORDER_COLOR = "rgba(26, 26, 24, 0.5)";
export const SELECTED_COLOR = "rgba(255, 255, 0, 0.85)";
export const HOVER_COLOR = "rgba(244, 241, 234, 0.95)";

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
const SEA_TARGET: [number, number, number] = [60, 110, 140];

/** Fill for a land region, or null to leave the parchment showing (unclaimed land). */
export function landFill(regionId: string, owner: string, mode: HighlightMode): string | null {
  // The ring colour reads clearly on parchment; the darker primary goes muddy at map alpha.
  const base = owner === "" ? null : hexToRgb(factionPalette(owner).ring);
  if (mode.kind === "move") {
    if (regionId === mode.from) {
      return base ? rgba(lighten(base, 0.18), OWNED_ALPHA) : rgba([255, 255, 255], 0.35);
    }
    if (mode.legal.includes(regionId)) {
      return rgba(REACHABLE, regionId === mode.hover ? 0.68 : 0.52);
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
      return rgba(REACHABLE, regionId === mode.hover ? 0.6 : 0.42);
    }
  }
  if (mode.kind === "mobilize" && mode.legal.includes(regionId)) {
    return rgba(SEA_TARGET, regionId === mode.hover ? 0.55 : 0.4);
  }
  return rgba([255, 255, 255], 0.1);
}
