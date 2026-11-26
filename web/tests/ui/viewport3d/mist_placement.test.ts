import { describe, expect, it } from "vitest";
import { jungleSites, MIST_POOL, nearestSites, valleySites } from "../../../src/ui/viewport3d/mistPlacement";
import type { ReliefPatch } from "../../../src/ui/viewport3d/mountainRelief";

function patch(): ReliefPatch {
  const columns = 24;
  const rows = 12;
  const fields = new Float32Array(columns * rows * 2);
  // Two ridges with a trough between them.
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const ridge = x < 6 || x > 17 ? 0.9 : 0.15;
      fields[(y * columns + x) * 2 + 1] = ridge;
    }
  }
  return { originX: 0, originY: 0, step: 1, columns, rows, fields };
}

describe("mist placement", () => {
  it("finds valley mist in the trough between ridges, not on the ridges", () => {
    const sites = valleySites([patch()]);
    expect(sites.length).toBeGreaterThan(0);
    for (const site of sites) {
      expect(site.kind).toBe("valley");
      expect(site.x).toBeGreaterThan(5);
      expect(site.x).toBeLessThan(18);
    }
  });
  it("finds jungle mist only where the caller says jungle", () => {
    const sites = jungleSites({ x: 0, y: 0, w: 100, h: 100 }, (x) => x < 50);
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.every((s) => s.x < 50 && s.kind === "jungle")).toBe(true);
  });
  it("spends the pool on the nearest sites within reach", () => {
    const sites = jungleSites({ x: 0, y: 0, w: 400, h: 400 }, () => true);
    const picked = nearestSites(sites, 200, 200, MIST_POOL, 60);
    expect(picked.length).toBeLessThanOrEqual(MIST_POOL);
    for (const s of picked) {
      expect(Math.hypot(s.x - 200, s.y - 200)).toBeLessThanOrEqual(60);
    }
  });
});
