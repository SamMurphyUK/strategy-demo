/** Per-unit motion for the battle preview. Frames step at 8 Hz. Recoil and lifts ease every animation frame. */

import { UNIT_ANIM_PROFILES, type BumpStyle, type UnitAnimProfile } from "./unitAnimationProfiles";

export const VEHICLE_TICK_SECONDS = 0.125;
export const ALL_LOOP_SECONDS = 15;
export const RECOIL_DAMP = 0.86;
export const RECOIL_SNAP = 0.1;
export const BUMP_MOVING = 0.22;
export const BUMP_IDLE = 0.05;
const MAX_STEP_SECONDS = 0.25;

export type VehicleMode = "moving" | "idle" | "firing";
export type FieldMotion = "move" | "idle" | "fire" | "all";

export interface VehicleAnim {
  mode: VehicleMode;
  frame: number;
  stateTick: number;
  /** Counts stay ticks. Damage stutters and sags read this. */
  step: number;
  /** 2: the torso has a lagged bump. 1: the head and weapon have it, or a one-tick jolt is showing. */
  bumpTimer: 0 | 1 | 2;
  bumpDir: -1 | 1;
  bumpStyle: BumpStyle;
  /** 1 for the tick a march becomes idle, when the profile has a halt. */
  lunge: 0 | 1;
  recoilX: number;
  /** Smoothed root lift, in sprite pixels. Positive is down. */
  liftY: number;
  liftLeft: number;
  /** Advances in tick lengths so a wave stays smooth at 60 Hz. */
  wave: number;
  damaged: boolean;
  /** +1 faces right. The gun sits on the right of these pictures. */
  facing: number;
}

export interface VehicleShift {
  x: number;
  y: number;
}

export interface VehicleOffsets {
  root: VehicleShift;
  tracks: VehicleShift;
  torso: VehicleShift;
  head: VehicleShift;
  weapon: VehicleShift;
  /** The torso. Kept so earlier callers can still read the hull. */
  hull: VehicleShift;
  /** The head. The weapon has its own shift. */
  turret: VehicleShift;
}

export interface PreviewClock {
  carry: number;
  allTime: number;
  motion: FieldMotion;
}

export interface PreviewStep {
  changed: boolean;
  dt: number;
  modes: VehicleMode[];
}

export function createPreviewClock(): PreviewClock {
  return { carry: 0, allTime: 0, motion: "move" };
}

export function createVehicleAnim(mode: VehicleMode = "moving", facing = 1): VehicleAnim {
  const direction = facing < 0 ? -1 : 1;
  return {
    mode,
    frame: 0,
    stateTick: 0,
    step: 0,
    bumpTimer: 0,
    bumpDir: 1,
    bumpStyle: "lag",
    lunge: 0,
    recoilX: 0,
    liftY: 0,
    liftLeft: 0,
    wave: 0,
    damaged: false,
    facing: direction,
  };
}

/** Where `allTime` sits in the 10s move, 4s idle, 1s fire loop. */
export function allModeAt(time: number): VehicleMode {
  let t = time % ALL_LOOP_SECONDS;
  if (t < 0) {
    t += ALL_LOOP_SECONDS;
  }
  if (t < 10) {
    return "moving";
  }
  if (t < 14) {
    return "idle";
  }
  return "firing";
}

export function motionMode(motion: FieldMotion, allTime: number): VehicleMode {
  if (motion === "idle") {
    return "idle";
  }
  if (motion === "fire") {
    return "firing";
  }
  if (motion === "all") {
    return allModeAt(allTime);
  }
  return "moving";
}

export function retargetClock(clock: PreviewClock, motion: FieldMotion): void {
  clock.motion = motion;
  clock.allTime = 0;
  clock.carry = 0;
}

/**
 * One preview frame. A motion change clears the carry so the stopping lunge
 * is still on screen when the next tick arrives.
 */
export function previewModes(clock: PreviewClock, motion: FieldMotion, dt: number): PreviewStep {
  const step = Number.isFinite(dt) ? Math.min(MAX_STEP_SECONDS, Math.max(0, dt)) : 0;
  if (clock.motion !== motion) {
    retargetClock(clock, motion);
    return { changed: true, dt: step, modes: [] };
  }
  return { changed: false, dt: step, modes: takePreviewTicks(clock, step, motion) };
}

export function takePreviewTicks(clock: PreviewClock, dt: number, motion: FieldMotion): VehicleMode[] {
  const modes: VehicleMode[] = [];
  if (!(dt > 0)) {
    return modes;
  }
  clock.motion = motion;
  clock.carry += dt;
  let guard = 0;
  while (clock.carry >= VEHICLE_TICK_SECONDS && guard < 8) {
    guard += 1;
    clock.carry -= VEHICLE_TICK_SECONDS;
    if (motion === "all") {
      clock.allTime += VEHICLE_TICK_SECONDS;
      if (clock.allTime >= ALL_LOOP_SECONDS - 1e-6) {
        clock.allTime = 0;
      }
    }
    modes.push(motionMode(motion, clock.allTime));
  }
  return modes;
}

interface KickPose {
  weaponDx: number;
  weaponDy: number;
  headDx: number;
  headDy: number;
  torsoDy: number;
  rootDy: number;
}

const NO_POSE: KickPose = { weaponDx: 0, weaponDy: 0, headDx: 0, headDy: 0, torsoDy: 0, rootDy: 0 };

function poseAt(profile: UnitAnimProfile, frame: number, damaged: boolean): KickPose {
  const extra = damaged ? (profile.damaged.barrelRecoverExtraTicks ?? 0) : 0;
  const pose: KickPose = { weaponDx: 0, weaponDy: 0, headDx: 0, headDy: 0, torsoDy: 0, rootDy: 0 };
  for (const kick of profile.kicks) {
    const holdsBarrel = extra > 0 && (kick.weaponDx != null || kick.weaponDy != null) && frame > kick.frame && frame <= kick.frame + extra;
    if (!holdsBarrel) {
      continue;
    }
    pose.weaponDx = kick.weaponDx ?? 0;
    pose.weaponDy = kick.weaponDy ?? 0;
  }
  for (const kick of profile.kicks) {
    if (frame !== kick.frame) {
      continue;
    }
    if (kick.weaponDx != null) {
      pose.weaponDx = kick.weaponDx;
    }
    if (kick.weaponDy != null) {
      pose.weaponDy = kick.weaponDy;
    }
    if (kick.headDx != null) {
      pose.headDx = kick.headDx;
    }
    if (kick.headDy != null) {
      pose.headDy = kick.headDy;
    }
    if (kick.torsoDy != null) {
      pose.torsoDy = kick.torsoDy;
    }
    if (kick.rootDy != null && kick.rootDyDampMs == null) {
      pose.rootDy = kick.rootDy;
    }
  }
  return pose;
}

function waveOffset(anim: VehicleAnim, profile: UnitAnimProfile): number {
  const wave = profile.wave;
  if (!wave || (wave.when === "idle" && anim.mode !== "idle")) {
    return 0;
  }
  const scale = anim.damaged ? (profile.damaged.wavePeriodScale ?? 1) : 1;
  const period = wave.periodTicks * scale;
  if (!(period > 0)) {
    return 0;
  }
  return Math.sin((anim.wave / period) * Math.PI * 2) * wave.ampPx;
}

export function vehicleOffsets(anim: VehicleAnim, profile: UnitAnimProfile = UNIT_ANIM_PROFILES.tank): VehicleOffsets {
  const facing = anim.facing;
  const pose = anim.mode === "firing" ? poseAt(profile, anim.frame, anim.damaged) : NO_POSE;
  const halt = anim.lunge === 1 ? profile.halt : null;
  const lungeX = halt ? halt.dx * facing : 0;
  const lungeY = halt ? halt.dy : 0;
  const torsoBump = anim.bumpStyle === "lag" && anim.bumpTimer === 2 ? anim.bumpDir : 0;
  const upperBump = anim.bumpStyle === "lag" && anim.bumpTimer === 1 ? anim.bumpDir : 0;
  const rigid = anim.bumpStyle === "rigid" && anim.bumpTimer > 0 ? anim.bumpDir : 0;
  const rootJolt = anim.bumpStyle === "root" && anim.bumpTimer > 0 ? anim.bumpDir : 0;
  const pitch = anim.mode === "moving" ? profile.movePitchDy : 0;
  const sink = anim.mode === "moving" ? profile.moveSinkDy : 0;
  const harm = anim.damaged ? profile.damaged : null;
  const sag = (part: "torso" | "head" | "weapon") => (harm && harm.sagParts.includes(part) ? harm.sagDy : 0);
  const stutter =
    harm && anim.mode === "moving" && harm.stutterEvery != null && harm.stutterEvery > 0 && anim.frame % harm.stutterEvery === 0
      ? (harm.stutterDx ?? 0) * facing
      : 0;
  const listX = harm ? (harm.headDx ?? 0) * facing : 0;
  const rootSag =
    harm && harm.rootSagEvery != null && harm.rootSagEvery > 0 && anim.step % harm.rootSagEvery === 0 ? (harm.rootSagDy ?? 0) : 0;
  const torso = {
    x: lungeX + stutter,
    y: torsoBump + rigid + lungeY + sag("torso") + sink + pose.torsoDy,
  };
  const head = {
    x: lungeX + pose.headDx * facing + listX,
    y: upperBump + rigid + lungeY + sag("head") + sink + pitch + pose.headDy,
  };
  const weapon = {
    x: lungeX + pose.weaponDx * facing,
    y: upperBump + rigid + lungeY + sag("weapon") + sink + pitch + pose.weaponDy,
  };
  const root = {
    x: anim.recoilX,
    y: waveOffset(anim, profile) + rootJolt + anim.liftY + rootSag + pose.rootDy,
  };
  return {
    root,
    tracks: { x: 0, y: 0 },
    torso,
    head,
    weapon,
    hull: torso,
    turret: { x: head.x, y: head.y },
  };
}

function enterMode(anim: VehicleAnim, next: VehicleMode, profile: UnitAnimProfile): void {
  const prev = anim.mode;
  anim.mode = next;
  anim.frame = 0;
  anim.stateTick = 0;
  anim.step = 0;
  anim.bumpTimer = 0;
  anim.lunge = prev === "moving" && next === "idle" && profile.halt != null ? 1 : 0;
}

export function applyMotion(anim: VehicleAnim, motion: FieldMotion, allTime: number, profile: UnitAnimProfile = UNIT_ANIM_PROFILES.tank): void {
  const next = motionMode(motion, allTime);
  if (next !== anim.mode) {
    enterMode(anim, next, profile);
  }
}

export function dampRecoil(anim: VehicleAnim, dt: number): void {
  if (!(dt > 0) || anim.recoilX === 0) {
    return;
  }
  anim.recoilX *= Math.pow(RECOIL_DAMP, dt * 60);
  if (Math.abs(anim.recoilX) < RECOIL_SNAP) {
    anim.recoilX = 0;
  }
}

/** Ease the kick and the bomber lift, and advance the heave, once per drawn frame. */
export function easeVehicle(anim: VehicleAnim, dt: number): void {
  dampRecoil(anim, dt);
  if (!(dt > 0)) {
    return;
  }
  anim.wave += dt / VEHICLE_TICK_SECONDS;
  if (anim.liftLeft <= 0) {
    anim.liftY = 0;
    return;
  }
  const next = Math.max(0, anim.liftLeft - dt);
  anim.liftY = next === 0 ? 0 : anim.liftY * (next / anim.liftLeft);
  anim.liftLeft = next;
}

function applyKick(anim: VehicleAnim, profile: UnitAnimProfile, random: () => number): void {
  if (anim.mode !== "firing") {
    return;
  }
  const kick = profile.kicks.find((item) => item.frame === anim.frame);
  if (!kick) {
    return;
  }
  if (kick.recoilX != null) {
    const magnitude = typeof kick.recoilX === "number" ? kick.recoilX : kick.recoilX.min + random() * (kick.recoilX.max - kick.recoilX.min);
    anim.recoilX = -anim.facing * magnitude;
  }
  if (kick.rootDy != null && kick.rootDyDampMs != null) {
    anim.liftY = kick.rootDy;
    anim.liftLeft = kick.rootDyDampMs / 1000;
  }
}

function rollBump(anim: VehicleAnim, profile: UnitAnimProfile, random: () => number): void {
  const spec = anim.mode === "moving" ? profile.moveBump : anim.mode === "idle" ? profile.idleBump : null;
  if (!spec) {
    return;
  }
  const chance = anim.damaged && anim.mode === "moving" && profile.damaged.moveBumpChance != null ? profile.damaged.moveBumpChance : spec.chance;
  if (random() >= chance) {
    return;
  }
  anim.bumpDir = spec.dir === "down" ? 1 : spec.dir === "up" ? -1 : random() < 0.5 ? -1 : 1;
  anim.bumpStyle = spec.style;
  anim.bumpTimer = spec.style === "lag" ? 2 : 1;
}

export function tickVehicle(
  anim: VehicleAnim,
  mode: VehicleMode,
  random: () => number = Math.random,
  profile: UnitAnimProfile = UNIT_ANIM_PROFILES.tank,
): void {
  if (mode !== anim.mode) {
    enterMode(anim, mode, profile);
    return;
  }
  const hadLunge = anim.lunge === 1;
  anim.lunge = 0;
  anim.frame = (anim.frame + 1) % 8;
  anim.stateTick = (anim.stateTick + 1) % 8;
  anim.step += 1;
  applyKick(anim, profile, random);
  if (hadLunge) {
    return;
  }
  if (anim.bumpTimer > 0) {
    anim.bumpTimer = (anim.bumpTimer - 1) as 0 | 1 | 2;
    return;
  }
  if (mode === "firing") {
    return;
  }
  rollBump(anim, profile, random);
}

/** Apply a button change, or play the ticks from this frame. */
export function advanceVehicle(
  anim: VehicleAnim,
  motion: FieldMotion,
  allTime: number,
  changed: boolean,
  modes: readonly VehicleMode[],
  random: () => number = Math.random,
  profile: UnitAnimProfile = UNIT_ANIM_PROFILES.tank,
): void {
  if (changed) {
    applyMotion(anim, motion, allTime, profile);
    return;
  }
  for (const mode of modes) {
    tickVehicle(anim, mode, random, profile);
  }
}
