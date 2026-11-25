import { describe, expect, it } from "vitest";
import type { HighlightMode } from "../../../../src/ui/map/geometry";
import { highlightShown, regionHighlights } from "../../../../src/ui/viewport3d/shogun/highlightRules";

const NONE: HighlightMode = { kind: "none" };
const never = () => false;

function armed(legal: string[], from = "home"): HighlightMode {
  return { kind: "move", from, legal, hover: "" };
}

describe("an idle pointer", () => {
  it("marks the hovered territory only as an idle hover", () => {
    const marks = regionHighlights({ selectedId: "", hoverId: "poland", highlight: NONE, isHostile: never });
    expect(marks).toEqual([{ regionId: "poland", tone: "hover", weight: "idle" }]);
  });

  it("shows nothing for an idle hover under the click-and-drag rule", () => {
    expect(highlightShown("idle", "click-and-drag")).toBe(false);
    expect(highlightShown("idle", "always-hover")).toBe(true);
    expect(highlightShown("idle", "off")).toBe(false);
  });

  it("marks nothing with no hover and no selection", () => {
    expect(regionHighlights({ selectedId: "", hoverId: "", highlight: NONE, isHostile: never })).toEqual([]);
  });
});

describe("a clicked territory", () => {
  it("wears the full selection mark", () => {
    const marks = regionHighlights({ selectedId: "poland", hoverId: "", highlight: NONE, isHostile: never });
    expect(marks).toEqual([{ regionId: "poland", tone: "select", weight: "full" }]);
    expect(highlightShown("full", "click-and-drag")).toBe(true);
    expect(highlightShown("full", "always-hover")).toBe(true);
    expect(highlightShown("full", "off")).toBe(false);
  });

  it("keeps one mark when the pointer rests on it", () => {
    const marks = regionHighlights({ selectedId: "poland", hoverId: "poland", highlight: NONE, isHostile: never });
    expect(marks).toEqual([{ regionId: "poland", tone: "select", weight: "full" }]);
  });
});

describe("a stack picked up", () => {
  const hostile = (id: string) => id === "ukraine";

  it("marks the legal destination under the pointer in gold for a move", () => {
    const marks = regionHighlights({ selectedId: "home", hoverId: "poland", highlight: armed(["poland", "ukraine"]), isHostile: hostile });
    expect(marks).toContainEqual({ regionId: "poland", tone: "move", weight: "full" });
  });

  it("marks it in crimson for an attack", () => {
    const marks = regionHighlights({ selectedId: "home", hoverId: "ukraine", highlight: armed(["poland", "ukraine"]), isHostile: hostile });
    expect(marks).toContainEqual({ regionId: "ukraine", tone: "attack", weight: "full" });
  });

  it("hints at the other legal destinations in their own tone", () => {
    const marks = regionHighlights({ selectedId: "home", hoverId: "poland", highlight: armed(["poland", "ukraine"]), isHostile: hostile });
    expect(marks).toContainEqual({ regionId: "ukraine", tone: "attack", weight: "hint" });
    expect(marks.filter((mark) => mark.regionId === "poland")).toHaveLength(1);
    expect(highlightShown("hint", "click-and-drag")).toBe(true);
    expect(highlightShown("hint", "off")).toBe(false);
  });

  it("gives a hovered territory that is not a legal destination no mark", () => {
    const marks = regionHighlights({ selectedId: "home", hoverId: "siberia", highlight: armed(["poland"]), isHostile: hostile });
    expect(marks.some((mark) => mark.regionId === "siberia")).toBe(false);
  });

  it("keeps the selection on the territory the stack leaves, with no drop mark there", () => {
    const marks = regionHighlights({ selectedId: "home", hoverId: "home", highlight: armed(["home", "poland"]), isHostile: hostile });
    expect(marks.filter((mark) => mark.regionId === "home")).toEqual([{ regionId: "home", tone: "select", weight: "full" }]);
  });

  it("draws the hovered destination last, over the hints and the selection", () => {
    const marks = regionHighlights({ selectedId: "home", hoverId: "poland", highlight: armed(["ukraine", "poland"]), isHostile: hostile });
    expect(marks[marks.length - 1]).toEqual({ regionId: "poland", tone: "move", weight: "full" });
  });

  it("never calls a placement an attack", () => {
    const placing: HighlightMode = { kind: "mobilize", legal: ["poland"], hover: "" };
    const marks = regionHighlights({ selectedId: "", hoverId: "poland", highlight: placing, isHostile: () => true });
    expect(marks).toEqual([{ regionId: "poland", tone: "move", weight: "full" }]);
  });
});
