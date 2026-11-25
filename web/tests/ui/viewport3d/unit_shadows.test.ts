import { describe, expect, it } from "vitest";
import type { BoardFrame } from "../../../src/ui/map/boardLayer";
import type { RegionLayout } from "../../../src/ui/map/mapRenderer";
import { screenToWorld } from "../../../src/ui/map/viewMath";
import { DAY_SHARE, SUN_CYCLE_S, sunAt } from "../../../src/ui/viewport3d/sun";
import { contactShadow, shadowDirection, unitShadow, writeUnitShadows } from "../../../src/ui/viewport3d/unitShadows";

const MORNING = sunAt(SUN_CYCLE_S * DAY_SHARE * 0.2);
const NIGHT = sunAt(SUN_CYCLE_S * DAY_SHARE + 2);

function frameWith(counters: { x: number; y: number; domain: "land" | "air" | "sea" }[], unitFade = 0): BoardFrame {
  const layout = { counters, copyDx: 0 } as unknown as RegionLayout;
  return {
    view: { x: 100, y: 50, k: 4 },
    width: 1000,
    height: 600,
    dpr: 1,
    fitK: 1.2,
    maxK: 8,
    copies: [0],
    layouts: [layout],
    tokenPx: 32,
    unitFade,
    layers: [],
  };
}

describe("unit shadows", () => {
  it("falls away from the sun, along the ground", () => {
    const dir = shadowDirection(MORNING);
    expect(Math.hypot(dir.x, dir.y)).toBeCloseTo(1, 9);
    expect(dir.x * MORNING.dir[0] + dir.y * MORNING.dir[1]).toBeLessThan(0);
    // The sun is on the north side, so shadows fall south: toward the bottom of the screen.
    expect(dir.y).toBeLessThan(0);
  });

  it("still falls somewhere when the sun is down", () => {
    const dir = shadowDirection(NIGHT);
    expect(Math.hypot(dir.x, dir.y)).toBeCloseTo(1, 3);
    expect(dir.y).toBeLessThan(0);
  });

  it("slides a counter's disc at least a pixel and a half, however far out the camera is", () => {
    for (const k of [0.7, 1.2, 4, 8]) {
      const shadow = unitShadow(0, 0, 5, false, 0, MORNING, k);
      expect(shadow.a).toBeCloseTo(shadow.b, 9);
      expect(shadow.a).toBeGreaterThan(5);
      expect(Math.hypot(shadow.x, shadow.y) * k).toBeGreaterThanOrEqual(1.6 - 1e-9);
    }
  });

  it("throws a figure's shadow along the ground, longer than it is wide", () => {
    const shadow = unitShadow(10, -20, 5, false, 1, MORNING, 4);
    const dir = shadowDirection(MORNING);
    expect(shadow.a).toBeGreaterThan(shadow.b);
    expect(Math.cos(shadow.angle)).toBeCloseTo(dir.x, 9);
    expect(Math.sin(shadow.angle)).toBeCloseTo(dir.y, 9);
    // The near end of the ellipse stays under the figure's feet.
    const offset = (shadow.x - 10) * dir.x + (shadow.y + 20) * dir.y;
    expect(offset).toBeGreaterThan(0);
    expect(offset - shadow.a).toBeLessThan(0);
  });

  it("drops an aircraft's shadow further off and smaller", () => {
    const tank = unitShadow(0, 0, 5, false, 1, MORNING, 4);
    const plane = unitShadow(0, 0, 5, true, 1, MORNING, 4);
    expect(Math.hypot(plane.x, plane.y)).toBeGreaterThan(Math.hypot(tank.x, tank.y) + 4);
    expect(plane.a).toBeLessThan(tank.a);
    // On the strategic sheet a counter is a counter, whatever it flies.
    expect(unitShadow(0, 0, 5, true, 0, MORNING, 4)).toEqual(unitShadow(0, 0, 5, false, 0, MORNING, 4));
  });

  it("writes one matrix per counter in view, at the counter's place on the board", () => {
    const frame = frameWith([
      { x: 500, y: 300, domain: "land" },
      { x: 5000, y: 300, domain: "land" },
      { x: 200, y: 100, domain: "air" },
    ]);
    const out = new Float32Array(16 * 8);
    expect(writeUnitShadows(out, frame, MORNING, 0.04)).toBe(2);
    const world = screenToWorld(frame.view, { x: 500, y: 300 });
    const radius = 32 / 2 / 4;
    const expected = unitShadow(world.x, -world.y, radius, false, 0, MORNING, 4);
    expect(out[12]).toBeCloseTo(expected.x, 4);
    expect(out[13]).toBeCloseTo(expected.y, 4);
    expect(out[14]).toBeCloseTo(0.04, 6);
    expect(out[15]).toBe(1);
    // Column lengths are the ellipse's two radii.
    expect(Math.hypot(out[0], out[1])).toBeCloseTo(expected.a, 4);
    expect(Math.hypot(out[4], out[5])).toBeCloseTo(expected.b, 4);
  });

  it("leaves only the dark under the base when the figures cast their own shadows", () => {
    // A counter keeps its disc.
    expect(contactShadow(3, -4, 5, 0, MORNING, 4)).toEqual(unitShadow(3, -4, 5, false, 0, MORNING, 4));
    // Standing figures: a base wider than it is deep, level with the screen, and close under the feet.
    const base = contactShadow(3, -4, 5, 1, MORNING, 4);
    expect(base.a).toBeGreaterThan(base.b);
    expect(base.angle).toBe(0);
    expect(Math.hypot(base.x - 3, base.y + 4)).toBeLessThan(5 * 0.3);
    // Shorter than the thrown ellipse it replaces: the long shadow is the figure's own now.
    const thrown = unitShadow(3, -4, 5, false, 1, MORNING, 4);
    expect(Math.hypot(base.x - 3, base.y + 4)).toBeLessThan(Math.hypot(thrown.x - 3, thrown.y + 4));
    const frame = frameWith([{ x: 500, y: 300, domain: "air" }], 1);
    const out = new Float32Array(16);
    expect(writeUnitShadows(out, frame, MORNING, 0.04, true)).toBe(1);
    const world = screenToWorld(frame.view, { x: 500, y: 300 });
    const expected = contactShadow(world.x, -world.y, 32 / 2 / 4, 1, MORNING, 4);
    expect(out[12]).toBeCloseTo(expected.x, 4);
    expect(out[13]).toBeCloseTo(expected.y, 4);
    expect(Math.hypot(out[0], out[1])).toBeCloseTo(expected.a, 4);
    expect(Math.hypot(out[4], out[5])).toBeCloseTo(expected.b, 4);
  });

  it("stops at the room it was given", () => {
    const counters = Array.from({ length: 10 }, (_, i) => ({ x: 100 + i * 20, y: 100, domain: "land" as const }));
    expect(writeUnitShadows(new Float32Array(16 * 4), frameWith(counters), MORNING, 0)).toBe(4);
  });
});
