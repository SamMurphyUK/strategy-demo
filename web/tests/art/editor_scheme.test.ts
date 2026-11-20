import { describe, expect, it } from "vitest";
import { editorSchemeForRig, editorSchemeForUnitType } from "../../src/art/editorScheme";
import { AS_DRAWN_LUT, emptyFrame, frameRgba } from "../../src/art/frameClips";
import { fittingFrameZoom, maxFrameZoom, minFrameZoom, openingFrameZoom, stepZoom, viewFrameZoom, wheelZoomAt } from "../../src/art/frameView";
import { frameMuzzles, moveLayer, noMove, rigFromPicture, seatPicture, toggleMuzzle, wornPart } from "../../src/art/partRig";

function labels(unitTypeId: string): string[] {
  return editorSchemeForUnitType(unitTypeId).layers.map((layer) => layer.label);
}

describe("editor layers", () => {
  it("keeps the soldier's four layers and gives each vehicle its own stack", () => {
    expect(labels("infantry")).toEqual(["Legs", "Torso", "Head", "Weapon"]);
    expect(labels("battleship")).toEqual(["Hull", "Guns", "Top deck"]);
    expect(labels("destroyer")).toEqual(["Hull", "Guns", "Top deck"]);
    expect(labels("fighter")).toEqual(["Chassis", "Propeller"]);
    expect(labels("bomber")).toEqual(["Chassis", "Propeller"]);
    expect(labels("artillery")).toEqual(["Wheel", "Carriage", "Gun"]);
    expect(labels("aaa")).toEqual(["Wheel", "Carriage", "Gun"]);
    expect(labels("tank")).toEqual(["Tracks", "Hull", "Gun"]);
    expect(labels("mech_infantry")).toEqual(["Tracks", "Hull", "Gun"]);
  });

  it("reads the stack back from a saved rig id", () => {
    expect(editorSchemeForRig("ger_battleship_seed1").layers.map((layer) => layer.label)).toEqual(["Hull", "Guns", "Top deck"]);
    expect(editorSchemeForRig("jap_infantry").muzzle).toBe("weapon");
    expect(editorSchemeForRig("us_tank_seed1").muzzle).toBe("head");
    expect(editorSchemeForRig("uk_fighter_seed1").picture).toBe("legs");
  });

  it("seats a ship picture on the hull and leaves the guns empty", () => {
    const rgba = new Uint8ClampedArray(4 * 4);
    rgba[2 * 4 + 3] = 255;
    rgba[2 * 4] = 0x4b;
    rgba[2 * 4 + 1] = 0x3d;
    rgba[2 * 4 + 2] = 0x44;
    const rig = seatPicture(rigFromPicture("ger_battleship_seed1", rgba, 2, 2), "legs");
    expect(wornPart(rig, "legs").name).toBe("Picture");
    expect(wornPart(rig, "legs").drawings[0]?.some((slot) => slot !== 0)).toBe(true);
    expect(wornPart(rig, "torso").drawings[0]?.every((slot) => slot === 0)).toBe(true);
  });
});

describe("several muzzles", () => {
  it("adds a muzzle per click and takes one off when that pixel is clicked again", () => {
    const blank = { pose: 0, move: noMove(), flash: false, muzzle: null };
    const two = toggleMuzzle(toggleMuzzle(blank, "head", 1, 2), "head", 4, 2);
    expect(two.muzzle).toEqual({ x: 1, y: 2 });
    expect(two.muzzles).toEqual([
      { x: 1, y: 2 },
      { x: 4, y: 2 },
    ]);
    const one = toggleMuzzle(two, "head", 1, 2);
    expect(one.muzzle).toEqual({ x: 4, y: 2 });
    expect(one.muzzles).toEqual([{ x: 4, y: 2 }]);
    const none = toggleMuzzle(one, "head", 4, 2);
    expect(none.muzzle).toBeNull();
    expect(none.muzzles).toBeUndefined();
  });

  it("moves every muzzle with the gun and leaves them when another layer moves", () => {
    const rgba = new Uint8ClampedArray(4);
    const rig = { ...rigFromPicture("us_tank_seed1", rgba, 1, 1), muzzleLayer: "head" as const };
    const marked = toggleMuzzle(toggleMuzzle(rig.clips.idle[0]!, "head", 0, 0), "head", 0, 0);
    const shifted = moveLayer(toggleMuzzle(rig.clips.idle[0]!, "head", 0, 0), "head", 2, -1);
    expect(frameMuzzles(rig, shifted)).toEqual([{ x: 2, y: -1 }]);
    const kicked = moveLayer(shifted, "weapon", -4, 0);
    expect(frameMuzzles(rig, kicked)).toEqual([{ x: 2, y: -1 }]);
    expect(marked.muzzle).toBeNull();
  });

  it("flashes every muzzle", () => {
    const frame = emptyFrame(5, 1);
    frame.flash = true;
    frame.muzzle = { x: 0, y: 0 };
    frame.muzzles = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
    ];
    const rgba = frameRgba(frame, AS_DRAWN_LUT);
    const alpha = (x: number) => rgba[(x * 4) + 3];
    expect(alpha(1)).toBe(255);
    expect(alpha(4)).toBe(255);
    expect(alpha(0)).toBe(0);
  });
});

describe("zoom for a large sprite", () => {
  it("keeps the old opening steps and can go down to a quarter", () => {
    expect(openingFrameZoom(80, 80)).toBe(8);
    expect(openingFrameZoom(512, 160)).toBe(1);
    expect(viewFrameZoom(80, 80, { width: 720, height: 640 })).toBe(8);
    expect(viewFrameZoom(900, 120, { width: 720, height: 640 })).toBe(0.5);
    expect(fittingFrameZoom(2000, 400, { width: 400, height: 300 })).toBe(0.25);
    expect(stepZoom(1, 1)).toBe(0.5);
    expect(stepZoom(1, -1)).toBe(2);
    expect(stepZoom(0.25, 1)).toBe(0.25);
    expect(minFrameZoom(80, 80, { width: 720, height: 640 })).toBe(1);
    expect(minFrameZoom(900, 120, { width: 720, height: 640 })).toBe(0.5);
    expect(stepZoom(1, 1, 1)).toBe(1);
    expect(stepZoom(2, 1, 1)).toBe(1);
    expect(stepZoom(0.5, -1, 0.5)).toBe(1);
    expect(maxFrameZoom(80, 80, { width: 720, height: 640 })).toBe(8);
    expect(maxFrameZoom(80, 80, { width: 1262, height: 520 })).toBe(6);
    expect(maxFrameZoom(32, 32, { width: 720, height: 640 })).toBe(12);
    expect(maxFrameZoom(512, 160, { width: 720, height: 640 })).toBe(1);
    expect(stepZoom(6, -1, 1, 6)).toBe(6);
    expect(stepZoom(4, -1, 1, 6)).toBe(6);
    expect(stepZoom(12, -1, 1, 6)).toBe(6);
    expect(stepZoom(6, 1, 1, 6)).toBe(4);
    expect(wheelZoomAt(200, 0, 100)).toBe(200);
    expect(wheelZoomAt(300, 200, 100)).toBeNull();
    expect(wheelZoomAt(400, 200, 0)).toBeNull();
  });
});
