import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeRgbaPng } from "../../dev/pngRgba.mjs";
import { AS_DRAWN_LUT, clipsFromWalkSheet, fromFrameFile, toFrameFile } from "../../src/art/frameClips";
import { EMBLEM_FRAME_SLOT, frameSlotsFor, frameStampCells, stampFramePart, stampPreviewRgba } from "../../src/art/frameStamp";
import { FRAME_ZOOMS, openingFrameZoom } from "../../src/art/frameView";
import { emblemBitmap, emblemById, emblemForFaction, type EmblemBitmap } from "../../src/art/emblems";
import { FACTION_LUTS } from "../../src/art/paperDoll";
import { assembleRig, moveLayer, resolveFrame, rigFromClips, toPartFile, toRigFile, withRigFrame, wornPart, type PartRig, type RigFrame } from "../../src/art/partRig";
import { EMBLEM_SLOT_KEYS, EMBLEM_STRIP } from "../../src/art/skeletonSchema";
import { MILITARY } from "../../src/ui/theme/militaryPalette";

const png = decodeRgbaPng(readFileSync("public/assets/units/jap_walk.png"));
const rig = rigFromClips(clipsFromWalkSheet(png.data, png.width, png.height, "jap_infantry"));
const hinomaru = emblemForFaction("JAP");
if (!hinomaru) {
  throw new Error("Japan has no emblem.");
}
const smallest = hinomaru.sizes[0]?.size ?? 0;
const bitmap: EmblemBitmap = emblemBitmap(hinomaru, smallest);
const opaque = bitmap.flat().filter((slot) => slot != null).length;

function walkFrame(at: number): RigFrame {
  const frame = rig.clips.walk[at];
  if (!frame) {
    throw new Error(`No walking frame ${at}.`);
  }
  return frame;
}

/** The middle of the torso's ink on a frame. */
function torsoMiddle(target: PartRig, frame: RigFrame): { x: number; y: number } {
  const cells = resolveFrame(target, frame).layers.torso;
  let left = target.width;
  let right = -1;
  let top = target.height;
  let bottom = -1;
  cells.forEach((slot, index) => {
    if (slot === 0) {
      return;
    }
    const x = index % target.width;
    const y = Math.floor(index / target.width);
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  });
  return { x: Math.round((left + right) / 2), y: Math.round((top + bottom) / 2) };
}

describe("emblem colours in the frame editor's slots", () => {
  it("gives every emblem colour its own slot, all inside 1–13", () => {
    const slots = EMBLEM_SLOT_KEYS.map((key) => EMBLEM_FRAME_SLOT[key]);
    expect(new Set(slots).size).toBe(EMBLEM_SLOT_KEYS.length);
    for (const slot of slots) {
      expect(Number.isInteger(slot) && slot >= 1 && slot <= 13).toBe(true);
    }
  });

  it("uses only slots that are the same colour in every country, so the emblem does not change with the uniform", () => {
    const tables = Object.values(FACTION_LUTS);
    for (const key of EMBLEM_SLOT_KEYS) {
      const slot = EMBLEM_FRAME_SLOT[key];
      const colours = new Set(tables.map((lut) => lut[slot]?.toUpperCase()));
      expect(colours.size, key).toBe(1);
    }
  });

  it("is exact for the four emblem colours a slot holds", () => {
    const lut = FACTION_LUTS.GER;
    for (const key of ["emblem_dark", "emblem_red_light", "emblem_white_shade", "emblem_blue"] as const) {
      expect(lut[EMBLEM_FRAME_SLOT[key]]?.toUpperCase(), key).toBe(MILITARY[EMBLEM_STRIP[key]].toUpperCase());
    }
  });
});

describe("stamping a frame at its native size", () => {
  it("works on the 80 by 80 rifleman, not a 48 canvas", () => {
    expect(rig.width).toBe(80);
    expect(rig.height).toBe(80);
  });

  it("writes the emblem onto the worn part of the open layer on this pose, and nothing else", () => {
    const frame = walkFrame(0);
    const at = torsoMiddle(rig, frame);
    const stamped = stampFramePart(rig, frame, "torso", bitmap, at.x, at.y, false);
    expect(stamped).not.toBe(rig);
    const before = wornPart(rig, "torso");
    const after = wornPart(stamped, "torso");
    after.drawings.forEach((drawing, pose) => {
      if (pose !== frame.pose) {
        expect(drawing).toBe(before.drawings[pose]);
      }
    });
    const cells = frameStampCells(rig, frame, "torso", bitmap, at.x, at.y, false);
    expect(cells).toHaveLength(opaque);
    const covered = new Set(cells.map((cell) => cell.y * rig.width + cell.x));
    const shown = resolveFrame(stamped, frame).layers.torso;
    for (const cell of cells) {
      expect(shown[cell.y * rig.width + cell.x]).toBe(cell.slot);
    }
    for (const layer of ["legs", "head", "weapon"] as const) {
      const beforePart = wornPart(rig, layer);
      const afterPart = wornPart(stamped, layer);
      afterPart.drawings.forEach((drawing, pose) => {
        if (pose !== frame.pose) {
          expect(drawing).toBe(beforePart.drawings[pose]);
        }
      });
      const beforeLayer = beforePart.drawings[frame.pose] ?? [];
      const afterLayer = afterPart.drawings[frame.pose] ?? [];
      afterLayer.forEach((slot, index) => {
        expect(slot).toBe(covered.has(index) ? 0 : beforeLayer[index]);
      });
    }
  });

  it("leaves the rig it was given untouched, so one undo step brings the frame back", () => {
    const frame = walkFrame(0);
    const at = torsoMiddle(rig, frame);
    const snapshot = JSON.stringify(rig);
    stampFramePart(rig, frame, "torso", bitmap, at.x, at.y, true);
    expect(JSON.stringify(rig)).toBe(snapshot);
  });

  it("only on the sprite: lands where the soldier has ink, and gives back the same rig on empty canvas", () => {
    const frame = walkFrame(0);
    const at = torsoMiddle(rig, frame);
    const shown = resolveFrame(rig, frame);
    const cells = frameStampCells(rig, frame, "torso", bitmap, at.x, at.y, true);
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      const index = cell.y * rig.width + cell.x;
      expect(["legs", "torso", "head", "weapon"].some((layer) => (shown.layers[layer as "legs"][index] ?? 0) !== 0)).toBe(true);
    }
    expect(stampFramePart(rig, frame, "torso", bitmap, 1, 1, true)).toBe(rig);
  });

  it("clips at the frame's edge instead of wrapping", () => {
    const frame = walkFrame(0);
    const cells = frameStampCells(rig, frame, "head", bitmap, 0, 0, false);
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.length).toBeLessThan(opaque);
    expect(cells.every((cell) => cell.x >= 0 && cell.y >= 0 && cell.x < rig.width && cell.y < rig.height)).toBe(true);
  });

  it("takes the frame's movement off, like the pencil, so the emblem sits where it was clicked", () => {
    const moved = moveLayer(walkFrame(0), "torso", 3, 1);
    const target = withRigFrame(rig, "walk", 0, moved);
    const at = torsoMiddle(target, moved);
    const stamped = stampFramePart(target, moved, "torso", bitmap, at.x, at.y, false);
    const shown = resolveFrame(stamped, moved).layers.torso;
    for (const cell of frameStampCells(target, moved, "torso", bitmap, at.x, at.y, false)) {
      expect(shown[cell.y * rig.width + cell.x]).toBe(cell.slot);
    }
    const drawing = wornPart(stamped, "torso").drawings[moved.pose] ?? [];
    const centre = bitmap[Math.floor(bitmap.length / 2)]?.[Math.floor((bitmap[0]?.length ?? 0) / 2)];
    if (centre) {
      expect(drawing[(at.y - 1) * rig.width + (at.x - 3)]).toBe(EMBLEM_FRAME_SLOT[centre]);
    }
  });

  it("saves and reads back: part files and frame files still hold slots 0–13 only", () => {
    const frame = walkFrame(0);
    const at = torsoMiddle(rig, frame);
    const stamped = stampFramePart(rig, frame, "torso", bitmap, at.x, at.y, false);
    const files = stamped.parts.map((part) => toPartFile(stamped, part));
    const back = assembleRig(JSON.parse(JSON.stringify(toRigFile(stamped))), JSON.parse(JSON.stringify(files)));
    expect(back.parts.map((part) => part.drawings)).toEqual(stamped.parts.map((part) => part.drawings));
    const pixels = resolveFrame(stamped, frame);
    expect(fromFrameFile(JSON.parse(JSON.stringify(toFrameFile(pixels)))).layers).toEqual(pixels.layers);
  });
});

describe("Hinomaru, darker", () => {
  it("paints the disc terracotta and the rim tan, and leaves the original Hinomaru on plum", () => {
    const darker = emblemById("jap_hinomaru_darker");
    const slots = frameSlotsFor("jap_hinomaru_darker");
    expect(darker?.name).toBe("Hinomaru, darker");
    expect(darker?.sizes).toBe(hinomaru.sizes);
    expect(FACTION_LUTS.JAP[slots.emblem_red]).toBe(MILITARY.terracotta);
    expect(FACTION_LUTS.JAP[slots.emblem_red_light]).toBe(MILITARY.terracotta);
    expect(FACTION_LUTS.JAP[slots.emblem_white]).toBe(MILITARY.tan);
    expect(FACTION_LUTS.JAP[slots.emblem_white_shade]).toBe(MILITARY.tan);
    expect(frameSlotsFor("jap_hinomaru").emblem_red).toBe(EMBLEM_FRAME_SLOT.emblem_red);
    const drawn = emblemBitmap(darker!, 17);
    const cells = frameStampCells(rig, walkFrame(0), "torso", drawn, 40, 40, false, slots);
    const top = 40 - Math.floor(drawn.length / 2);
    const left = 40 - Math.floor((drawn[0]?.length ?? 0) / 2);
    const painted = (kind: "emblem_red" | "emblem_white") => cells.find((cell) => drawn[cell.y - top]?.[cell.x - left] === kind);
    expect(painted("emblem_red")?.slot).toBe(slots.emblem_red);
    expect(painted("emblem_white")?.slot).toBe(slots.emblem_white);
  });
});

describe("the stamp's hover preview", () => {
  it("is the cells the click would write, faint, in the colours on screen", () => {
    const cells = [
      { x: 2, y: 1, slot: EMBLEM_FRAME_SLOT.emblem_red },
      { x: 0, y: 0, slot: EMBLEM_FRAME_SLOT.emblem_dark },
    ];
    const rgba = stampPreviewRgba(cells, 4, 3, AS_DRAWN_LUT, 190);
    const red = Number.parseInt((AS_DRAWN_LUT[EMBLEM_FRAME_SLOT.emblem_red] ?? "").slice(1, 7), 16);
    const offset = (1 * 4 + 2) * 4;
    expect([...rgba.subarray(offset, offset + 4)]).toEqual([(red >> 16) & 255, (red >> 8) & 255, red & 255, 190]);
    expect(rgba[3]).toBe(190);
    expect(rgba.filter((_, index) => index % 4 === 3 && rgba[index] !== 0)).toHaveLength(2);
  });
});

describe("zoom from the sprite's own size", () => {
  it("opens an 80 by 80 frame at 8, and wide candidate pictures small enough to see whole", () => {
    expect(openingFrameZoom(80, 80)).toBe(8);
    expect(openingFrameZoom(144, 80)).toBe(4);
    expect(openingFrameZoom(512, 160)).toBe(1);
    expect(FRAME_ZOOMS).toContain(openingFrameZoom(200, 120));
  });
});
