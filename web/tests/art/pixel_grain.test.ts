import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { ARCHETYPE_LAYERS, emptyFrames } from "../../src/art/archetypeLayers";
import { fromLayeredFile, normalizePlateGrain } from "../../src/art/layeredUnit";
import { buildAnimationDocument, documentFromLayers, plateProblems, type UnitPaintDocument } from "../../src/art/pixelPaint";
import type { SpriteFrameGrid } from "../../src/art/skeletonSchema";
import { tankPlate } from "./plateFixture";

function repeatGrid(grid: SpriteFrameGrid, block: number): SpriteFrameGrid {
  const out: SpriteFrameGrid = [];
  for (const row of grid) {
    const wide = row.flatMap((cell) => Array.from({ length: block }, () => cell));
    for (let copy = 0; copy < block; copy += 1) {
      out.push(wide.slice());
    }
  }
  return out;
}

/** The same plate with every pixel, point, and shift repeated `block` times. */
function repeated(doc: UnitPaintDocument, block: number): UnitPaintDocument {
  if (!doc.layers || doc.archetype === "infantry") {
    throw new Error("A plate is required.");
  }
  const width = doc.blueprint.canvasSize.width * block;
  const height = doc.blueprint.canvasSize.height * block;
  const frames = emptyFrames(doc.archetype, width, height);
  for (const layer of ARCHETYPE_LAYERS[doc.archetype]) {
    const grid = doc.layers.idle[layer];
    if (grid) {
      frames.idle[layer] = repeatGrid(grid, block);
    }
  }
  const motion = doc.blueprint.motion ?? { bobPx: 1, recoilPx: 2, treadStride: 1 };
  const point = (value: { x: number; y: number }) => ({ x: value.x * block, y: value.y * block });
  return buildAnimationDocument(
    documentFromLayers(
      {
        ...doc.blueprint,
        canvasSize: { width, height },
        groundOrigin: point(doc.blueprint.groundOrigin),
        muzzlePoint: doc.blueprint.muzzlePoint ? point(doc.blueprint.muzzlePoint) : undefined,
        displayDivisor: (doc.blueprint.displayDivisor ?? 1) * block,
        motion: { bobPx: motion.bobPx * block, recoilPx: motion.recoilPx * block, treadStride: motion.treadStride * block },
      },
      doc.archetype,
      frames,
    ),
  );
}

describe("plate grain", () => {
  it("collapses a doubled plate back onto its pixels, ground, and muzzle", () => {
    const doc = tankPlate();
    const grain = normalizePlateGrain(repeated(doc, 2));
    expect(grain.detected).toBe(2);
    expect(grain.applied).toBe(2);
    expect(grain.doc.blueprint.canvasSize).toEqual(doc.blueprint.canvasSize);
    expect(grain.doc.blueprint.groundOrigin).toEqual(doc.blueprint.groundOrigin);
    expect(grain.doc.blueprint.muzzlePoint).toEqual(doc.blueprint.muzzlePoint);
    expect(grain.doc.layers?.idle.hull).toEqual(doc.layers?.idle.hull);
    expect(plateProblems(grain.doc)).toEqual([]);
  });

  it("keeps a plate that is already one art pixel per pixel", () => {
    const doc = tankPlate();
    const grain = normalizePlateGrain(doc);
    expect(grain.detected).toBe(1);
    expect(grain.applied).toBe(1);
    expect(grain.doc).toBe(doc);
  });

  it("snaps the saved UK tank to 103 by 65 when grain is forced to 2", async () => {
    const file = JSON.parse(await readFile(new URL("../../assets/layered/UK/tank.json", import.meta.url), "utf8")) as unknown;
    const doc = fromLayeredFile(file);
    expect(doc.blueprint.canvasSize).toEqual({ width: 206, height: 130 });
    const grain = normalizePlateGrain(doc, 2);
    expect(grain.applied).toBe(2);
    expect(grain.doc.blueprint.canvasSize).toEqual({ width: 103, height: 65 });
    expect(grain.doc.blueprint.groundOrigin).toEqual({ x: 51, y: 53 });
    expect(grain.doc.blueprint.muzzlePoint).toEqual({ x: 91, y: 27 });
    expect(plateProblems(grain.doc)).toEqual([]);
  });
});
