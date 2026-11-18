import type { SpriteFrameKey } from "./skeletonSchema";

/** Pose changes per second. The lane still steps one whole pixel at a time. */
export const POSE_FPS = 11;

const MARCH: readonly SpriteFrameKey[] = ["idle", "move_1", "idle", "move_2"];

export function poseStep(time: number): number {
  return Math.floor(Math.max(0, time) * POSE_FPS);
}

/** idle, move 1, idle, move 2. Fire replaces the march while the shot is up. */
export function poseFrameAt(time: number, firing: boolean): SpriteFrameKey {
  if (firing) {
    return "fire";
  }
  return MARCH[poseStep(time) % MARCH.length] ?? "idle";
}

/** A shot occupies the first two pose ticks of every 16. */
export function poseFiring(time: number): boolean {
  return poseStep(time) % 16 < 2;
}
