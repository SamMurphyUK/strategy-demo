import { describe, expect, it } from "vitest";
import { GOLDEN_AZIMUTH, shadowLight, shadowReach, sunAt, sunAtAzimuth, sunFor, SUN_CYCLE_S, DAY_SHARE } from "../../../src/ui/viewport3d/sun";
import { fitSunShadow, lightAxes, shadowCoord, type ShadowGround } from "../../../src/ui/viewport3d/sunShadow";

const DAY = SUN_CYCLE_S * DAY_SHARE;
const GROUND: ShadowGround = { centerX: 400, centerY: -250, halfWidth: 60, halfDepth: 40, seaDrop: 7, seaShift: 3.5, top: 14 };

function corners(ground: ShadowGround): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      out.push([ground.centerX + sx * ground.halfWidth, ground.centerY + sy * ground.halfDepth, 0]);
      out.push([ground.centerX + sx * ground.halfWidth, ground.centerY + sy * ground.halfDepth + ground.seaShift, -ground.seaDrop]);
    }
  }
  return out;
}

describe("sun settings", () => {
  it("moves the sun only on the animated setting", () => {
    expect(sunFor("animated", 40)).toEqual(sunAt(40));
    expect(sunFor("animated", 40)).not.toEqual(sunFor("animated", 120));
    expect(sunFor("static-noon", 40)).toEqual(sunFor("static-noon", 120));
    expect(sunFor("static-golden", 40)).toEqual(sunFor("static-golden", 120));
  });

  it("holds the animated sun at an azimuth when the board asks", () => {
    expect(sunFor("animated", 40, "field", false, 28)).toEqual(sunAtAzimuth(28));
    // A static setting wins over the held azimuth.
    expect(sunFor("static-noon", 40, "field", false, 28)).toEqual(sunAtAzimuth(0));
  });

  it("stands high and plain at noon, low and warm for the golden setting", () => {
    const noon = sunFor("static-noon", 0);
    const golden = sunFor("static-golden", 0);
    sunAt(DAY * 0.5).dir.forEach((value, i) => expect(noon.dir[i]).toBeCloseTo(value, 9));
    expect(golden).toEqual(sunAtAzimuth(GOLDEN_AZIMUTH));
    expect(golden.dir[2]).toBeLessThan(noon.dir[2]);
    // Late afternoon: the sun is on the west side, and its light has less blue for its red.
    expect(golden.dir[0]).toBeLessThan(0);
    expect(golden.color[2] / golden.color[0]).toBeLessThan(noon.color[2] / noon.color[0]);
    expect(golden.direct).toBe(1);
  });

  it("puts the direct light out when the sun is off", () => {
    const off = sunFor("off", 40);
    expect(off.direct).toBe(0);
    expect(off.shadow).toBe(0);
    expect(sunFor("off", 40)).toEqual(sunFor("off", 400));
  });

  it("keeps the dusk look's own light on every setting but off", () => {
    expect(sunFor("static-noon", 0, "dusk")).toEqual(sunAt(0, "dusk"));
    expect(sunFor("static-golden", 0, "dusk")).toEqual(sunAt(0, "dusk"));
    expect(sunFor("off", 0, "dusk").direct).toBe(0);
  });
});

describe("the direction shadows are cast from", () => {
  it("keeps the sun's bearing and is a unit vector", () => {
    for (const azimuth of [-50, -20, 0, 35, 50]) {
      const sun = sunAtAzimuth(azimuth);
      const light = shadowLight(sun);
      expect(Math.hypot(...light)).toBeCloseTo(1, 9);
      expect(Math.atan2(light[0], light[1])).toBeCloseTo(Math.atan2(sun.dir[0], sun.dir[1]), 9);
    }
  });

  it("is the sun itself while the shadow is short, and is lifted when it would run long", () => {
    const noon = sunAtAzimuth(0);
    shadowLight(noon).forEach((value, i) => expect(value).toBeCloseTo(noon.dir[i], 9));
    const low = sunAtAzimuth(50);
    expect(shadowReach(low)).toBeGreaterThan(1);
    const lifted = shadowLight(low, 1);
    expect(Math.hypot(lifted[0], lifted[1]) / lifted[2]).toBeCloseTo(1, 9);
    expect(lifted[2]).toBeGreaterThan(low.dir[2]);
  });
});

describe("the shadow camera", () => {
  it("builds square axes with x level", () => {
    const { x, y, z } = lightAxes(shadowLight(sunAtAzimuth(30)));
    expect(x[2]).toBe(0);
    for (const [a, b] of [[x, y], [y, z], [x, z]] as const) {
      expect(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]).toBeCloseTo(0, 9);
    }
    for (const axis of [x, y, z]) {
      expect(Math.hypot(...axis)).toBeCloseTo(1, 9);
    }
    // Up the picture is toward the sun's far side, with z up.
    expect(y[2]).toBeGreaterThan(0);
  });

  it("covers the land and the water in view at every hour", () => {
    for (const azimuth of [-50, -25, 0, 25, 50]) {
      const light = shadowLight(sunAtAzimuth(azimuth));
      const fit = fitSunShadow(light, GROUND, 2048);
      for (const corner of corners(GROUND)) {
        const at = shadowCoord(fit, light, corner);
        expect(at.u).toBeGreaterThan(0);
        expect(at.u).toBeLessThan(1);
        expect(at.v).toBeGreaterThan(0);
        expect(at.v).toBeLessThan(1);
        expect(at.depth).toBeGreaterThan(0);
        expect(at.depth).toBeLessThan(1);
      }
      // The tallest caster over the middle of the view is in front of the far plane and behind the near one.
      const roof = shadowCoord(fit, light, [GROUND.centerX, GROUND.centerY, GROUND.top]);
      expect(roof.depth).toBeGreaterThan(0);
      expect(roof.depth).toBeLessThan(1);
    }
  });

  it("wastes little of the map", () => {
    const light = shadowLight(sunAtAzimuth(0));
    const fit = fitSunShadow(light, GROUND, 2048);
    const us = corners(GROUND).map((corner) => shadowCoord(fit, light, corner).u);
    const vs = corners(GROUND).map((corner) => shadowCoord(fit, light, corner).v);
    expect(Math.max(...us) - Math.min(...us)).toBeGreaterThan(0.94);
    expect(Math.max(...vs) - Math.min(...vs)).toBeGreaterThan(0.94);
  });

  it("keeps its size through a pan and moves in whole texels", () => {
    const light = shadowLight(sunAtAzimuth(20));
    const { x, y } = lightAxes(light);
    const base = fitSunShadow(light, GROUND, 1024);
    for (const step of [0.013, 0.4, 7.77, 123.4]) {
      const moved = fitSunShadow(light, { ...GROUND, centerX: GROUND.centerX + step, centerY: GROUND.centerY - step * 0.6 }, 1024);
      expect(moved.halfWidth).toBeCloseTo(base.halfWidth, 9);
      expect(moved.halfHeight).toBeCloseTo(base.halfHeight, 9);
      expect(moved.far).toBeCloseTo(base.far, 9);
      const delta = [moved.position[0] - base.position[0], moved.position[1] - base.position[1], moved.position[2] - base.position[2]];
      const across = (delta[0] * x[0] + delta[1] * x[1] + delta[2] * x[2]) / base.texelX;
      const down = (delta[0] * y[0] + delta[1] * y[1] + delta[2] * y[2]) / base.texelY;
      expect(Math.abs(across - Math.round(across))).toBeLessThan(1e-6);
      expect(Math.abs(down - Math.round(down))).toBeLessThan(1e-6);
    }
    // Ten pans of a twentieth of a texel: across its picture the camera holds, and steps at most
    // once each way. Along its line of sight it is free to slide; that moves no shadow.
    const stops = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const nudge = fitSunShadow(light, { ...GROUND, centerX: GROUND.centerX + base.texelX * 0.05 * i }, 1024);
      const across = nudge.position[0] * x[0] + nudge.position[1] * x[1] + nudge.position[2] * x[2];
      const down = nudge.position[0] * y[0] + nudge.position[1] * y[1] + nudge.position[2] * y[2];
      stops.add(`${Math.round(across / base.texelX)},${Math.round(down / base.texelY)}`);
    }
    expect(stops.size).toBeLessThanOrEqual(3);
  });

  it("spends a larger map on smaller texels", () => {
    const light = shadowLight(sunAtAzimuth(0));
    const low = fitSunShadow(light, GROUND, 1024);
    const high = fitSunShadow(light, GROUND, 4096);
    expect(high.texelX).toBeCloseTo(low.texelX / 4, 9);
    expect(high.halfWidth).toBeCloseTo(low.halfWidth, 9);
  });
});
