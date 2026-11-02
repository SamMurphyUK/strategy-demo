// Campaign chrome taken from the colour the map paints that faction's land.

import type { CSSProperties } from "react";
import { factionPalette } from "../theme/factionPalette";

const INK = "#241c1e";
const CREAM = "#f3ecdf";

function channels(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(from: string, toward: string, t: number): string {
  const [ar, ag, ab] = channels(from);
  const [br, bg, bb] = channels(toward);
  const byte = (a: number, b: number) => Math.round(a + (b - a) * t).toString(16).padStart(2, "0");
  return `#${byte(ar, br)}${byte(ag, bg)}${byte(ab, bb)}`;
}

/** CSS variables for `.campaign`. `--brass` is the map colour itself; the wells are that hue, darkened. */
export function factionChrome(factionId: string): CSSProperties {
  const land = factionPalette(factionId).primary;
  return {
    "--land": land,
    "--frame": mix(land, INK, 0.84),
    "--well": mix(land, INK, 0.7),
    "--brass": land,
    "--gold": mix(land, CREAM, 0.42),
    "--gold-text": mix(land, CREAM, 0.7),
    "--parchment": mix(land, CREAM, 0.55),
    "--button": mix(land, INK, 0.76),
    "--button-edge": land,
    "--stamp": mix(land, "#6a2424", 0.28),
    "--chit-active": mix(land, INK, 0.52),
    "--teal": mix(land, CREAM, 0.78),
  } as CSSProperties;
}
