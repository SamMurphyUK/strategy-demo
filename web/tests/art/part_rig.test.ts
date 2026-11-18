import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeRgbaPng } from "../../dev/pngRgba.mjs";
import { AS_DRAWN_LUT, breathFrom, clipsFromWalkSheet, composite, frameRgba, paintCell, type FrameClips } from "../../src/art/frameClips";
import {
  assembleRig,
  breathFrame,
  buildGaps,
  copyPart,
  fillTorsoUnderWeapon,
  framesOnPose,
  moveLayer,
  outlineFit,
  ownPose,
  paintPart,
  partFromPicture,
  partStrip,
  removeBuild,
  removePart,
  resolveFrame,
  retakeOutline,
  rigFromClips,
  saveBuild,
  shotFrame,
  spreadDrawing,
  toPartFile,
  toRigFile,
  trimToOutline,
  wearBuild,
  wearPart,
  withRigFrame,
  wornBuild,
  wornPart,
} from "../../src/art/partRig";

const png = decodeRgbaPng(readFileSync("public/assets/units/jap_walk.png"));
const clips = clipsFromWalkSheet(png.data, png.width, png.height, "jap_infantry");
const rig = rigFromClips(clips);

function first<T>(list: readonly T[]): T {
  const item = list[0];
  if (item === undefined) {
    throw new Error("The list is empty.");
  }
  return item;
}

describe("a rig of swappable parts built from the walk", () => {
  it("keeps the walk pixel for pixel, as eight poses of four parts", () => {
    expect(rig.poses).toBe(8);
    expect(rig.parts.map((part) => part.id)).toEqual(["legs_original", "torso_original", "head_original", "weapon_original"]);
    rig.clips.walk.forEach((frame, index) => {
      const resolved = resolveFrame(rig, frame);
      expect(resolved.layers).toEqual(clips.clips.walk[index]?.layers);
      expect(resolved.muzzle).toEqual(clips.clips.walk[index]?.muzzle);
    });
  });

  it("reads Idle as walking pose 0 with no movement, and adds no pose for it", () => {
    expect(rig.clips.idle).toHaveLength(1);
    expect(first(rig.clips.idle).pose).toBe(0);
    expect(first(rig.clips.idle).move.head).toEqual({ x: 0, y: 0 });
    expect(framesOnPose(rig, 0)).toEqual([
      { clip: "idle", index: 0 },
      { clip: "walk", index: 0 },
    ]);
  });

  it("reads a moved frame as a pose plus movement, and a repainted frame as its own pose", () => {
    const walk0 = first(clips.clips.walk);
    const breath = breathFrom(walk0);
    const repainted = paintCell(walk0, "torso", 2, 2, 5);
    const edited: FrameClips = { ...clips, clips: { ...clips.clips, idle: [walk0, breath], fire: [repainted] } };
    const built = rigFromClips(edited);
    expect(built.poses).toBe(9);
    expect(built.clips.idle[1]?.pose).toBe(0);
    expect(built.clips.idle[1]?.move.head).toEqual({ x: 0, y: -1 });
    expect(built.clips.idle[1]?.move.torso).toEqual({ x: 0, y: -1 });
    expect(built.clips.idle[1]?.move.legs).toEqual({ x: 0, y: 0 });
    expect(built.clips.fire[0]?.pose).toBe(8);
    expect(resolveFrame(built, first(built.clips.fire)).layers).toEqual(repainted.layers);
    expect(resolveFrame(built, built.clips.idle[1]!).layers).toEqual(breath.layers);
  });

  it("measures the head's bob across the walk", () => {
    expect(rig.anchors.head[0]).toEqual({ x: 0, y: 0 });
    expect(rig.anchors.head[3]).toEqual({ x: -1, y: 2 });
    expect(rig.anchors.head[6]).toEqual({ x: 0, y: 2 });
  });

  it("measures where the rifle sits on each pose, lift included", () => {
    expect(rig.anchors.weapon.map((anchor) => `${anchor.x},${anchor.y}`)).toEqual([
      "0,0",
      "0,0",
      "0,0",
      "-1,1",
      "-1,0",
      "1,-6",
      "1,-3",
      "1,0",
    ]);
  });

  it("swaps a part in every clip and puts the old one back unchanged", () => {
    const before = rig.clips.walk.map((frame) => composite(resolveFrame(rig, frame)));
    const copied = copyPart(rig, "torso", "German tunic");
    expect(copied.wearing.torso).toBe("torso_german_tunic");
    expect(wornPart(copied, "torso").drawings).toEqual(wornPart(rig, "torso").drawings);

    const idle = first(copied.clips.idle);
    const spot = wornPart(copied, "torso").drawings[0]!.findIndex((slot) => slot !== 0);
    const painted = paintPart(copied, idle, "torso", spot % 80, Math.floor(spot / 80), 5);
    expect(resolveFrame(painted, first(painted.clips.idle)).layers.torso[spot]).toBe(5);
    expect(resolveFrame(painted, first(painted.clips.walk)).layers.torso[spot]).toBe(5);

    const back = wearPart(painted, "torso", "torso_original");
    expect(back.clips.walk.map((frame) => composite(resolveFrame(back, frame)))).toEqual(before);
    expect(wearPart(back, "torso", "torso_original")).toBe(back);
    expect(wearPart(back, "torso", "legs_original")).toBe(back);

    const removed = removePart(painted, "torso_german_tunic");
    expect(removed.wearing.torso).toBe("torso_original");
    expect(() => removePart(removed, "torso_original")).toThrow();
  });

  it("keeps a bob and a kick as numbers on the frame, so they survive a swap", () => {
    const idle = first(rig.clips.idle);
    const breath = breathFrame(idle);
    const shot = shotFrame(idle);
    expect(breath.move.head).toEqual({ x: 0, y: -1 });
    expect(shot.move.weapon).toEqual({ x: -2, y: 0 });
    expect(shot.flash).toBe(true);
    expect(idle.move.weapon).toEqual({ x: 0, y: 0 });

    const still = resolveFrame(rig, idle);
    const fired = resolveFrame(rig, shot);
    expect(fired.muzzle).toEqual({ x: (still.muzzle?.x ?? 0) - 2, y: still.muzzle?.y });
    expect(fired.layers.legs).toBe(still.layers.legs);

    const swapped = copyPart(rig, "weapon", "Carbine");
    expect(resolveFrame(swapped, shot).layers.weapon).toEqual(fired.layers.weapon);
    expect(moveLayer(idle, "head", 0, 0)).toBe(idle);
  });

  it("paints through a frame's movement onto the right pixel of the drawing", () => {
    const shot = shotFrame(first(rig.clips.idle));
    const painted = paintPart(rig, shot, "weapon", 30, 10, 12);
    expect(wornPart(painted, "weapon").drawings[0]?.[10 * 80 + 32]).toBe(12);
    expect(resolveFrame(painted, shot).layers.weapon[10 * 80 + 30]).toBe(12);
    expect(paintPart(painted, shot, "weapon", 30, 10, 12)).toBe(painted);
    expect(paintPart(rig, shot, "weapon", -1, 10, 12)).toBe(rig);
  });

  it("places one drawing on every pose, and reads a strip pose by pose", () => {
    const head = wornPart(rig, "head");
    const one = frameRgba(
      { width: 80, height: 80, layers: { legs: [], torso: [], head: first(head.drawings), weapon: [] }, muzzle: null, flash: false },
      AS_DRAWN_LUT,
    );
    const single = partFromPicture(rig, "head", "Field cap", one, 80, 80);
    const cap = wornPart(single, "head");
    expect(cap.id).toBe("head_field_cap");
    expect(cap.drawings).toHaveLength(8);
    expect(cap.drawings[0]).toEqual(head.drawings[0]);
    const lifted = cap.drawings[3]!;
    const source = first(head.drawings);
    const at = source.findIndex((slot) => slot !== 0);
    expect(lifted[at + 2 * 80 - 1]).toBe(source[at]);

    const strip = partStrip(rig, head);
    expect(strip.width).toBe(640);
    const rgba = new Uint8ClampedArray(strip.width * strip.height * 4);
    strip.cells.forEach((slot, index) => {
      if (slot === 0) {
        return;
      }
      const rgb = Number.parseInt((AS_DRAWN_LUT[slot] ?? "#000000").slice(1, 7), 16);
      rgba.set([(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, 255], index * 4);
    });
    const whole = partFromPicture(rig, "head", "Sheet head", rgba, strip.width, strip.height);
    expect(wornPart(whole, "head").drawings).toEqual(head.drawings);
    expect(() => partFromPicture(rig, "head", "Wrong", new Uint8ClampedArray(48 * 48 * 4), 48, 48)).toThrow(/640×80/);

    const spread = spreadDrawing(rig, "head", 0);
    expect(wornPart(spread, "head").drawings[3]).toEqual(lifted);
  });

  it("holds legs and torsos to the skeleton's outline", () => {
    expect(outlineFit(rig, wornPart(rig, "legs"))).toEqual({ outside: 0, missing: 0 });
    expect(outlineFit(rig, wornPart(rig, "head"))).toBeNull();
    const torso = outlineFit(rig, wornPart(rig, "torso"));
    expect(torso?.outside).toBe(0);
    expect(torso?.missing).toBeGreaterThan(0);

    const filled = fillTorsoUnderWeapon(rig);
    expect(outlineFit(filled, wornPart(filled, "torso"))).toEqual({ outside: 0, missing: 0 });
    expect(fillTorsoUnderWeapon(filled)).toBe(filled);
    expect(filled.clips.walk.map((frame) => composite(resolveFrame(filled, frame)))).toEqual(
      rig.clips.walk.map((frame) => composite(resolveFrame(rig, frame))),
    );

    const stray = paintPart(rig, first(rig.clips.walk), "legs", 1, 1, 6);
    expect(outlineFit(stray, wornPart(stray, "legs"), 0)).toEqual({ outside: 1, missing: 0 });
    const trimmed = trimToOutline(stray, "legs");
    expect(wornPart(trimmed, "legs").drawings).toEqual(wornPart(rig, "legs").drawings);
    expect(trimToOutline(trimmed, "legs")).toBe(trimmed);
    expect(trimToOutline(rig, "head")).toBe(rig);
  });

  it("takes the outline again from the worn part after the walk is redrawn", () => {
    expect(retakeOutline(rig, "torso")).toBe(rig);
    expect(retakeOutline(rig, "legs")).toBe(rig);
    expect(retakeOutline(rig, "head")).toBe(rig);

    // A torso pixel far out on the weapon's row, as a badly split sheet leaves behind.
    const walk0 = first(rig.clips.walk);
    const tip = resolveFrame(rig, walk0).muzzle!;
    const stray = paintPart(rig, walk0, "torso", tip.x, tip.y, 6);
    const taken = retakeOutline(stray, "torso");
    expect(taken.outlines.torso[0]?.[tip.y * 80 + tip.x]).toBe(1);
    // The row between the body and the stray pixel counts as under the weapon, so the outline swells.
    const swollen = taken.outlines.torso[0]!.filter((inside) => inside === 1).length;
    expect(swollen).toBeGreaterThan(rig.outlines.torso[0]!.filter((inside) => inside === 1).length + 1);
    expect(taken.outlines.torso[1]).toBe(rig.outlines.torso[1]);
    expect(taken.outlines.legs).toBe(rig.outlines.legs);

    // Clearing the pixel and taking the outline again puts it back exactly.
    const cleaned = retakeOutline(paintPart(taken, walk0, "torso", tip.x, tip.y, 0), "torso");
    expect(cleaned.outlines.torso).toEqual(rig.outlines.torso);
    expect(outlineFit(cleaned, wornPart(cleaned, "torso"))?.outside).toBe(0);

    // A pixel taken off the edge of the legs leaves the outline too.
    const edge = rig.outlines.legs[0]!.indexOf(1);
    const shaved = paintPart(rig, walk0, "legs", edge % 80, Math.floor(edge / 80), 0);
    expect(outlineFit(shaved, wornPart(shaved, "legs"), 0)).toEqual({ outside: 0, missing: 1 });
    const followed = retakeOutline(shaved, "legs");
    expect(followed.outlines.legs[0]?.[edge]).toBe(0);
    expect(outlineFit(followed, wornPart(followed, "legs"))).toEqual({ outside: 0, missing: 0 });
  });

  it("gives a frame its own pose, with its movement drawn in, for every part in the library", () => {
    const library = wearPart(copyPart(rig, "head", "Field cap"), "head", "head_original");
    const breath = breathFrame(first(library.clips.idle));
    const withBreath = { ...library, clips: { ...library.clips, idle: [first(library.clips.idle), breath] } };
    const before = resolveFrame(withBreath, breath);
    const owned = ownPose(withBreath, "idle", 1);
    const frame = owned.clips.idle[1]!;
    expect(owned.poses).toBe(9);
    expect(frame.pose).toBe(8);
    expect(frame.move.head).toEqual({ x: 0, y: 0 });
    expect(resolveFrame(owned, frame).layers).toEqual(before.layers);
    expect(owned.parts.every((part) => part.drawings.length === 9)).toBe(true);
    expect(owned.anchors.head[8]).toEqual({ x: 0, y: -1 });

    const repainted = paintPart(owned, frame, "head", 5, 5, 11);
    expect(resolveFrame(repainted, first(repainted.clips.walk)).layers.head[5 * 80 + 5]).toBe(0);
    expect(withRigFrame(owned, "idle", 1, frame)).toBe(owned);
  });

  it("saves a choice of parts and colours as a named build and puts it back on", () => {
    expect(rig.builds).toEqual([]);
    const cap = copyPart(rig, "head", "Field cap");
    const carbine = copyPart(cap, "weapon", "Carbine");
    const saved = saveBuild(carbine, "  3rd Guards ", "USSR");
    expect(saved.builds).toEqual([
      {
        id: "3rd_guards",
        name: "3rd Guards",
        wearing: { legs: "legs_original", torso: "torso_original", head: "head_field_cap", weapon: "weapon_carbine" },
        colours: "USSR",
      },
    ]);
    expect(wornBuild(saved, "USSR")?.id).toBe("3rd_guards");
    expect(wornBuild(saved, "GER")).toBeNull();
    expect(() => saveBuild(saved, "   ", "USSR")).toThrow(/name/);

    const plain = wearPart(wearPart(saved, "head", "head_original"), "weapon", "weapon_original");
    expect(wornBuild(plain, "USSR")).toBeNull();
    const both = saveBuild(plain, "Line infantry", "SHEET");
    expect(both.builds.map((build) => build.id)).toEqual(["3rd_guards", "line_infantry"]);

    const back = wearBuild(both, "3rd_guards");
    expect(back.wearing).toEqual(saved.wearing);
    expect(back.clips.walk.map((frame) => composite(resolveFrame(back, frame)))).toEqual(
      saved.clips.walk.map((frame) => composite(resolveFrame(saved, frame))),
    );
    expect(wearBuild(back, "3rd_guards")).toBe(back);
    expect(wearBuild(back, "nobody")).toBe(back);

    // The same name, in other capitals, is saved over. It does not become a second build.
    const over = saveBuild(wearBuild(both, "line_infantry"), "3RD GUARDS", "GER");
    expect(over.builds.map((build) => build.id)).toEqual(["3rd_guards", "line_infantry"]);
    expect(over.builds[0]).toMatchObject({ name: "3RD GUARDS", colours: "GER", wearing: plain.wearing });

    // A deleted part leaves a gap. The layer keeps what it is wearing.
    const lost = removePart(both, "head_field_cap");
    const guards = first(lost.builds);
    expect(buildGaps(lost, guards)).toEqual(["head"]);
    expect(buildGaps(both, guards)).toEqual([]);
    const partly = wearBuild(lost, "3rd_guards");
    expect(partly.wearing.head).toBe("head_original");
    expect(partly.wearing.weapon).toBe("weapon_carbine");

    expect(removeBuild(both, "3rd_guards").builds.map((build) => build.id)).toEqual(["line_infantry"]);
    expect(removeBuild(both, "nobody")).toBe(both);

    const rigFile = JSON.parse(JSON.stringify(toRigFile(both))) as Record<string, unknown>;
    const partFiles = both.parts.map((part) => JSON.parse(JSON.stringify(toPartFile(both, part))) as unknown);
    expect(assembleRig(rigFile, partFiles).builds).toEqual(both.builds);
    // A rig saved before builds existed opens with none.
    const { builds: _dropped, ...older } = rigFile;
    expect(assembleRig(older, partFiles).builds).toEqual([]);
    expect(() => assembleRig({ ...rigFile, builds: [{ id: "x", name: "", colours: "GER", wearing: {} }] }, partFiles)).toThrow(/build/);
  });

  it("saves and opens again as a rig file and one file per part", () => {
    const worn = copyPart(rig, "weapon", "Carbine");
    const rigFile = JSON.parse(JSON.stringify(toRigFile(worn))) as unknown;
    const partFiles = worn.parts.map((part) => JSON.parse(JSON.stringify(toPartFile(worn, part))) as unknown);
    expect(assembleRig(rigFile, partFiles)).toEqual(worn);
    expect(() => assembleRig(rigFile, partFiles.slice(0, 2))).toThrow();
    expect(() => assembleRig({ kind: "sprite-clips", version: 1 }, partFiles)).toThrow();
  });
});
