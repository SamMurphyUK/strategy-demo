// Which territories wear the watercolour edge, and in which pigment. Pure.
//
// The rules of the Shogun board:
//   - A pointer that only moves over the map marks nothing.
//   - A clicked territory is marked.
//   - While a stack is picked up (dragged, or chosen to move), the legal destination under the
//     pointer is marked: gold for a move, crimson for an attack. The other legal destinations
//     show the same pigment faintly, so the player can see where the stack may go.
//
// Whether a destination is legal, and whether entering it is an attack, are the session's answers.
// They arrive as the highlight and a hostility test, and this only sorts them into marks.
import type { HighlightMode } from "../../map/geometry";
import type { HighlightRule } from "../../map/mapVisualConfig";

export type HighlightTone = "select" | "move" | "attack" | "hover";
/** How strongly a mark is laid: the full edge, the faint hint on a legal destination, or an idle hover. */
export type HighlightWeight = "full" | "hint" | "idle";

export interface RegionHighlight {
  regionId: string;
  tone: HighlightTone;
  weight: HighlightWeight;
}

export interface HighlightInput {
  selectedId: string;
  /** The region under the pointer, or "". */
  hoverId: string;
  /** The session's move or mobilize highlight. `none` means nothing is picked up. */
  highlight: HighlightMode;
  /** True when moving the picked-up stack into the region is an attack. */
  isHostile(regionId: string): boolean;
}

/** Every mark the board could show, back to front. `highlightShown` then applies the player's setting. */
export function regionHighlights(input: HighlightInput): RegionHighlight[] {
  const { selectedId, hoverId, highlight } = input;
  const out: RegionHighlight[] = [];
  const armed = highlight.kind !== "none";
  const legal = armed ? highlight.legal : [];
  const origin = highlight.kind === "move" ? highlight.from : "";
  const toneOf = (regionId: string): HighlightTone =>
    highlight.kind === "move" && input.isHostile(regionId) ? "attack" : "move";

  for (const regionId of legal) {
    if (regionId !== hoverId && regionId !== origin) {
      out.push({ regionId, tone: toneOf(regionId), weight: "hint" });
    }
  }
  if (selectedId !== "" && !(legal.includes(selectedId) && selectedId !== origin)) {
    out.push({ regionId: selectedId, tone: "select", weight: "full" });
  }
  if (hoverId !== "" && hoverId !== origin && legal.includes(hoverId)) {
    out.push({ regionId: hoverId, tone: toneOf(hoverId), weight: "full" });
  } else if (!armed && hoverId !== "" && hoverId !== selectedId) {
    out.push({ regionId: hoverId, tone: "hover", weight: "idle" });
  }
  return out;
}

/** Whether a mark shows under the player's highlight setting. */
export function highlightShown(weight: HighlightWeight, rule: HighlightRule): boolean {
  if (rule === "off") {
    return false;
  }
  return weight !== "idle" || rule === "always-hover";
}
