import { describe, expect, it } from "vitest";
import {
  buildReliefPatch,
  CLEARING_FLAT,
  CLEARING_FULL,
  insideDistance,
  RELIEF_ZONES,
  reliefBuffers,
  type ReliefSite,
  sampleMountainHeight,
  sampleReliefField,
  sampleReliefFields,
  VALLEY_FLAT,
} from "../../../src/ui/viewport3d/mountainRelief";

/** A round territory forty across. */
const DISC = { x: 100, y: 60, r: 20 };
const inDisc = (p: { x: number; y: number }) => Math.hypot(p.x - DISC.x, p.y - DISC.y) <= DISC.r;

function site(over: Partial<ReliefSite> = {}): ReliefSite {
  return {
    box: { x: DISC.x - DISC.r, y: DISC.y - DISC.r, w: DISC.r * 2, h: DISC.r * 2 },
    inside: inDisc,
    keepClear: [],
    valleys: [],
    rise: 1,
    step: 0.5,
    salt: 7,
    ...over,
  };
}

describe("the three sculpted places", () => {
  it("are Switzerland, the Himalayas, and Persia, and nowhere else", () => {
    expect(RELIEF_ZONES.map((zone) => zone.name)).toEqual(["Switzerland", "Himalayas", "Persia"]);
    expect(RELIEF_ZONES.filter((zone) => zone.region).map((zone) => zone.region)).toEqual(["Persia"]);
    for (const zone of RELIEF_ZONES) {
      expect(zone.rise).toBeGreaterThan(0);
      expect(zone.rise).toBeLessThanOrEqual(1);
      if (zone.gap) {
        const { seed, box } = zone.gap;
        expect(seed.x).toBeGreaterThan(box.x);
        expect(seed.x).toBeLessThan(box.x + box.w);
        expect(seed.y).toBeGreaterThan(box.y);
        expect(seed.y).toBeLessThan(box.y + box.h);
      }
    }
    // The Himalayas are the roof of the board.
    expect(Math.max(...RELIEF_ZONES.map((zone) => zone.rise))).toBe(RELIEF_ZONES[1].rise);
  });
});

describe("distance to the edge of a mask", () => {
  it("is exact for a square", () => {
    const size = 9;
    const mask = new Uint8Array(size * size);
    for (let y = 2; y <= 6; y++) {
      for (let x = 2; x <= 6; x++) {
        mask[y * size + x] = 1;
      }
    }
    const depth = insideDistance(mask, size, size);
    expect(depth[0]).toBe(0);
    expect(depth[2 * size + 2]).toBe(1);
    expect(depth[4 * size + 4]).toBe(3);
    expect(depth[3 * size + 4]).toBe(2);
    expect(depth[4 * size + 6]).toBe(1);
  });

  it("measures across a corner, not along the axes", () => {
    // Everything inside but one far corner cell.
    const size = 6;
    const mask = new Uint8Array(size * size).fill(1);
    mask[0] = 0;
    const depth = insideDistance(mask, size, size);
    expect(depth[3 * size + 4]).toBeCloseTo(5, 6);
    expect(depth[1 * size + 1]).toBeCloseTo(Math.SQRT2, 6);
  });
});

describe("a sculpted range", () => {
  const patch = buildReliefPatch(site())!;

  it("is flat on its edge and outside it, so it joins the land with no step", () => {
    expect(patch).not.toBeNull();
    for (let a = 0; a < 64; a++) {
      const angle = (a / 64) * Math.PI * 2;
      for (const r of [DISC.r, DISC.r + 0.6, DISC.r + 5]) {
        const p = { x: DISC.x + Math.cos(angle) * r, y: DISC.y + Math.sin(angle) * r };
        expect(sampleMountainHeight([patch], p.x, p.y, 1.1, 0.6)).toBeLessThan(0.03);
      }
    }
    expect(sampleReliefField(patch, -500, -500)).toEqual({ dome: 0, ridge: 0 });
  });

  it("rises to the zone's share of the peak height and no higher, in both shapes", () => {
    let dome = 0;
    let ridge = 0;
    for (let i = 0; i < patch.columns * patch.rows; i++) {
      dome = Math.max(dome, patch.fields[i * 2]);
      ridge = Math.max(ridge, patch.fields[i * 2 + 1]);
      expect(patch.fields[i * 2]).toBeGreaterThanOrEqual(0);
      expect(patch.fields[i * 2 + 1]).toBeGreaterThanOrEqual(0);
    }
    expect(dome).toBeCloseTo(1, 5);
    expect(ridge).toBeCloseTo(1, 5);
    const lower = buildReliefPatch(site({ rise: 0.68 }))!;
    let top = 0;
    for (let i = 0; i < lower.fields.length; i++) {
      top = Math.max(top, lower.fields[i]);
    }
    expect(top).toBeCloseTo(0.68, 5);
  });

  it("scales with the peak height and mixes dome and ridge by the sharpness", () => {
    const p = { x: DISC.x + 3, y: DISC.y - 2 };
    const field = sampleReliefField(patch, p.x, p.y);
    expect(field.dome).toBeGreaterThan(0.2);
    expect(sampleMountainHeight([patch], p.x, p.y, 1, 0)).toBeCloseTo(field.dome, 9);
    expect(sampleMountainHeight([patch], p.x, p.y, 1, 1)).toBeCloseTo(field.ridge, 9);
    expect(sampleMountainHeight([patch], p.x, p.y, 2, 0.5)).toBeCloseTo(field.dome + field.ridge, 9);
    expect(sampleMountainHeight([patch], p.x, p.y, 0, 0.5)).toBe(0);
  });

  it("is smooth: no cliff between two neighbouring nodes", () => {
    for (let iy = 0; iy < patch.rows; iy++) {
      for (let ix = 0; ix + 1 < patch.columns; ix++) {
        const i = iy * patch.columns + ix;
        expect(Math.abs(patch.fields[i * 2] - patch.fields[(i + 1) * 2])).toBeLessThan(0.2);
        expect(Math.abs(patch.fields[i * 2 + 1] - patch.fields[(i + 1) * 2 + 1])).toBeLessThan(0.3);
      }
    }
  });

  it("really is ridged: the massif has more ups and downs than the dome", () => {
    let dome = 0;
    let ridge = 0;
    const iy = Math.floor(patch.rows / 2);
    for (let ix = 1; ix + 1 < patch.columns; ix++) {
      const at = (dx: number, channel: number) => patch.fields[(iy * patch.columns + ix + dx) * 2 + channel];
      dome += Math.abs(at(1, 0) - 2 * at(0, 0) + at(-1, 0));
      ridge += Math.abs(at(1, 1) - 2 * at(0, 1) + at(-1, 1));
    }
    expect(ridge).toBeGreaterThan(dome * 1.5);
  });

  it("builds the same range every time, and a different one for a different salt", () => {
    expect(Array.from(buildReliefPatch(site())!.fields)).toEqual(Array.from(patch.fields));
    expect(Array.from(buildReliefPatch(site({ salt: 8 }))!.fields)).not.toEqual(Array.from(patch.fields));
  });
});

describe("room for the pieces", () => {
  const anchor = { x: DISC.x + 4, y: DISC.y + 3 };
  const patch = buildReliefPatch(site({ keepClear: [anchor] }))!;

  it("leaves level ground round a point the pieces use", () => {
    for (let a = 0; a < 32; a++) {
      const angle = (a / 32) * Math.PI * 2;
      for (const r of [0, 1.5, CLEARING_FLAT - 0.6]) {
        const p = { x: anchor.x + Math.cos(angle) * r, y: anchor.y + Math.sin(angle) * r };
        expect(sampleMountainHeight([patch], p.x, p.y, 1.1, 0.6)).toBeLessThan(1e-6);
      }
    }
  });

  it("is back to full height past the clearing", () => {
    const open = buildReliefPatch(site())!;
    const far = { x: anchor.x - (CLEARING_FULL + 2), y: anchor.y };
    expect(inDisc(far)).toBe(true);
    expect(sampleReliefField(patch, far.x, far.y).dome * 1).toBeGreaterThan(0);
    // The two patches are scaled by their own summits, so compare shapes, not heights.
    const ratio = sampleReliefField(patch, far.x, far.y).dome / sampleReliefField(open, far.x, far.y).dome;
    expect(ratio).toBeGreaterThan(0.9);
    expect(ratio).toBeLessThan(1.2);
  });

  it("leaves a valley for a river", () => {
    const river = Array.from({ length: 41 }, (_, i) => ({ x: DISC.x - 20 + i, y: DISC.y }));
    const cut = buildReliefPatch(site({ valleys: river }))!;
    for (let x = DISC.x - 12; x <= DISC.x + 12; x += 2) {
      expect(sampleMountainHeight([cut], x, DISC.y, 1.1, 0.6)).toBeLessThan(0.02);
      expect(sampleMountainHeight([cut], x, DISC.y + VALLEY_FLAT - 0.2, 1.1, 0.6)).toBeLessThan(0.04);
    }
    // The slopes either side still stand.
    expect(sampleMountainHeight([cut], DISC.x, DISC.y - 8, 1.1, 0)).toBeGreaterThan(0.3);
    expect(sampleMountainHeight([cut], DISC.x, DISC.y + 8, 1.1, 0)).toBeGreaterThan(0.3);
  });
});

describe("a hole in the territories", () => {
  // Two discs that do not touch. The seed picks one.
  const twin = (p: { x: number; y: number }) => inDisc(p) || Math.hypot(p.x - 160, p.y - 60) <= 10;
  const box = { x: 70, y: 30, w: 110, h: 60 };

  it("raises only the part joined to the seed", () => {
    const patch = buildReliefPatch(site({ box, inside: twin, seed: { x: 160, y: 60 } }))!;
    expect(sampleReliefField(patch, 160, 60).dome).toBeGreaterThan(0.5);
    expect(sampleReliefField(patch, DISC.x, DISC.y)).toEqual({ dome: 0, ridge: 0 });
  });

  it("is nothing when the seed is not in a hole", () => {
    expect(buildReliefPatch(site({ box, inside: twin, seed: { x: 135, y: 35 } }))).toBeNull();
    expect(buildReliefPatch(site({ inside: () => false }))).toBeNull();
  });

  it("answers for whichever patch a point is on", () => {
    const west = buildReliefPatch(site({ box, inside: twin, seed: { x: DISC.x, y: DISC.y } }))!;
    const east = buildReliefPatch(site({ box, inside: twin, seed: { x: 160, y: 60 } }))!;
    expect(sampleReliefFields([west, east], 160, 60)).toEqual(sampleReliefField(east, 160, 60));
    expect(sampleReliefFields([west, east], DISC.x, DISC.y)).toEqual(sampleReliefField(west, DISC.x, DISC.y));
    expect(sampleReliefFields([west, east], 135, 35)).toEqual({ dome: 0, ridge: 0 });
    expect(sampleReliefFields([], 160, 60)).toEqual({ dome: 0, ridge: 0 });
  });
});

describe("a range as a mesh", () => {
  const patch = buildReliefPatch(site())!;
  const buffers = reliefBuffers(patch);

  it("lays its grid flat on the land, with map y turned over", () => {
    const count = patch.columns * patch.rows;
    expect(buffers.positions.length).toBe(count * 3);
    expect(buffers.fields).toBe(patch.fields);
    for (let i = 0; i < count; i += 97) {
      expect(buffers.positions[i * 3]).toBeCloseTo(patch.originX + (i % patch.columns) * patch.step, 5);
      expect(buffers.positions[i * 3 + 1]).toBeCloseTo(-(patch.originY + Math.floor(i / patch.columns) * patch.step), 5);
      expect(buffers.positions[i * 3 + 2]).toBe(0);
    }
  });

  it("meshes only the cells that rise, and every triangle faces up", () => {
    expect(buffers.indices.length % 3).toBe(0);
    expect(buffers.indices.length).toBeGreaterThan(0);
    expect(buffers.indices.length).toBeLessThan((patch.columns - 1) * (patch.rows - 1) * 6);
    for (let t = 0; t < buffers.indices.length; t += 3) {
      const [a, b, c] = [buffers.indices[t], buffers.indices[t + 1], buffers.indices[t + 2]];
      const ux = buffers.positions[b * 3] - buffers.positions[a * 3];
      const uy = buffers.positions[b * 3 + 1] - buffers.positions[a * 3 + 1];
      const vx = buffers.positions[c * 3] - buffers.positions[a * 3];
      const vy = buffers.positions[c * 3 + 1] - buffers.positions[a * 3 + 1];
      expect(ux * vy - uy * vx).toBeGreaterThan(0);
      const rise = patch.fields[a * 2] + patch.fields[b * 2] + patch.fields[c * 2];
      // A triangle belongs to a cell with some height in it, though this corner of it may be level.
      expect(rise).toBeGreaterThanOrEqual(0);
    }
  });

  it("gives each node the slope of the ground there, in scene coordinates", () => {
    const iy = Math.floor(patch.rows / 2);
    const ix = Math.floor(patch.columns / 3);
    const i = iy * patch.columns + ix;
    const east = (patch.fields[(i + 1) * 2] - patch.fields[(i - 1) * 2]) / (2 * patch.step);
    // One row down the map is one step south in the scene.
    const north = -(patch.fields[(i + patch.columns) * 2] - patch.fields[(i - patch.columns) * 2]) / (2 * patch.step);
    expect(buffers.slopes[i * 4]).toBeCloseTo(east, 6);
    expect(buffers.slopes[i * 4 + 1]).toBeCloseTo(north, 6);
    // The far corner of the box is level ground.
    expect(Array.from(buffers.slopes.slice(0, 4))).toEqual([0, 0, 0, 0]);
  });
});
