/** Per-archetype motion for the battle preview. Numbers assume the picture faces right. */

export type AnimArchetype =
  | "tank"
  | "mech_inf"
  | "artillery"
  | "aa_gun"
  | "fighter"
  | "tac_bomber"
  | "strat_bomber"
  | "battleship"
  | "cruiser"
  | "destroyer"
  | "submarine"
  | "transport";

export type BumpDir = "down" | "up" | "signed";
export type BumpStyle = "lag" | "rigid" | "root";

/** A backward kick. A span is `min + random * (max - min)`, facing right. */
export type RecoilKick = number | { min: number; max: number };

export interface BumpSpec {
  chance: number;
  dir: BumpDir;
  /** Lag: torso this tick, head and weapon the next. Rigid: those three together. Root: the whole unit. */
  style: BumpStyle;
}

export interface FireKick {
  frame: number;
  weaponDx?: number;
  weaponDy?: number;
  headDx?: number;
  headDy?: number;
  torsoDy?: number;
  recoilX?: RecoilKick;
  rootDy?: number;
  /** When set, `rootDy` eases back to 0 over this many milliseconds. */
  rootDyDampMs?: number;
}

export interface DamageSpec {
  sagDy: number;
  sagParts: readonly ("torso" | "head" | "weapon")[];
  moveBumpChance?: number;
  /** Torso hitch while moving. `stutterDx` is multiplied by facing. */
  stutterEvery?: number;
  stutterDx?: number;
  /** How many extra ticks a fire kick keeps its weapon shift. */
  barrelRecoverExtraTicks?: number;
  rootSagEvery?: number;
  rootSagDy?: number;
  /** Superstructure list, multiplied by facing. */
  headDx?: number;
  wavePeriodScale?: number;
}

export interface UnitAnimProfile {
  id: AnimArchetype;
  idleBump: BumpSpec | null;
  moveBump: BumpSpec | null;
  /** One tick when a march becomes idle. `dx` is multiplied by facing. */
  halt: { dx: number; dy: number } | null;
  /** Nose-down on the head and weapon while moving. */
  movePitchDy: number;
  /** Extra sink on the torso, head, and weapon while moving. */
  moveSinkDy: number;
  wave: { ampPx: number; periodTicks: number; when: "idle" | "all" } | null;
  kicks: readonly FireKick[];
  damaged: DamageSpec;
}

/** A paper-doll layer the preview can slide on its own. */
export type AnimLayer = "tracks" | "torso" | "head" | "weapon";

export interface LayerShift {
  x: number;
  y: number;
}

/**
 * Which drawn layer receives each profile slot.
 * A tank's gun is the weapon. A towed gun and a halftrack's gun are the head.
 * A ship's guns are the torso. A plane's airframe is the tracks and its propeller is the torso.
 */
export type LayerInk = Record<AnimLayer, AnimLayer>;

const LAG_DOWN: BumpSpec = { chance: 0.05, dir: "down", style: "lag" };
const LAG_SIGNED: BumpSpec = { chance: 0.22, dir: "signed", style: "lag" };
const HALT = { dx: 1, dy: 1 };

const ARMOR_DAMAGE: DamageSpec = {
  sagDy: 1,
  sagParts: ["torso", "head", "weapon"],
  moveBumpChance: 0.35,
  stutterEvery: 4,
  stutterDx: -1,
};

const GUN_DAMAGE: DamageSpec = {
  sagDy: 1,
  sagParts: ["head", "weapon"],
  barrelRecoverExtraTicks: 2,
};

const AIR_DAMAGE: DamageSpec = {
  sagDy: 0,
  sagParts: [],
  rootSagEvery: 6,
  rootSagDy: 2,
};

function shipDamage(sagDy: number): DamageSpec {
  return {
    sagDy,
    sagParts: ["torso", "head", "weapon"],
    headDx: -1,
    wavePeriodScale: 1.5,
  };
}

function armor(id: "tank" | "mech_inf", kicks: readonly FireKick[]): UnitAnimProfile {
  return {
    id,
    idleBump: LAG_DOWN,
    moveBump: LAG_SIGNED,
    halt: HALT,
    movePitchDy: 0,
    moveSinkDy: 0,
    wave: null,
    kicks,
    damaged: ARMOR_DAMAGE,
  };
}

function ordnance(id: "artillery" | "aa_gun", kicks: readonly FireKick[]): UnitAnimProfile {
  return {
    id,
    idleBump: null,
    moveBump: { chance: 0.18, dir: "up", style: "rigid" },
    halt: HALT,
    movePitchDy: 0,
    moveSinkDy: 0,
    wave: null,
    kicks,
    damaged: GUN_DAMAGE,
  };
}

function aircraft(id: "fighter" | "tac_bomber" | "strat_bomber", periodTicks: number, kicks: readonly FireKick[]): UnitAnimProfile {
  return {
    id,
    idleBump: null,
    moveBump: { chance: 0.12, dir: "signed", style: "root" },
    halt: null,
    movePitchDy: 1,
    moveSinkDy: 0,
    wave: { ampPx: 1, periodTicks, when: "idle" },
    kicks,
    damaged: AIR_DAMAGE,
  };
}

function vessel(
  id: "battleship" | "cruiser" | "destroyer" | "submarine" | "transport",
  periodTicks: number,
  kicks: readonly FireKick[],
  sagDy: number,
  moveSinkDy = 0,
): UnitAnimProfile {
  return {
    id,
    idleBump: null,
    moveBump: null,
    halt: null,
    movePitchDy: 0,
    moveSinkDy,
    wave: { ampPx: 1, periodTicks, when: "all" },
    kicks,
    damaged: shipDamage(sagDy),
  };
}

const DECK_GUN: readonly FireKick[] = [{ frame: 1, weaponDx: -2, recoilX: 1 }];

const SAME_INK: LayerInk = { tracks: "tracks", torso: "torso", head: "head", weapon: "weapon" };
const GUN_ON_HEAD: LayerInk = { tracks: "tracks", torso: "torso", head: "head", weapon: "head" };
const GUN_ON_TORSO: LayerInk = { tracks: "tracks", torso: "torso", head: "head", weapon: "torso" };
/** Flat aircraft: prop on torso, airframe on tracks. The `_25D` fighter skips this fold in the preview. */
const AIRFRAME_INK: LayerInk = { tracks: "tracks", torso: "torso", head: "tracks", weapon: "torso" };

export const LAYER_INK: Record<AnimArchetype, LayerInk> = {
  tank: SAME_INK,
  mech_inf: GUN_ON_HEAD,
  artillery: GUN_ON_HEAD,
  aa_gun: GUN_ON_HEAD,
  fighter: AIRFRAME_INK,
  tac_bomber: AIRFRAME_INK,
  strat_bomber: AIRFRAME_INK,
  battleship: GUN_ON_TORSO,
  cruiser: GUN_ON_TORSO,
  destroyer: GUN_ON_TORSO,
  submarine: GUN_ON_TORSO,
  transport: GUN_ON_TORSO,
};

function mergeAxis(current: number, next: number): number {
  if (current === 0 || next === 0 || current === next) {
    return current === 0 ? next : current;
  }
  return current + next;
}

/** Slide each profile slot on the layer that holds that part's ink. Shared layers keep one copy of an identical shift. */
export function foldLayerShift(profile: UnitAnimProfile, parts: Record<AnimLayer, LayerShift>): Record<AnimLayer, LayerShift> {
  const ink = LAYER_INK[profile.id];
  const out: Record<AnimLayer, LayerShift> = {
    tracks: { x: 0, y: 0 },
    torso: { x: 0, y: 0 },
    head: { x: 0, y: 0 },
    weapon: { x: 0, y: 0 },
  };
  for (const slot of ["tracks", "torso", "head", "weapon"] as const) {
    const dest = out[ink[slot]];
    const shift = parts[slot];
    dest.x = mergeAxis(dest.x, shift.x);
    dest.y = mergeAxis(dest.y, shift.y);
  }
  return out;
}

export const UNIT_ANIM_PROFILES: Record<AnimArchetype, UnitAnimProfile> = {
  tank: armor("tank", [{ frame: 1, weaponDx: -3, recoilX: { min: 2, max: 4 } }]),
  mech_inf: armor("mech_inf", [
    { frame: 1, weaponDx: -2, recoilX: { min: 1, max: 2 } },
    { frame: 4, weaponDx: -2, recoilX: { min: 1, max: 2 } },
  ]),
  artillery: ordnance("artillery", [{ frame: 1, weaponDx: -4, recoilX: 4, torsoDy: -1 }]),
  aa_gun: ordnance("aa_gun", [
    { frame: 1, weaponDx: -2, weaponDy: 2, headDx: -2, headDy: 2, recoilX: 1.5 },
    { frame: 5, weaponDx: -2, weaponDy: 2, headDx: -2, headDy: 2, recoilX: 1.5 },
  ]),
  fighter: aircraft("fighter", 8, [
    { frame: 1, recoilX: 1 },
    { frame: 3, recoilX: 1 },
    { frame: 5, recoilX: 1 },
  ]),
  tac_bomber: aircraft("tac_bomber", 8, [{ frame: 1, rootDy: -2, rootDyDampMs: 300 }]),
  strat_bomber: aircraft("strat_bomber", 16, [{ frame: 1, rootDy: -1 }]),
  battleship: vessel("battleship", 16, [
    { frame: 1, weaponDx: -3, recoilX: 3 },
    { frame: 2, headDx: -1 },
  ], 2),
  cruiser: vessel("cruiser", 16, [
    { frame: 1, weaponDx: -2, recoilX: 2 },
    { frame: 2, headDx: -1 },
  ], 2),
  destroyer: vessel("destroyer", 8, DECK_GUN, 1),
  submarine: vessel("submarine", 8, [{ frame: 1, rootDy: -1 }], 1, 2),
  transport: vessel("transport", 8, DECK_GUN, 1),
};

const ALIASES: Record<string, AnimArchetype> = {
  tank: "tank",
  armor: "tank",
  mech_inf: "mech_inf",
  mech_infantry: "mech_inf",
  artillery: "artillery",
  aa_gun: "aa_gun",
  aaa: "aa_gun",
  aa: "aa_gun",
  fighter: "fighter",
  tac_bomber: "tac_bomber",
  tactical_bomber: "tac_bomber",
  strat_bomber: "strat_bomber",
  strategic_bomber: "strat_bomber",
  bomber: "strat_bomber",
  battleship: "battleship",
  cruiser: "cruiser",
  destroyer: "destroyer",
  submarine: "submarine",
  transport: "transport",
};

const STATE_PREFIX = /^(?:walk|idle|fire|plate|vector):/;
const TAIL = /:(?:vector|png|still|rig)$/;
const QUICK = /_quick$/;
const SEED = /_seed\d+$/;
const FACTION = /^(?:ger|ussr|uk|usa|us|jap)_/;

function profileKey(unitId: string): string {
  let text = unitId.trim().toLowerCase();
  for (let guard = 0; guard < 6; guard += 1) {
    const next = text.replace(STATE_PREFIX, "").replace(TAIL, "").replace(QUICK, "").replace(SEED, "").replace(FACTION, "");
    if (next === text) {
      break;
    }
    text = next;
  }
  return text;
}

/** The profile written for this type. Infantry, carriers, and unknown ids have none. */
export function namedAnimProfile(unitId: string): UnitAnimProfile | null {
  const id = ALIASES[profileKey(unitId)];
  return id ? UNIT_ANIM_PROFILES[id] : null;
}

/** Map a unit id, a menu value, or a roster type onto its profile. Unknown ids use the tank. */
export function resolveUnitAnimProfile(unitId: string): UnitAnimProfile {
  return namedAnimProfile(unitId) ?? UNIT_ANIM_PROFILES.tank;
}
