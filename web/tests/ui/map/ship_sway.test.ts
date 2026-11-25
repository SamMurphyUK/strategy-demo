import { describe, expect, it } from "vitest";
import {
  CALM_ROLL_DEG,
  frontPosition,
  frontSweep,
  NO_SWAY,
  ROCK_END_S,
  ROCK_ROLL_DEG,
  rockEnvelope,
  secondsSinceStruck,
  shipSway,
  type SwayInput,
  SWAY_BOB_PX,
  SWELL_WAVES,
  SWELL_WORLD_WIDTH,
  swellPhase,
} from "../../../src/ui/map/shipSway";

const base: SwayInput = {
  seconds: 0,
  worldX: 300,
  worldY: 250,
  ringWorld: 8,
  landShare: 0,
  submarine: false,
  bobAmp: 0.66,
  rockAmp: 1,
  loopSeconds: 20,
  directionDeg: 0,
  subFactor: 0.8,
};

/** The peak roll over one whole loop. */
function peakRoll(input: Partial<SwayInput>): number {
  let peak = 0;
  for (let t = 0; t < 20; t += 0.02) {
    peak = Math.max(peak, Math.abs(shipSway({ ...base, ...input, seconds: t }).roll));
  }
  return peak;
}

describe("the heave and the calm", () => {
  it("holds still on a bad clock or place, and at zero amounts", () => {
    expect(shipSway({ ...base, seconds: Number.NaN })).toEqual(NO_SWAY);
    expect(shipSway({ ...base, worldX: Number.NaN })).toEqual(NO_SWAY);
    expect(shipSway({ ...base, bobAmp: 0, rockAmp: 0, seconds: 3 })).toEqual(NO_SWAY);
  });

  it("heaves inside its amount, and keeps pitch and roll near zero between waves", () => {
    for (let t = 0; t < 60; t += 0.37) {
      const sway = shipSway({ ...base, rockAmp: 0, seconds: t });
      expect(Math.abs(sway.bob)).toBeLessThanOrEqual(SWAY_BOB_PX * base.bobAmp * 1.4);
      expect(Math.abs(sway.roll)).toBeLessThanOrEqual(CALM_ROLL_DEG * base.bobAmp + 1e-9);
      expect(Math.abs(sway.pitch)).toBeLessThanOrEqual(CALM_ROLL_DEG * base.bobAmp + 1e-9);
    }
  });

  it("is a heave that travels west to east and loops with no seam", () => {
    expect(swellPhase(5, 100) - swellPhase(5, 100 + SWELL_WORLD_WIDTH)).toBeCloseTo(SWELL_WAVES * Math.PI * 2, 9);
    expect(shipSway({ ...base, seconds: 5, worldX: 100, landShare: 0.4 }).bob).toBeCloseTo(
      shipSway({ ...base, seconds: 5, worldX: 100 + SWELL_WORLD_WIDTH, landShare: 0.4 }).bob,
      9,
    );
    expect(shipSway({ ...base, rockAmp: 0, seconds: 2, worldX: 100 }).bob).not.toBeCloseTo(shipSway({ ...base, rockAmp: 0, seconds: 2, worldX: 260 }).bob, 3);
  });
});

describe("the wave front", () => {
  it("sweeps the board once in the loop and starts again", () => {
    const sweep = frontSweep(0);
    expect(frontPosition(0, 20, 0)).toBeCloseTo(sweep.from, 9);
    expect(frontPosition(10, 20, 0)).toBeCloseTo((sweep.from + sweep.to) / 2, 9);
    expect(frontPosition(20, 20, 0)).toBeCloseTo(sweep.from, 9);
    expect(frontPosition(30, 20, 0)).toBeCloseTo(frontPosition(10, 20, 0), 9);
  });

  it("reaches a ship in the west before one in the east, going west to east", () => {
    const west = secondsSinceStruck(0, 100, 250, 8, 20, 0);
    const east = secondsSinceStruck(0, 600, 250, 8, 20, 0);
    // Struck at 0 means just touched: the further east a ship is, the longer until the front comes.
    expect(((20 - west) % 20)).toBeLessThan(20 - east);
  });

  it("reaches a ship's ring edge before its centre, by the ring's radius", () => {
    const small = secondsSinceStruck(5, 400, 250, 0, 20, 0);
    const wide = secondsSinceStruck(5, 400, 250, 30, 20, 0);
    expect(wide).toBeGreaterThan(small);
  });

  it("follows the direction it is given", () => {
    const south = secondsSinceStruck(0, 400, 100, 0, 20, 90);
    const north = secondsSinceStruck(0, 400, 400, 0, 20, 90);
    expect(((20 - south) % 20)).toBeLessThan(20 - north);
  });
});

describe("the rocking", () => {
  it("is none before the front touches, rises cleanly, then dies away to level", () => {
    expect(rockEnvelope(-1)).toBe(0);
    expect(rockEnvelope(0)).toBe(0);
    expect(rockEnvelope(0.35)).toBeGreaterThan(0);
    expect(rockEnvelope(0.35)).toBeLessThan(rockEnvelope(0.7));
    expect(rockEnvelope(0.7)).toBeCloseTo(1, 9);
    expect(rockEnvelope(3)).toBeLessThan(rockEnvelope(1.5));
    expect(rockEnvelope(ROCK_END_S)).toBe(0);
    expect(rockEnvelope(ROCK_END_S + 5)).toBe(0);
  });

  it("is smooth: no jump as the front touches or as the swing ends", () => {
    expect(rockEnvelope(0.001)).toBeLessThan(0.01);
    expect(rockEnvelope(ROCK_END_S - 0.001)).toBeLessThan(0.01);
  });

  it("rocks a ship as the front crosses it, within the roll it is given", () => {
    const peak = peakRoll({});
    expect(peak).toBeGreaterThan(ROCK_ROLL_DEG * 0.4);
    expect(peak).toBeLessThanOrEqual(ROCK_ROLL_DEG * 1.01 + CALM_ROLL_DEG);
  });

  it("is level between waves", () => {
    // Well after a swing has ended, and before the loop brings the front round again.
    const struckAt = 20 - secondsSinceStruck(0, 300, 250, 8, 20, 0);
    const quiet = struckAt + ROCK_END_S + 1;
    const sway = shipSway({ ...base, seconds: quiet % 20 });
    expect(Math.abs(sway.roll)).toBeLessThanOrEqual(CALM_ROLL_DEG * base.bobAmp + 1e-9);
  });

  it("rocks a submarine 20% less than a surface ship, and a ship in a cliff's lee less than open water", () => {
    const ship = peakRoll({ rockAmp: 1, bobAmp: 0 });
    const sub = peakRoll({ rockAmp: 1, bobAmp: 0, submarine: true });
    expect(sub / ship).toBeCloseTo(0.8, 2);
    expect(peakRoll({ rockAmp: 1, bobAmp: 0, landShare: 1 })).toBeLessThan(ship);
  });

  it("scales with the rocking amount, and is none at 0", () => {
    const one = peakRoll({ rockAmp: 1, bobAmp: 0 });
    expect(peakRoll({ rockAmp: 2, bobAmp: 0 })).toBeCloseTo(one * 2, 2);
    expect(peakRoll({ rockAmp: 0, bobAmp: 0 })).toBe(0);
  });
});

describe("the wave front the sea glint follows", () => {
  it("is the same line the ships are struck by: progress along the sweep is the front's position", () => {
    for (const degrees of [0, 90, 37]) {
      const sweep = frontSweep(degrees);
      for (const t of [0, 3.3, 9.9, 17.1]) {
        const progress = (t % 20) / 20;
        expect(frontPosition(t, 20, degrees)).toBeCloseTo(sweep.from + (sweep.to - sweep.from) * progress, 9);
      }
    }
  });
});
