import { describe, expect, it } from "vitest";
import { formationOnBase, formationShares, insideRing } from "../../../src/ui/map/squadFormation";

describe("a squad on its base", () => {
  it("puts one unit at the middle, a pair on a diagonal, and a crowd in a wedge", () => {
    expect(formationShares(1)).toEqual([{ x: 0, y: 0 }]);
    const pair = formationShares(2);
    expect(pair).toHaveLength(2);
    expect(pair[0].x).toBeLessThan(pair[1].x);
    expect(pair[0].y).toBeLessThan(pair[1].y);
    const wedge = formationShares(3);
    expect(wedge).toHaveLength(3);
    // One lead at the front and middle, two flanking behind it.
    const lead = wedge.reduce((front, spot) => (spot.y > front.y ? spot : front));
    expect(lead.x).toBe(0);
    expect(wedge.filter((spot) => spot.y < lead.y)).toHaveLength(2);
    expect(wedge.filter((spot) => spot.x < 0)).toHaveLength(1);
    expect(wedge.filter((spot) => spot.x > 0)).toHaveLength(1);
    expect(formationShares(9)).toHaveLength(3);
  });

  it("keeps every foot inside the inner ring, at every squash and at full spread", () => {
    for (const count of [1, 2, 3, 6]) {
      for (const ratio of [1, 0.8, 0.55, 0.3]) {
        for (const spot of formationOnBase(count, 40, 1, ratio)) {
          expect(insideRing(spot, 40, ratio, 1)).toBe(true);
        }
      }
    }
  });

  it("spreads with the slider, and squashes with the ground", () => {
    const tight = formationOnBase(3, 40, 0.5, 1);
    const wide = formationOnBase(3, 40, 1, 1);
    expect(Math.abs(wide[0].x)).toBeCloseTo(Math.abs(tight[0].x) * 2, 9);
    const tilted = formationOnBase(3, 40, 1, 0.5);
    expect(Math.abs(tilted[2].y)).toBeCloseTo(Math.abs(wide[2].y) * 0.5, 9);
  });
});
