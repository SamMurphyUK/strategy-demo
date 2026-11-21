import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MILITARY } from "../../src/ui/theme/militaryPalette";
import { unitTypeFromRigId } from "../../src/art/editorScheme";
import { vectorShelf } from "../../src/art/unitShelf";

const PUBLIC_UNITS = resolve(__dirname, "../../public/assets/units");
const V1_RIG = resolve(PUBLIC_UNITS, "rigs/jap_infantry");
const V2_RIG = resolve(PUBLIC_UNITS, "rigs/jap_infantry_v2");
const V1_FRAMES = resolve(PUBLIC_UNITS, "frames/jap_infantry");
const V2_FRAMES = resolve(PUBLIC_UNITS, "frames/jap_infantry_v2");
const V2_VECTOR = resolve(PUBLIC_UNITS, "vector/frames/jap_infantry_v2");

function readJson(path: string) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function shiftCells(cells: readonly number[], width: number, height: number, dx: number, dy: number): number[] {
  const out = new Array<number>(width * height).fill(0);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const v = cells[y * width + x] ?? 0;
      if (v === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        out[ny * width + nx] = v;
      }
    }
  }
  return out;
}

describe("jap_infantry_v2 non-destructive cleanup & vectorization", () => {
  it("preserves v1 alongside _v2 and keeps Walk Frames 1-8 (Poses 0..7) 100% untouched", () => {
    expect(existsSync(resolve(PUBLIC_UNITS, "jap_walk.png"))).toBe(true);
    expect(existsSync(resolve(PUBLIC_UNITS, "jap_walk_v2.png"))).toBe(true);
    expect(readFileSync(resolve(PUBLIC_UNITS, "jap_walk.png")).equals(readFileSync(resolve(PUBLIC_UNITS, "jap_walk_v2.png")))).toBe(true);

    for (const part of ["legs_original", "torso_original", "head_original", "weapon_original"]) {
      const v1 = readJson(resolve(V1_RIG, `part_${part}.json`));
      const v2 = readJson(resolve(V2_RIG, `part_${part}.json`));
      for (let pose = 0; pose < 8; pose += 1) {
        expect(v2.drawings[pose]).toEqual(v1.drawings[pose]);
      }
    }

    for (let i = 0; i < 8; i += 1) {
      const v1Raw = readFileSync(resolve(V1_FRAMES, `walk_${i}.json`), "utf-8");
      const v2Raw = readFileSync(resolve(V2_FRAMES, `walk_${i}.json`), "utf-8");
      expect(v2Raw).toBe(v1Raw);
    }
  });

  it("leaves weapon layer completely empty on Poses 8..19 and stamps clean Walk Frame 1 head onto upright Poses 8..15", () => {
    const head = readJson(resolve(V2_RIG, "part_head_original.json"));
    const torso = readJson(resolve(V2_RIG, "part_torso_original.json"));
    const legs = readJson(resolve(V2_RIG, "part_legs_original.json"));
    const weapon = readJson(resolve(V2_RIG, "part_weapon_original.json"));

    const head0: number[] = head.drawings[0];
    const expectedOffsets: Record<number, [number, number]> = {
      8: [0, 0],
      9: [0, 1],
      10: [0, 0],
      11: [0, 0],
      12: [-1, 0],
      13: [0, 1],
      14: [1, 0],
      15: [0, 0],
    };

    for (let pose = 8; pose < 20; pose += 1) {
      expect(weapon.drawings[pose].every((v: number) => v === 0)).toBe(true);
      expect(legs.drawings[pose].some((v: number) => v !== 0)).toBe(true);
      expect(torso.drawings[pose].some((v: number) => v !== 0)).toBe(true);
      expect(head.drawings[pose].some((v: number) => v !== 0)).toBe(true);
    }

    for (const [poseStr, [dx, dy]] of Object.entries(expectedOffsets)) {
      const pose = Number(poseStr);
      expect(head.drawings[pose]).toEqual(shiftCells(head0, 80, 80, dx, dy));
    }

    // Verify floating stray pixels behind head in Firing Frame 2 (Pose 13, x=26..28, y=30..32) and
    // muzzle smoke wisps in Firing Frame 3 (Pose 14, x=50..55, y=31..40) are completely stripped.
    for (let y = 30; y <= 32; y += 1) {
      for (let x = 26; x <= 28; x += 1) {
        expect(torso.drawings[13][y * 80 + x]).toBe(0);
        expect(head.drawings[13][y * 80 + x]).toBe(0);
      }
    }
    for (let y = 31; y <= 40; y += 1) {
      for (let x = 50; x <= 55; x += 1) {
        expect(torso.drawings[14][y * 80 + x]).toBe(0);
        expect(head.drawings[14][y * 80 + x]).toBe(0);
      }
    }
  });

  it("vectorizes all 21 _v2 clip frames strictly within the 16-color MILITARY palette", () => {
    const allowedHex = new Set(Object.values(MILITARY).map((h) => h.toLowerCase()));
    const clips = readJson(resolve(V2_VECTOR, "clips.json"));
    expect(clips.unitId).toBe("jap_infantry_v2");
    expect(clips.clips.idle).toHaveLength(5);
    expect(clips.clips.walk).toHaveLength(8);
    expect(clips.clips.fire).toHaveLength(4);
    expect(clips.clips.damaged).toHaveLength(4);

    const allNames = [
      ...clips.clips.idle,
      ...clips.clips.walk,
      ...clips.clips.fire,
      ...clips.clips.damaged,
    ];
    for (const name of allNames) {
      const svgPath = resolve(V2_VECTOR, `${name}.svg`);
      expect(existsSync(svgPath)).toBe(true);
      const svg = readFileSync(svgPath, "utf-8");
      const fills = [...svg.matchAll(/fill="([^"]+)"/g)].map((m) => m[1]!.toLowerCase());
      expect(fills.length).toBeGreaterThan(0);
      for (const fill of fills) {
        expect(allowedHex.has(fill)).toBe(true);
      }
    }

    expect(unitTypeFromRigId("jap_infantry_v2")).toBe("infantry");
    const manifest = readJson(resolve(PUBLIC_UNITS, "vector/manifest.json"));
    const shelf = vectorShelf(manifest);
    const v2Row = shelf.find((item) => item.key === "clips:assets/units/vector/frames/jap_infantry_v2");
    expect(v2Row?.fieldPick).toBe("walk:jap_infantry_v2:vector");
  });
});
