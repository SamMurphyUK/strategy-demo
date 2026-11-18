import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { maskCoverage, partCandidateRelativeStem, pictureKind, resolveInsideRoot } from "../../dev/bakeUnitPlugin.mjs";
import { decodeRgbaPng, encodeRgbaPng } from "../../dev/pngRgba.mjs";
import { clipsFromWalkSheet } from "../../src/art/frameClips";
import {
  GEN_KEY,
  GEN_MAX_SIDE,
  GEN_MIN_SIDE,
  genZone,
  harvestPart,
  isKeyColour,
  planGeneration,
  type GenPicture,
  type GenPlan,
  type GenSheet,
} from "../../src/art/partGen";
import { outlineFit, ownPose, partFromDrawings, rigFromClips, shiftCells, wornPart } from "../../src/art/partRig";

const png = decodeRgbaPng(readFileSync("public/assets/units/jap_walk.png"));
const rig = rigFromClips(clipsFromWalkSheet(png.data, png.width, png.height, "jap_infantry"));
const SIZE = rig.width * rig.height;

/** The picture as it was sent, as if the tool had changed nothing. */
function echo(sheet: GenSheet): GenPicture {
  return { rgba: sheet.input.slice(), width: sheet.width, height: sheet.height };
}

function flat(sheet: GenSheet, rgb: readonly [number, number, number]): GenPicture {
  const rgba = new Uint8ClampedArray(sheet.width * sheet.height * 4);
  for (let index = 0; index < sheet.width * sheet.height; index += 1) {
    rgba.set([rgb[0], rgb[1], rgb[2], 255], index * 4);
  }
  return { rgba, width: sheet.width, height: sheet.height };
}

/** Where a frame pixel of one pose sits in a sheet's RGBA. */
function offsetOf(plan: GenPlan, sheet: GenSheet, pose: number, index: number): number {
  const at = sheet.poses.indexOf(pose);
  const x = sheet.originX + (index % rig.width) - plan.box.x + (at % sheet.columns) * plan.box.width;
  const y = sheet.originY + Math.floor(index / rig.width) - plan.box.y + Math.floor(at / sheet.columns) * plan.box.height;
  return (y * sheet.width + x) * 4;
}

function solid(mask: Uint8ClampedArray): number {
  let count = 0;
  for (let offset = 3; offset < mask.length; offset += 4) {
    if ((mask[offset] ?? 0) > 12) {
      count += 1;
    }
  }
  return count;
}

function count(cells: readonly number[]): number {
  return cells.filter((slot) => slot !== 0).length;
}

function only<T>(list: readonly T[]): T {
  expect(list).toHaveLength(1);
  return list[0] as T;
}

describe("pictures sent out for a new part", () => {
  it("sends every pose of the torso in one picture, with the rifle off and only the tunic open to repainting", () => {
    const plan = planGeneration(rig, { layer: "torso", spread: "each", pose: 0, room: 2 });
    const sheet = only(plan.sheets);
    expect(sheet.poses).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(sheet.width).toBeLessThanOrEqual(GEN_MAX_SIDE);
    expect(sheet.height).toBeLessThanOrEqual(GEN_MAX_SIDE);
    expect(sheet.input.length).toBe(sheet.width * sheet.height * 4);
    for (let offset = 3; offset < sheet.input.length; offset += 4) {
      expect(sheet.input[offset]).toBe(255);
    }

    let open = 0;
    for (let pose = 0; pose < rig.poses; pose += 1) {
      const head = wornPart(rig, "head").drawings[pose] ?? [];
      const outline = rig.outlines.torso[pose] ?? [];
      const zone = plan.zones[pose] ?? [];
      for (let index = 0; index < SIZE; index += 1) {
        // The tunic's outline, less the pixels the head hides.
        expect(zone[index]).toBe(outline[index] === 1 && (head[index] ?? 0) === 0 ? 1 : 0);
        open += zone[index] ?? 0;
        if (zone[index] === 1) {
          // Where the rifle lay over the tunic there is a hole. It is sent filled in, never as background.
          const offset = offsetOf(plan, sheet, pose, index);
          expect(isKeyColour(sheet.input[offset] ?? 0, sheet.input[offset + 1] ?? 0, sheet.input[offset + 2] ?? 0)).toBe(false);
        }
      }
    }
    expect(open).toBeGreaterThan(0);
    expect(solid(sheet.mask)).toBe(open);

    const weapon = wornPart(rig, "weapon").drawings[0] ?? [];
    const bare = weapon.findIndex(
      (slot, index) =>
        slot !== 0 &&
        (["legs", "torso", "head"] as const).every((layer) => (wornPart(rig, layer).drawings[0]?.[index] ?? 0) === 0) &&
        rig.outlines.torso[0]?.[index] !== 1,
    );
    expect(bare).toBeGreaterThanOrEqual(0);
    const offset = offsetOf(plan, sheet, 0, bare);
    expect([...sheet.input.subarray(offset, offset + 3)]).toEqual([...GEN_KEY]);
  });

  it("reads back the picture it sent as the same torso, filled out to the outline", () => {
    const plan = planGeneration(rig, { layer: "torso", spread: "each", pose: 0, room: 2 });
    const result = harvestPart(rig, plan, [echo(only(plan.sheets))]);
    expect(result.drawings).toHaveLength(8);
    const worn = wornPart(rig, "torso");
    result.drawings.forEach((drawing, pose) => {
      worn.drawings[pose]?.forEach((slot, index) => {
        if (slot !== 0) {
          expect(drawing[index]).toBe(slot);
        }
      });
    });
    const made = partFromDrawings(rig, "torso", "Echo tunic", result.drawings);
    expect(made.wearing.torso).toBe("torso_echo_tunic");
    expect(outlineFit(made, wornPart(made, "torso"))).toEqual({ outside: 0, missing: 0 });
    expect(outlineFit(rig, wornPart(rig, "torso"))?.missing).toBeGreaterThan(0);

    // A picture that leaves pose 0's tunic as background: the outline keeps the worn part's pixels there.
    const sheet = only(plan.sheets);
    const blanked = echo(sheet);
    plan.zones[0]?.forEach((inside, index) => {
      if (inside === 1) {
        blanked.rgba.set([GEN_KEY[0], GEN_KEY[1], GEN_KEY[2], 255], offsetOf(plan, sheet, 0, index));
      }
    });
    const partly = harvestPart(rig, plan, [blanked]);
    expect(partly.kept).toBe(count(plan.zones[0] ?? []));
    expect(partly.painted).toBe(result.painted - partly.kept);
    expect(partly.drawings).toEqual(result.drawings);
  });

  it("holds legs and torsos to the outline whatever the picture paints", () => {
    for (const layer of ["legs", "torso"] as const) {
      const plan = planGeneration(rig, { layer, spread: "each", pose: 0, room: 6 });
      const result = harvestPart(rig, plan, [flat(only(plan.sheets), [0x64, 0x53, 0x55])]);
      result.drawings.forEach((drawing, pose) => {
        const outline = rig.outlines[layer][pose] ?? [];
        const zone = plan.zones[pose] ?? [];
        drawing.forEach((slot, index) => {
          expect(slot !== 0).toBe(outline[index] === 1);
          if (zone[index] === 1) {
            expect(slot).toBe(4);
          }
        });
      });
    }
    expect(() => planGeneration(rig, { layer: "torso", spread: "one", pose: 0, room: 2 })).toThrow(/each pose/);
    expect(() => planGeneration(rig, { layer: "legs", spread: "one", pose: 0, room: 2 })).toThrow(/each pose/);
  });

  it("draws one head and lets the skeleton place it on every pose", () => {
    const plan = planGeneration(rig, { layer: "head", spread: "one", pose: 3, room: 2 });
    const sheet = only(plan.sheets);
    expect(sheet.poses).toEqual([3]);
    const zone = plan.zones[3] ?? [];
    const head = wornPart(rig, "head").drawings[3] ?? [];
    const body = (index: number) =>
      (wornPart(rig, "legs").drawings[3]?.[index] ?? 0) !== 0 ||
      (wornPart(rig, "torso").drawings[3]?.[index] ?? 0) !== 0 ||
      rig.outlines.torso[3]?.[index] === 1;
    zone.forEach((inside, index) => {
      if ((head[index] ?? 0) !== 0) {
        expect(inside).toBe(1);
      } else if (body(index)) {
        expect(inside).toBe(0);
      }
    });
    expect(count(zone)).toBeGreaterThan(count(head));
    expect(count(genZone(rig, "head", 3, 0))).toBe(count(head));

    // A picture that fills the whole zone with the helmet colour: a bigger hat.
    const result = harvestPart(rig, plan, [flat(sheet, [0xa9, 0xa2, 0x5d])]);
    expect(result.painted).toBe(count(zone));
    expect(result.kept).toBe(0);
    expect(result.drawings).toHaveLength(8);
    expect(result.drawings[3]).toEqual(zone.map((inside) => (inside === 1 ? 11 : 0)));
    const anchor = rig.anchors.head[3]!;
    expect(result.drawings[0]).toEqual(shiftCells(result.drawings[3]!, rig.width, rig.height, -anchor.x, -anchor.y));
    const six = rig.anchors.head[6]!;
    expect(result.drawings[6]).toEqual(shiftCells(result.drawings[3]!, rig.width, rig.height, six.x - anchor.x, six.y - anchor.y));
  });

  it("reads the key colour and clear pixels as empty", () => {
    expect(isKeyColour(255, 0, 255)).toBe(true);
    expect(isKeyColour(236, 20, 228)).toBe(true);
    expect(isKeyColour(0xb8, 0x7a, 0x60)).toBe(false);
    expect(isKeyColour(0x4b, 0x3d, 0x44)).toBe(false);

    const plan = planGeneration(rig, { layer: "head", spread: "one", pose: 0, room: 3 });
    const sheet = only(plan.sheets);
    const same = harvestPart(rig, plan, [echo(sheet)]);
    expect(same.drawings[0]).toEqual(wornPart(rig, "head").drawings[0]);

    // The head goes out on a whole body: the tunic's holes under the rifle are filled, and are not the head's to repaint.
    rig.outlines.torso[0]?.forEach((inside, index) => {
      if (inside === 1 && (wornPart(rig, "head").drawings[0]?.[index] ?? 0) === 0) {
        const offset = offsetOf(plan, sheet, 0, index);
        expect(isKeyColour(sheet.input[offset] ?? 0, sheet.input[offset + 1] ?? 0, sheet.input[offset + 2] ?? 0)).toBe(false);
        expect(sheet.mask[offset + 3]).toBe(0);
      }
    });

    expect(() => harvestPart(rig, plan, [flat(sheet, GEN_KEY)])).toThrow(/nothing painted/);
    const clear = { rgba: new Uint8ClampedArray(sheet.width * sheet.height * 4), width: sheet.width, height: sheet.height };
    expect(() => harvestPart(rig, plan, [clear])).toThrow(/nothing painted/);
    expect(() => harvestPart(rig, plan, [])).toThrow(/1 pictures were sent/);
    expect(() => harvestPart(rig, plan, [{ rgba: new Uint8ClampedArray(48 * 48 * 4), width: 48, height: 48 }])).toThrow(/48×48/);
  });

  it("sends a weapon on its own, with room around it for a different shape", () => {
    const plan = planGeneration(rig, { layer: "weapon", spread: "one", pose: 0, room: 2 });
    const sheet = only(plan.sheets);
    const weapon = wornPart(rig, "weapon").drawings[0] ?? [];
    let ink = 0;
    for (let offset = 0; offset < sheet.input.length; offset += 4) {
      if (!isKeyColour(sheet.input[offset] ?? 0, sheet.input[offset + 1] ?? 0, sheet.input[offset + 2] ?? 0)) {
        ink += 1;
      }
    }
    expect(ink).toBe(count(weapon));
    // The rifle alone is a sliver. It is sent in the middle of a picture no smaller than 64 a side.
    expect(plan.box.height).toBeLessThan(GEN_MIN_SIDE);
    expect(sheet.width).toBeGreaterThanOrEqual(GEN_MIN_SIDE);
    expect(sheet.height).toBe(GEN_MIN_SIDE);
    expect(sheet.originY).toBe(Math.floor((GEN_MIN_SIDE - plan.box.height) / 2));
    expect(count(plan.zones[0] ?? [])).toBeGreaterThan(count(weapon));
    expect(solid(sheet.mask)).toBe(count(plan.zones[0] ?? []));

    const result = harvestPart(rig, plan, [echo(sheet)]);
    expect(result.drawings[0]).toEqual(weapon);
    const lift = rig.anchors.weapon[5]!;
    expect(result.drawings[5]).toEqual(shiftCells(weapon, rig.width, rig.height, lift.x, lift.y));

    const each = planGeneration(rig, { layer: "weapon", spread: "each", pose: 0, room: 2 });
    const all = harvestPart(rig, each, each.sheets.map(echo));
    expect(all.drawings).toEqual(wornPart(rig, "weapon").drawings);
  });

  it("reads a picture that came back enlarged", () => {
    const plan = planGeneration(rig, { layer: "legs", spread: "each", pose: 0, room: 0 });
    const sheet = only(plan.sheets);
    const big = new Uint8ClampedArray(sheet.width * 3 * sheet.height * 3 * 4);
    for (let y = 0; y < sheet.height * 3; y += 1) {
      for (let x = 0; x < sheet.width * 3; x += 1) {
        const from = (Math.floor(y / 3) * sheet.width + Math.floor(x / 3)) * 4;
        big.set(sheet.input.subarray(from, from + 4), (y * sheet.width * 3 + x) * 4);
      }
    }
    const enlarged = harvestPart(rig, plan, [{ rgba: big, width: sheet.width * 3, height: sheet.height * 3 }]);
    expect(enlarged).toEqual(harvestPart(rig, plan, [echo(sheet)]));
  });

  it("splits a rig with many poses across pictures and reads them all back", () => {
    let long = rig;
    for (let added = 0; added < 40; added += 1) {
      long = ownPose(long, "idle", 0);
    }
    expect(long.poses).toBe(48);
    const plan = planGeneration(long, { layer: "legs", spread: "each", pose: 0, room: 0 });
    expect(plan.sheets.length).toBeGreaterThan(1);
    expect(plan.sheets.flatMap((sheet) => sheet.poses)).toEqual(Array.from({ length: 48 }, (_, pose) => pose));
    for (const sheet of plan.sheets) {
      expect(sheet.width).toBeLessThanOrEqual(GEN_MAX_SIDE);
      expect(sheet.height).toBeLessThanOrEqual(GEN_MAX_SIDE);
      expect(sheet.poses.length).toBeLessThanOrEqual(sheet.columns * Math.ceil(sheet.height / plan.box.height));
    }
    const result = harvestPart(long, plan, plan.sheets.map(echo));
    expect(result.drawings).toHaveLength(48);
    const made = partFromDrawings(long, "legs", "Echo legs", result.drawings);
    expect(outlineFit(made, wornPart(made, "legs"))).toEqual({ outside: 0, missing: 0 });
    expect(() => partFromDrawings(rig, "legs", "Too many", result.drawings)).toThrow(/8 drawings/);
  });
});

describe("the dev route that sends a part out", () => {
  it("reads the mask the same way the planner wrote it, through a PNG", () => {
    const plan = planGeneration(rig, { layer: "head", spread: "one", pose: 0, room: 2 });
    const sheet = only(plan.sheets);
    const mask = decodeRgbaPng(encodeRgbaPng(sheet.width, sheet.height, sheet.mask));
    expect(maskCoverage(mask)).toEqual({ open: count(plan.zones[0] ?? []), total: sheet.width * sheet.height });
    const input = decodeRgbaPng(encodeRgbaPng(sheet.width, sheet.height, sheet.input));
    expect(maskCoverage(input).open).toBe(sheet.width * sheet.height);
  });

  it("keeps a paid picture under the candidates folder, named by layer, seed and task", () => {
    const stem = partCandidateRelativeStem("jap_infantry", "head", 7, "8d24e990-e395-11f1-a82a-a2aaf3fae649");
    expect(stem.split(/[\\/]/)).toEqual([
      "assets",
      "candidates",
      "parts",
      "jap_infantry",
      "head_seed7_8d24e990-e395-11f1-a82a-a2aaf3fae649",
    ]);
    expect(() => resolveInsideRoot("C:/project/web", `${stem}.png`)).not.toThrow();
    expect(() => partCandidateRelativeStem("../x", "head", 7, "task")).toThrow();
    expect(() => partCandidateRelativeStem("jap_infantry", "hat", 7, "task")).toThrow();
    expect(() => partCandidateRelativeStem("jap_infantry", "head", "7; rm", "task")).toThrow();
    expect(() => partCandidateRelativeStem("jap_infantry", "head", 7, "../task")).toThrow();
  });

  it("tells a picture from anything else by its first bytes", () => {
    expect(pictureKind(encodeRgbaPng(1, 1, new Uint8ClampedArray(4)))).toBe("png");
    expect(pictureKind(Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "latin1"))).toBe("webp");
    expect(pictureKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(pictureKind(Buffer.from('{"error":"no"}'))).toBeNull();
    expect(pictureKind(Buffer.alloc(0))).toBeNull();
  });
});
