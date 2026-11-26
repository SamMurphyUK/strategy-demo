import { describe, expect, it } from "vitest";
import { blendPresets, cameraPose, fitDistance, pitchOf } from "../../../src/ui/viewport3d/battle/battleCamera";
import { BATTLE_SKINS } from "../../../src/ui/viewport3d/skins/battleSkin";

const cam = BATTLE_SKINS.european.camera;

describe("battle camera", () => {
  it("looks down at 12 degrees through a 35 degree lens in the establishing shot, so the horizon sits in the top sixth", () => {
    const pose = cameraPose(cam.establishing, 16 / 9);
    expect(pose.fovDeg).toBe(35);
    expect(pitchOf(pose)).toBeCloseTo(12, 3);
    // It stands toward the front lip and above the table, looking into the scene.
    expect(pose.position[1]).toBeLessThan(pose.target[1]);
    expect(pose.position[2]).toBeGreaterThan(pose.target[2]);
  });

  it("stands further off for a narrower frame, and closer for the exchange shot", () => {
    expect(fitDistance(cam.establishing, 1)).toBeGreaterThan(fitDistance(cam.establishing, 2));
    expect(cameraPose(cam.exchange, 1.6).distance).toBeLessThan(cameraPose(cam.establishing, 1.6).distance);
  });

  it("blends presets end to end", () => {
    expect(blendPresets(cam.establishing, cam.exchange, 0)).toEqual(cam.establishing);
    expect(blendPresets(cam.establishing, cam.exchange, 1)).toEqual(cam.exchange);
    expect(blendPresets(cam.establishing, cam.exchange, 0.5).zoom).toBeCloseTo((cam.establishing.zoom + cam.exchange.zoom) / 2, 6);
  });
});
