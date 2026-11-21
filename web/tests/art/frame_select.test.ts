import { describe, expect, it } from "vitest";
import { rectMask } from "../../src/art/pixelPaint";
import { claimBrush, claimUnselected, feedIdleCopies, idleSource, paintedSelection, resolveFrame, rigBundle, rigFromBundle, sendShownToLayer, wornPart, type PartRig, type RigFrame } from "../../src/art/partRig";
import type { PartCategory } from "../../src/art/paperDoll";

function drawing(slots: Record<number, number> = {}): number[] {
  const cells = new Array<number>(16).fill(0);
  for (const [index, slot] of Object.entries(slots)) {
    cells[Number(index)] = slot;
  }
  return cells;
}

function rigWith(torso: number[], weapon: number[]): { rig: PartRig; frame: RigFrame } {
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
    parts: [part("legs", "legs", empty.slice()), part("torso", "torso", torso), part("head", "head", empty.slice()), part("weapon", "weapon", weapon)],
    wearing: { legs: "legs", torso: "torso", head: "head", weapon: "weapon" },
    clips: { idle: [], walk: [frame], fire: [], damaged: [] },
    builds: [],
  };
  return { rig, frame };
}

describe("send a selection to a layer", () => {
  it("moves the pixel that shows onto the weapon and leaves a hole in the torso", () => {
    const { rig, frame } = rigWith(drawing({ 5: 3 }), drawing());
    const sent = sendShownToLayer(rig, frame, rectMask(4, 4, { x: 1, y: 1 }, { x: 1, y: 1 }), "weapon", false);
    expect(sent.moved).toBe(1);
    expect(wornPart(sent.rig, "torso").drawings[0]?.[5]).toBe(0);
    expect(wornPart(sent.rig, "weapon").drawings[0]?.[5]).toBe(3);
    expect(resolveFrame(sent.rig, frame).layers.weapon[5]).toBe(3);
  });

  it("fills the layer the pixel left when the hole should stay painted", () => {
    const { rig, frame } = rigWith(drawing({ 5: 3, 6: 3 }), drawing());
    const sent = sendShownToLayer(rig, frame, rectMask(4, 4, { x: 1, y: 1 }, { x: 1, y: 1 }), "weapon", true);
    expect(wornPart(sent.rig, "torso").drawings[0]?.[5]).toBe(3);
    expect(wornPart(sent.rig, "weapon").drawings[0]?.[5]).toBe(3);
  });

  it("puts the pixel on the weapon drawing where that frame's movement has the part", () => {
    const { rig, frame } = rigWith(drawing({ 5: 3 }), drawing());
    const moved: RigFrame = { ...frame, move: { ...frame.move, weapon: { x: 1, y: 0 } } };
    const sent = sendShownToLayer(rig, moved, rectMask(4, 4, { x: 1, y: 1 }, { x: 1, y: 1 }), "weapon", false);
    expect(sent.moved).toBe(1);
    expect(wornPart(sent.rig, "weapon").drawings[0]?.[4]).toBe(3);
    expect(wornPart(sent.rig, "torso").drawings[0]?.[5]).toBe(0);
  });

  it("takes a separated part off the layer it left, even when the hole would be filled", () => {
    const { rig, frame } = rigWith(drawing(), drawing());
    const legs = drawing({ 0: 4, 1: 4 });
    const outlined = legs.map((slot) => (slot === 0 ? 0 : 1));
    const separated: PartRig = {
      ...rig,
      outlines: { legs: [outlined], torso: [drawing()] },
      parts: rig.parts.map((part) => (part.layer === "legs" ? { ...part, drawings: [legs] } : part)),
    };
    const sent = sendShownToLayer(separated, frame, rectMask(4, 4, { x: 0, y: 0 }, { x: 1, y: 0 }), "torso", true);
    expect(sent.moved).toBe(2);
    expect(wornPart(sent.rig, "legs").drawings[0]?.[0]).toBe(0);
    expect(wornPart(sent.rig, "legs").drawings[0]?.[1]).toBe(0);
    expect(wornPart(sent.rig, "torso").drawings[0]?.[0]).toBe(4);
    expect(wornPart(sent.rig, "torso").drawings[0]?.[1]).toBe(4);
    expect(sent.rig.outlines.legs[0]?.[0]).toBe(0);
    expect(sent.rig.outlines.legs[0]?.[1]).toBe(0);
    expect(sent.rig.outlines.torso[0]?.[0]).toBe(1);
    expect(sent.rig.outlines.torso[0]?.[1]).toBe(1);
  });

  it("takes a covered square off the layer underneath as well", () => {
    const { rig, frame } = rigWith(drawing({ 5: 3 }), drawing());
    const covered: PartRig = {
      ...rig,
      parts: rig.parts.map((part) => (part.layer === "legs" ? { ...part, drawings: [drawing({ 5: 8 })] } : part)),
    };
    const sent = sendShownToLayer(covered, frame, rectMask(4, 4, { x: 1, y: 1 }, { x: 1, y: 1 }), "head", false);
    expect(wornPart(sent.rig, "head").drawings[0]?.[5]).toBe(3);
    expect(wornPart(sent.rig, "torso").drawings[0]?.[5]).toBe(0);
    expect(wornPart(sent.rig, "legs").drawings[0]?.[5]).toBe(0);
  });

  it("moves the brushed pixels onto the layer and keeps their colour", () => {
    const { rig, frame } = rigWith(drawing({ 5: 4, 6: 9 }), drawing());
    const claimed = claimBrush(rig, frame, "head", 1, 1, 1, false);
    expect(wornPart(claimed, "head").drawings[0]?.[5]).toBe(4);
    expect(wornPart(claimed, "torso").drawings[0]?.[5]).toBe(0);
    expect(wornPart(claimed, "torso").drawings[0]?.[6]).toBe(9);
    expect(claimBrush(rig, frame, "head", 0, 0, 1, false)).toBe(rig);
  });

  it("drops empty ground from a selection and keeps the painted pixel", () => {
    const { rig, frame } = rigWith(drawing({ 5: 3 }), drawing());
    const shown = resolveFrame(rig, frame);
    const picked = paintedSelection(shown, rectMask(4, 4, { x: 0, y: 0 }, { x: 3, y: 3 }));
    expect(picked.cells[5]).toBe(1);
    expect([...picked.cells].filter((cell) => cell !== 0)).toHaveLength(1);
  });

  it("moves pixels still on the loaded layer and leaves a pixel already on another layer", () => {
    const { rig, frame } = rigWith(drawing({ 5: 3, 6: 3 }), drawing({ 9: 4 }));
    const sent = claimUnselected(rig, frame, "head", null, "torso");
    expect(sent.moved).toBe(2);
    expect(wornPart(sent.rig, "torso").drawings[0]?.[5]).toBe(0);
    expect(wornPart(sent.rig, "head").drawings[0]?.[5]).toBe(3);
    expect(wornPart(sent.rig, "head").drawings[0]?.[6]).toBe(3);
    expect(wornPart(sent.rig, "weapon").drawings[0]?.[9]).toBe(4);
  });

  it("leaves pixels inside the selection where they are", () => {
    const { rig, frame } = rigWith(drawing({ 5: 3, 6: 3 }), drawing());
    const sent = claimUnselected(rig, frame, "head", rectMask(4, 4, { x: 1, y: 1 }, { x: 1, y: 1 }), "torso");
    expect(sent.moved).toBe(1);
    expect(wornPart(sent.rig, "torso").drawings[0]?.[5]).toBe(3);
    expect(wornPart(sent.rig, "head").drawings[0]?.[6]).toBe(3);
  });

  it("builds the split from Idle 0 and writes it onto frames that are still copies of that picture", () => {
    const { rig, frame } = rigWith(drawing({ 0: 4 }), drawing());
    const shared: PartRig = {
      ...rig,
      poses: 2,
      parts: rig.parts.map((part) => ({ ...part, drawings: [part.drawings[0]!.slice(), part.drawings[0]!.slice()] })),
      clips: {
        idle: [frame],
        walk: [frame, { ...frame, pose: 1 }],
        fire: [],
        damaged: [],
      },
    };
    expect(idleSource(shared)).toBe(shared.clips.idle[0]);
    const sent = sendShownToLayer(shared, idleSource(shared), rectMask(4, 4, { x: 0, y: 0 }, { x: 0, y: 0 }), "head", false);
    const fed = feedIdleCopies(shared, sent.rig);
    expect(wornPart(fed, "head").drawings[0]?.[0]).toBe(4);
    expect(wornPart(fed, "head").drawings[1]?.[0]).toBe(4);
    expect(resolveFrame(fed, fed.clips.walk[0]!).layers.head[0]).toBe(4);
    expect(resolveFrame(fed, fed.clips.walk[1]!).layers.head[0]).toBe(4);
  });

  it("leaves a pose that is no longer a copy of Idle 0", () => {
    const { rig, frame } = rigWith(drawing({ 0: 4 }), drawing());
    const shared: PartRig = {
      ...rig,
      poses: 2,
      parts: rig.parts.map((part) => ({
        ...part,
        drawings: [part.drawings[0]!.slice(), part.drawings[0]!.map((slot, index) => (part.layer === "torso" && index === 1 ? 2 : slot))],
      })),
      clips: { idle: [frame], walk: [{ ...frame, pose: 1 }], fire: [], damaged: [] },
    };
    const sent = sendShownToLayer(shared, idleSource(shared), rectMask(4, 4, { x: 0, y: 0 }, { x: 0, y: 0 }), "head", false);
    const fed = feedIdleCopies(shared, sent.rig);
    expect(wornPart(fed, "head").drawings[0]?.[0]).toBe(4);
    expect(wornPart(fed, "head").drawings[1]?.[0]).toBe(0);
    expect(wornPart(fed, "torso").drawings[1]?.[1]).toBe(2);
  });

  it("leaves a pixel that already shows on the chosen layer", () => {
    const { rig, frame } = rigWith(drawing(), drawing({ 5: 4 }));
    const sent = sendShownToLayer(rig, frame, rectMask(4, 4, { x: 0, y: 0 }, { x: 3, y: 3 }), "weapon", false);
    expect(sent.moved).toBe(0);
    expect(sent.rig).toBe(rig);
  });
});

describe("a rig file with its parts", () => {
  it("opens as the same drawings", () => {
    const { rig } = rigWith(drawing({ 5: 3 }), drawing({ 9: 7 }));
    const opened = rigFromBundle(JSON.parse(JSON.stringify(rigBundle(rig))));
    expect(wornPart(opened, "torso").drawings[0]?.[5]).toBe(3);
    expect(wornPart(opened, "weapon").drawings[0]?.[9]).toBe(7);
    expect(opened.clips.walk).toHaveLength(1);
  });
});
