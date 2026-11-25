import { describe, expect, it } from "vitest";
import { drawBasePlinth, mixHex, PLINTH_BRASS, PLINTH_EBONY, PLINTH_WALNUT, plinthParts, plinthRingColor } from "../../../src/ui/map/basePlinth";
import { DEFAULT_VISUALS, plinthLook } from "../../../src/ui/map/mapVisualConfig";

interface Call {
  op: string;
  args: number[];
  fill: string;
  stroke: string;
  alpha: number;
  width: number;
}

/** A canvas that writes down what it was asked to draw. It has the methods the 2D map's test canvas has, and no more. */
function recorder() {
  const calls: Call[] = [];
  let path: number[] = [];
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    lineCap: "butt" as CanvasLineCap,
    depth: 0,
    save() {
      ctx.depth += 1;
    },
    restore() {
      ctx.depth -= 1;
    },
    beginPath() {
      path = [];
    },
    ellipse(...args: number[]) {
      path = args;
    },
    fill() {
      calls.push({ op: "fill", args: path, fill: ctx.fillStyle, stroke: ctx.strokeStyle, alpha: ctx.globalAlpha, width: ctx.lineWidth });
    },
    stroke() {
      calls.push({ op: "stroke", args: path, fill: ctx.fillStyle, stroke: ctx.strokeStyle, alpha: ctx.globalAlpha, width: ctx.lineWidth });
    },
  };
  return { ctx, calls };
}

const SHAPE = { x: 100, y: 80, rx: 20, ry: 11, color: "#5B7D73" };
const LOOK = plinthLook(DEFAULT_VISUALS)!;

describe("mixing two colours", () => {
  it("gives each end at 0 and 1 and the middle between", () => {
    expect(mixHex("#000000", "#FFFFFF", 0)).toBe("#000000");
    expect(mixHex("#000000", "#FFFFFF", 1)).toBe("#FFFFFF");
    expect(mixHex("#000000", "#FFFFFF", 0.5)).toBe("#808080");
    expect(mixHex("#102030", "#102030", 0.3)).toBe("#102030");
    expect(mixHex("#000000", "#FFFFFF", 7)).toBe("#FFFFFF");
  });
});

describe("the turned base", () => {
  it("is dark wood: an ebony wall under a walnut top, each darker than the ring", () => {
    const light = (hex: string) => Number.parseInt(hex.slice(1, 3), 16) + Number.parseInt(hex.slice(3, 5), 16) + Number.parseInt(hex.slice(5, 7), 16);
    expect(light(PLINTH_EBONY)).toBeLessThan(light(PLINTH_WALNUT));
    expect(light(PLINTH_WALNUT)).toBeLessThan(light(PLINTH_BRASS));
  });

  it("draws the wall, the top, the ring, and the faction's field, from the outside in", () => {
    const { ctx, calls } = recorder();
    drawBasePlinth(ctx, LOOK, SHAPE);
    const all = calls.filter((call) => call.op === "fill");
    // A soft contact shadow comes first: two faint black ellipses, wider than the base.
    const shadows = all.filter((call) => call.fill === "#000000");
    expect(shadows).toHaveLength(2);
    expect(shadows.every((call) => call.alpha > 0 && call.alpha < 1 && call.args[2] > SHAPE.rx)).toBe(true);
    const fills = all.filter((call) => call.fill !== "#000000");
    expect(fills.map((call) => call.fill)).toEqual([PLINTH_EBONY, PLINTH_WALNUT, plinthRingColor(SHAPE.color, LOOK.brass), SHAPE.color]);
    // The wall is the top face moved down the screen.
    expect(fills[0].args[1]).toBeGreaterThan(fills[1].args[1]);
    expect(fills[0].args.slice(2, 4)).toEqual([SHAPE.rx, SHAPE.ry]);
    // Each ellipse sits inside the one before it.
    for (let i = 2; i < fills.length; i++) {
      expect(fills[i].args[2]).toBeLessThan(fills[i - 1].args[2]);
      expect(fills[i].args[3]).toBeLessThan(fills[i - 1].args[3]);
    }
    // Every fill is solid, and the canvas is handed back as it came.
    expect(fills.every((call) => call.alpha === 1)).toBe(true);
    expect(ctx.depth).toBe(0);
    expect(ctx.globalAlpha).toBe(1);
  });

  it("never draws outside the base's own ellipse, but for the wall below it", () => {
    const { ctx, calls } = recorder();
    drawBasePlinth(ctx, LOOK, SHAPE);
    const parts = plinthParts(SHAPE, LOOK);
    for (const call of calls.filter((item) => item.fill !== "#000000")) {
      expect(call.args[2]).toBeLessThanOrEqual(SHAPE.rx);
      expect(call.args[3]).toBeLessThanOrEqual(SHAPE.ry);
      expect(call.args[0]).toBe(SHAPE.x);
      expect(call.args[1]).toBeLessThanOrEqual(SHAPE.y + parts.wall);
    }
    expect(parts.wall).toBeGreaterThanOrEqual(1);
    expect(parts.wall).toBeLessThanOrEqual(3);
  });

  it("widens the dark rim with the rim width", () => {
    const thin = plinthParts(SHAPE, { ...LOOK, rim: 0.1 });
    const wide = plinthParts(SHAPE, { ...LOOK, rim: 0.35 });
    expect(wide.ring.rx).toBeLessThan(thin.ring.rx);
    expect(wide.ring.ry).toBeLessThan(thin.ring.ry);
    expect(thin.ring.rx).toBeCloseTo(SHAPE.rx * 0.9, 9);
    // The ring is a band of at least a pixel round the field.
    expect(thin.ring.rx - thin.field.rx).toBeGreaterThanOrEqual(1);
    expect(wide.field.rx).toBeGreaterThan(0);
  });

  it("makes the ring brass at full brass and the faction's own colour, lightened, at none", () => {
    expect(plinthRingColor("#5B7D73", 1)).toBe(PLINTH_BRASS);
    expect(plinthRingColor("#5B7D73", 0)).toBe(mixHex("#5B7D73", "#DDCF99", 0.3));
    expect(plinthRingColor("#5B7D73", 0)).not.toBe(plinthRingColor("#9C524E", 0));
    expect(plinthRingColor("#5B7D73", 1)).toBe(plinthRingColor("#9C524E", 1));
  });

  it("puts one satin highlight on the rim, and none on a matt base", () => {
    const strokes = (roughness: number) => {
      const { ctx, calls } = recorder();
      drawBasePlinth(ctx, plinthLook({ ...DEFAULT_VISUALS, plinthRoughness: roughness })!, SHAPE);
      return calls.filter((call) => call.op === "stroke");
    };
    const satin = strokes(0.5);
    const matt = strokes(1);
    // Always: two bevel lines, the light outer edge, the faction ring, and the light inner edge. The highlight comes last, while there is any gloss.
    expect(matt.length).toBe(5);
    expect(satin.length).toBe(6);
    const highlight = satin[5];
    expect(highlight.alpha).toBeGreaterThan(0);
    expect(highlight.alpha).toBeLessThan(1);
    // It lies on the rim, between the edge and the ring.
    const parts = plinthParts(SHAPE, LOOK);
    expect(highlight.args[2]).toBeLessThan(SHAPE.rx);
    expect(highlight.args[2]).toBeGreaterThan(parts.ring.rx);
    // Glossier is brighter and shorter.
    const polished = strokes(0.1)[5];
    expect(polished.alpha).toBeGreaterThan(highlight.alpha);
    expect(polished.args[6] - polished.args[5]).toBeLessThan(highlight.args[6] - highlight.args[5]);
  });

  it("draws two factions differently and one faction the same twice", () => {
    const draw = (color: string) => {
      const { ctx, calls } = recorder();
      drawBasePlinth(ctx, LOOK, { ...SHAPE, color });
      return JSON.stringify(calls);
    };
    expect(draw("#5B7D73")).toBe(draw("#5B7D73"));
    expect(draw("#5B7D73")).not.toBe(draw("#9C524E"));
  });
});
