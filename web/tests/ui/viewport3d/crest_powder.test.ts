import { describe, expect, it } from "vitest";
import { crestAt, POWDER_POOL, SAND_COLOUR, SNOW_COLOUR } from "../../../src/ui/viewport3d/crestPowder";
import { isMonsoonRegion, monsoonSites } from "../../../src/ui/viewport3d/mistPlacement";

describe("crest powder", () => {
  // A ridge along x = 50, 4 high and a few units wide.
  const ridge = (x: number) => 4 * Math.exp(-(((x - 50) / 4) ** 2));
  it("finds a steep crest and not a flat plain or the ridge's own top", () => {
    const flank = crestAt((x) => ridge(x), 46, 10);
    expect(flank.slope).toBeGreaterThan(0.3);
    const plain = crestAt((x) => ridge(x), 0, 10);
    expect(plain.slope).toBeLessThan(0.01);
    const top = crestAt((x) => ridge(x), 50, 10);
    expect(top.ridge).toBeGreaterThan(0);
  });
  it("keeps the powder under the bloom", () => {
    expect(Math.max(...SAND_COLOUR, ...SNOW_COLOUR)).toBeLessThanOrEqual(0.92);
    expect(POWDER_POOL).toBeGreaterThan(100);
  });
});

describe("monsoon mist", () => {
  it("names the Southeast Asian territories and spreads dense sites only over their land", () => {
    for (const id of ["Burma", "Borneo", "New Guinea", "Philippine Islands", "Thailand", "Indochina", "Malaya", "Sumatra", "Java"]) {
      expect(isMonsoonRegion(id)).toBe(true);
    }
    expect(isMonsoonRegion("Germany")).toBe(false);
    const box = { x: 0, y: 0, w: 40, h: 40 };
    const sites = monsoonSites(
      [
        { id: "Burma", box, contains: () => true },
        { id: "Germany", box, contains: () => true },
      ],
      (x) => x < 20,
    );
    expect(sites.length).toBeGreaterThan(5);
    expect(sites.every((site) => site.dense === true && site.x < 20)).toBe(true);
  });
});
