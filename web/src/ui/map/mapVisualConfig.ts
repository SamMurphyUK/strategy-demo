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

  // --- The table: terrain, light, and bases. Each has a switch and its own numbers. ---

  /** Sculpted relief in Switzerland, the Himalayas, and Persia. Every other territory stays flat. */
  enableShogunMountains: boolean;
  /** The loose peak and boulder models along the world's ranges. */
  enableScatteredRocks: boolean;
  /** Height of the tallest summit, in world units. The board also holds it under two fifths of an infantry figure. */
  mountainPeakHeight: number;
  /** 0 is a smooth dome. 1 is the ridged massif. */
  mountainRidgeSharpness: number;
  /** Share of the summit's height where the snow is half on. */
  mountainSnowLine: number;
  /** Half the height the snow takes to come on, as a share of the summit. Small is a hard line. */
  mountainSnowBlend: number;
  /** How far sunlit snow goes above paper white, for the glow to spread. 0 leaves it white. */
  mountainSnowGlow: number;

  /** Fine relief on the land: flock, soil, sand, and rock grain, lit by the sun. */
  enablePbrSurface: boolean;
  /** Depth of the grain. */
  pbrNormalStrength: number;
  /** 1 is matt flock. Lower puts a satin sheen on the ground toward the sun. */
  pbrRoughness: number;
  /** World units the grain covers before it repeats. */
  pbrTilingScale: number;
  /** Saturation of the land's own colour under the grain. 1 is the printed colour. */
  terrainSaturation: number;

  enableRivers: boolean;
  /** Width of a river, in world units. */
  riverWidth: number;
  /** How much darker the middle of the channel is than its edge. */
  riverDepthShade: number;
  /** Strength of the sunlit and the shaded bank. */
  riverBankHighlight: number;

  enableRoads: boolean;
  /** Width of a road, in world units. */
  roadWidth: number;
  roadOpacity: number;
  /** 0 is bone ivory, 1 is warm parchment. */
  roadWarmth: number;

  /** The sun crosses the table. Off, it stops where it stands. */
  enableSunTransit: boolean;
  /** How fast the day passes. 1 is the shipped pace, a day in five minutes. */
  sunCycleSpeed: number;
  /** Height of the sun at either end of the day, in degrees above the table. */
  sunMinElevation: number;
  /** Height of the sun at noon, in degrees. */
  sunMaxElevation: number;
  /** 1 is the shipped amber. More warms noon as well; 0 is white light all day. */
  sunWarmthIntensity: number;
  /** Strength of the cool fill from the sky. */
  ambientFillIntensity: number;

  /** Shadows cast by the sun. Off, there is no shadow map at all. */
  enableShadows: boolean;
  /** How dark a full cast shadow is. */
  shadowOpacity: number;
  /** Width of a shadow's edge, in texels of the map. */
  shadowSoftness: number;
  /** How far off a slope the map is read, in world units. More cures stripes and loosens contact. */
  shadowNormalBias: number;

  /** The turned base under a standing figure: a dark rim, a brass ring, a faction field. */
  enableBasePlinths: boolean;
  /** Width of the rim, as a share of the base. */
  plinthRimWidth: number;
  /** 0 is polished, 1 is matt. Between, the rim carries a satin highlight. */
  plinthRoughness: number;
  /** 0 is a ring in the faction's colour, 1 is brass. */
  plinthBrassIntensity: number;
  /** A figure's shadow falls on bases only and leaves the ground clean. */
  shadowOnBasesOnly: boolean;
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
  enableShogunMountains: true,
  enableScatteredRocks: false,
  mountainPeakHeight: 1.1,
  mountainRidgeSharpness: 0.62,
  mountainSnowLine: 0.64,
  mountainSnowBlend: 0.2,
  mountainSnowGlow: 0.22,
  enablePbrSurface: true,
  pbrNormalStrength: 0.35,
  pbrRoughness: 0.82,
  pbrTilingScale: 12,
  terrainSaturation: 0.86,
  enableRivers: true,
  riverWidth: 0.62,
  riverDepthShade: 0.4,
  riverBankHighlight: 0.5,
  enableRoads: true,
  roadWidth: 0.3,
  roadOpacity: 0.6,
  roadWarmth: 0.5,
  enableSunTransit: true,
  sunCycleSpeed: 1,
  sunMinElevation: 35,
  sunMaxElevation: 65,
  sunWarmthIntensity: 1.2,
  ambientFillIntensity: 1,
  enableShadows: true,
  shadowOpacity: 0.4,
  shadowSoftness: 1.2,
  shadowNormalBias: 0.14,
  enableBasePlinths: true,
  plinthRimWidth: 0.2,
  plinthRoughness: 0.55,
  plinthBrassIntensity: 0.8,
  shadowOnBasesOnly: false,
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
  // The table as it was before the sculpted ranges: the loose peaks, the shipped arc, the flat base.
  enableShogunMountains: false,
  enableScatteredRocks: true,
  enablePbrSurface: false,
  enableRivers: false,
  enableRoads: false,
  sunCycleSpeed: 1,
  sunMinElevation: 30,
  sunMaxElevation: 62,
  sunWarmthIntensity: 1,
  ambientFillIntensity: 1,
  enableShadows: false,
  enableBasePlinths: false,
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
  mountainPeakHeight: [0, 2],
  mountainRidgeSharpness: [0, 1],
  mountainSnowLine: [0, 1],
  mountainSnowBlend: [0.02, 0.6],
  mountainSnowGlow: [0, 1],
  pbrNormalStrength: [0, 2],
  pbrRoughness: [0, 1],
  pbrTilingScale: [4, 60],
  terrainSaturation: [0, 1.4],
  riverWidth: [0.2, 2.5],
  riverDepthShade: [0, 1],
  riverBankHighlight: [0, 1],
  roadWidth: [0.1, 1.2],
  roadOpacity: [0, 1],
  roadWarmth: [0, 1],
  sunCycleSpeed: [0, 8],
  sunMinElevation: [10, 60],
  sunMaxElevation: [30, 88],
  sunWarmthIntensity: [0, 2],
  ambientFillIntensity: [0.4, 1.6],
  shadowOpacity: [0, 0.85],
  shadowSoftness: [0.3, 3],
  shadowNormalBias: [0, 0.6],
  plinthRimWidth: [0.06, 0.4],
  plinthRoughness: [0, 1],
  plinthBrassIntensity: [0, 1],
});

const FRIENDLY_STYLES: readonly FriendlyBorderStyle[] = ["subtle-dashed", "solid", "hidden"];
const FRONTLINE_STYLES: readonly FrontlineStyle[] = ["dual-ink", "classic", "hidden"];
const HIGHLIGHT_RULES: readonly HighlightRule[] = ["click-and-drag", "always-hover", "off"];
export const EFFECT_WEIGHTS: readonly EffectWeight[] = ["off", "low", "medium", "high"];
export const OUTLINE_MODES: readonly OutlineMode[] = ["units-only", "watercolor-only", "both", "off"];
export const SUN_CYCLES: readonly SunCycle[] = ["animated", "static-noon", "static-golden", "off"];

/** The words each worded setting may hold. Every other setting is a number or a switch. */
const CHOICES: Partial<Record<VisualKey, readonly string[]>> = {
  friendlyBorderStyle: FRIENDLY_STYLES,
  frontlineStyle: FRONTLINE_STYLES,
  highlightMode: HIGHLIGHT_RULES,
  aoWeight: EFFECT_WEIGHTS,
  bloomWeight: EFFECT_WEIGHTS,
  filmGrainWeight: EFFECT_WEIGHTS,
  outlineMode: OUTLINE_MODES,
  shadowQuality: EFFECT_WEIGHTS,
  envReflectionWeight: EFFECT_WEIGHTS,
  sunCycle: SUN_CYCLES,
};

/** Every setting, in the order the type lists them. */
export const VISUAL_KEYS = Object.keys(DEFAULT_VISUALS) as VisualKey[];

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
  const out: Record<string, unknown> = {};
  for (const key of VISUAL_KEYS) {
    const fallback = base[key];
    if (typeof fallback === "number") {
      out[key] = numberIn(raw[key], key, fallback);
    } else if (typeof fallback === "boolean") {
      out[key] = flag(raw[key], fallback);
    } else {
      out[key] = oneOf<string>(raw[key], CHOICES[key] ?? [fallback], fallback);
    }
  }
  return out as unknown as MapVisualConfig;
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
  return { shadows: castShadowLook(config) !== null && config.sunCycle !== "off", outline: look.line + look.wash > 0 };
}

// --- The table: terrain, light, and bases. A switch that is off gives null, and the board skips the work. ---

/** Height of an infantry figure on screen, in CSS pixels: the upright figure at its shipped scale. */
export const INFANTRY_FIGURE_PX = 24 * 1.4;
/** A summit stands no taller than this share of an infantry figure, so the ground never hides a piece. */
export const MOUNTAIN_FIGURE_SHARE = 0.4;

/** The tallest a summit may stand at a zoom, in world units. `k` is screen pixels per world unit. */
export function mountainHeightCap(k: number): number {
  return (MOUNTAIN_FIGURE_SHARE * INFANTRY_FIGURE_PX) / Math.max(k, 1e-6);
}

export interface MountainLook {
  /** Height of the tallest summit now, in world units. */
  height: number;
  sharpness: number;
  snowLine: number;
  snowBlend: number;
  snowGlow: number;
  /** How far the rock and the snow have come in: 0 from altitude, 1 on the table. */
  fade: number;
}

/**
 * The sculpted ranges at a zoom. `relief` is the zoom's share of the sun's shading (see
 * zoomDetail.ts): the ranges rise with it from a flat sheet, and from altitude there are none.
 */
export function mountainLook(config: Readonly<MapVisualConfig>, relief: number, k: number): MountainLook | null {
  const fade = Math.min(1, Math.max(0, relief));
  const height = Math.min(config.mountainPeakHeight, mountainHeightCap(k)) * fade;
  if (!config.enableShogunMountains || height <= 0.004) {
    return null;
  }
  return {
    height,
    sharpness: config.mountainRidgeSharpness,
    snowLine: config.mountainSnowLine,
    snowBlend: config.mountainSnowBlend,
    snowGlow: config.mountainSnowGlow,
    fade,
  };
}

export interface SurfaceLook {
  normal: number;
  roughness: number;
  /** World units for one repeat of the grain. */
  tiling: number;
  saturation: number;
}

export function surfaceLook(config: Readonly<MapVisualConfig>): SurfaceLook | null {
  if (!config.enablePbrSurface) {
    return null;
  }
  return { normal: config.pbrNormalStrength, roughness: config.pbrRoughness, tiling: config.pbrTilingScale, saturation: config.terrainSaturation };
}

export function riverLook(config: Readonly<MapVisualConfig>): { halfWidth: number; depth: number; bank: number } | null {
  return config.enableRivers ? { halfWidth: config.riverWidth / 2, depth: config.riverDepthShade, bank: config.riverBankHighlight } : null;
}

/**
 * The roads at a zoom. They are a detail of the table: over the fitted board there are none, and
 * they come in over the first fifth of the way down.
 */
export function roadLook(config: Readonly<MapVisualConfig>, closeness: number): { halfWidth: number; opacity: number; warmth: number } | null {
  const opacity = config.roadOpacity * smooth((closeness - 0.03) / 0.19);
  if (!config.enableRoads || opacity <= 0.004) {
    return null;
  }
  return { halfWidth: config.roadWidth / 2, opacity, warmth: config.roadWarmth };
}

/** The opacity the shipped shadow tint was drawn for. */
export const SHADOW_OPACITY_UNIT = 0.36;

export interface CastShadowLook {
  /** Side of the shadow map, in texels. */
  size: number;
  /** Depth of the shadow against the shipped tint. 1 is the tint as it was painted. */
  depth: number;
  softness: number;
  normalBias: number;
  /** Figures shade bases and nothing else. */
  basesOnly: boolean;
}

export function castShadowLook(config: Readonly<MapVisualConfig>): CastShadowLook | null {
  const size = shadowMapSize(config.shadowQuality);
  if (!config.enableShadows || size <= 0) {
    return null;
  }
  return {
    size,
    depth: config.shadowOpacity / SHADOW_OPACITY_UNIT,
    softness: config.shadowSoftness,
    normalBias: config.shadowNormalBias,
    basesOnly: config.shadowOnBasesOnly,
  };
}

/** The sun's arc and colour as the numbers sun.ts takes. The noon height is never under the dawn height. */
export function sunArcOf(config: Readonly<MapVisualConfig>): { minElevation: number; maxElevation: number; warmth: number; fill: number } {
  return {
    minElevation: config.sunMinElevation,
    maxElevation: Math.max(config.sunMinElevation, config.sunMaxElevation),
    warmth: config.sunWarmthIntensity,
    fill: config.ambientFillIntensity,
  };
}

/** Seconds of the sun's day that pass in one second. 0 is a sun that holds still. */
export function sunPace(config: Readonly<MapVisualConfig>): number {
  return config.enableSunTransit ? config.sunCycleSpeed : 0;
}

export interface PlinthLook {
  /** Width of the dark rim, as a share of the base's radius. */
  rim: number;
  /** Opacity of the satin highlight on the rim. */
  sheen: number;
  /** How much of the rim's arc the highlight covers, in radians. A matt rim spreads it wide and faint. */
  sheenArc: number;
  /** 0 is a ring in the faction's colour, 1 is brass. */
  brass: number;
}

export function plinthLook(config: Readonly<MapVisualConfig>): PlinthLook | null {
  if (!config.enableBasePlinths) {
    return null;
  }
  const rough = Math.min(1, Math.max(0, config.plinthRoughness));
  return {
    rim: config.plinthRimWidth,
    sheen: 0.62 * (1 - rough) ** 0.8,
    sheenArc: 0.35 + 1.25 * rough,
    brass: config.plinthBrassIntensity,
  };
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
