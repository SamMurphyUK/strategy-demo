import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeRgbaPng } from "../../dev/pngRgba.mjs";
import {
  FACTION_LUTS,
  bakeSpritesheet,
  composeFrame,
  extractRig,
  floodMask,
  layoutWalkGrid,
  maskPixelsInRect,
  nearestSemanticSlot,
  nudgeSocket,
  paintMaskPixels,
  quantizePixel,
  rebuildPartsFromMask,
  retintWalkParts,
  sampleReference,
  type ModularPart,
  type PartCategory,
} from "../../src/art/paperDoll";
import { MILITARY } from "../../src/ui/theme/militaryPalette";

function assembly(parts: ModularPart[]): Record<PartCategory, ModularPart> {
  const found = Object.fromEntries(parts.map((part) => [part.category, part])) as Record<PartCategory, ModularPart>;
  return found;
}

describe("paper doll rig", () => {
  const sample = sampleReference();
  const extracted = extractRig(sample.rgba, sample.mask, sample.width, sample.height);

  it("reads eight walk sockets and builds idle and fire from the standing pose", () => {
    expect(extracted.manifest.animations.walk).toHaveLength(8);
    expect(extracted.manifest.animations.idle).toHaveLength(2);
    expect(extracted.manifest.animations.fire).toHaveLength(3);
    const standing = extracted.manifest.animations.walk[0];
    const breath = extracted.manifest.animations.idle[1];
    const kick = extracted.manifest.animations.fire[1];
    if (!standing || !breath || !kick) {
      throw new Error("missing generated frame");
    }
    expect(extracted.manifest.animations.walk[1]?.torsoOffset).toEqual({ x: 0, y: -1 });
    expect(breath.headSocket.y).toBe(standing.headSocket.y - 1);
    expect(breath.torsoOffset).toEqual({ x: 0, y: -1 });
    expect(kick.weaponRecoilOffset).toEqual({ x: -2, y: 0 });
    expect(kick.showMuzzleFlash).toBe(true);
    expect(extracted.manifest.animations.fire[0]?.showMuzzleFlash).toBeUndefined();
    expect(extracted.manifest.animations.fire[2]?.weaponRecoilOffset).toBeUndefined();
  });

  it("pins the head at the bottom and keeps every socket on a whole pixel", () => {
    const head = extracted.parts.find((part) => part.category === "head");
    const legs = extracted.parts.find((part) => part.category === "legs");
    const weapon = extracted.parts.find((part) => part.category === "weapon");
    if (!head || !legs || !weapon) {
      throw new Error("missing part");
    }
    expect(head.frameCount).toBe(1);
    expect(legs.frameCount).toBe(8);
    expect(head.anchor.y).toBe(head.height - 1);
    expect(legs.anchor.y).toBe(0);
    expect(weapon.muzzleAnchor?.x).toBe(weapon.width - 1);
    for (const frame of extracted.manifest.animations.walk) {
      expect(Number.isInteger(frame.headSocket.x)).toBe(true);
      expect(Number.isInteger(frame.headSocket.y)).toBe(true);
      expect(Number.isInteger(frame.weaponSocket.x)).toBe(true);
      expect(Number.isInteger(frame.hipSocket.y)).toBe(true);
    }
  });

  it("puts helmet metal on the helmet slot and leaves the gun on the gun slot", () => {
    const steel = Number.parseInt(MILITARY.steel.slice(1), 16);
    const r = (steel >> 16) & 255;
    const g = (steel >> 8) & 255;
    const b = steel & 255;
    expect(nearestSemanticSlot(r, g, b)).toBe(12);
    expect(quantizePixel(r, g, b, 255, "head")).toBe(11);
    expect(quantizePixel(r, g, b, 255, "weapon")).toBe(12);
    expect(quantizePixel(0, 0, 0, 0, "torso")).toBe(0);
    const head = extracted.parts.find((part) => part.category === "head");
    const gun = extracted.parts.find((part) => part.category === "weapon");
    expect(head?.spriteData.indices.includes(11)).toBe(true);
    expect(gun?.spriteData.indices.includes(12)).toBe(true);
    expect(gun?.spriteData.indices.includes(11)).toBe(false);
  });

  it("keeps the rifle colours the same in every faction preset", () => {
    for (const lut of Object.values(FACTION_LUTS)) {
      expect(lut[12]).toBe(MILITARY.steel);
      expect(lut[13]).toBe(MILITARY.charcoal);
    }
    expect(FACTION_LUTS.GER[11]).toBe(MILITARY.feldgrau);
    expect(FACTION_LUTS.UK[2]).toBe(MILITARY.khaki);
    expect(FACTION_LUTS.USSR[2]).toBe(MILITARY.olive);
    expect(FACTION_LUTS.US[2]).toBe(MILITARY.brass);
    expect(FACTION_LUTS.JAP[2]).toBe(MILITARY.tan);
    expect(FACTION_LUTS.UK[11]).not.toBe(FACTION_LUTS.GER[11]);
  });

  it("nudges a socket by one pixel and rebuilds the breath from the standing frame", () => {
    const nudged = nudgeSocket(extracted.manifest, "walk", 0, "head", 0, 1);
    expect(nudged.animations.walk[0]?.headSocket.y).toBe((extracted.manifest.animations.walk[0]?.headSocket.y ?? 0) + 1);
    expect(nudged.animations.idle[1]?.headSocket.y).toBe((nudged.animations.walk[0]?.headSocket.y ?? 0) - 1);
    expect(nudged.animations.walk[1]?.headSocket).toEqual(extracted.manifest.animations.walk[1]?.headSocket);
  });

  it("bakes walk, idle, and fire into one nearest-pixel sheet", () => {
    const parts = assembly(extracted.parts);
    const standing = composeFrame(extracted.manifest, parts, "walk", 0);
    const neck = extracted.manifest.animations.walk[0]?.headSocket;
    if (!neck) {
      throw new Error("missing head socket");
    }
    expect(standing.indices[neck.y * standing.width + neck.x]).not.toBe(0);
    const baked = bakeSpritesheet(extracted.manifest, parts, FACTION_LUTS.GER, "GER");
    expect(baked.width).toBe(extracted.manifest.frameWidth * 8);
    expect(baked.height).toBe(extracted.manifest.frameHeight * 3);
    expect(baked.meta.frames).toEqual({ walk: 8, idle: 2, fire: 3 });
    const kick = extracted.manifest.animations.fire[1];
    const muzzle = parts.weapon.muzzleAnchor;
    if (!kick || !muzzle) {
      throw new Error("missing muzzle");
    }
    const flashX = extracted.manifest.frameWidth + kick.weaponSocket.x + (kick.weaponRecoilOffset?.x ?? 0) - parts.weapon.anchor.x + muzzle.x;
    const flashY = extracted.manifest.frameHeight * 2 + kick.weaponSocket.y - parts.weapon.anchor.y + muzzle.y;
    const flash = ((flashY * baked.width) + flashX) * 4;
    expect(baked.rgba[flash + 3]).toBe(255);
    expect(baked.rgba[flash]).toBe(0xdd);
  });

  it("refuses a sheet whose first frame has no mask", () => {
    const blank = sample.mask.map(() => null);
    expect(() => extractRig(sample.rgba, blank, sample.width, sample.height)).toThrow(/Frame 0/);
  });

  it("paints a pixel into another area and keeps a chosen colour", () => {
    const overrides = new Array(sample.mask.length).fill(0);
    const same = rebuildPartsFromMask(sample.rgba, sample.mask, overrides, sample.width, sample.height, extracted.parts, false);
    expect(same.find((part) => part.category === "head")?.spriteData.indices).toEqual(
      extracted.parts.find((part) => part.category === "head")?.spriteData.indices,
    );
    expect(sample.mask[8 * sample.width + 10]).toBe("torso");
    const painted = paintMaskPixels(sample.mask, overrides, sample.width, 0, 20, 24, [{ x: 10, y: 8 }], "head", 9);
    const again = paintMaskPixels(painted.mask, painted.overrides, sample.width, 0, 20, 24, [{ x: 10, y: 8 }], "head", 9);
    expect(again.mask).toBe(painted.mask);
    const rebuilt = rebuildPartsFromMask(sample.rgba, painted.mask, painted.overrides, sample.width, sample.height, extracted.parts, false);
    const count = (parts: ModularPart[], category: PartCategory) =>
      parts.find((part) => part.category === category)?.spriteData.indices.filter((slot) => slot !== 0).length ?? 0;
    expect(count(rebuilt, "head")).toBe(count(extracted.parts, "head") + 1);
    expect(count(rebuilt, "torso")).toBe(count(extracted.parts, "torso") - 1);
    expect(rebuilt.find((part) => part.category === "head")?.spriteData.indices.includes(9)).toBe(true);
    expect(floodMask(sample.mask, sample.rgba, sample.width, 20, 24, 0, { x: 10, y: 3 })).toHaveLength(25);
    expect(maskPixelsInRect(sample.mask, sample.rgba, sample.width, 20, 24, 0, { x: 8, y: 1 }, { x: 12, y: 5 })).toHaveLength(25);
    expect(floodMask(sample.mask, sample.rgba, sample.width, 20, 24, 0, { x: 0, y: 0 })).toEqual([{ x: 0, y: 0 }]);
  });
});

describe("japanese walk sheet", () => {
  const png = decodeRgbaPng(readFileSync("public/assets/units/jap_walk.png"));
  const sheet = layoutWalkGrid(png.data, png.width, png.height);
  const extracted = extractRig(sheet.rgba, sheet.mask, sheet.width, sheet.height, "jap_walk");
  const parts = retintWalkParts(extracted.parts);

  it("reads the 4 by 2 sheet as eight square frames", () => {
    expect(png.width).toBe(320);
    expect(png.height).toBe(160);
    expect(sheet.width).toBe(640);
    expect(sheet.height).toBe(80);
    expect(extracted.manifest.frameWidth).toBe(80);
    expect(extracted.manifest.animations.walk).toHaveLength(8);
  });

  it("pins a head, tunic, rifle, and both legs on every frame", () => {
    for (let frame = 0; frame < 8; frame += 1) {
      const counts = { head: 0, torso: 0, weapon: 0, legs: 0 };
      for (let y = 0; y < 80; y += 1) {
        for (let x = 0; x < 80; x += 1) {
          const category = sheet.mask[y * sheet.width + frame * 80 + x];
          if (category) {
            counts[category] += 1;
          }
        }
      }
      expect(counts.head).toBeGreaterThan(40);
      expect(counts.torso).toBeGreaterThan(40);
      expect(counts.weapon).toBeGreaterThan(40);
      expect(counts.legs).toBeGreaterThan(40);
      const standing = extracted.manifest.animations.walk[frame];
      expect(standing && standing.headSocket.y < standing.hipSocket.y).toBe(true);
      expect(standing && standing.weaponSocket.x > standing.headSocket.x).toBe(true);
    }
  });

  it("puts the helmet and tunic on slots a faction can recolour", () => {
    const head = parts.find((part) => part.category === "head");
    const torso = parts.find((part) => part.category === "torso");
    const legs = parts.find((part) => part.category === "legs");
    const weapon = parts.find((part) => part.category === "weapon");
    expect(head?.anchor.y).toBe((head?.height ?? 0) - 1);
    expect(head?.spriteData.indices.includes(11)).toBe(true);
    expect(torso?.spriteData.indices.includes(2)).toBe(true);
    expect(legs?.frameCount).toBe(8);
    expect(weapon?.muzzleAnchor?.x).toBe((weapon?.width ?? 1) - 1);
    expect(weapon?.spriteData.indices.includes(11)).toBe(false);
    expect(FACTION_LUTS.UK[2]).not.toBe(FACTION_LUTS.GER[2]);
    expect(FACTION_LUTS.UK[12]).toBe(FACTION_LUTS.GER[12]);
  });

  it("rebuilds the walk from the mask with the same indices", () => {
    const rebuilt = rebuildPartsFromMask(
      sheet.rgba,
      sheet.mask,
      new Array<number>(sheet.mask.length).fill(0),
      sheet.width,
      sheet.height,
      extracted.parts,
      true,
    );
    for (const category of ["head", "torso", "weapon", "legs"] as const) {
      const next = rebuilt.find((part) => part.category === category);
      const prior = parts.find((part) => part.category === category);
      expect(next?.spriteData.indices).toEqual(prior?.spriteData.indices);
      expect(next?.frames.map((frame) => frame.indices)).toEqual(prior?.frames.map((frame) => frame.indices));
    }
  });
});
