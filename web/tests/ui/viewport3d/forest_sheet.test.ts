import { describe, expect, it } from "vitest";
import { buildForestSheet } from "../../../src/ui/viewport3d/forestSheet";
import { copseFactor } from "../../../src/ui/viewport3d/propPlan";

const none = { pine: [], broadleaf: [], acacia: [], palm: [], rock: [], dune: [], peak: [], house: [], factory: [] };
const tree = (x: number, y: number) => ({ x, y, scale: 1, height: 1, turn: 0, tint: "#000000", snow: 0 });

describe("forest copses", () => {
  it("clumps trees: dense hearts, open clearings, and nothing negative", () => {
    const values: number[] = [];
    for (let y = 0; y < 200; y += 3) {
      for (let x = 0; x < 200; x += 3) {
        values.push(copseFactor(x, y));
      }
    }
    expect(Math.min(...values)).toBeGreaterThan(0);
    expect(Math.min(...values)).toBeLessThan(0.15);
    expect(Math.max(...values)).toBeGreaterThan(1.2);
  });
  it("sheets the density under the trees and leaves open ground at zero", () => {
    const props = { ...none, pine: Array.from({ length: 12 }, (_, i) => tree(100 + (i % 4) * 1.5, 100 + Math.floor(i / 4) * 1.5)), rock: [tree(300, 300)] };
    const sheet = buildForestSheet({ x: 0, y: 0, w: 400, h: 400 }, props);
    const at = (x: number, y: number) => sheet.data[Math.floor((y / 400) * sheet.height) * sheet.width + Math.floor((x / 400) * sheet.width)];
    expect(at(102, 101)).toBeGreaterThan(120);
    expect(at(300, 300)).toBe(0);
    expect(at(10, 10)).toBe(0);
  });
});
