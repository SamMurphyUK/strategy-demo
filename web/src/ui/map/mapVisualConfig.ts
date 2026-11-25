// Live art settings for the Shogun board (../viewport3d/shogun), and the store that holds them.
//
// `mapVisuals` is one plain object, changed in place. The board reads its fields inside the frame
// loop and writes them to shader uniforms, post-pass numbers, and `visible` flags, so a slider
// costs a frame and nothing else: no React render of the board, no new geometry. The tuning drawer
// is the only React reader, and it subscribes for itself.
//
// No Three.js and no DOM here, so the 2D map and the tests can read it.

export type FriendlyBorderStyle = "subtle-dashed" | "solid" | "hidden";
export type FrontlineStyle = "dual-ink" | "classic" | "hidden";
export type HighlightRule = "click-and-drag" | "always-hover" | "off";
/** How much of an effect the board draws. "off" costs nothing: no pass, no buffer, no shader branch. */
export type EffectWeight = "off" | "low" | "medium" | "high";
/** What marks a picked-up or pointed-at stack: an ink line round its figures, a pigment wash, both, or nothing. */
export type OutlineMode = "units-only" | "watercolor-only" | "both" | "off";
/** The sun: crossing the table, held at noon, held at the warm end of the afternoon, or out. */
export type SunCycle = "animated" | "static-noon" | "static-golden" | "off";

export interface MapVisualConfig {
  /** Share of the faction colour over the natural ground at the closest zoom. */
  factionWashClose: number;
  /** The same share at the fitted board. */
  factionWashFar: number;
  /** Paper tooth and contour lines on the land. 0 is smooth. */
  terrainGrainStrength: number;
  /** The line between two territories of one faction. */
  friendlyBorderStyle: FriendlyBorderStyle;
  /** The line between two factions at war. */
  frontlineStyle: FrontlineStyle;
  /** When a territory wears the watercolour edge. */
  highlightMode: HighlightRule;
  watercolorIntensity: number;
  /** How strongly every legal destination shows while a stack is picked up. 0 shows the hovered one only. */
  legalHintStrength: number;
  /** Trees, mountains, and buildings. */
  showBiomeProps: boolean;
  /** Battle smoke and chimney smoke. */
  showBattleSmoke: boolean;
  /** Opacity of the thickest part of a puff. */
  smokeOpacity: number;
  /** Swell, surf, foam, and glints. */
  showCoastalWaves: boolean;
  enableDoF: boolean;
  /** Blur at the screen's far edge. 1 is the full lens; the shipped look pulls it back to 0.6. */
  bokehIntensity: number;
  /** Where the sun stands while it does not sweep, in degrees east of north. */
  sunAzimuth: number;
  /** The sun crosses the table through the day. */
  sunSweep: boolean;
  /** Dark edge around the pieces. */
  unitRim: number;
  /** Opacity of the shadow under a piece. */
  contactShadow: number;
  /** Shade where a cliff meets the sea and where a mountain or a building meets the ground. */
  aoWeight: EffectWeight;
  /** Glow round embers and sun glitter. Nothing at or below paper white glows. */
  bloomWeight: EffectWeight;
  /** Paper tooth over the finished picture, strongest at the strategic zoom. */
  filmGrainWeight: EffectWeight;
  outlineMode: OutlineMode;
  /** Shadows cast by cliffs, mountains, buildings, and standing figures. The weight is the map's size. */
  shadowQuality: EffectWeight;
  /** Sky on the sea: a sheen on the swell and a glitter path under the sun. */
  envReflectionWeight: EffectWeight;
  sunCycle: SunCycle;
}

export type VisualKey = keyof MapVisualConfig;

/** The Shogun look: natural ground, a light faction wash close in, ink borders, a watercolour selection. */
export const DEFAULT_VISUALS: Readonly<MapVisualConfig> = Object.freeze({
  factionWashClose: 0.15,
  factionWashFar: 0.5,
  terrainGrainStrength: 0.6,
  friendlyBorderStyle: "subtle-dashed",
  frontlineStyle: "dual-ink",
  highlightMode: "click-and-drag",
  watercolorIntensity: 1,
  legalHintStrength: 0.35,
  showBiomeProps: true,
  showBattleSmoke: true,
  smokeOpacity: 0.22,
  showCoastalWaves: true,
  enableDoF: true,
  bokehIntensity: 0.6,
  sunAzimuth: 28,
  sunSweep: true,
  unitRim: 0.5,
  contactShadow: 0.32,
  aoWeight: "medium",
  bloomWeight: "low",
  filmGrainWeight: "low",
  outlineMode: "units-only",
  shadowQuality: "medium",
  envReflectionWeight: "medium",
  sunCycle: "animated",
});

/** Solid faction land, full borders, the banded frontline, hover marks, and the full lens. */
export const SOLID_VISUALS: Readonly<MapVisualConfig> = Object.freeze({
  ...DEFAULT_VISUALS,
  factionWashClose: 1,
  factionWashFar: 1,
  terrainGrainStrength: 0,
  friendlyBorderStyle: "solid",
  frontlineStyle: "classic",
  highlightMode: "always-hover",
  legalHintStrength: 1,
  smokeOpacity: 0.6,
  bokehIntensity: 1,
  unitRim: 0,
  contactShadow: 0.2,
});

/** Solid land with nothing standing or moving on it. */
export const PLAIN_VISUALS: Readonly<MapVisualConfig> = Object.freeze({
  ...SOLID_VISUALS,
  showBiomeProps: false,
  showBattleSmoke: false,
  showCoastalWaves: false,
  enableDoF: false,
  sunSweep: false,
  aoWeight: "off",
  bloomWeight: "off",
  filmGrainWeight: "off",
  outlineMode: "off",
  shadowQuality: "off",
  envReflectionWeight: "off",
});

export const VISUAL_PRESETS = {
  shogun: DEFAULT_VISUALS,
  solid: SOLID_VISUALS,
  plain: PLAIN_VISUALS,
} as const;

export type VisualPresetName = keyof typeof VISUAL_PRESETS;

/** Slider ends. The sun stays inside the part of the day that casts shadows. */
export const VISUAL_RANGES: Readonly<Record<string, readonly [number, number]>> = Object.freeze({
  factionWashClose: [0, 1],
  factionWashFar: [0, 1],
  terrainGrainStrength: [0, 2],
  watercolorIntensity: [0, 2],
  legalHintStrength: [0, 1],
  smokeOpacity: [0, 0.6],
  bokehIntensity: [0, 1.5],
  sunAzimuth: [-50, 50],
  unitRim: [0, 1],
  contactShadow: [0, 0.6],
});

const FRIENDLY_STYLES: readonly FriendlyBorderStyle[] = ["subtle-dashed", "solid", "hidden"];
const FRONTLINE_STYLES: readonly FrontlineStyle[] = ["dual-ink", "classic", "hidden"];
const HIGHLIGHT_RULES: readonly HighlightRule[] = ["click-and-drag", "always-hover", "off"];
export const EFFECT_WEIGHTS: readonly EffectWeight[] = ["off", "low", "medium", "high"];
export const OUTLINE_MODES: readonly OutlineMode[] = ["units-only", "watercolor-only", "both", "off"];
export const SUN_CYCLES: readonly SunCycle[] = ["animated", "static-noon", "static-golden", "off"];

function numberIn(value: unknown, key: string, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  const [low, high] = VISUAL_RANGES[key] ?? [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY];
  return Math.min(high, Math.max(low, value));
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

/** A whole config from anything: a stored object, a pasted preset, or nothing. Gaps take `base`. */
export function parseVisuals(value: unknown, base: Readonly<MapVisualConfig> = DEFAULT_VISUALS): MapVisualConfig {
  const raw = (value && typeof value === "object" ? value : {}) as Partial<Record<VisualKey, unknown>>;
  return {
    factionWashClose: numberIn(raw.factionWashClose, "factionWashClose", base.factionWashClose),
    factionWashFar: numberIn(raw.factionWashFar, "factionWashFar", base.factionWashFar),
    terrainGrainStrength: numberIn(raw.terrainGrainStrength, "terrainGrainStrength", base.terrainGrainStrength),
    friendlyBorderStyle: oneOf(raw.friendlyBorderStyle, FRIENDLY_STYLES, base.friendlyBorderStyle),
    frontlineStyle: oneOf(raw.frontlineStyle, FRONTLINE_STYLES, base.frontlineStyle),
    highlightMode: oneOf(raw.highlightMode, HIGHLIGHT_RULES, base.highlightMode),
    watercolorIntensity: numberIn(raw.watercolorIntensity, "watercolorIntensity", base.watercolorIntensity),
    legalHintStrength: numberIn(raw.legalHintStrength, "legalHintStrength", base.legalHintStrength),
    showBiomeProps: flag(raw.showBiomeProps, base.showBiomeProps),
    showBattleSmoke: flag(raw.showBattleSmoke, base.showBattleSmoke),
    smokeOpacity: numberIn(raw.smokeOpacity, "smokeOpacity", base.smokeOpacity),
    showCoastalWaves: flag(raw.showCoastalWaves, base.showCoastalWaves),
    enableDoF: flag(raw.enableDoF, base.enableDoF),
    bokehIntensity: numberIn(raw.bokehIntensity, "bokehIntensity", base.bokehIntensity),
    sunAzimuth: numberIn(raw.sunAzimuth, "sunAzimuth", base.sunAzimuth),
    sunSweep: flag(raw.sunSweep, base.sunSweep),
    unitRim: numberIn(raw.unitRim, "unitRim", base.unitRim),
    contactShadow: numberIn(raw.contactShadow, "contactShadow", base.contactShadow),
    aoWeight: oneOf(raw.aoWeight, EFFECT_WEIGHTS, base.aoWeight),
    bloomWeight: oneOf(raw.bloomWeight, EFFECT_WEIGHTS, base.bloomWeight),
    filmGrainWeight: oneOf(raw.filmGrainWeight, EFFECT_WEIGHTS, base.filmGrainWeight),
    outlineMode: oneOf(raw.outlineMode, OUTLINE_MODES, base.outlineMode),
    shadowQuality: oneOf(raw.shadowQuality, EFFECT_WEIGHTS, base.shadowQuality),
    envReflectionWeight: oneOf(raw.envReflectionWeight, EFFECT_WEIGHTS, base.envReflectionWeight),
    sunCycle: oneOf(raw.sunCycle, SUN_CYCLES, base.sunCycle),
  };
}

/** The config as the text the drawer copies: every key, in the order the type lists them. */
export function visualPresetJson(config: Readonly<MapVisualConfig>): string {
  return JSON.stringify(parseVisuals(config), null, 2);
}

/** The preset a config equals, or "custom". */
export function visualPresetOf(config: Readonly<MapVisualConfig>): VisualPresetName | "custom" {
  const text = visualPresetJson(config);
  for (const name of Object.keys(VISUAL_PRESETS) as VisualPresetName[]) {
    if (visualPresetJson(VISUAL_PRESETS[name]) === text) {
      return name;
    }
  }
  return "custom";
}

// --- Numbers the board derives from the config. Pure. -------------------------------------------

function smooth(value: number): number {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

/**
 * Share of the faction colour over the ground. `closeness` is 0 at the fitted board and 1 at the
 * closest zoom (see shogunDetail.ts). The wash eases from the far share to the close one.
 */
export function factionWash(closeness: number, config: Readonly<MapVisualConfig>): number {
  const near = smooth(closeness);
  return config.factionWashFar + (config.factionWashClose - config.factionWashFar) * near;
}

/** Ink opacity of the dashed and the solid friendly line for a style. */
export function friendlyBorderInk(style: FriendlyBorderStyle): { dashed: number; solid: number } {
  if (style === "subtle-dashed") {
    return { dashed: 0.25, solid: 0 };
  }
  return style === "solid" ? { dashed: 0, solid: 0.9 } : { dashed: 0, solid: 0 };
}

/** Which frontline drawing is on: 1 or 0 each. Both 0 leaves an ordinary border. */
export function frontlineInk(style: FrontlineStyle): { dual: number; classic: number } {
  return { dual: style === "dual-ink" ? 1 : 0, classic: style === "classic" ? 1 : 0 };
}

/** Lens strength for a zoom's focus share. 0 at altitude, and 0 with the lens off. */
export function bokehShare(focus: number, config: Readonly<MapVisualConfig>): number {
  return config.enableDoF ? Math.max(0, focus) * config.bokehIntensity : 0;
}

// --- Light and lens. Each weight is a row of numbers; "off" is null, and the board skips the work. ---

export interface AoLook {
  /** How dark the deepest crevice goes. 1 is the full ink. */
  strength: number;
  /** Depth taps for each pixel. */
  samples: number;
  /** Size of the shade buffer against the frame: 0.5 is a quarter of the pixels. */
  scale: number;
  /** Reach of the shade, in world units. A cliff is seven tall. */
  radius: number;
}

export function aoLook(weight: EffectWeight): AoLook | null {
  if (weight === "low") {
    return { strength: 0.45, samples: 6, scale: 0.5, radius: 2 };
  }
  if (weight === "medium") {
    return { strength: 0.62, samples: 10, scale: 0.5, radius: 2.4 };
  }
  return weight === "high" ? { strength: 0.8, samples: 16, scale: 1, radius: 2.8 } : null;
}

export interface BloomLook {
  /** Share of the glow added back to the picture. */
  strength: number;
  /** Halvings of the glow buffer. More spreads it wider. */
  levels: number;
}

/** Light above this glows. Paper white is 1, so the land, the sea, and the pieces stay as painted. */
export const BLOOM_THRESHOLD = 1.05;

export function bloomLook(weight: EffectWeight): BloomLook | null {
  if (weight === "low") {
    return { strength: 0.55, levels: 3 };
  }
  if (weight === "medium") {
    return { strength: 0.85, levels: 4 };
  }
  return weight === "high" ? { strength: 1.2, levels: 5 } : null;
}

const GRAIN_AMOUNT: Readonly<Record<EffectWeight, number>> = { off: 0, low: 0.028, medium: 0.046, high: 0.07 };

/**
 * Depth of the paper tooth, as a share of full brightness. It is deepest over the fitted board,
 * where the picture is a printed sheet, and eases to two thirds on the table, where it would dirty
 * the figures.
 */
export function grainAmount(weight: EffectWeight, closeness: number): number {
  const near = smooth(closeness);
  return GRAIN_AMOUNT[weight] * (1 - near / 3);
}

/** What the outline pass draws round a stack. Both 0 is no pass. */
export function outlineLook(mode: OutlineMode): { line: number; wash: number } {
  return {
    line: mode === "units-only" || mode === "both" ? 1 : 0,
    wash: mode === "watercolor-only" || mode === "both" ? 1 : 0,
  };
}

const SHADOW_MAP_SIZE: Readonly<Record<EffectWeight, number>> = { off: 0, low: 1024, medium: 2048, high: 4096 };

/** Side of the sun's shadow map, in texels. 0 is no map. */
export function shadowMapSize(quality: EffectWeight): number {
  return SHADOW_MAP_SIZE[quality];
}

const SKY_SHEEN: Readonly<Record<EffectWeight, number>> = { off: 0, low: 0.4, medium: 0.7, high: 1 };

/** Share of the sky the sea shows. 1 is the full sheen. */
export function skySheen(weight: EffectWeight): number {
  return SKY_SHEEN[weight];
}

/** True when the board needs the standing figures on their own canvas: to cast them, or to line them. */
export function wantsFigureCards(config: Readonly<MapVisualConfig>): { shadows: boolean; outline: boolean } {
  const look = outlineLook(config.outlineMode);
  return { shadows: config.shadowQuality !== "off" && config.sunCycle !== "off", outline: look.line + look.wash > 0 };
}

// --- The store ----------------------------------------------------------------------------------

export const MAP_VISUALS_STORAGE_KEY = "strategy-demo.map-visuals";

interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function storage(): Storage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

function readStored(): MapVisualConfig {
  try {
    const raw = storage()?.getItem(MAP_VISUALS_STORAGE_KEY);
    return raw ? parseVisuals(JSON.parse(raw)) : parseVisuals(null);
  } catch {
    return parseVisuals(null);
  }
}

/** The live settings. Read fields straight off it; change them through the setters below. */
export const mapVisuals: MapVisualConfig = readStored();

let rev = 0;
const listeners = new Set<() => void>();

function publish(save: boolean): void {
  rev += 1;
  try {
    if (save) {
      storage()?.setItem(MAP_VISUALS_STORAGE_KEY, JSON.stringify(mapVisuals));
    } else {
      storage()?.removeItem(MAP_VISUALS_STORAGE_KEY);
    }
  } catch {
    // The page still has the new values.
  }
  for (const listener of [...listeners]) {
    listener();
  }
}

export function getVisualRev(): number {
  return rev;
}

export function subscribeVisuals(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setVisual<K extends VisualKey>(key: K, value: MapVisualConfig[K]): void {
  const next = parseVisuals({ ...mapVisuals, [key]: value }, mapVisuals);
  if (next[key] === mapVisuals[key]) {
    return;
  }
  mapVisuals[key] = next[key];
  publish(true);
}

/** Replaces every setting: a preset, or a pasted one. */
export function applyVisuals(value: unknown): void {
  Object.assign(mapVisuals, parseVisuals(value));
  publish(true);
}

/** Back to the shipped look, and the stored copy is dropped. */
export function resetVisuals(): void {
  Object.assign(mapVisuals, parseVisuals(null));
  publish(false);
}
