import { describe, expect, it } from "vitest";
import { DEPARTURE_SHADOW_PX, departureAscent, departureShadowAlpha } from "../../../src/ui/battle/departureShadow";

describe("departure shadow", () => {
  it("fades a climbing plane's ground shadow out over a short climb", () => {
    expect(departureShadowAlpha(0)).toBe(1);
    expect(departureShadowAlpha(DEPARTURE_SHADOW_PX / 2)).toBeCloseTo(0.5, 5);
    expect(departureShadowAlpha(DEPARTURE_SHADOW_PX)).toBe(0);
    expect(departureShadowAlpha(DEPARTURE_SHADOW_PX + 40)).toBe(0);
  });

  it("only lifts the shadow for a plane that is flying off", () => {
    expect(departureAscent({ type: "fighter", victoryAscentY: 12 })).toBe(12);
    expect(departureAscent({ type: "tank", victoryAscentY: 12 })).toBe(0);
    expect(departureAscent({ type: "fighter" })).toBe(0);
  });
});