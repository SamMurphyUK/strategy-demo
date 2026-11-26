import { describe, expect, it } from "vitest";
import { BASE_FLOCKS, BIRD_POOL, BIRDS_PER_FLOCK, curlFlow, FLOCKS, spawnPoint } from "../../../src/ui/viewport3d/birdFlock";

describe("bird flocks", () => {
  it("pools two to three flocks of eight to twelve birds", () => {
    expect(BASE_FLOCKS).toBeGreaterThanOrEqual(2);
    expect(BASE_FLOCKS).toBeLessThanOrEqual(3);
    // Africa flies twice as many.
    expect(FLOCKS).toBe(BASE_FLOCKS * 2);
    expect(BIRDS_PER_FLOCK).toBeGreaterThanOrEqual(8);
    expect(BIRDS_PER_FLOCK).toBeLessThanOrEqual(12);
    expect(BIRD_POOL).toBe(FLOCKS * BIRDS_PER_FLOCK);
  });
  it("spawns upwind of the target, outside the view", () => {
    const at = spawnPoint({ x: 100, y: 50 }, { x: 2, y: 0 }, 60, 0);
    expect(at.x).toBeCloseTo(40, 9);
    expect(at.y).toBeCloseTo(50, 9);
    const off = spawnPoint({ x: 100, y: 50 }, { x: 0, y: 1 }, 60, 10);
    expect(off.y).toBeCloseTo(-10, 9);
  });
  it("flows smoothly, with no push beyond a gentle few units a second", () => {
    let last = curlFlow(0, 0, 5, 0);
    for (let x = 0.5; x < 60; x += 0.5) {
      const now = curlFlow(x, 3, 5, 2);
      expect(Math.hypot(now.x, now.y, now.z)).toBeLessThan(3);
      expect(Math.abs(now.x - last.x)).toBeLessThan(1);
      last = now;
    }
  });
});
