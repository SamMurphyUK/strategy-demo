import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertBlockoutFitsSheet, compileBlueprintFrame, evaluateCandidateAgainstBlockout } from "../../src/art/blockoutCompiler";
import {
  SHEET_FOOT_ANCHOR,
  type FactionMilitaryMapping,
  type PaletteSlotKey,
  type SpriteFrameGrid,
  type UnitSpriteSheetBlueprint,
} from "../../src/art/skeletonSchema";
import { MILITARY } from "../../src/ui/theme/militaryPalette";
import { candidateRelativePath, resolveInsideRoot } from "../../dev/bakeUnitPlugin.mjs";

const SLOTS: PaletteSlotKey[] = [
  "primary_uniform_or_hull",
  "secondary_trim_or_webbing",
  "metallic_steel",
  "metallic_brass_or_track",
  "wood_or_leather",
  "skin_stand_in",
  "insignia_accent",
];

function mapping(fill: FactionMilitaryMapping[PaletteSlotKey] = "crimson"): FactionMilitaryMapping {
  return Object.fromEntries(SLOTS.map((slot) => [slot, fill])) as FactionMilitaryMapping;
}

function grid(width: number, height: number, slot: PaletteSlotKey | null = null): SpriteFrameGrid {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => slot));
}

function sheet(framesIdle: SpriteFrameGrid, ground = { x: 24, y: 46 }, size: { width: 48 | 64; height: 48 | 64 } = { width: 48, height: 48 }): UnitSpriteSheetBlueprint {
  const blank = grid(size.width, size.height);
  return {
    blueprintId: "ger_tank_a",
    unitTypeId: "tank",
    factionId: "GER",
    category: "land",
    canvasSize: size,
    groundOrigin: ground,
    sheetFootAnchor: { ...SHEET_FOOT_ANCHOR },
    muzzlePoint: { x: 40, y: 40 },
    nativeFacing: "right",
    recoilOffsetPx: 2,
    frames: { idle: framesIdle, move_1: blank, move_2: blank, fire: blank },
    historicalEraTag: "1943",
  };
}

describe("blockout compiler", () => {
  it("names only the sixteen military strip keys", () => {
    expect(Object.keys(MILITARY)).toEqual([
      "cream",
      "tan",
      "terracotta",
      "crimson",
      "plum",
      "charcoal",
      "steel",
      "spruce",
      "sage",
      "taupe",
      "feldgrau",
      "bone",
      "olive",
      "brass",
      "brown",
      "khaki",
    ]);
    expect(SHEET_FOOT_ANCHOR).toEqual({ x: 40, y: 52 });
  });

  it("maps a frame's slots straight onto faction colours", () => {
    const idle = grid(48, 48);
    idle[46][24] = "primary_uniform_or_hull";
    idle[46][28] = "metallic_brass_or_track";
    const colors = mapping();
    colors.metallic_brass_or_track = "brass";
    const { albedoKeys } = compileBlueprintFrame(sheet(idle), "idle", colors);
    const at = (x: number, y: number) => albedoKeys[y * 48 + x];
    expect(at(24, 46)).toBe("crimson");
    expect(at(28, 46)).toBe("brass");
    expect(albedoKeys.filter((key) => key != null)).toHaveLength(2);
  });

  it("keeps a solid block filled, with no holes from a transform", () => {
    const idle = grid(48, 48);
    for (let y = 20; y < 25; y++) {
      for (let x = 10; x < 15; x++) {
        idle[y][x] = "primary_uniform_or_hull";
      }
    }
    const { albedoKeys } = compileBlueprintFrame(sheet(idle), "idle", mapping());
    expect(albedoKeys.filter((key) => key != null)).toHaveLength(25);
  });

  it("throws on a missing frame and a strip key that is not in the palette", () => {
    const idle = grid(48, 48);
    idle[46][24] = "primary_uniform_or_hull";
    const brokenFrame = sheet(idle);
    brokenFrame.frames = { ...brokenFrame.frames, fire: grid(2, 2) };
    expect(() => compileBlueprintFrame(brokenFrame, "fire", mapping())).toThrow(/48×48/);

    const broken = mapping();
    (broken as { primary_uniform_or_hull?: string }).primary_uniform_or_hull = "soviet_green";
    expect(() => compileBlueprintFrame(sheet(idle), "idle", broken as FactionMilitaryMapping)).toThrow(/MilitaryStripKey/);
  });

  it("rejects a blockout that would eat the outline margin on the 80×56 sheet", () => {
    expect(assertBlockoutFitsSheet(sheet(grid(48, 48)))).toEqual({ x: 16, y: 6 });

    const tall = sheet(grid(48, 64), { x: 24, y: 46 }, { width: 48, height: 64 });
    expect(() => assertBlockoutFitsSheet(tall)).toThrow(/80×56/);

    const lowFeet = sheet(grid(48, 48), { x: 24, y: 20 });
    expect(() => assertBlockoutFitsSheet(lowFeet)).toThrow(/margin/);
  });

  it("throws when the candidate size disagrees, and returns strip keys plus an IoU", () => {
    const width = 2;
    const height = 2;
    const albedoKeys = ["crimson", "crimson", null, null] as ("crimson" | null)[];
    const data = new Uint8ClampedArray(width * height * 4);
    const paint = (index: number, r: number, g: number, b: number, a: number) => {
      const offset = index * 4;
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = a;
    };
    paint(0, 0x9c, 0x52, 0x4e, 255);
    paint(1, 0x11, 0x11, 0x11, 0);
    paint(2, 0x8c, 0x7c, 0x79, 255);
    paint(3, 0, 0, 0, 10);

    expect(() =>
      evaluateCandidateAgainstBlockout({ width: 3, height: 2, data } as ImageData, width, height, albedoKeys, MILITARY),
    ).toThrow(/does not match/);

    const scored = evaluateCandidateAgainstBlockout(
      { width, height, data } as ImageData,
      width,
      height,
      albedoKeys,
      MILITARY,
    );
    expect(scored.quantizedKeys).toEqual(["crimson", null, "feldgrau", null]);
    expect(scored.silhouetteIoU).toBeCloseTo(1 / 3);
  });
});

describe("bake unit paths", () => {
  it("keeps reference plates and candidate files inside the Vite root", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const relative = candidateRelativePath("GER", "ger_tank_a", 7);
    expect(relative.replaceAll("\\", "/")).toBe("assets/candidates/GER/ger_tank_a_seed7.raw.png");
    const output = resolveInsideRoot(root, relative);
    expect(output.startsWith(root)).toBe(true);
    expect(() => resolveInsideRoot(root, "../demomap01.json")).toThrow(/escapes/);
    expect(() => resolveInsideRoot(root, "assets/candidates/../../../outside.png")).toThrow(/escapes/);
    expect(() => resolveInsideRoot(root, path.resolve(root, "../outside.png"))).toThrow(/escapes/);
    expect(() => candidateRelativePath("GER", "../outside", 1)).toThrow(/blueprintId/);
    expect(() => candidateRelativePath("NEUTRAL", "ger_tank_a", 1)).toThrow(/roster/);
  });
});
