// Live presentation settings for the 3D battle stage, and the store that holds them. Pure: no Three.js, no DOM
// beyond localStorage, and nothing here reads or writes combat rules or simulation state.
//
// It mirrors the board's mapVisualConfig.ts: one plain object changed in place, a revision counter, and setters.
// The stage reads the fields inside its frame loop, so a slider costs a frame and no React render of the stage.
// Which skin owns which setting is in battleSkin.ts, the way boardSkin.ts owns the board's.

export interface BattleVisualConfig {
  /** Scale of the rear support lane against the front. Rear lanes sit at about 0.78 to 0.85. The airspace lane follows it. */
  battleDepthScale: number;
  /** Desaturation of the rear lanes, 0 to 1. A fifth to a third of the colour is drawn out of them. */
  battleDepthDesat: number;
  /** Share of the skin's scatter drawn. 0 is bare ground, 1 is the skin's own plan, 2 is half again as thick. */
  battleScatterDensity: number;
  /** Strength of the persistent battle smoke and of the valley mist. */
  battleSmokeStrength: number;
  /** Blur of the foreground lip and the horizon. 0 is a sharp lens. */
  battleTiltShift: number;
  /** Valley-mist tint on the rear lanes and the ground behind the line. */
  battleValleyMist: number;
  /** Depth of the recoil spring on a firing unit. */
  battleRecoilPitch: number;
  /** Length of the hit-stop on a heavy hit, in frames at 60 Hz. 0 is none. */
  battleHitStopFrames: number;
  /** Size of the damped camera thud. */
  battleCameraThud: number;
  /** Brightness of the brief warm point light on a muzzle burst. */
  battleMuzzleLight: number;
}

export type BattleVisualKey = keyof BattleVisualConfig;

export const DEFAULT_BATTLE_VISUALS: Readonly<BattleVisualConfig> = Object.freeze({
  battleDepthScale: 0.82,
  battleDepthDesat: 0.25,
  battleScatterDensity: 1,
  battleSmokeStrength: 1,
  battleTiltShift: 0.8,
  battleValleyMist: 0.6,
  battleRecoilPitch: 1,
  battleHitStopFrames: 3,
  battleCameraThud: 1,
  battleMuzzleLight: 1,
});

export const BATTLE_VISUAL_RANGES: Readonly<Record<BattleVisualKey, readonly [number, number]>> = Object.freeze({
  battleDepthScale: [0.6, 1],
  battleDepthDesat: [0, 0.6],
  battleScatterDensity: [0, 2],
  battleSmokeStrength: [0, 2],
  battleTiltShift: [0, 1],
  battleValleyMist: [0, 1],
  battleRecoilPitch: [0, 2],
  battleHitStopFrames: [0, 6],
  battleCameraThud: [0, 2],
  battleMuzzleLight: [0, 2],
});

export const BATTLE_VISUAL_KEYS = Object.keys(DEFAULT_BATTLE_VISUALS) as BattleVisualKey[];

export const BATTLE_VISUALS_STORAGE_KEY = "battle-visuals-v1";

/** A whole config from anything: a stored object, a pasted preset, or nothing. Gaps take `base`; numbers are clamped. */
export function parseBattleVisuals(value: unknown, base: Readonly<BattleVisualConfig> = DEFAULT_BATTLE_VISUALS): BattleVisualConfig {
  const raw = (value && typeof value === "object" ? value : {}) as Partial<Record<BattleVisualKey, unknown>>;
  const out = {} as BattleVisualConfig;
  for (const key of BATTLE_VISUAL_KEYS) {
    const [low, high] = BATTLE_VISUAL_RANGES[key];
    const v = raw[key];
    out[key] = typeof v === "number" && Number.isFinite(v) ? Math.min(high, Math.max(low, v)) : base[key];
  }
  return out;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function readStored(): BattleVisualConfig {
  try {
    const text = storage()?.getItem(BATTLE_VISUALS_STORAGE_KEY);
    return parseBattleVisuals(text ? JSON.parse(text) : null);
  } catch {
    return { ...DEFAULT_BATTLE_VISUALS };
  }
}

/** The live settings. Read fields straight off it; change them through the setters below. */
export const battleVisuals: BattleVisualConfig = readStored();

let rev = 0;
const listeners = new Set<() => void>();

function publish(): void {
  rev += 1;
  try {
    storage()?.setItem(BATTLE_VISUALS_STORAGE_KEY, JSON.stringify(battleVisuals));
  } catch {
    // The page still has the new values.
  }
  for (const listener of [...listeners]) {
    listener();
  }
}

export function getBattleVisualRev(): number {
  return rev;
}

export function subscribeBattleVisuals(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setBattleVisual<K extends BattleVisualKey>(key: K, value: BattleVisualConfig[K]): void {
  const next = parseBattleVisuals({ ...battleVisuals, [key]: value }, battleVisuals);
  if (next[key] === battleVisuals[key]) {
    return;
  }
  battleVisuals[key] = next[key];
  publish();
}

export function resetBattleVisuals(): void {
  Object.assign(battleVisuals, DEFAULT_BATTLE_VISUALS);
  publish();
}
