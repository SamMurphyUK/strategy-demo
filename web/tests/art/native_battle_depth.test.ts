import { describe, expect, it } from "vitest";
import {
  contactShadow,
  depthOrder,
  depthUnitScale,
  fieldBlit,
  footprintSpan,
  nativeStamp,
  shadowColor,
} from "../../src/art/nativeBattleOverlay";

/** An RGBA buffer where each listed [x, y] is opaque. */
function pixels(width: number, height: number, opaque: [number, number][]): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (const [x, y] of opaque) {
    rgba[(y * width + x) * 4 + 3] = 255;
  }
  return rgba;
}

describe("lane depth scale", () => {
  it("is about 0.85 on the back lane and 1.05 on the front lane", () => {
    expect(depthUnitScale(1, 114)).toBeCloseTo(0.85, 6);
    expect(depthUnitScale(1, 525)).toBeCloseTo(1.05, 6);
    expect(depthUnitScale(1, 160)).toBeLessThan(depthUnitScale(1, 480));
  });

  it("multiplies the size the unit was given", () => {
    expect(depthUnitScale(2, 525)).toBeCloseTo(2.1, 6);
    expect(depthUnitScale(0.5, 114)).toBeCloseTo(0.425, 6);
  });

  it("leaves a sea scene's units at the size they were given", () => {
    expect(depthUnitScale(1, 565, false)).toBe(1);
    expect(depthUnitScale(2, 300, false)).toBe(2);
  });

  it("keeps the ground point on its station when the depth scale changes the size", () => {
    const size = { width: 48, height: 48 };
    const feet = { x: 24, y: 40 };
    const station = { x: 300, y: 160 };
    const scale = depthUnitScale(1, station.y);
    const stamp = nativeStamp(size, feet, station, scale);
    expect(stamp.x + feet.x * scale).toBeCloseTo(station.x, 6);
    expect(stamp.y + feet.y * scale).toBeCloseTo(station.y, 6);
    const blit = fieldBlit(size, size, feet, station, scale, 1, 1, false);
    expect(blit.width).toBeCloseTo(48 * scale, 3);
    expect(blit.height).toBeCloseTo(48 * scale, 3);
  });
});

describe("footprint", () => {
  it("takes the width of the lowest opaque rows, not of an antenna or a barrel", () => {
    const opaque: [number, number][] = [];
    for (let x = 4; x <= 19; x += 1) {
      opaque.push([x, 19]);
      opaque.push([x, 18]);
    }
    for (let y = 2; y < 18; y += 1) opaque.push([11, y]);
    opaque.push([0, 10], [1, 10], [2, 10]);
    const span = footprintSpan(pixels(24, 20, opaque), 24, 20);
    expect(span.left).toBe(4);
    expect(span.right).toBe(19);
    expect(span.width).toBe(16);
    expect(span.centre).toBe(11.5);
  });

  it("falls back to half the picture, centred, when nothing is opaque", () => {
    const span = footprintSpan(new Uint8ClampedArray(20 * 10 * 4), 20, 10);
    expect(span.width).toBe(10);
    expect(span.centre).toBeCloseTo(9.5, 6);
  });
});

describe("contact shadow", () => {
  const footprint = { left: 4, right: 19, width: 16, centre: 11.5 };

  it("is a flat oval that grows with the unit's width and its lane's depth scale", () => {
    const back = contactShadow(footprint, { x: 12, y: 19 }, { x: 200, y: 160 }, 0.85);
    const front = contactShadow(footprint, { x: 12, y: 19 }, { x: 200, y: 480 }, 1.05);
    expect(front.rx).toBeGreaterThan(back.rx);
    expect(front.ry).toBeGreaterThan(back.ry);
    expect(back.ry).toBeLessThan(back.rx / 3);
    const wide = contactShadow({ ...footprint, width: 32 }, { x: 12, y: 19 }, { x: 200, y: 160 }, 0.85);
    expect(wide.rx).toBeCloseTo(back.rx * 2, 6);
  });

  it("sits on the ground point, shifted to the middle of the footprint", () => {
    const spot = contactShadow(footprint, { x: 12, y: 19 }, { x: 200, y: 300 }, 1);
    expect(spot.y).toBe(300);
    expect(spot.x).toBeCloseTo(199.5, 6);
  });

  it("uses the exact translucent colour at full strength", () => {
    expect(shadowColor(1)).toBe("rgba(26, 22, 20, 0.32)");
    expect(shadowColor(0)).toBe("rgba(26, 22, 20, 0)");
    expect(shadowColor(2)).toBe("rgba(26, 22, 20, 0.32)");
  });
});

describe("draw order", () => {
  it("draws the back lane first and keeps placement order on one lane", () => {
    const list = [
      { id: 1, station: { y: 300 } },
      { id: 2, station: { y: 160 } },
      { id: 3, station: { y: 300 } },
      { id: 4, station: { y: 480 } },
    ];
    expect(depthOrder(list).map((item) => item.id)).toEqual([2, 1, 3, 4]);
    expect(list.map((item) => item.id)).toEqual([1, 2, 3, 4]);
  });
});
