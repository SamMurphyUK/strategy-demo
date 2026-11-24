import { describe, expect, it } from "vitest";
import { PART_FIXED, PART_OPTIONAL, PART_SNOW, PART_TINT, propBuffers, propGeometry } from "../../../src/ui/viewport3d/propMeshes";
import { FACTORY_CHIMNEY, PROP_KINDS, type PropInstance } from "../../../src/ui/viewport3d/propPlan";

function partsOf(kind: (typeof PROP_KINDS)[number]): Set<number> {
  const part = propGeometry(kind).getAttribute("aPart");
  const seen = new Set<number>();
  for (let i = 0; i < part.count; i++) {
    seen.add(part.getX(i));
  }
  return seen;
}

describe("prop meshes", () => {
  it("stands every model on the board, about one unit wide and one unit tall", () => {
    for (const kind of PROP_KINDS) {
      const geometry = propGeometry(kind);
      geometry.computeBoundingBox();
      const box = geometry.boundingBox!;
      expect(box.min.z, kind).toBeGreaterThanOrEqual(-0.25);
      expect(box.max.z, kind).toBeGreaterThan(0.7);
      expect(box.max.z, kind).toBeLessThanOrEqual(FACTORY_CHIMNEY.top + 1e-6);
      expect(box.max.x - box.min.x, kind).toBeLessThan(1.6);
      expect(box.max.y - box.min.y, kind).toBeLessThan(1.6);
    }
  });

  it("gives every vertex a position, a flat normal, a colour, and a part", () => {
    for (const kind of PROP_KINDS) {
      const geometry = propGeometry(kind);
      const count = geometry.getAttribute("position").count;
      expect(geometry.getIndex(), kind).toBeNull();
      expect(count % 3, kind).toBe(0);
      expect(geometry.getAttribute("normal").count, kind).toBe(count);
      expect(geometry.getAttribute("color").count, kind).toBe(count);
      expect(geometry.getAttribute("aPart").count, kind).toBe(count);
      // Light enough to draw thousands of.
      expect(count / 3, kind).toBeLessThan(260);
    }
  });

  it("tints foliage and leaves trunks alone", () => {
    expect(partsOf("pine")).toEqual(new Set([PART_FIXED, PART_TINT]));
    expect(partsOf("rock")).toEqual(new Set([PART_TINT]));
  });

  it("gives the peak a snow cap and the factory an optional second chimney", () => {
    expect(partsOf("peak")).toEqual(new Set([PART_TINT, PART_SNOW]));
    expect(partsOf("factory").has(PART_OPTIONAL)).toBe(true);
    expect(partsOf("house").has(PART_OPTIONAL)).toBe(false);
  });

  it("faces every slope of the peak up and outward", () => {
    const geometry = propGeometry("peak");
    const normal = geometry.getAttribute("normal");
    for (let i = 0; i < normal.count; i++) {
      expect(normal.getZ(i)).toBeGreaterThan(0);
    }
  });

  it("puts the factory's chimney mouth where the plan sends the smoke", () => {
    const geometry = propGeometry("factory");
    const position = geometry.getAttribute("position");
    let top = -Infinity;
    let at = { x: 0, y: 0 };
    for (let i = 0; i < position.count; i++) {
      if (position.getZ(i) > top && position.getX(i) > 0) {
        top = position.getZ(i);
        at = { x: position.getX(i), y: position.getY(i) };
      }
    }
    expect(top).toBeCloseTo(FACTORY_CHIMNEY.top, 6);
    expect(Math.abs(at.x - FACTORY_CHIMNEY.x)).toBeLessThan(0.08);
    expect(Math.abs(at.y - FACTORY_CHIMNEY.y)).toBeLessThan(0.08);
  });

  it("writes an instance as a turn, a footprint, a height, and a place with y flipped", () => {
    const prop: PropInstance = { x: 40, y: 25, scale: 2, height: 3, turn: Math.PI / 2, tint: [0.2, 0.4, 0.6], snow: 1 };
    const buffers = propBuffers([prop], 0.5);
    expect(buffers.count).toBe(1);
    expect(buffers.flags).toHaveLength(3);
    expect(buffers.flags[2]).toBe(0.5);
    const m = buffers.matrices;
    // Column-major. A quarter turn sends the model's x axis to scene y.
    expect(m[0]).toBeCloseTo(0, 9);
    expect(m[1]).toBeCloseTo(2, 9);
    expect(m[4]).toBeCloseTo(-2, 9);
    expect(m[5]).toBeCloseTo(0, 9);
    expect(m[10]).toBe(3);
    expect([m[12], m[13], m[14], m[15]]).toEqual([40, -25, 0, 1]);
    expect(Array.from(buffers.tints)).toEqual([0.2, 0.4, 0.6].map((value) => Math.fround(value)));
    expect(buffers.flags[0]).toBe(1);
    expect(buffers.flags[1]).toBeGreaterThanOrEqual(0);
    expect(buffers.flags[1]).toBeLessThan(1);
  });
});
