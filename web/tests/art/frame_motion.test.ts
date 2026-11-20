import { describe, expect, it } from "vitest";
import { rectMask } from "../../src/art/pixelPaint";
import {
  STEEL_SLOT,
  buildMotion,
  paintSteel,
  stepSteel,
  wornPart,
  type PartRig,
  type RigFrame,
} from "../../src/art/partRig";
import type { PartCategory } from "../../src/art/paperDoll";

function drawing(slots: Record<number, number> = {}): number[] {
  const cells = new Array<number>(16).fill(0);
  for (const [index, slot] of Object.entries(slots)) {
    cells[Number(index)] = slot;
  }
  return cells;
}

function rigWith(layers: Partial<Record<PartCategory, number[]>>): { rig: PartRig; frame: RigFrame } {
  const empty = drawing();
  const cells = (layer: PartCategory) => layers[layer] ?? empty.slice();
  const part = (id: string, layer: PartCategory) => ({ id, name: id, layer, drawings: [cells(layer)] });
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
    feet: { x: 0, y: 3 },
    poses: 1,
    anchors: {
      legs: [{ ...still }],
      torso: [{ ...still }],
      head: [{ ...still }],
      weapon: [{ ...still }],
    },
    outlines: { legs: [empty.slice()], torso: [empty.slice()] },
    parts: [part("legs", "legs"), part("torso", "torso"), part("head", "head"), part("weapon", "weapon")],
    wearing: { legs: "legs", torso: "torso", head: "head", weapon: "weapon" },
    clips: { idle: [frame], walk: [frame], fire: [], damaged: [] },
    builds: [],
  };
  return { rig, frame };
}

describe("steel on a part", () => {
  it("paints every other column of the selection gun metal", () => {
    const { rig, frame } = rigWith({ legs: drawing({ 0: 3, 1: 3, 2: 3, 3: 3 }) });
    const painted = paintSteel(rig, frame, "legs", rectMask(4, 4, { x: 0, y: 0 }, { x: 3, y: 0 }), true);
    const row = wornPart(painted, "legs").drawings[0]?.slice(0, 4);
    expect(row).toEqual([STEEL_SLOT, 3, STEEL_SLOT, 3]);
  });

  it("paints every inked pixel in the selection gun metal", () => {
    const { rig, frame } = rigWith({ legs: drawing({ 0: 3, 1: 3 }) });
    const painted = paintSteel(rig, frame, "legs", rectMask(4, 4, { x: 0, y: 0 }, { x: 3, y: 0 }), false);
    expect(wornPart(painted, "legs").drawings[0]?.slice(0, 2)).toEqual([STEEL_SLOT, STEEL_SLOT]);
  });
});

describe("a step of gun metal", () => {
  it("walks the links along a run and closes the colour up behind them", () => {
    const row = [STEEL_SLOT, 3, STEEL_SLOT, 3, ...new Array<number>(12).fill(0)];
    const stepped = stepSteel(row, 4, 4, 1, "x");
    expect(stepped.slice(0, 4)).toEqual([3, STEEL_SLOT, 3, STEEL_SLOT]);
  });

  it("drops a propeller dash down a pixel and clears the cell it left", () => {
    const cells = drawing({ 0: STEEL_SLOT, 1: 4 });
    const stepped = stepSteel(cells, 4, 4, 1, "y");
    expect(stepped[0]).toBe(0);
    expect(stepped[1]).toBe(4);
    expect(stepped[4]).toBe(STEEL_SLOT);
  });
});

describe("build animation", () => {
  it("writes a stepped walk and a shot, and leaves idle", () => {
    const { rig, frame } = rigWith({
      legs: drawing({ 0: STEEL_SLOT, 1: 3, 2: STEEL_SLOT, 3: 3 }),
      torso: drawing({ 5: 2 }),
      weapon: drawing({ 6: 7 }),
    });
    const built = buildMotion(rig, frame, { bob: 2, recoil: 4, stride: 1, along: "x", links: "legs" });
    expect(built.clips.idle).toEqual(rig.clips.idle);
    expect(built.clips.walk).toHaveLength(2);
    expect(wornPart(built, "legs").drawings[1]?.slice(0, 4)).toEqual([3, STEEL_SLOT, 3, STEEL_SLOT]);
    expect(built.clips.walk[0]?.pose).toBe(1);
    expect(built.clips.walk[1]?.move.torso).toEqual({ x: 0, y: 2 });
    expect(built.clips.walk[1]?.move.legs).toEqual({ x: 0, y: 0 });
    expect(built.clips.fire[0]?.flash).toBe(true);
    expect(built.clips.fire[0]?.move.weapon).toEqual({ x: -4, y: 2 });
    expect(built.clips.fire[0]?.move.torso).toEqual({ x: -2, y: 2 });
  });
});
