import { describe, expect, it } from "vitest";
import { isVehicleUnitType, steelToolFor } from "../../src/art/archetypeLayers";
import { AS_DRAWN_LUT, CLIP_KEYS, readClipsFile } from "../../src/art/frameClips";
import { assembleRig, rigFromPicture, toPartFile, toRigFile, withVehicleClips, wornPart } from "../../src/art/partRig";

function rgbaOf(width: number, height: number, paint: (index: number, out: Uint8ClampedArray) => void): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    paint(index, out);
  }
  return out;
}

describe("rigFromPicture", () => {
  it("puts the picture on the torso of a one-pose rig and leaves the other layers empty", () => {
    const hex = (AS_DRAWN_LUT[5] ?? "#4b3d44").replace("#", "");
    const channels = [0, 2, 4].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
    const rgba = rgbaOf(2, 2, (index, out) => {
      const offset = index * 4;
      if (index === 2) {
        out[offset] = channels[0] ?? 0;
        out[offset + 1] = channels[1] ?? 0;
        out[offset + 2] = channels[2] ?? 0;
        out[offset + 3] = 255;
        return;
      }
      out[offset + 3] = 0;
    });
    const rig = rigFromPicture("us_battleship_seed1", rgba, 2, 2);
    expect(rig.unitId).toBe("us_battleship_seed1");
    expect(rig.width).toBe(2);
    expect(rig.height).toBe(2);
    expect(rig.poses).toBe(1);
    expect(rig.clips.idle).toHaveLength(1);
    expect(rig.clips.walk).toHaveLength(0);
    expect(rig.clips.fire).toHaveLength(0);
    expect(rig.clips.damaged).toHaveLength(0);
    expect(wornPart(rig, "torso").drawings[0]).toEqual([0, 0, 5, 0]);
    expect(wornPart(rig, "legs").drawings[0]).toEqual([0, 0, 0, 0]);
    expect(wornPart(rig, "head").drawings[0]).toEqual([0, 0, 0, 0]);
    expect(wornPart(rig, "weapon").drawings[0]).toEqual([0, 0, 0, 0]);
    expect(rig.feet).toEqual({ x: 0, y: 1 });
  });

  it("keeps a solid pixel off the empty slot", () => {
    const rgba = rgbaOf(1, 1, (_index, out) => {
      out[0] = 1;
      out[1] = 2;
      out[2] = 3;
      out[3] = 255;
    });
    const rig = rigFromPicture("tiny", rgba, 1, 1);
    const slot = wornPart(rig, "torso").drawings[0]?.[0] ?? 0;
    expect(slot).toBeGreaterThan(0);
    expect(slot).toBeLessThanOrEqual(13);
  });
});

describe("steelToolFor", () => {
  it("shows tread links for tanks and mechanised infantry", () => {
    expect(steelToolFor("tank")).toBe("tread");
    expect(steelToolFor("mech_infantry")).toBe("tread");
  });

  it("shows a wingtip step for aircraft, including the short shelf names", () => {
    expect(steelToolFor("fighter")).toBe("propeller");
    expect(steelToolFor("bomber")).toBe("propeller");
    expect(steelToolFor("tac_bomber")).toBe("propeller");
  });

  it("keeps soldier links for infantry and hides them for ships and guns", () => {
    expect(steelToolFor("infantry")).toBe("soldier");
    expect(steelToolFor("battleship")).toBeNull();
    expect(steelToolFor("artillery")).toBeNull();
    expect(steelToolFor("aaa")).toBeNull();
  });
});

describe("vehicle clips", () => {
  it("treats tanks, guns, planes, and ships as vehicles and leaves the soldier", () => {
    expect(isVehicleUnitType("tank")).toBe(true);
    expect(isVehicleUnitType("mech_infantry")).toBe(true);
    expect(isVehicleUnitType("artillery")).toBe(true);
    expect(isVehicleUnitType("aaa")).toBe(true);
    expect(isVehicleUnitType("fighter")).toBe(true);
    expect(isVehicleUnitType("bomber")).toBe(true);
    expect(isVehicleUnitType("tac_bomber")).toBe(true);
    expect(isVehicleUnitType("battleship")).toBe(true);
    expect(isVehicleUnitType("carrier")).toBe(true);
    expect(isVehicleUnitType("infantry")).toBe(false);
    expect(isVehicleUnitType("unit")).toBe(false);
  });

  it("fills Idle, Moving, Firing, and Damaged with copies of pose 0", () => {
    const rgba = rgbaOf(1, 1, (_index, out) => {
      out[3] = 0;
    });
    const rig = withVehicleClips(rigFromPicture("us_tank_seed1", rgba, 1, 1));
    expect(rig.poses).toBe(1);
    expect(rig.clips.idle).toHaveLength(4);
    expect(rig.clips.walk).toHaveLength(8);
    expect(rig.clips.fire).toHaveLength(2);
    expect(rig.clips.damaged).toHaveLength(2);
    const frames = CLIP_KEYS.flatMap((key) => rig.clips[key]);
    expect(frames.every((frame) => frame.pose === 0 && frame.flash === false && frame.muzzle === null)).toBe(true);
    const first = rig.clips.walk[0];
    const second = rig.clips.walk[1];
    if (!first || !second) {
      throw new Error("Moving has no frames.");
    }
    first.move.torso.x = 3;
    expect(second.move.torso.x).toBe(0);
    expect(rig.clips.idle[0]?.move.torso.x).toBe(0);
  });

  it("opens an older rig and clip list that have no damaged frames", () => {
    const rgba = rgbaOf(1, 1, (_index, out) => {
      out[3] = 0;
    });
    const rig = rigFromPicture("old", rgba, 1, 1);
    const file = JSON.parse(JSON.stringify(toRigFile(rig))) as { clips: Record<string, unknown> };
    delete file.clips.damaged;
    const parts = JSON.parse(JSON.stringify(rig.parts.map((part) => toPartFile(rig, part)))) as unknown[];
    const opened = assembleRig(file, parts);
    expect(opened.clips.damaged).toEqual([]);
    expect(opened.clips.idle).toHaveLength(1);
    expect(
      readClipsFile({
        kind: "sprite-clips",
        version: 1,
        unitId: "jap_infantry",
        width: 1,
        height: 1,
        feet: { x: 0, y: 0 },
        clips: { idle: ["idle_0"], walk: ["walk_0"], fire: [] },
      }).clips.damaged,
    ).toEqual([]);
  });

  it("keeps a frame's section name", () => {
    const rgba = rgbaOf(1, 1, (_index, out) => {
      out[3] = 0;
    });
    const rig = rigFromPicture("jap_infantry", rgba, 1, 1);
    const frame = rig.clips.idle[0];
    if (!frame) {
      throw new Error("Idle has no frame.");
    }
    frame.name = "Idle 2";
    const opened = assembleRig(
      toRigFile(rig),
      rig.parts.map((part) => toPartFile(rig, part)),
    );
    expect(opened.clips.idle[0]?.name).toBe("Idle 2");
  });

  it("keeps an exhaust point on the frame it was saved with", () => {
    const rgba = rgbaOf(1, 1, (_index, out) => {
      out[3] = 0;
    });
    const rig = rigFromPicture("ger_tank_seed1", rgba, 1, 1);
    const file = toRigFile(rig);
    const idle = file.clips.idle[0];
    if (!idle) {
      throw new Error("Idle has no frame.");
    }
    idle.smoke = { x: 1, y: 0 };
    const opened = assembleRig(
      JSON.parse(JSON.stringify(file)) as unknown,
      rig.parts.map((part) => toPartFile(rig, part)),
    );
    expect(opened.clips.idle[0]?.smoke).toEqual({ x: 1, y: 0 });
    expect(
      readClipsFile({
        kind: "sprite-clips",
        version: 1,
        unitId: "ger_tank_seed1_QUICK",
        width: 1,
        height: 1,
        feet: { x: 0, y: 0 },
        smoke: { x: 16, y: 40 },
        muzzle: { x: 191, y: 26 },
        flashFrames: [0],
        puffFrames: { idle: [6, 7], fire: [5, 6, 7] },
        clips: { idle: ["idle_0"], walk: ["walk_0"], fire: ["fire_0"] },
      }),
    ).toMatchObject({
      smoke: { x: 16, y: 40 },
      muzzle: { x: 191, y: 26 },
      flashFrames: [0],
      puffFrames: { idle: [6, 7], fire: [5, 6, 7] },
    });
  });
});
