import { describe, expect, it } from "vitest";
import { compositeStack, emptyGrid, emptyStack, type LayerStack } from "../../src/art/archetypeLayers";
import { rasterCardSlots } from "../../src/art/blockoutCompiler";
import {
  cardBlockMask,
  emptyMask,
  healUncoveredCells,
  linkStripes,
  maskCount,
  maskHas,
  moveRegionToLayer,
  paintAt,
  paintSteelLinks,
  polygonMask,
  rectMask,
  tagSteel,
  transferRegionToLayer,
  withEditingFrame,
  withEditingLayer,
  type UnitPaintDocument,
} from "../../src/art/pixelPaint";
import type { PaletteSlotKey, SpriteFrameGrid } from "../../src/art/skeletonSchema";
import { TANK_PARTS, partCorners, tankPlate } from "./plateFixture";

const HULL: PaletteSlotKey = "primary_uniform_or_hull";
const TRIM: PaletteSlotKey = "secondary_trim_or_webbing";
const STEEL: PaletteSlotKey = "metallic_steel";
const TRACK: PaletteSlotKey = "metallic_brass_or_track";

function fill(grid: SpriteFrameGrid, slot: PaletteSlotKey, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      grid[y]![x] = slot;
    }
  }
}

function ink(grid: SpriteFrameGrid): number {
  return grid.flat().filter((slot) => slot != null).length;
}

function select(doc: UnitPaintDocument, part: (typeof TANK_PARTS)[keyof typeof TANK_PARTS]) {
  const { width, height } = doc.blueprint.canvasSize;
  return rectMask(width, height, ...partCorners(part));
}

/** The test tank cut into its four layers, the way the editor does it. */
function cutTank(heal: boolean): UnitPaintDocument {
  let doc = tankPlate();
  doc = moveRegionToLayer(doc, select(doc, TANK_PARTS.tracks), "tracks", heal).doc;
  doc = moveRegionToLayer(doc, select(doc, TANK_PARTS.turret), "turret", heal).doc;
  doc = moveRegionToLayer(doc, select(doc, TANK_PARTS.barrel), "barrel", heal).doc;
  return doc;
}

describe("selections", () => {
  it("makes a box from two corners in either order, both included", () => {
    const box = rectMask(20, 10, { x: 7, y: 6 }, { x: 3, y: 2 });
    expect(maskCount(box)).toBe(25);
    expect(maskHas(box, 3, 2)).toBe(true);
    expect(maskHas(box, 7, 6)).toBe(true);
    expect(maskHas(box, 8, 6)).toBe(false);
    expect(maskCount(rectMask(20, 10, { x: -5, y: -5 }, { x: 40, y: 40 }))).toBe(200);
  });

  it("fills a lasso and includes the line it was drawn with", () => {
    const square = polygonMask(40, 40, [
      { x: 10, y: 10 },
      { x: 20, y: 10 },
      { x: 20, y: 20 },
      { x: 10, y: 20 },
    ]);
    expect(maskCount(square)).toBe(121);
    expect(maskHas(square, 15, 15)).toBe(true);
    expect(maskHas(square, 9, 15)).toBe(false);
    expect(maskHas(square, 21, 20)).toBe(false);
    const triangle = polygonMask(40, 40, [
      { x: 5, y: 30 },
      { x: 25, y: 30 },
      { x: 15, y: 10 },
    ]);
    expect(maskHas(triangle, 15, 25)).toBe(true);
    expect(maskHas(triangle, 15, 10)).toBe(true);
    expect(maskHas(triangle, 6, 12)).toBe(false);
    expect(maskHas(triangle, 24, 12)).toBe(false);
  });

  it("selects only the line when the lasso has two points", () => {
    const line = polygonMask(20, 20, [
      { x: 2, y: 3 },
      { x: 9, y: 3 },
    ]);
    expect(maskCount(line)).toBe(8);
  });

  it("finds the block of plate pixels behind one card pixel", () => {
    const doc = tankPlate();
    const ground = doc.blueprint.groundOrigin;
    const atGround = cardBlockMask(doc, ground.x, ground.y);
    expect(maskCount(atGround)).toBe(4);
    for (const [x, y] of [
      [ground.x, ground.y],
      [ground.x + 1, ground.y],
      [ground.x, ground.y - 1],
      [ground.x + 1, ground.y - 1],
    ] as const) {
      expect(maskHas(atGround, x, y)).toBe(true);
    }
    expect(cardBlockMask(doc, ground.x + 1, ground.y - 1).cells).toEqual(atGround.cells);
    const placement = { ...doc.blueprint };
    const block = emptyGrid(doc.blueprint.canvasSize.width, doc.blueprint.canvasSize.height);
    atGround.cells.forEach((cell, index) => {
      if (cell !== 0) {
        block[Math.floor(index / atGround.width)]![index % atGround.width] = STEEL;
      }
    });
    expect(rasterCardSlots(block, placement).filter((slot) => slot != null)).toHaveLength(1);
  });
});

describe("transferRegionToLayer", () => {
  function stack(): LayerStack {
    const layers = emptyStack("tank", 12, 8);
    fill(layers.hull!, HULL, 1, 2, 10, 6);
    return layers;
  }

  it("moves the ink inside the region to the same cells of the other layer", () => {
    const before = stack();
    const result = transferRegionToLayer("tank", before, "hull", "turret", rectMask(12, 8, { x: 3, y: 0 }, { x: 5, y: 3 }));
    expect(result.count).toBe(6);
    expect(maskCount(result.moved)).toBe(6);
    expect(result.stack.turret![2]![3]).toBe(HULL);
    expect(result.stack.turret![3]![5]).toBe(HULL);
    expect(result.stack.hull![2]![3]).toBeNull();
    expect(result.stack.hull![4]![3]).toBe(HULL);
    expect(result.stack.turret![1]![3]).toBeNull();
    expect(ink(result.stack.hull!) + ink(result.stack.turret!)).toBe(ink(before.hull!));
  });

  it("does not change the stack it was given", () => {
    const before = stack();
    const copy = structuredClone(before);
    transferRegionToLayer("tank", before, "hull", "turret", rectMask(12, 8, { x: 0, y: 0 }, { x: 11, y: 7 }));
    expect(before).toEqual(copy);
  });

  it("leaves a cell under ink the upper layer already has, and replaces what is under ink moved down", () => {
    const layers = stack();
    layers.turret![3]![4] = TRIM;
    const everything = rectMask(12, 8, { x: 0, y: 0 }, { x: 11, y: 7 });
    const up = transferRegionToLayer("tank", layers, "hull", "turret", everything);
    expect(up.stack.turret![3]![4]).toBe(TRIM);
    expect(up.stack.hull![3]![4]).toBe(HULL);
    expect(up.count).toBe(ink(layers.hull!) - 1);
    const down = transferRegionToLayer("tank", layers, "turret", "hull", everything);
    expect(down.stack.hull![3]![4]).toBe(TRIM);
    expect(down.stack.turret![3]![4]).toBeNull();
    expect(down.count).toBe(1);
    expect(compositeStack("tank", up.stack)).toEqual(compositeStack("tank", layers));
    expect(compositeStack("tank", down.stack)).toEqual(compositeStack("tank", layers));
  });

  it("moves nothing when the two layers are the same, and refuses a layer the skeleton does not have", () => {
    const layers = stack();
    const everything = rectMask(12, 8, { x: 0, y: 0 }, { x: 11, y: 7 });
    expect(transferRegionToLayer("tank", layers, "hull", "hull", everything).count).toBe(0);
    expect(() => transferRegionToLayer("tank", layers, "hull", "superstructure", everything)).toThrow(/no superstructure layer/);
  });
});

describe("healUncoveredCells", () => {
  it("fills a hole that has the layer's ink on both sides, from the nearer side", () => {
    const hull = emptyGrid(12, 5);
    fill(hull, HULL, 0, 2, 3, 2);
    fill(hull, TRACK, 8, 2, 11, 2);
    const vacated = rectMask(12, 5, { x: 4, y: 0 }, { x: 7, y: 4 });
    const healed = healUncoveredCells(hull, vacated);
    expect(healed[2]!.slice(4, 8)).toEqual([HULL, HULL, TRACK, TRACK]);
    expect(healed[1]!.every((slot) => slot == null)).toBe(true);
    expect(ink(healed)).toBe(12);
  });

  it("fills a hole that has ink above and below it", () => {
    const hull = emptyGrid(5, 9);
    fill(hull, HULL, 2, 0, 2, 2);
    fill(hull, TRACK, 2, 6, 2, 8);
    const healed = healUncoveredCells(hull, rectMask(5, 9, { x: 0, y: 3 }, { x: 4, y: 5 }));
    expect([3, 4, 5].map((y) => healed[y]![2])).toEqual([HULL, HULL, TRACK]);
    expect(healed[4]![1]).toBeNull();
  });

  it("leaves a cell with ink on one side only, so a lifted barrel leaves no stub", () => {
    const hull = emptyGrid(12, 5);
    fill(hull, HULL, 0, 1, 4, 3);
    const healed = healUncoveredCells(hull, rectMask(12, 5, { x: 5, y: 2 }, { x: 11, y: 2 }));
    expect(healed).toEqual(hull);
  });

  it("only fills cells that were vacated, and never repaints ink", () => {
    const hull = emptyGrid(9, 3);
    fill(hull, HULL, 0, 1, 1, 1);
    fill(hull, TRACK, 7, 1, 8, 1);
    const healed = healUncoveredCells(hull, rectMask(9, 3, { x: 1, y: 1 }, { x: 3, y: 1 }));
    expect(healed[1]).toEqual([HULL, HULL, HULL, HULL, null, null, null, TRACK, TRACK]);
    expect(healUncoveredCells(hull, emptyMask(9, 3))).toEqual(hull);
  });

  it("stops at the reach it is given", () => {
    const hull = emptyGrid(12, 1);
    hull[0]![0] = HULL;
    hull[0]![11] = HULL;
    const healed = healUncoveredCells(hull, rectMask(12, 1, { x: 1, y: 0 }, { x: 10, y: 0 }), 2);
    expect(healed[0]!.map((slot) => (slot == null ? "." : "P")).join("")).toBe("PPP......PPP");
  });
});

describe("cutting a plate into layers", () => {
  it("takes each part off the body layer and leaves the idle pose pixel for pixel the same", () => {
    const whole = tankPlate();
    const cut = cutTank(true);
    expect(cut.blueprint.frames.idle).toEqual(whole.blueprint.frames.idle);
    expect(compositeStack("tank", cut.layers!.idle)).toEqual(whole.blueprint.frames.idle);
    expect(ink(cut.layers!.idle.tracks!)).toBe(96 * 12);
    expect(ink(cut.layers!.idle.turret!)).toBe(36 * 16);
    expect(ink(cut.layers!.idle.barrel!)).toBe(48 * 3);
  });

  it("reports how many pixels moved, and moves nothing from an empty selection", () => {
    const doc = tankPlate();
    expect(moveRegionToLayer(doc, select(doc, TANK_PARTS.turret), "turret", true).moved).toBe(36 * 16);
    const nothing = moveRegionToLayer(doc, rectMask(doc.blueprint.canvasSize.width, doc.blueprint.canvasSize.height, { x: 0, y: 0 }, { x: 3, y: 3 }), "turret", true);
    expect(nothing.moved).toBe(0);
    expect(nothing.doc).toBe(doc);
  });

  it("heals the hull under the turret where the turret sat in it, and nowhere else", () => {
    const [topLeft, bottomRight] = partCorners(TANK_PARTS.turret);
    const hullTop = partCorners(TANK_PARTS.hull)[0].y;
    const healed = cutTank(true).layers!.idle.hull!;
    const bare = cutTank(false).layers!.idle.hull!;
    for (let x = topLeft.x; x <= bottomRight.x; x += 1) {
      expect(healed[hullTop]![x]).toBe(HULL);
      expect(healed[bottomRight.y]![x]).toBe(HULL);
      expect(bare[hullTop]![x]).toBeNull();
      expect(healed[hullTop - 1]![x]).toBeNull();
      expect(healed[topLeft.y]![x]).toBeNull();
    }
  });

  it("leaves no hull behind the barrel", () => {
    const [topLeft, bottomRight] = partCorners(TANK_PARTS.barrel);
    const hull = cutTank(true).layers!.idle.hull!;
    for (let y = topLeft.y; y <= bottomRight.y; y += 1) {
      for (let x = topLeft.x; x <= bottomRight.x; x += 1) {
        expect(hull[y]![x]).toBeNull();
      }
    }
  });

  it("shows hull, with no gap, where the turret kicks back on the shot", () => {
    const healed = cutTank(true);
    const bare = cutTank(false);
    const { bobPx, recoilPx } = healed.blueprint.motion!;
    const turret = partCorners(TANK_PARTS.turret)[1];
    const hullTop = partCorners(TANK_PARTS.hull)[0].y;
    // The turret goes back half the recoil. The column it leaves, inside the hull, is the last half-recoil of its width.
    for (let x = turret.x - recoilPx / 2 + 1; x <= turret.x; x += 1) {
      for (let y = hullTop + bobPx; y <= turret.y + bobPx; y += 1) {
        expect(healed.blueprint.frames.fire[y]![x]).toBe(HULL);
        expect(bare.blueprint.frames.fire[y]![x]).toBeNull();
      }
    }
  });

  it("builds the poses again after every cut", () => {
    const whole = tankPlate();
    const cut = cutTank(true);
    const barrelTip = partCorners(TANK_PARTS.barrel)[1];
    const { bobPx, recoilPx } = cut.blueprint.motion!;
    // Uncut, the barrel is hull and only drops. Cut, it also slides back by the whole recoil.
    expect(whole.blueprint.frames.fire[barrelTip.y + bobPx]![barrelTip.x - 10]).toBe("wood_or_leather");    expect(cut.layers!.fire.barrel![barrelTip.y + bobPx]![barrelTip.x - recoilPx]).toBe("wood_or_leather");
    expect(cut.layers!.fire.barrel![barrelTip.y + bobPx]![barrelTip.x]).toBe("skin_stand_in");
  });

  it("works on the idle pose of a plate whichever pose is open, and keeps that pose open", () => {
    const doc = withEditingFrame(tankPlate(), "fire");
    const cut = moveRegionToLayer(doc, select(doc, TANK_PARTS.turret), "turret", true).doc;
    expect(cut.editingFrame).toBe("fire");
    expect(ink(cut.layers!.idle.turret!)).toBe(36 * 16);
  });

  it("takes each cell from the layer that shows there", () => {
    const cut = cutTank(true);
    const everything = rectMask(cut.blueprint.canvasSize.width, cut.blueprint.canvasSize.height, { x: 0, y: 0 }, { x: 999, y: 999 });
    const merged = moveRegionToLayer(cut, everything, "hull", false);
    expect(merged.moved).toBe(96 * 12 + 36 * 16 + 48 * 3);
    expect(merged.doc.layers!.idle.hull).toEqual(tankPlate().layers!.idle.hull);
    for (const layer of ["tracks", "turret", "barrel"]) {
      expect(ink(merged.doc.layers!.idle[layer]!)).toBe(0);
    }
  });
});

describe("steel links", () => {
  it("turns ink in the region to steel and leaves empty cells empty", () => {
    const tread = emptyGrid(8, 2);
    fill(tread, TRACK, 1, 0, 6, 0);
    const tagged = paintSteelLinks(tread, rectMask(8, 2, { x: 0, y: 0 }, { x: 3, y: 1 }));
    expect(tagged[0]).toEqual([null, STEEL, STEEL, STEEL, TRACK, TRACK, TRACK, null]);
    expect(tagged[1]!.every((slot) => slot == null)).toBe(true);
    expect(tread[0]![1]).toBe(TRACK);
  });

  it("stripes a selection into links one block wide, counted from the ground column", () => {
    const stripes = linkStripes(rectMask(12, 1, { x: 0, y: 0 }, { x: 11, y: 0 }), 4, 2);
    expect([...stripes.cells].join("")).toBe("110011001100");
    const wide = linkStripes(rectMask(12, 1, { x: 0, y: 0 }, { x: 11, y: 0 }), 0, 1, 3);
    expect([...wide.cells].join("")).toBe("100100100100");
  });

  it("tags the open layer, and the tread then steps one card pixel on Move 1", () => {
    let doc = withEditingLayer(cutTank(true), "tracks");
    const [topLeft, bottomRight] = partCorners(TANK_PARTS.tracks);
    const { width, height } = doc.blueprint.canvasSize;
    const divisor = doc.blueprint.displayDivisor!;
    const band = rectMask(width, height, topLeft, { x: bottomRight.x, y: topLeft.y + divisor - 1 });
    doc = tagSteel(doc, linkStripes(band, doc.blueprint.groundOrigin.x, divisor));
    const idle = doc.layers!.idle.tracks!;
    const step = doc.layers!.move_1.tracks!;
    expect(idle.flat().filter((slot) => slot === STEEL)).toHaveLength(96);
    expect(doc.layers!.idle.hull!.flat().includes(STEEL)).toBe(false);
    for (let y = topLeft.y; y < topLeft.y + divisor; y += 1) {
      for (let x = topLeft.x; x + divisor <= bottomRight.x; x += 1) {
        expect(step[y]![x + divisor] === STEEL).toBe(idle[y]![x] === STEEL);
      }
    }
    expect(step.map((row) => row.map((slot) => slot != null))).toEqual(idle.map((row) => row.map((slot) => slot != null)));
    const card = (frame: "idle" | "move_1") => rasterCardSlots(doc.blueprint.frames[frame], doc.blueprint);
    const links = (frame: "idle" | "move_1") => card(frame).flatMap((slot, index) => (slot === STEEL ? [index] : []));
    expect(links("idle").length).toBeGreaterThan(20);
    // On the card every link is one pixel, and Move 1 has each of them one pixel further along.
    // The last link runs off the end of the tread and is lost, so the tread keeps its shape.
    expect(links("move_1")).toEqual(
      links("idle")
        .slice(0, -1)
        .map((index) => index + 1),
    );
  });
});

describe("painting on a plate", () => {
  it("copies only the row under the brush", () => {
    const doc = tankPlate();
    const [corner] = partCorners(TANK_PARTS.hull);
    const next = paintAt(doc, corner.x + 4, corner.y + 2, "insignia_accent");
    expect(next.layers!.idle.hull![corner.y + 2]![corner.x + 4]).toBe("insignia_accent");
    expect(next.blueprint.frames.idle[corner.y + 2]![corner.x + 4]).toBe("insignia_accent");
    expect(doc.layers!.idle.hull![corner.y + 2]![corner.x + 4]).toBe(HULL);
    expect(doc.blueprint.frames.idle[corner.y + 2]![corner.x + 4]).toBe(HULL);
    expect(next.layers!.move_1).toBe(doc.layers!.move_1);
    expect(next.layers!.idle.turret).toBe(doc.layers!.idle.turret);
    expect(next.layers!.idle.hull![corner.y + 1]).toBe(doc.layers!.idle.hull![corner.y + 1]);
    expect(next.blueprint.frames.fire).toBe(doc.blueprint.frames.fire);
  });

  it("shows the layer on top after a stroke, and what is under it after the eraser", () => {
    const cut = withEditingLayer(cutTank(true), "hull");
    const [corner] = partCorners(TANK_PARTS.turret);
    const hullTop = partCorners(TANK_PARTS.hull)[0].y;
    // The turret covers this hull cell, so painting the hull under it does not show.
    const under = paintAt(cut, corner.x + 3, hullTop, "insignia_accent");
    expect(under.layers!.idle.hull![hullTop]![corner.x + 3]).toBe("insignia_accent");
    expect(under.blueprint.frames.idle[hullTop]![corner.x + 3]).toBe(TRIM);
    const erased = paintAt(under, corner.x + 3, hullTop, "eraser");
    expect(erased.blueprint.frames.idle[hullTop]![corner.x + 3]).toBeNull();
    expect(erased.layers!.idle.hull![hullTop]![corner.x + 3]).toBeNull();
    expect(erased.layers!.idle.turret![hullTop]![corner.x + 3]).toBeNull();
    expect(erased.blueprint.frames.idle).toEqual(compositeStack("tank", erased.layers!.idle));
  });
});
