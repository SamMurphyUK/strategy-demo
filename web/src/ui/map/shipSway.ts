// How a ship moves on the water: a gentle heave all the time, and a rocking that a travelling wave
// front sets off as it crosses the ship. Pure: nothing here is state, so a frame costs a few sums and
// nothing in React hears of it.
//
// Heave. One long swell crosses the board from west to east and comes round again, as if a sine
// wave were moving slowly and unseen over the sea. A ship is reached by it according to where it
// stands, so ships rise and fall one after another, never all together. Pitch and roll are all but
// still between waves.
//
// Rocking. A line sweeps the board on a loop (`loopSeconds`) in a chosen direction. When the line
// reaches the edge of a ship's waterline ring, the ship is struck: its roll and pitch rise cleanly
// as the crest comes under it, then die away as a damped swing while the wave passes on. Only ships
// are ever moved by it, and a submarine, riding under the surface, is moved less.

export interface Sway {
  /** Up (+) or down (-), in CSS pixels. */
  bob: number;
  /** Clockwise degrees about the feet. */
  roll: number;
  /** Degrees toward the camera (+) or away (-). It shortens the figure, as a lean does. */
  pitch: number;
}

export const NO_SWAY: Readonly<Sway> = Object.freeze({ bob: 0, roll: 0, pitch: 0 });

/** Greatest heave at full amount, in CSS pixels. */
export const SWAY_BOB_PX = 1.6;
/** Roll and pitch left between waves, in degrees. Near zero: the ship is all but level in a calm. */
export const CALM_ROLL_DEG = 0.12;
/** Greatest roll and pitch a wave front sets off at full amount, in degrees. */
export const ROCK_ROLL_DEG = 3.4;
export const ROCK_PITCH_DEG = 2.6;

/** How the rocking is shaped: seconds to rise to its crest, seconds for the swing to fade to a third, and its rate. */
export const ROCK_ATTACK_S = 0.7;
export const ROCK_DECAY_S = 2.4;
export const ROCK_RATE = 2.9;
/** A swing is over after this long, and the ship is level again. */
export const ROCK_END_S = 9;

/** The world the swell and the front are laid over, in world units. */
export const SWELL_WORLD_WIDTH = 800;
export const SWELL_WORLD_HEIGHT = 504;
/** Wavelengths of the heave across the world width, and radians a second of it at a fixed point. */
export const SWELL_WAVES = 2;
export const SWELL_RATE = 0.48;
/** How far past the board's edge the front starts and ends, so it is off the sea when the loop turns. */
const FRONT_MARGIN = 40;

/** The heave's phase at a map x and a time: the crest moves east, so the phase falls with x. */
export function swellPhase(seconds: number, worldX: number): number {
  return seconds * SWELL_RATE - (worldX / SWELL_WORLD_WIDTH) * SWELL_WAVES * Math.PI * 2;
}

/** The unit vector a front travels along, for a direction in degrees: 0 runs west to east, 90 north to south. */
export function frontDirection(degrees: number): { x: number; y: number } {
  const radians = (degrees * Math.PI) / 180;
  return { x: Math.cos(radians), y: Math.sin(radians) };
}

/** How far along the direction the front sweeps: its start and its end, in world units along it. */
export function frontSweep(degrees: number): { from: number; to: number } {
  const d = frontDirection(degrees);
  const reach = [0, SWELL_WORLD_WIDTH].flatMap((x) => [0, SWELL_WORLD_HEIGHT].map((y) => x * d.x + y * d.y));
  return { from: Math.min(...reach) - FRONT_MARGIN, to: Math.max(...reach) + FRONT_MARGIN };
}

/** Where along its direction the front is, `seconds` into a loop of `loopSeconds`. */
export function frontPosition(seconds: number, loopSeconds: number, degrees: number): number {
  const sweep = frontSweep(degrees);
  const loop = Math.max(0.5, loopSeconds);
  const share = (((seconds % loop) + loop) % loop) / loop;
  return sweep.from + (sweep.to - sweep.from) * share;
}

/**
 * Seconds since the front reached the edge of a ship's ring, within the loop: 0 as it touches, then
 * rising. The ring's edge is `ringWorld` before the ship's centre along the front's direction.
 */
export function secondsSinceStruck(
  seconds: number,
  worldX: number,
  worldY: number,
  ringWorld: number,
  loopSeconds: number,
  degrees: number,
): number {
  const d = frontDirection(degrees);
  const sweep = frontSweep(degrees);
  const loop = Math.max(0.5, loopSeconds);
  const along = worldX * d.x + worldY * d.y - Math.max(0, ringWorld);
  const struckAt = ((along - sweep.from) / (sweep.to - sweep.from)) * loop;
  return (((seconds - struckAt) % loop) + loop) % loop;
}

/**
 * The rocking at `tau` seconds after the front touches the ring, as a swing from -1 to 1. It is 0
 * before the touch. It rises cleanly over the attack, so the crest arrives with no jolt, and then the
 * swing fades as a damped oscillation until the ship is level again.
 */
export function rockResponse(tau: number): number {
  return rockEnvelope(tau) * Math.sin(tau * ROCK_RATE);
}

/** The size of the swing at `tau`, from 0 to 1: a clean rise over the attack, then a damped fade. */
export function rockEnvelope(tau: number): number {
  if (!(tau > 0) || tau >= ROCK_END_S) {
    return 0;
  }
  let attack = 1;
  if (tau < ROCK_ATTACK_S) {
    const t = tau / ROCK_ATTACK_S;
    attack = t * t * (3 - 2 * t);
  }
  const decay = Math.exp(-Math.max(0, tau - ROCK_ATTACK_S) / ROCK_DECAY_S);
  // A last fade to nothing, so the swing never stops short.
  const tail = tau > ROCK_END_S - 2 ? Math.max(0, (ROCK_END_S - tau) / 2) : 1;
  return attack * decay * tail;
}

export interface SwayInput {
  /** The clock, in seconds. */
  seconds: number;
  /** Where the ship stands, in world units. */
  worldX: number;
  worldY: number;
  /** The radius of its waterline ring, in world units. */
  ringWorld: number;
  /** How much of the ground round it is land: 0 in open water, 1 against a coast. */
  landShare: number;
  submarine: boolean;
  /** Sliders: the heave, the rocking, the loop in seconds, the front's direction in degrees, and a submarine's share of the rocking. */
  bobAmp: number;
  rockAmp: number;
  loopSeconds: number;
  directionDeg: number;
  subFactor: number;
}

export function shipSway(input: SwayInput): Sway {
  const { seconds, worldX, worldY } = input;
  if (!Number.isFinite(seconds) || !Number.isFinite(worldX) || !Number.isFinite(worldY)) {
    return NO_SWAY;
  }
  const near = Math.min(1, Math.max(0, input.landShare));
  const phase = swellPhase(seconds, worldX);
  // The heave: against a cliff the swell is shorter, and the water that comes back off the rock is quicker.
  const long = Math.sin(phase);
  const slap = Math.sin(phase * 2 + seconds * 0.9);
  const heave = input.bobAmp > 0 ? SWAY_BOB_PX * input.bobAmp * (long * (1 - 0.45 * near) + 0.4 * near * slap) : 0;
  // Between waves the ship is all but level.
  const calm = input.bobAmp > 0 ? CALM_ROLL_DEG * input.bobAmp * Math.sin(phase - 1.1) : 0;
  let roll = calm;
  let pitch = calm * 0.7;
  if (input.rockAmp > 0) {
    const struck = secondsSinceStruck(seconds, worldX, worldY, input.ringWorld, input.loopSeconds, input.directionDeg);
    const envelope = rockEnvelope(struck);
    if (envelope > 0) {
      // A ship in the lee of a cliff is struck less. A submarine, below the surface, is struck less again.
      const share = input.rockAmp * (1 - 0.3 * near) * (input.submarine ? input.subFactor : 1);
      roll += ROCK_ROLL_DEG * share * envelope * Math.sin(struck * ROCK_RATE);
      // The pitch is a quarter of a swing behind the roll.
      pitch += ROCK_PITCH_DEG * share * envelope * Math.sin(struck * ROCK_RATE - Math.PI / 2);
    }
  }
  return { bob: heave, roll, pitch };
}
