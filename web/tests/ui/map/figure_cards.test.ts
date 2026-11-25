import { describe, expect, it } from "vitest";
import type { FigureCard } from "../../../src/ui/map/boardLayer";
import { layoutOutline, MAX_OUTLINE_SIDE, stackMatches, stackOfFigure } from "../../../src/ui/map/figureCards";

function card(id: string, left: number, top: number, w = 40, h = 60): FigureCard {
  return { id, left, top, w, h, feetX: left + w / 2, feetY: top + h };
}

const CARDS: FigureCard[] = [
  card("ruhr|0|GER/tank/0:0", 100, 200),
  card("ruhr|0|GER/tank/0:1", 130, 205),
  card("ruhr|0|GER/infantry/0:0", 220, 210, 20, 40),
  card("paris|0|UK/infantry/0:0", 600, 300, 20, 40),
  // The same stack on the next copy of the world, mostly off the right edge.
  card("ruhr|800|GER/tank/0:0", 990, 200),
];

describe("which stack a figure stands in", () => {
  it("drops the place in the stack", () => {
    expect(stackOfFigure("ruhr|0|GER/tank/0:1")).toBe("ruhr|0|GER/tank/0");
    expect(stackOfFigure("no-index")).toBe("no-index");
  });

  it("matches the region and the slot on any copy, or on the copy named", () => {
    expect(stackMatches("ruhr|0|GER/tank/0", { kind: "selected", regionId: "ruhr", key: "GER/tank/0" })).toBe(true);
    expect(stackMatches("ruhr|-800|GER/tank/0", { kind: "selected", regionId: "ruhr", key: "GER/tank/0" })).toBe(true);
    expect(stackMatches("ruhr|800|GER/tank/0", { kind: "hover", regionId: "ruhr", key: "GER/tank/0", copyDx: 0 })).toBe(false);
    expect(stackMatches("ruhr|800|GER/tank/0", { kind: "hover", regionId: "ruhr", key: "GER/tank/0", copyDx: 800 })).toBe(true);
  });

  it("does not take one stack for another that shares a prefix or a suffix", () => {
    expect(stackMatches("ruhr|0|GER/tank/0", { kind: "selected", regionId: "ruhr", key: "tank/0" })).toBe(false);
    expect(stackMatches("ruhr-east|0|GER/tank/0", { kind: "selected", regionId: "ruhr", key: "GER/tank/0" })).toBe(false);
    expect(stackMatches("ruhr|0|GER/tank/0", { kind: "selected", regionId: "ruhr", key: "GER/tank/01" })).toBe(false);
  });
});

describe("the outline's rectangles", () => {
  it("wraps the picked stack's figures with clear space round them", () => {
    const layout = layoutOutline(CARDS, [{ kind: "selected", regionId: "ruhr", key: "GER/tank/0" }], 1000, 600, 10);
    expect(layout.slots).toHaveLength(1);
    const slot = layout.slots[0];
    expect(slot).toMatchObject({ kind: "selected", x: 90, y: 190, w: 90, h: 85, atlasX: 0, atlasY: 0 });
    // The other tank stack's figures and the infantry are not in it.
    expect(layout.members[0]).toEqual([0, 1]);
    expect(layout.width).toBe(90);
    expect(layout.height).toBe(85);
  });

  it("marks the copy of a selected stack that shows most", () => {
    const layout = layoutOutline(CARDS, [{ kind: "selected", regionId: "ruhr", key: "GER/tank/0" }], 1000, 600, 10);
    expect(layout.members[0]).not.toContain(4);
  });

  it("cuts a rectangle to the frame", () => {
    const layout = layoutOutline(CARDS, [{ kind: "hover", regionId: "ruhr", key: "GER/tank/0", copyDx: 800 }], 1000, 600, 10);
    const slot = layout.slots[0];
    expect(slot.x).toBe(980);
    expect(slot.x + slot.w).toBe(1000);
  });

  it("lays a selection and a hover side by side, the selection first", () => {
    const layout = layoutOutline(
      CARDS,
      [
        { kind: "hover", regionId: "paris", key: "UK/infantry/0", copyDx: 0 },
        { kind: "selected", regionId: "ruhr", key: "GER/tank/0" },
      ],
      1000,
      600,
      10,
    );
    expect(layout.slots.map((slot) => slot.kind)).toEqual(["selected", "hover"]);
    expect(layout.slots[1].atlasX).toBe(layout.slots[0].w);
    expect(layout.width).toBe(layout.slots[0].w + layout.slots[1].w);
    expect(layout.height).toBe(Math.max(layout.slots[0].h, layout.slots[1].h));
  });

  it("marks a stack once when the pointer is over the selected one", () => {
    const layout = layoutOutline(
      CARDS,
      [
        { kind: "selected", regionId: "ruhr", key: "GER/tank/0" },
        { kind: "hover", regionId: "ruhr", key: "GER/tank/0", copyDx: 0 },
      ],
      1000,
      600,
      10,
    );
    expect(layout.slots).toHaveLength(1);
    expect(layout.slots[0].kind).toBe("selected");
  });

  it("marks nothing for a stack with no figure in view, or one too large to be a stack", () => {
    expect(layoutOutline(CARDS, [{ kind: "selected", regionId: "moscow", key: "USSR/tank/0" }], 1000, 600, 10).slots).toEqual([]);
    const huge = [card("ruhr|0|GER/tank/0:0", 0, 0, MAX_OUTLINE_SIDE + 50, 60)];
    expect(layoutOutline(huge, [{ kind: "selected", regionId: "ruhr", key: "GER/tank/0" }], 4000, 600, 10).slots).toEqual([]);
    // A territory is never a pick: with no stack named there is nothing to mark.
    expect(layoutOutline(CARDS, [], 1000, 600, 10).slots).toEqual([]);
  });
});
