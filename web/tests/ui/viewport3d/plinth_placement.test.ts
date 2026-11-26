import { describe, expect, it } from "vitest";
import { MAX_PLINTHS, plinthBuffers, plinthFactor, plinthRadius, writePlinths } from "../../../src/ui/viewport3d/plinthPlacement";

const look = { heightRatio: 0.22, pair: 1.25, crowd: 1.45 };

function counter(x: number, y: number, count: number, domain = "land") {
  return { x, y, domain, slot: { key: `${x}`, entry: { faction_id: "GER", unit_type_id: "infantry", count } } };
}

function frameOf(counters: ReturnType<typeof counter>[]) {
  return {
    view: { x: 0, y: 0, k: 4 },
    width: 800,
    height: 600,
    tokenPx: 32,
    layouts: [{ counters }],
  } as unknown as Parameters<typeof writePlinths>[1];
}

describe("the 3D bases", () => {
  it("are 1x for one unit, 1.25x for two, and 1.45x for three or more", () => {
    expect(plinthFactor(1, look)).toBe(1);
    expect(plinthFactor(2, look)).toBe(1.25);
    expect(plinthFactor(3, look)).toBe(1.45);
    expect(plinthFactor(8, look)).toBe(1.45);
    expect(plinthRadius(32, 4, 2, look)).toBeCloseTo(plinthRadius(32, 4, 1, look) * 1.25, 9);
  });

  it("write one base for each land stack on screen, and none for a ship or an off-screen stack", () => {
    const out = plinthBuffers();
    const count = writePlinths(out, frameOf([counter(100, 100, 1), counter(200, 200, 3), counter(300, 300, 1, "sea"), counter(-500, 100, 1)]), look, () => ({ dome: 0, ridge: 0 }));
    expect(count).toBe(2);
    // The second is a crowd: a wider base, and as high as its radius sets.
    expect(out.matrices[16]).toBeGreaterThan(out.matrices[0]);
    expect(out.matrices[16 + 10]).toBeCloseTo(out.matrices[16] * 0.22, 5);
  });

  it("stand each base on the ground under it, in the faction's colour", () => {
    const out = plinthBuffers();
    writePlinths(out, frameOf([counter(100, 100, 1)]), look, () => ({ dome: 0.3, ridge: 0.5 }));
    expect(out.rises[0]).toBeCloseTo(0.3, 6);
    expect(out.rises[1]).toBeCloseTo(0.5, 6);
    expect(out.colors[0] + out.colors[1] + out.colors[2]).toBeGreaterThan(0);
    expect(out.matrices[15]).toBe(1);
  });

  it("never hold more than the buffers do", () => {
    const many = Array.from({ length: MAX_PLINTHS + 40 }, (_, i) => counter(10 + (i % 700), 10 + Math.floor(i / 700) * 20, 1));
    expect(writePlinths(plinthBuffers(), frameOf(many), look, () => ({ dome: 0, ridge: 0 }))).toBe(MAX_PLINTHS);
  });
});

describe("vehicle bases and aircraft at sea", () => {
  it("draws a tank's or gun's base tighter than an infantry base's", async () => {
    const { plinthRadius } = await import("../../../src/ui/viewport3d/plinthPlacement");
    const look = { pair: 1.25, crowd: 1.45, vehicleRadius: 0.7 };
    const infantry = plinthRadius(30, 2, 1, look, "infantry");
    expect(plinthRadius(30, 2, 1, look, "tank")).toBeCloseTo(infantry * 0.7, 9);
    expect(plinthRadius(30, 2, 1, look, "artillery")).toBeCloseTo(infantry * 0.7, 9);
    expect(plinthRadius(30, 2, 1, look, "fighter")).toBeCloseTo(infantry, 9);
  });
});
