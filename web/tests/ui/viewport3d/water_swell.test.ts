import { describe, expect, it } from "vitest";
import { frontPosition } from "../../../src/ui/map/shipSway";
import { FRONT_CREST_GAIN, FRONT_CREST_WIDTH, waterY, WATER_Y_GLSL } from "../../../src/ui/viewport3d/skins/waterSwell";

const base = { amp: 0.3, seconds: 10, loopSeconds: 20, directionDeg: 0 };

describe("waterY", () => {
  it("is flat when the slider is 0", () => {
    expect(waterY(100, 50, { ...base, amp: 0 })).toBe(0);
  });
  it("stands highest at the travelling front", () => {
    const at = frontPosition(base.seconds, base.loopSeconds, base.directionDeg);
    const onFront = waterY(at, 50, base);
    const farOff = waterY(at + FRONT_CREST_WIDTH * 6, 50, base);
    expect(onFront).toBeGreaterThan(farOff + base.amp * (FRONT_CREST_GAIN - 1.2));
  });
  it("moves the crest with time", () => {
    const early = frontPosition(2, 20, 0);
    const late = frontPosition(12, 20, 0);
    expect(late).toBeGreaterThan(early);
    expect(waterY(late, 0, { ...base, seconds: 12 })).toBeGreaterThan(waterY(early, 0, { ...base, seconds: 12 }));
  });
  it("is shared with the shader chunk", () => {
    expect(WATER_Y_GLSL).toContain("float waterY(vec2 p, float t)");
    expect(WATER_Y_GLSL).toContain(FRONT_CREST_GAIN.toFixed(1));
  });
});
