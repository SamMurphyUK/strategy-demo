import { describe, expect, it } from "vitest";
import { islandCells, islandScale, lowerShare, makeLowerAt, MIN_ISLAND_SCALE } from "../../../src/ui/viewport3d/islandLowering";

const square = (x: number, y: number, size: number) => [[[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]] as never;

describe("island lowering", () => {
  const land = [square(0, 0, 200), square(300, 300, 10), square(400, 100, 20)] as never;
  const regions = [
    { id: "Continent", anchor: { x: 100, y: 100 } },
    { id: "Midway", anchor: { x: 305, y: 305 } },
    { id: "Wake", anchor: { x: 410, y: 110 } },
  ];
  it("finds the small polygons as islands, with the territories on them", () => {
    const cells = islandCells(land, regions, 900);
    expect(cells.map((cell) => cell.index)).toEqual([1, 2]);
    expect(cells[0].regionIds).toEqual(["Midway"]);
    expect(cells[1].regionIds).toEqual(["Wake"]);
  });
  it("takes a territory's own scale over the global one, and holds it above the floor", () => {
    const cell = { regionIds: ["Midway"] };
    expect(islandScale(cell, {}, 0.6)).toBe(0.6);
    expect(islandScale(cell, { Midway: 0.3 }, 0.6)).toBe(0.3);
    expect(islandScale(cell, { Midway: -5 }, 0.6)).toBe(MIN_ISLAND_SCALE);
    expect(islandScale(cell, {}, 4)).toBe(1);
    expect(lowerShare(1)).toBe(0);
    expect(lowerShare(0.4)).toBeCloseTo(0.6, 9);
  });
  it("says how far the ground is lowered at a point: on an island, and nowhere else", () => {
    const cells = islandCells(land, regions, 900);
    const lowerAt = makeLowerAt(cells, (cell) => (cell.regionIds[0] === "Midway" ? 0.5 : 1), () => 7);
    expect(lowerAt(305, 305)).toBeCloseTo(3.5, 9);
    expect(lowerAt(410, 110)).toBe(0);
    expect(lowerAt(100, 100)).toBe(0);
  });
});
