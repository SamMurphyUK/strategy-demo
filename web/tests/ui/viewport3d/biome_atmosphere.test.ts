import { describe, expect, it } from "vitest";
import { damp, dampWeather, sampleWeather } from "../../../src/ui/viewport3d/biomeAtmosphere";

describe("biome atmosphere", () => {
  it("reads the share of desert and snow over a wide ring", () => {
    const desert = sampleWeather(() => "desert", { x: 0, y: 0 });
    expect(desert.desert).toBeCloseTo(1, 9);
    expect(desert.snow).toBe(0);
    const snow = sampleWeather((p) => (p.x < 0 ? "tundra" : "temperate"), { x: 0, y: 0 });
    expect(snow.snow).toBeGreaterThan(0.3);
    expect(snow.snow).toBeLessThan(0.7);
  });
  it("damps toward the target and never overshoots or snaps", () => {
    let weather = { desert: 0, snow: 0 };
    const target = { desert: 1, snow: 0.5 };
    const first = dampWeather(weather, target, 1 / 60);
    expect(first.desert).toBeGreaterThan(0);
    expect(first.desert).toBeLessThan(0.05);
    for (let i = 0; i < 60 * 20; i++) {
      weather = dampWeather(weather, target, 1 / 60);
    }
    expect(weather.desert).toBeGreaterThan(0.98);
    expect(weather.desert).toBeLessThanOrEqual(1);
    expect(damp(0.4, 0.4, 5)).toBeCloseTo(0.4, 9);
  });
});
