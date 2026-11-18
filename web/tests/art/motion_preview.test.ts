import { describe, expect, it } from "vitest";
import { POSE_FPS, poseFiring, poseFrameAt, poseStep } from "../../src/art/motionPreview";

describe("sprite pose clock", () => {
  it("cycles idle, move 1, idle, move 2 at eleven poses a second", () => {
    expect(POSE_FPS).toBeGreaterThanOrEqual(10);
    expect(POSE_FPS).toBeLessThanOrEqual(12);
    expect(poseFrameAt(0, false)).toBe("idle");
    expect(poseFrameAt(1 / POSE_FPS, false)).toBe("move_1");
    expect(poseFrameAt(2 / POSE_FPS, false)).toBe("idle");
    expect(poseFrameAt(3 / POSE_FPS, false)).toBe("move_2");
    expect(poseFrameAt(4 / POSE_FPS, false)).toBe("idle");
  });

  it("steps the lane by whole pose ticks and holds fire for two of them", () => {
    expect(poseStep(0)).toBe(0);
    expect(poseStep(1 / POSE_FPS + 0.001)).toBe(1);
    expect(poseFiring(0)).toBe(true);
    expect(poseFiring(1 / POSE_FPS)).toBe(true);
    expect(poseFiring(2 / POSE_FPS)).toBe(false);
    expect(poseFrameAt(0, true)).toBe("fire");
    expect(poseFrameAt(16 / POSE_FPS, false)).toBe("idle");
    expect(poseFiring(16 / POSE_FPS)).toBe(true);
  });
});
