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

// --- The look: colours, positions and scales, as one object the Z and X inspectors edit and copy as JSON ----------------------------------
//
// Everything a skin decides about the picture lives here, so a desert, Pacific or winter skin swaps the whole object and no code. It is plain
// data: hex strings and numbers. `battleVisuals` above holds the sliders; this holds the rest.

export interface SkyStops {
  /** Colour at the horizon, in the middle of the sky, and at the top. */
  low: string;
  mid: string;
  high: string;
}

export interface BattleLook {
  time: {
    /** Hour of the day, 0 to 24. 6 is sunrise, 12 noon, 18 sunset. */
    hour: number;
    /** The hour moves by itself at `speed` hours a minute. */
    auto: boolean;
    speed: number;
  };
  sky: { night: SkyStops; dawn: SkyStops; day: SkyStops; dusk: SkyStops };
  sun: {
    /** Radius of the disc, in world units. Small on purpose, to sell distance. */
    size: number;
    /** The halo's width as a multiple of the disc, and the colour of its dark rim. */
    haloSize: number;
    haloRim: string;
    /** Colours of the halo's three bands, outer to inner, which brighten with the light's strength. */
    halo: [string, string, string];
    /** Light colour at noon, and at the horizon. */
    noon: string;
    low: string;
  };
  moon: { size: number; color: string; glowColor: string; glowSize: number; light: string };
  stars: { density: number; twinkle: number };
  clouds: {
    /** The share of the sky they cover, 0 to 1. */
    share: number;
    speed: number;
    /** The direction they drift (the old painter drifts them sideways). */
    dirX: number;
    dirY: number;
    color: string;
  };
  horizon: {
    /** Atmospheric mist over the far band and the far ground, and how much colour it draws out. */
    mist: number;
    desat: number;
    mistColor: string;
    treeColor: string;
    townColor: string;
    /** Height of the band, in world units, and how much of it is town. */
    height: number;
    town: number;
  };
  ground: { trench: string; bagLight: string; bagDark: string; /** The tint of the sunken no man's land trough. */ troughTint: string; noMansDarken: number; scorch: number };
  sea: {
    coast: string;
    mid: string;
    deep: string;
    sand: string;
    /** How hard the water breaks and swashes onto the beach, and the bob of the waves. */
    swash: number;
    bob: number;
    /** Share of the light's colour the water takes. */
    lightShare: number;
  };
  pos: {
    /** The trench lines: half the gap between them at the front lip and at the far end, and the depths (world y) they are measured at. */
    trench: { halfFront: number; halfBack: number; yFront: number; yBack: number; height: number; width: number };
    /** Where the horizon band stands (world y) and how far the far ground reaches. */
    horizonY: number;
    /** Where the sun and moon stand on the painted sky: across (world x) and up (0 horizon, 1 top). */
    sun: { x: number; up: number };
    moon: { x: number; up: number };
    /** The beach and the sea strip, along the front, in stage depth fractions. */
    beach: { from: number; to: number };
    sea: { from: number; to: number };
    /** The camera: the lens (wide-angle by default), its height above the table, and what depth fraction it aims at. */
    camera: { fov: number; height: number; aim: number };
    /** The trench lips stand this high above the ground, and the no man's land trough between them is sunk this deep. */
    relief: { lipHeight: number; troughDepth: number };
    /** The columns step outward from a trench line by this much a rank, and the first column's offset. */
    columnGap: number;
    columnOffset: number;
  };
}

export const EUROPEAN_LOOK: Readonly<BattleLook> = Object.freeze<BattleLook>({
  time: { hour: 9.5, auto: false, speed: 2 },
  sky: {
    night: { low: "#2E2A4A", mid: "#1B2040", high: "#0E0F26" },
    dawn: { low: "#E58A4E", mid: "#B0587A", high: "#4B4A86" },
    day: { low: "#F0C67A", mid: "#9DBFD8", high: "#4F86C2" },
    dusk: { low: "#E0703F", mid: "#9A4F85", high: "#3B3A78" },
  },
  sun: { size: 0.42, haloSize: 3.2, haloRim: "#B07A44", halo: ["#E9B968", "#F4D58C", "#FFF1C4"], noon: "#FFF3D2", low: "#F0A260" },
  moon: { size: 0.8, color: "#E6EEF8", glowColor: "#8FA7CC", glowSize: 3.2, light: "#8FA7D8" },
  stars: { density: 0.55, twinkle: 0.5 },
  clouds: { share: 0.45, speed: 0.012, dirX: 1, dirY: 0, color: "#F2EBDD" },
  horizon: { mist: 0.45, desat: 0.35, mistColor: "#B9C2B4", treeColor: "#4F6B5C", townColor: "#6D6B74", height: 9, town: 0.3 },
  ground: { trench: "#846D59", bagLight: "#CCA87B", bagDark: "#846D59", troughTint: "#645355", noMansDarken: 0.14, scorch: 1 },
  sea: { coast: "#7DAA9E", mid: "#4F7BA0", deep: "#33567E", sand: "#CCA87B", swash: 0.6, bob: 0.5, lightShare: 0.35 },
  pos: {
    trench: { halfFront: 3.2, halfBack: 1.6, yFront: -9, yBack: 160, height: 0.13, width: 0.24 },
    horizonY: 160,
    sun: { x: -14, up: 0.3 },
    moon: { x: 18, up: 0.3 },
    beach: { from: 0.075, to: 0.15 },
    sea: { from: 0, to: 0.085 },
    camera: { fov: 50, height: 6, aim: 0.42 },
    relief: { lipHeight: 0.16, troughDepth: 0.22 },
    columnGap: 1.45,
    columnOffset: 0.9,
  },
});

function cloneLook(look: Readonly<BattleLook>): BattleLook {
  return JSON.parse(JSON.stringify(look)) as BattleLook;
}

/** The live look. Read fields straight off it inside the frame loop. */
export const battleLook: BattleLook = cloneLook(EUROPEAN_LOOK);
// A test aid: `?hour=6.3` starts the battle at that hour of the day.
if (typeof window !== "undefined") {
  const asked = Number(new URLSearchParams(window.location.search).get("hour"));
  if (new URLSearchParams(window.location.search).get("hour") !== null && Number.isFinite(asked)) {
    battleLook.time.hour = Math.min(24, Math.max(0, asked));
  }
}

let lookRev = 0;
const lookListeners = new Set<() => void>();

export function getBattleLookRev(): number {
  return lookRev;
}

export function subscribeBattleLook(listener: () => void): () => void {
  lookListeners.add(listener);
  return () => {
    lookListeners.delete(listener);
  };
}

function lookChanged(): void {
  lookRev += 1;
  for (const listener of [...lookListeners]) {
    listener();
  }
}

/** Sets one field by its dotted path, e.g. `sea.swash` or `pos.trench.halfFront`. A value of the wrong kind is ignored. */
export function setBattleLook(path: string, value: string | number | boolean): void {
  const keys = path.split(".");
  let node: Record<string, unknown> = battleLook as unknown as Record<string, unknown>;
  for (let i = 0; i < keys.length - 1; i++) {
    const next = node[keys[i]];
    if (!next || typeof next !== "object") {
      return;
    }
    node = next as Record<string, unknown>;
  }
  const last = keys[keys.length - 1];
  const old = node[last];
  if (typeof old !== typeof value || old === value) {
    return;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    return;
  }
  node[last] = value;
  lookChanged();
}

export function resetBattleLook(): void {
  Object.assign(battleLook, cloneLook(EUROPEAN_LOOK));
  lookChanged();
}

/** The look as the JSON the inspectors copy: the same shape as the object above. */
export function battleLookJson(): string {
  return JSON.stringify(battleLook, null, 2);
}

/** Every leaf of the look with its dotted path, in order, for the inspectors. */
export function lookLeaves(look: BattleLook = battleLook): { path: string; value: string | number | boolean }[] {
  const out: { path: string; value: string | number | boolean }[] = [];
  const walk = (node: unknown, prefix: string) => {
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${prefix}.${i}`));
    } else if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        walk(v, prefix ? `${prefix}.${k}` : k);
      }
    } else if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
      out.push({ path: prefix, value: node });
    }
  };
  walk(look, "");
  return out;
}
