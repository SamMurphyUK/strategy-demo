import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeRgbaPng } from "../../dev/pngRgba.mjs";
import {
  AS_DRAWN_LUT,
  breathFrom,
  cardRgba,
  clipsFromWalkSheet,
  cloneFrame,
  composite,
  eraseCell,
  fillTorsoUnderWeapon,
  frameRgba,
  fromFrameFile,
  nudgeLayer,
  paintCell,
  shotFrom,
  toFrameFile,
} from "../../src/art/frameClips";
import { FACTION_LUTS } from "../../src/art/paperDoll";

const png = decodeRgbaPng(readFileSync("public/assets/units/jap_walk.png"));
const clips = clipsFromWalkSheet(png.data, png.width, png.height, "jap_infantry");

function opaqueInCell(cellX: number, cellY: number): number {
  let count = 0;
  for (let y = 0; y < 80; y += 1) {
    for (let x = 0; x < 80; x += 1) {
      if ((png.data[((cellY * 80 + y) * png.width + cellX * 80 + x) * 4 + 3] ?? 0) >= 128) {
        count += 1;
      }
    }
  }
  return count;
}

describe("sprite frames from the walk sheet", () => {
  it("keeps every walk frame at full size, pixel for pixel", () => {
    expect(clips.clips.walk).toHaveLength(8);
    expect(clips.width).toBe(80);
    for (let index = 0; index < 8; index += 1) {
      const frame = clips.clips.walk[index];
      const painted = composite(frame!).filter((slot) => slot !== 0).length;
      expect(painted).toBe(opaqueInCell(index % 4, Math.floor(index / 4)));
    }
    expect(opaqueInCell(0, 0)).toBe(871);
  });

  it("draws every walk frame in the sheet's own colours, pixel for pixel", () => {
    for (let index = 0; index < 8; index += 1) {
      const rgba = frameRgba(clips.clips.walk[index]!, AS_DRAWN_LUT);
      const left = (index % 4) * 80;
      const top = Math.floor(index / 4) * 80;
      let mismatches = 0;
      for (let y = 0; y < 80; y += 1) {
        for (let x = 0; x < 80; x += 1) {
          const from = ((top + y) * png.width + left + x) * 4;
          const to = (y * 80 + x) * 4;
          const opaque = (png.data[from + 3] ?? 0) >= 128;
          if (opaque !== (rgba[to + 3] === 255)) {
            mismatches += 1;
          } else if (opaque && [0, 1, 2].some((k) => png.data[from + k] !== rgba[to + k])) {
            mismatches += 1;
          }
        }
      }
      expect(mismatches, `walk frame ${index}`).toBe(0);
    }
  });

  it("keeps both eyes on frame 0", () => {
    const flat = composite(clips.clips.walk[0]!);
    const at = (x: number, y: number) => flat[y * 80 + x];
    expect(at(43, 27)).toBe(at(46, 27));
    expect(at(43, 27)).not.toBe(at(44, 27));
    expect(at(43, 28)).not.toBe(at(42, 28));
  });

  it("starts Idle as a copy of walk frame 0 and Firing empty", () => {
    expect(clips.clips.idle).toHaveLength(1);
    expect(clips.clips.idle[0]?.layers).toEqual(clips.clips.walk[0]?.layers);
    expect(clips.clips.idle[0]?.layers.torso).not.toBe(clips.clips.walk[0]?.layers.torso);
    expect(clips.clips.fire).toHaveLength(0);
    expect(clips.feet.y).toBe(71);
  });

  it("paints a copy without touching the frame it came from", () => {
    const walk = clips.clips.walk[0]!;
    const before = walk.layers.torso.slice();
    const index = walk.layers.torso.findIndex((slot) => slot !== 0);
    const x = index % 80;
    const y = Math.floor(index / 80);
    const copy = cloneFrame(walk);
    const painted = paintCell(copy, "torso", x, y, 5);
    expect(painted.layers.torso[index]).toBe(5);
    expect(walk.layers.torso).toEqual(before);
    expect(paintCell(painted, "torso", x, y, 5)).toBe(painted);
    const erased = eraseCell(painted, x, y);
    expect(composite(erased)[index]).toBe(0);
    expect(eraseCell(erased, x, y)).toBe(erased);
  });

  it("fills the tunic behind the weapon so a shot leaves no hole", () => {
    const idle = clips.clips.idle[0]!;
    const filled = fillTorsoUnderWeapon(idle);
    const shot = shotFrom(filled);
    expect(shot.flash).toBe(true);
    expect(shot.muzzle?.x).toBe((idle.muzzle?.x ?? 0) - 2);
    const holes = (frame: typeof idle) => {
      const before = composite(idle);
      const after = composite(frame);
      return before.filter(
        (slot, index) =>
          slot !== 0 && after[index] === 0 && (idle.layers.weapon[index] ?? 0) !== 0 && (idle.layers.torso[index] ?? 0) === 0,
      ).length;
    };
    expect(holes(shotFrom(idle))).toBeGreaterThan(0);
    expect(fillTorsoUnderWeapon(filled)).toBe(filled);
    expect(holes(shot)).toBeLessThan(holes(shotFrom(idle)));
  });

  it("makes a breath frame and moves one layer at a time", () => {
    const idle = clips.clips.idle[0]!;
    const breath = breathFrom(idle);
    expect(breath.layers.legs).toEqual(idle.layers.legs);
    expect(breath.layers.weapon).toEqual(idle.layers.weapon);
    expect(breath.layers.head).not.toEqual(idle.layers.head);
    expect(nudgeLayer(idle, "torso", 0, 0)).toBe(idle);
  });

  it("puts the feet on the game card's ground point and saves a frame round trip", () => {
    const idle = clips.clips.idle[0]!;
    const card = cardRgba(idle, FACTION_LUTS.JAP, clips.feet);
    const rowInk = (y: number) => Array.from({ length: 80 }, (_, x) => card[(y * 80 + x) * 4 + 3]).some((alpha) => alpha === 255);
    expect(rowInk(52)).toBe(true);
    expect(rowInk(53)).toBe(false);
    const file = JSON.parse(JSON.stringify(toFrameFile(idle))) as unknown;
    expect(fromFrameFile(file)).toEqual(idle);
    expect(() =>
      fromFrameFile({
        kind: "sprite-frame",
        version: 1,
        width: 2,
        height: 2,
        layers: {},
      }),
    ).toThrow();
  });
});
