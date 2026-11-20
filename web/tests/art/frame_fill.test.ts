import { describe, expect, it } from "vitest";
import { fillLayerInk, fillPart, paintBrush, wornPart, type PartRig, type RigFrame } from "../../src/art/partRig";
import type { PartCategory } from "../../src/art/paperDoll";

function drawing(slots: Record<number, number> = {}): number[] {
  const cells = new Array<number>(16).fill(0);
  for (const [index, slot] of Object.entries(slots)) {
    cells[Number(index)] = slot;
  }
  return cells;
}

function rigWith(torso: number[]): { rig: PartRig; frame: RigFrame } {
  const empty = drawing();
  const part = (id: string, layer: PartCategory, cells: number[]) => ({ id, name: id, layer, drawings: [cells] });
  const still = { x: 0, y: 0 };
  const frame: RigFrame = {
    pose: 0,
    move: { legs: { ...still }, torso: { ...still }, head: { ...still }, weapon: { ...still } },
    flash: false,
    muzzle: null,
  };
  const rig: PartRig = {
    unitId: "tiny",
    width: 4,
    height: 4,
    feet: { x: 1, y: 3 },
    poses: 1,
    anchors: {
      legs: [{ ...still }],
      torso: [{ ...still }],
      head: [{ ...still }],
      weapon: [{ ...still }],
    },
    outlines: { legs: [empty.slice()], torso: [empty.slice()] },
    parts: [part("legs", "legs", empty.slice()), part("torso", "torso", torso), part("head", "head", empty.slice()), part("weapon", "weapon", empty.slice())],
    wearing: { legs: "legs", torso: "torso", head: "head", weapon: "weapon" },
    clips: { idle: [], walk: [frame], fire: [], damaged: [] },
    builds: [],
  };
  return { rig, frame };
}

describe("fill a part", () => {
  it("replaces the connected squares of the clicked colour and stops at a different colour", () => {
    // Row 1 is uniform mid, with webbing between the right-hand mid.
    const { rig, frame } = rigWith(drawing({ 4: 2, 5: 2, 6: 5, 7: 2 }));
    const filled = fillPart(rig, frame, "torso", 0, 1, 3);
    const cells = wornPart(filled, "torso").drawings[0] ?? [];
    expect(cells[4]).toBe(3);
    expect(cells[5]).toBe(3);
    expect(cells[6]).toBe(5);
    expect(cells[7]).toBe(2);
    expect(wornPart(filled, "legs").drawings[0]?.[4]).toBe(0);
  });

  it("leaves a square that only meets the fill at a corner", () => {
    const { rig, frame } = rigWith(drawing({ 4: 2, 9: 2 }));
    const filled = fillPart(rig, frame, "torso", 0, 1, 3);
    const cells = wornPart(filled, "torso").drawings[0] ?? [];
    expect(cells[4]).toBe(3);
    expect(cells[9]).toBe(2);
  });

  it("fills empty canvas up to the ink and leaves the ink", () => {
    const { rig, frame } = rigWith(drawing({ 5: 2 }));
    const filled = fillPart(rig, frame, "torso", 0, 0, 4);
    const cells = wornPart(filled, "torso").drawings[0] ?? [];
    expect(cells.filter((slot) => slot === 4)).toHaveLength(15);
    expect(cells[5]).toBe(2);
  });

  it("reads the colour where this frame has moved the part", () => {
    const { rig, frame } = rigWith(drawing({ 0: 2, 1: 2 }));
    const moved: RigFrame = { ...frame, move: { ...frame.move, torso: { x: 1, y: 0 } } };
    const filled = fillPart(rig, moved, "torso", 1, 0, 7);
    const cells = wornPart(filled, "torso").drawings[0] ?? [];
    expect(cells[0]).toBe(7);
    expect(cells[1]).toBe(7);
  });

  it("leaves the rig when the square is already the paint colour", () => {
    const { rig, frame } = rigWith(drawing({ 5: 2, 6: 2 }));
    expect(fillPart(rig, frame, "torso", 1, 1, 2)).toBe(rig);
  });

  it("recolours the painted pixels inside the outline and leaves the rest", () => {
    const { rig, frame } = rigWith(drawing({ 5: 2, 6: 2 }));
    const outline = new Array<number>(16).fill(0);
    outline[5] = 1;
    const held = { ...rig, outlines: { ...rig.outlines, torso: [outline] } };
    const filled = fillLayerInk(held, frame, "torso", 4);
    const cells = wornPart(filled, "torso").drawings[0] ?? [];
    expect(cells[5]).toBe(4);
    expect(cells[6]).toBe(2);
    expect(cells.filter((slot) => slot !== 0)).toHaveLength(2);
  });

  it("paints a square centred on the pencil", () => {
    const { rig, frame } = rigWith(drawing());
    const painted = paintBrush(rig, frame, "torso", 1, 1, 3, 3);
    const cells = wornPart(painted, "torso").drawings[0] ?? [];
    expect(cells.filter((slot) => slot === 3)).toHaveLength(9);
    expect(cells[0]).toBe(3);
    expect(cells[15]).toBe(0);
  });

  it("leaves the rig when the click misses the moved part", () => {
    const { rig, frame } = rigWith(drawing({ 0: 2 }));
    const moved: RigFrame = { ...frame, move: { ...frame.move, torso: { x: 1, y: 0 } } };
    expect(fillPart(rig, moved, "torso", 0, 0, 7)).toBe(rig);
  });
});
