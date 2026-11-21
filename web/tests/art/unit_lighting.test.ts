import { describe, expect, it } from "vitest";
import { lightUnitSprite, type UnitSkyLight } from "../../src/art/unitLighting";

describe("unit lighting", () => {
  it("tints an opaque sprite with ambient and keeps clear pixels clear", () => {
    if (typeof document === "undefined") {
      return;
    }
    const source = document.createElement("canvas");
    source.width = 8;
    source.height = 8;
    const g = source.getContext("2d");
    expect(g).not.toBeNull();
    if (!g) {
      return;
    }
    g.fillStyle = "rgb(200, 180, 140)";
    g.fillRect(2, 2, 4, 4);

    const light: UnitSkyLight = {
      ambient: [88, 106, 162],
      rims: [{ x: 0, color: [150, 182, 232], k: 0.2 }],
      key: "test-night",
    };
    const lit = lightUnitSprite(source, 8, 8, light, 640);
    expect(lit).not.toBeNull();
    if (!lit) {
      return;
    }
    const pixels = lit.getContext("2d")!.getImageData(0, 0, 8, 8).data;
    // Corner stays fully clear.
    expect(pixels[3]).toBe(0);
    // Solid pixel is darker / cooler than the warm paint after ambient multiply.
    const solid = lit.getContext("2d")!.getImageData(4, 4, 1, 1).data;
    expect(solid[3]).toBeGreaterThan(200);
    expect(solid[0]).toBeLessThan(200);
    expect(solid[2]).toBeGreaterThan(solid[0] - 10);
  });
});
