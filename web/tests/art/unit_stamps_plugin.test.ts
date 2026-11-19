import { describe, expect, it } from "vitest";
import { checkStampsFile, stampedPngPathFor, stampedSvgPathFor, stampsPathFor } from "../../dev/unitStampsPlugin.mjs";
import * as stamps from "../../src/art/spriteStamps";

const POLISHED = [
  "assets/candidates/US/us_bomber_seed1.outlined.polished.png",
  "assets/candidates/USSR/ussr_tank_t34_seed1.outlined.polished.png",
  "assets/candidates/UK/uk_fighter_seed1.outlined.polished.png",
];

describe("the stamps dev endpoint", () => {
  it("names the same files as spriteStamps.ts", () => {
    for (const path of POLISHED) {
      expect(stampsPathFor(path)).toBe(stamps.stampsPathFor(path));
      expect(stampedPngPathFor(path)).toBe(stamps.stampedPngPathFor(path));
    }
  });

  it("names the SVG vectorize_units.py writes for a stamped PNG", () => {
    expect(stampedSvgPathFor(POLISHED[0])).toBe("assets/units/vector/US/us_bomber_seed1.stamped.svg");
  });

  it("refuses paths that are not polished candidate PNGs", () => {
    for (const bad of ["assets/candidates/US/../../vite.config.ts", "assets/candidates/US/us_bomber_seed1.outlined.quantized.png", "public/x.outlined.polished.png", ""]) {
      expect(() => stampsPathFor(bad), bad).toThrow();
    }
  });

  it("takes what the editor sends and refuses a wrong shape", () => {
    const good = { kind: "unit-stamps", version: 1, source: POLISHED[0], width: 368, height: 496, stamps: [{ emblem: "us_star_and_bars", size: 41, x: 10, y: 10, flip: false, turn: true, onlyOnSprite: true }] };
    expect(checkStampsFile(good)).toEqual(good);
    expect(Object.keys(checkStampsFile({ ...good, stamps: [{ y: 10, x: 10, size: 41, emblem: "us_star_and_bars" }] }).stamps[0])).toEqual(["emblem", "size", "x", "y", "flip", "turn", "onlyOnSprite"]);
    expect(stamps.readStampSidecar(good).stamps).toHaveLength(1);
    expect(() => checkStampsFile({ ...good, source: "assets/candidates/US/x.png" })).toThrow();
    expect(() => checkStampsFile({ ...good, stamps: [{ ...good.stamps[0], x: 400 }] })).toThrow();
    expect(() => checkStampsFile({ ...good, stamps: [{ ...good.stamps[0], emblem: "../x" }] })).toThrow();
    expect(() => checkStampsFile({ ...good, kind: "nope" })).toThrow();
  });
});
