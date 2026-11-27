import { describe, expect, it } from "vitest";
import { blendPresets, cameraPose, fitDistance, horizonFraction, lookPose, pitchOf } from "../../../src/ui/viewport3d/battle/battleCamera";
import { BATTLE_SKINS } from "../../../src/ui/viewport3d/skins/battleSkin";

const cam = BATTLE_SKINS.european.camera;

describe("battle camera", () => {
  it("looks down at 17 degrees through a wide 50 degree lens in the establishing shot", () => {
    const pose = cameraPose(cam.establishing, 16 / 9);
    expect(pose.fovDeg).toBe(50);
    expect(pitchOf(pose)).toBeCloseTo(17, 3);
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

  it("lays the look's lens, height and aim over a preset: a wide, low shot with the horizon in the top fifth", () => {
    const pose = lookPose(cam.establishing, 16 / 9, { fov: 50, height: 6, aim: 0.42 });
    expect(pose.fovDeg).toBe(50);
    expect(pose.position[2]).toBe(6);
    const horizon = horizonFraction(pose);
    expect(horizon).toBeGreaterThan(0.05);
    expect(horizon).toBeLessThan(0.25);
  });

  it("dials the foreshortening: a higher camera looks down more and pushes the horizon up out of the frame", () => {
    const low = lookPose(cam.establishing, 16 / 9, { fov: 50, height: 4, aim: 0.42 });
    const high = lookPose(cam.establishing, 16 / 9, { fov: 50, height: 12, aim: 0.42 });
    expect(pitchOf(high)).toBeGreaterThan(pitchOf(low));
    expect(horizonFraction(high)).toBeLessThan(horizonFraction(low));
    // A wider lens stands closer to fit the same stage.
    const wide = lookPose(cam.establishing, 16 / 9, { fov: 60, height: 6, aim: 0.42 });
    const narrow = lookPose(cam.establishing, 16 / 9, { fov: 35, height: 6, aim: 0.42 });
    expect(wide.distance).toBeLessThan(narrow.distance);
  });
});
