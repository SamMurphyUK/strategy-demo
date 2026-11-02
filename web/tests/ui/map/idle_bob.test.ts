import { describe, expect, it } from "vitest";
import { idleBob, idlePhase } from "../../../src/ui/map/uprightSprites";

describe("upright idle breathe", () => {
  it("gives troops a one-pixel sine and ships half of that, and leaves the guns still", () => {
    const crest = Math.PI / 6;
    expect(idleBob("infantry", 0, 0)).toBe(0);
    expect(idleBob("infantry", crest, 0)).toBeCloseTo(1, 8);
    expect(idleBob("tank", crest, Math.PI)).toBeCloseTo(-1, 8);
    expect(idleBob("battleship", crest, 0)).toBeCloseTo(0.5, 8);
    expect(idleBob("transport", crest, 0)).toBeCloseTo(0.5, 8);
    expect(idleBob("artillery", crest, 0.4)).toBe(0);
    expect(idleBob("aa", 4, 1)).toBe(0);
    expect(idleBob("aaa", 4, 1)).toBe(0);
  });

  it("keeps one stack's phase and gives a neighbour a different one", () => {
    const here = idlePhase("Southeast Asia", "infantry");
    expect(idlePhase("Southeast Asia", "infantry")).toBe(here);
    expect(here).toBeGreaterThanOrEqual(0);
    expect(here).toBeLessThan(Math.PI * 2);
    expect(idlePhase("India", "infantry")).not.toBe(here);
  });
});
