import { describe, expect, it } from "vitest";
import type { MultiPolygon } from "../../../../src/ui/map/regionClip";
import { chainSegments, friendlyBorders, isFactionOwner, type Segment } from "../../../../src/ui/viewport3d/shogun/borderLines";

/** An axis-aligned box as a territory. */
function box(x: number, y: number, w: number, h: number): MultiPolygon {
  return [
    [
      [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ],
    ],
  ];
}

function lengthOf(segments: readonly Segment[]): number {
  return segments.reduce((sum, [x1, y1, x2, y2]) => sum + Math.hypot(x2 - x1, y2 - y1), 0);
}

describe("borders inside one faction's land", () => {
  // Three boxes in a row: two German, then one Soviet.
  const row = [
    { owner: "ger", shape: box(0, 0, 10, 10) },
    { owner: "ger", shape: box(10, 0, 10, 10) },
    { owner: "ussr", shape: box(20, 0, 10, 10) },
  ];

  it("finds the border two territories of one faction share", () => {
    const borders = friendlyBorders(row, null);
    expect(lengthOf(borders)).toBeCloseTo(10, 6);
    for (const [x1, , x2] of borders) {
      expect(x1).toBe(10);
      expect(x2).toBe(10);
    }
  });

  it("leaves the border between two factions alone", () => {
    const borders = friendlyBorders(row, null);
    expect(borders.some(([x1]) => x1 === 20)).toBe(false);
  });

  it("treats unowned and neutral land as no one's empire", () => {
    expect(isFactionOwner("ger")).toBe(true);
    expect(isFactionOwner("")).toBe(false);
    expect(isFactionOwner("neutral")).toBe(false);
    expect(isFactionOwner(undefined)).toBe(false);
    const neutral = [
      { owner: "", shape: box(0, 0, 10, 10) },
      { owner: "", shape: box(10, 0, 10, 10) },
    ];
    expect(friendlyBorders(neutral, null)).toEqual([]);
  });

  it("matches owners without regard to case", () => {
    const mixed = [
      { owner: "GER", shape: box(0, 0, 10, 10) },
      { owner: "ger", shape: box(10, 0, 10, 10) },
    ];
    expect(lengthOf(friendlyBorders(mixed, null))).toBeCloseTo(10, 6);
  });

  it("drops a shared border that lies on the world's seam", () => {
    const seam = { left: 0, right: 10 };
    const wrapped = [
      { owner: "ger", shape: box(0, 0, 10, 10) },
      { owner: "ger", shape: box(10, 0, 10, 10) },
    ];
    expect(friendlyBorders(wrapped, seam)).toEqual([]);
  });
});

describe("joining segments into lines", () => {
  it("joins segments that meet end to end, whichever way each points", () => {
    const lines = chainSegments([
      [0, 0, 1, 0],
      [2, 0, 1, 0],
      [2, 0, 2, 1],
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveLength(4);
    const ends = [lines[0][0], lines[0][3]].map(([x, y]) => `${x},${y}`).sort();
    expect(ends).toEqual(["0,0", "2,1"]);
  });

  it("stops a line where three borders meet", () => {
    const lines = chainSegments([
      [0, 0, 1, 0],
      [1, 0, 2, 0],
      [1, 0, 1, 1],
    ]);
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(line).toHaveLength(2);
    }
  });

  it("returns a closed loop with its first point repeated", () => {
    const lines = chainSegments([
      [0, 0, 1, 0],
      [1, 0, 1, 1],
      [1, 1, 0, 1],
      [0, 1, 0, 0],
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveLength(5);
    expect(lines[0][0]).toEqual(lines[0][4]);
  });

  it("uses every segment once", () => {
    const segments: Segment[] = [
      [0, 0, 1, 0],
      [1, 0, 2, 0],
      [1, 0, 1, 1],
      [5, 5, 6, 5],
      [6, 5, 6, 6],
    ];
    const lines = chainSegments(segments);
    const pieces = lines.reduce((sum, line) => sum + line.length - 1, 0);
    expect(pieces).toBe(segments.length);
  });

  it("returns nothing for nothing", () => {
    expect(chainSegments([])).toEqual([]);
  });
});
