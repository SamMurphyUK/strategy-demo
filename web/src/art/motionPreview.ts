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

export interface PlaybackBeat {
  /** The name of the cell on a card strip. */
  name: string;
  /** The stored pose a layered unit starts from. */
  pose: SpriteFrameKey;
  /** How much of the recoil is on: 0, a half, or the whole. A half is built from the idle layers when it is drawn. */
  recoil: 0 | 0.5 | 1;
  /** The pose a unit with no layers shows instead. It has no half recoil. */
  flat: SpriteFrameKey;
}

/**
 * The eight beats a layered unit plays: two steps, then a shot that winds up, peaks, and recovers.
 * Only four poses are stored. The two half-recoil beats are worked out from the idle layers.
 */
const IDLE_BEAT: PlaybackBeat = { name: "idle", pose: "idle", recoil: 0, flat: "idle" };

export const PLAYBACK_BEATS: readonly PlaybackBeat[] = [
  IDLE_BEAT,
  { name: "move_1", pose: "move_1", recoil: 0, flat: "move_1" },
  { name: "idle_2", pose: "idle", recoil: 0, flat: "idle" },
  { name: "move_2", pose: "move_2", recoil: 0, flat: "move_2" },
  { name: "fire_windup", pose: "fire", recoil: 0.5, flat: "idle" },
  { name: "fire_peak", pose: "fire", recoil: 1, flat: "fire" },
  { name: "fire_recover", pose: "fire", recoil: 0.5, flat: "fire" },
  { name: "idle_settle", pose: "idle", recoil: 0, flat: "idle" },
];

const MARCH_BEATS: readonly number[] = [0, 1, 2, 3];
const SHOT_BEATS: readonly number[] = [4, 5, 6, 7];

/**
 * The beat on show at this time. The march loops. Every 16 ticks the shot takes four of them:
 * windup, peak, recovery, settle.
 */
export function playbackBeatAt(time: number): PlaybackBeat {
  const step = poseStep(time);
  const inCycle = step % 16;
  const index = inCycle < SHOT_BEATS.length ? SHOT_BEATS[inCycle] : MARCH_BEATS[step % MARCH_BEATS.length];
  return PLAYBACK_BEATS[index ?? 0] ?? IDLE_BEAT;
}
