import { describe, expect, it } from "vitest";
import { drawHoverMark, type TerrainScene } from "../../../src/ui/map/mapRenderer";

/** A context that records the translations and strokes made on it, and nothing else. */
function recorder() {
  const calls: string[] = [];
  const shifts: number[] = [];
  const noop = () => undefined;
  const ctx = new Proxy(
    {},
    {
      get(_target, name: string) {
        if (name === "translate") return (x: number, y: number) => void shifts.push(y);
        if (name === "stroke") return () => void calls.push("stroke");
        if (name === "fill") return () => void calls.push("fill");
        return noop;
      },
      set() {
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls, shifts };
}

function scene(type: "sea" | "land", cliffDrop: number): TerrainScene {
  return {
    view: { x: 0, y: 0, k: 4 },
    dpr: 1,
    copies: [0],
    regions: [{ id: "r", type }],
    paths: new Map([["r", {} as Path2D]]),
    cliffDrop,
    terrainLift: () => 0,
  } as unknown as TerrainScene;
}

describe("a sea zone's outline sits on the water", () => {
  it("is lowered whole, outline and wash, when the board has cliffs", () => {
    const { ctx, calls, shifts } = recorder();
    drawHoverMark(ctx, scene("sea", 6), "r");
    expect(calls).toEqual(["fill", "stroke"]);
    // One translation, down the screen (positive world y), by the cliff face.
    expect(shifts.filter((y) => y > 0).length).toBe(1);
  });

  it("stays where it was on a flat map", () => {
    const { ctx, shifts } = recorder();
    drawHoverMark(ctx, scene("sea", 0), "r");
    expect(shifts.filter((y) => y !== 0)).toEqual([]);
  });

  it("does not lower a land outline", () => {
    const { ctx, shifts } = recorder();
    drawHoverMark(ctx, scene("land", 6), "r");
    expect(shifts.filter((y) => y > 0)).toEqual([]);
  });
});
