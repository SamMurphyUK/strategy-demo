import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertBlockoutFitsSheet,
  evaluateCandidateAgainstBlockout,
  rasterBlueprintAlbedo,
  resolveNodeTransforms,
} from "../../src/art/blockoutCompiler";
import {
  SHEET_FOOT_ANCHOR,
  type FactionMilitaryMapping,
  type PaletteSlotKey,
  type PartAsset,
  type SkeletonNode,
  type UnitSkeletonBlueprint,
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

function grid(width: number, height: number, slot: PaletteSlotKey | null): (PaletteSlotKey | null)[][] {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => slot));
}

function part(partId: string, width: number, height: number, slot: PaletteSlotKey): PartAsset {
  return {
    partId,
    slotType: "hull",
    label: partId,
    width,
    height,
    localPivot: { x: 0, y: 0 },
    pixelGrid: grid(width, height, slot),
    promptFragment: partId,
  };
}

function blueprint(nodes: SkeletonNode[], ground = { x: 24, y: 46 }): UnitSkeletonBlueprint {
  return {
    blueprintId: "ger_tank_a",
    unitTypeId: "tank",
    factionId: "GER",
    category: "land",
    canvasSize: { width: 48, height: 48 },
    groundOrigin: ground,
    sheetFootAnchor: { ...SHEET_FOOT_ANCHOR },
    muzzlePoint: { x: 40, y: 40 },
    nativeFacing: "right",
    nodes,
    historicalEraTag: "1943",
  };
}

function node(partial: Partial<SkeletonNode> & Pick<SkeletonNode, "nodeId" | "partId">): SkeletonNode {
  return {
    parentId: null,
    anchorInParent: { x: 0, y: 0 },
    rotationDeg: 0,
    zIndex: 0,
    ...partial,
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

  it("places a low-z child on its parent before anyone paints", () => {
    const bp = blueprint([
      node({ nodeId: "hull", partId: "hull", zIndex: 10 }),
      node({
        nodeId: "gun",
        partId: "gun",
        parentId: "hull",
        anchorInParent: { x: 4, y: 0 },
        zIndex: 0,
      }),
    ]);
    const parts = new Map<string, PartAsset>([
      ["hull", part("hull", 2, 1, "primary_uniform_or_hull")],
      ["gun", part("gun", 1, 1, "metallic_brass_or_track")],
    ]);
    const colors = mapping();
    colors.metallic_brass_or_track = "brass";
    const { albedoKeys } = rasterBlueprintAlbedo(bp, parts, colors);
    const at = (x: number, y: number) => albedoKeys[y * 48 + x];
    expect(at(24, 46)).toBe("crimson");
    expect(at(28, 46)).toBe("brass");
    const transforms = resolveNodeTransforms(bp);
    expect(transforms.get("gun")?.worldPivot).toEqual({ x: 28, y: 46 });
  });

  it("keeps a rotated solid rectangle filled", () => {
    const square = part("plate", 5, 5, "primary_uniform_or_hull");
    square.localPivot = { x: 2, y: 2 };
    const bp = blueprint([
      node({ nodeId: "plate", partId: "plate", anchorInParent: { x: 0, y: -8 }, rotationDeg: 20 }),
    ]);
    const { albedoKeys } = rasterBlueprintAlbedo(bp, new Map([["plate", square]]), mapping());
    const opaque = albedoKeys.filter((key) => key != null).length;
    expect(opaque).toBeGreaterThanOrEqual(25);
    let holes = 0;
    for (let y = 1; y < 47; y++) {
      for (let x = 1; x < 47; x++) {
        const index = y * 48 + x;
        if (albedoKeys[index] != null) {
          continue;
        }
        const enclosed = [index - 1, index + 1, index - 48, index + 48].every((neighbor) => albedoKeys[neighbor] != null);
        if (enclosed) {
          holes += 1;
        }
      }
    }
    expect(holes).toBe(0);
  });

  it("throws on a cycle, a missing part, and a strip key that is not in the palette", () => {
    const cyclic = blueprint([
      node({ nodeId: "a", partId: "p", parentId: "b" }),
      node({ nodeId: "b", partId: "p", parentId: "a" }),
    ]);
    expect(() => resolveNodeTransforms(cyclic)).toThrow(/cycle/i);

    const missing = blueprint([node({ nodeId: "hull", partId: "gone" })]);
    expect(() => rasterBlueprintAlbedo(missing, new Map(), mapping())).toThrow(/missing part/i);

    const bp = blueprint([node({ nodeId: "hull", partId: "hull" })]);
    const parts = new Map([["hull", part("hull", 1, 1, "primary_uniform_or_hull")]]);
    const broken = mapping();
    (broken as { primary_uniform_or_hull?: string }).primary_uniform_or_hull = "soviet_green";
    expect(() => rasterBlueprintAlbedo(bp, parts, broken as FactionMilitaryMapping)).toThrow(/MilitaryStripKey/);
  });

  it("rejects a blockout that would eat the outline margin on the 80×56 sheet", () => {
    const fitted = blueprint([node({ nodeId: "hull", partId: "hull" })]);
    expect(assertBlockoutFitsSheet(fitted)).toEqual({ x: 16, y: 6 });

    const tall = blueprint([], { x: 24, y: 46 });
    tall.canvasSize = { width: 48, height: 64 };
    expect(() => assertBlockoutFitsSheet(tall)).toThrow(/80×56/);

    const lowFeet = blueprint([], { x: 24, y: 20 });
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
