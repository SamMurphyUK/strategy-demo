import { describe, expect, it } from "vitest";
import { missCraterRadii, missLeavesCrater } from "../../../src/ui/battle/impactScars";

describe("miss craters", () => {
  it("leaves a scar on land and skips the naval and air-strike boards", () => {
    expect(missLeavesCrater("normandy")).toBe(true);
    expect(missLeavesCrater("eastern")).toBe(true);
    expect(missLeavesCrater("north_africa")).toBe(true);
    expect(missLeavesCrater("pacific")).toBe(true);
    expect(missLeavesCrater("navy_test")).toBe(false);
    expect(missLeavesCrater("air_strike_test")).toBe(false);
  });

  it("stays about half the size of a light hit crater", () => {
    const small = missCraterRadii(() => 0);
    const large = missCraterRadii(() => 1);
    expect(small).toEqual({ rx: 5, ry: 3 });
    expect(large).toEqual({ rx: 7.5, ry: 4.5 });
    expect(large.rx).toBeLessThan(9);
    expect(large.ry).toBeLessThan(6);
  });
});
