// Live picture settings for the campaign board. Pure: the store holds the copy the map reads.
//
// The ground's foreshortening is a straight line between two zooms. Below `start` the vertical
// squash is `far`. Above `end` it is `near`. 0 is a flat map. 0.15 is the shipped tip, which
// pitches the camera about 32° from overhead.
import type { FactionKey } from "../theme/factionPalette";
import { mapVisuals } from "./mapVisualConfig";
import { resolveFaction } from "../theme/factionPalette";
import { MILITARY } from "../theme/militaryPalette";
import { FACTION_TINT } from "./mapStyle";
import type { BoardDetail } from "../viewport3d/zoomDetail";

export interface TiltCurve {
  /** Zoom at which the line leaves the far squash. Flat in the sense of "no further change" below this. */
  start: number;
  /** Zoom at which the line arrives at the near squash. */
  end: number;
  /** Vertical squash at and below `start`. 0 is flat. */
  far: number;
  /** Vertical squash at and above `end`. */
  near: number;
}

/** How far a figure tips away from the screen, in degrees, across the same kind of line. */
export interface UnitPitchCurve {
  start: number;
  end: number;
  /** Degrees when zoomed out. 0 faces the screen. */
  far: number;
  /** Degrees when zoomed in. */
  near: number;
}

export interface Knob {
  on: boolean;
  /** Strength while `on` is set. 0 to 1. */
  amount: number;
}

export type LandPalette = "strip" | "parchment";
export type BorderSet = "current" | "previous";
export type LookName = "current" | "vanilla" | "custom";

export interface BoardTune {
  look: LookName;
  tilt: TiltCurve;
  unit: UnitPitchCurve;
  /** Closeness where trees and mountains start. 0 is the fitted map, 1 is the closest zoom. */
  terrainFrom: number;
  terrainTo: number;
  props: Knob;
  relief: Knob;
  water: Knob;
  smoke: Knob;
  vignette: Knob;
  focus: Knob;
  /** While set, saturation follows the zoom. Otherwise `saturation` is a fixed grade. */
  gradeZoom: boolean;
  saturation: number;
  /** While set, the warm grade follows the close-zoom ramp. */
  warmZoom: boolean;
  warm: number;
  palette: LandPalette;
  /** A picked colour wins over the palette for that faction. */
  colors: Partial<Record<FactionKey, string>>;
  borders: BorderSet;
  /** The old territory ink, charcoal or sepia, over every border two lands share. */
  territoryLines: boolean;
  /** The old wide band along a border between factions at war. */
  enemyBand: boolean;
}

/** The shipped tip: no squash below 1.15, 15% by 2.2. */
export const SHIPPED_TILT: TiltCurve = { start: 1.15, end: 2.2, far: 0, near: 0.15 };
/** Figures face the screen at every zoom until a slider moves. */
export const SHIPPED_UNIT: UnitPitchCurve = { start: 1.15, end: 2.2, far: 0, near: 0 };

/**
 * Trees, mountains and buildings wait for the close zoom. 0.7 is past the upright-sprite handoff
 * on a normal window; 0.94 is full before the closest stop.
 */
export const TERRAIN_FROM = 0.7;
export const TERRAIN_TO = 0.94;

/** Faction land from the 16-colour strip. This is the map as it stands. */
export const STRIP_LAND: Record<FactionKey, string> = {
  JAP: MILITARY.terracotta,
  USSR: MILITARY.crimson,
  GER: MILITARY.feldgrau,
  ITA: MILITARY.spruce,
  CHI: MILITARY.brass,
  ANZ: MILITARY.brown,
  FRA: MILITARY.steel,
  UK: MILITARY.khaki,
  US: MILITARY.olive,
  NEUTRAL: MILITARY.bone,
};

export interface BorderPass {
  color: string;
  width: number;
}

/** The charcoal territory line the bake paints now. */
export const CURRENT_BORDERS: readonly BorderPass[] = [
  { color: "rgba(100, 83, 85, 0.28)", width: 4 },
  { color: MILITARY.charcoal, width: 1.2 },
];

/** The sepia line from before the strip colours. */
export const PREVIOUS_BORDERS: readonly BorderPass[] = [
  { color: "rgba(45, 38, 28, 0.25)", width: 4 },
  { color: "#2B2620", width: 1.2 },
];

const FACTION_KEYS: readonly FactionKey[] = ["US", "UK", "GER", "JAP", "USSR", "ITA", "CHI", "ANZ", "FRA", "NEUTRAL"];

function knob(on = true, amount = 1): Knob {
  return { on, amount };
}

export function currentTune(): BoardTune {
  return {
    look: "current",
    tilt: { ...SHIPPED_TILT },
    unit: { ...SHIPPED_UNIT },
    terrainFrom: TERRAIN_FROM,
    terrainTo: TERRAIN_TO,
    props: knob(),
    relief: knob(),
    water: knob(),
    smoke: knob(),
    vignette: knob(),
    focus: knob(),
    gradeZoom: true,
    saturation: 0.86,
    warmZoom: true,
    warm: 0,
    palette: "strip",
    colors: {},
    borders: "current",
    territoryLines: false,
    enemyBand: false,
  };
}

/**
 * The plain board: desaturated land, no trees, mountains, smoke, lens or vignette, and the
 * previous parchment tints and sepia borders. The camera curve stays where it was.
 */
export function vanillaTune(): BoardTune {
  return {
    ...currentTune(),
    look: "vanilla",
    props: knob(false),
    relief: knob(false),
    water: knob(false),
    smoke: knob(false),
    vignette: knob(false),
    focus: knob(false),
    gradeZoom: false,
    saturation: 0.62,
    warmZoom: false,
    warm: 0,
    palette: "parchment",
    colors: {},
    borders: "previous",
    terrainFrom: 1,
    terrainTo: 1,
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** 0 at and below `start`, 1 at and above `end`. */
export function zoomShare(zoom: number, start: number, end: number): number {
  if (!(end > start)) {
    return zoom >= end ? 1 : 0;
  }
  if (zoom >= end) {
    return 1;
  }
  if (zoom <= start) {
    return 0;
  }
  return (zoom - start) / (end - start);
}

function smooth(from: number, to: number, value: number): number {
  const t = clamp01((value - from) / (to - from || 1));
  return t * t * (3 - 2 * t);
}

// --- The camera's distance, and the tiers it makes ----------------------------------------------------------------------
//
// The board's camera is orthographic, so it has a zoom (`k`, screen pixels per world unit) and no true distance. The notes speak
// in a distance, and a distance is what this gives them: d = DISTANCE_K / k, chosen so the diorama cross-fade, which runs over
// zoom 3.8 to 4.3, runs over distance 4.3 to 3.8 exactly. Every tier below is a distance, and `k` is what the camera holds.
//
//   strategic   d > 14        pure pixel chart: no diorama, no micro
//   icon        7.5 to 14     stepped relief, icon readability
//   diorama     3.8 to 7.5    the diorama surface comes in over 4.3 to 3.8
//   micro       1.35 to 3.8   uMicroAlpha runs 0 to 1 over 3.6 to 2.4; the camera never goes nearer than 1.35

/** 3.8 times 4.3: the zoom of the diorama's start times the zoom of its finish. */
export const DISTANCE_K = 3.8 * 4.3;
/** Distance of the camera for a zoom. */
export function cameraDistance(k: number): number {
  return DISTANCE_K / Math.max(k, 1e-6);
}
/** The zoom for a distance. */
export function zoomForDistance(distance: number): number {
  return DISTANCE_K / Math.max(distance, 1e-6);
}
/** Where the tiers begin, as distances. */
export const TIER_STRATEGIC = 14;
export const TIER_ICON = 7.5;
export const TIER_DIORAMA = 3.8;
/** uMicroAlpha is 0 at the first and 1 at the second. */
export const MICRO_ALPHA_FROM = 3.6;
export const MICRO_ALPHA_TO = 2.4;
/** The camera dives to the low pitch over this stretch of distance. */
const MICRO_PITCH_FROM = 3.6;
const MICRO_PITCH_TO = 2.1;

export type CameraTier = "strategic" | "icon" | "diorama" | "micro";

export function cameraTier(k: number): CameraTier {
  const d = cameraDistance(k);
  return d > TIER_STRATEGIC ? "strategic" : d > TIER_ICON ? "icon" : d > TIER_DIORAMA ? "diorama" : "micro";
}

/** 0 up to the first distance, 1 from the second, an ease between. Distances fall as the camera nears. */
function nearShare(distance: number, from: number, to: number): number {
  const t = clamp01((from - distance) / (from - to));
  return t * t * (3 - 2 * t);
}

/** The cliffs' own shade is off at the chart's zoom, and comes in slowly over this stretch of the close zoom. */
export const CLIFF_SHADE_FROM = 3.4;
export const CLIFF_SHADE_TO = 8;

export function cliffShadeFade(k: number): number {
  const t = clamp01((k - CLIFF_SHADE_FROM) / (CLIFF_SHADE_TO - CLIFF_SHADE_FROM));
  return t * t * (3 - 2 * t);
}

/** The zoom the facility badges begin to fade at (the sprites' arrival), and where they are gone. */
export const FACILITY_FADE_FROM = 3.8;
export const FACILITY_FADE_TO = 7.0;

/** How much of the factory, harbor and airfield badges is left at a zoom: whole up to the sprites' arrival, then a slow fade to nothing. */
export function facilityBadgeAlpha(k: number): number {
  const t = clamp01((k - FACILITY_FADE_FROM) / (FACILITY_FADE_TO - FACILITY_FADE_FROM));
  return 1 - t * t * (3 - 2 * t);
}

/**
 * The facility badge's split at a zoom. `split` runs 0 to 1 from `from` to `end` and is how far its triangles have drifted
 * apart; `alpha` holds at 1 through the first of it, then fades to nothing at `end`, a little before the closest zoom.
 */
export function facilitySplit(k: number, from: number, end: number): { split: number; alpha: number } {
  const t = clamp01((k - from) / Math.max(0.05, end - from));
  const split = t * t * (3 - 2 * t);
  const fade = clamp01((t - 0.3) / 0.7);
  return { split, alpha: 1 - fade * fade * (3 - 2 * fade) };
}

/** How much of the territory numerals and capital marks is left at a zoom: whole up to `from`, gone at `to`. */
export function emblemAlpha(k: number, from: number, to: number): number {
  const t = clamp01((k - from) / Math.max(0.05, to - from));
  return 1 - t * t * (3 - 2 * t);
}

/** uMicroAlpha at a zoom: 0 outside the micro tier, 1 close in. */
export function microAlpha(k: number): number {
  return nearShare(cameraDistance(k), MICRO_ALPHA_FROM, MICRO_ALPHA_TO);
}

/** Degrees above the horizon the camera looks from at a zoom, with the micro dive. Overhead is 90. */
export function elevationDegrees(zoom: number, curve: TiltCurve): number {
  return 90 - pitchDegrees(1 - groundSquash(zoom, curve));
}

/** How much world Y shortens at this zoom. 0 is flat. The micro dive takes it on to the low diorama angle. */
export function groundSquash(zoom: number, curve: TiltCurve): number {
  const share = zoomShare(zoom, curve.start, curve.end);
  const base = curve.far + (curve.near - curve.far) * share;
  // A squash of 1 - sin(elevation) is a camera that high above the horizon.
  const low = 1 - Math.sin((mapVisuals.microPitchDeg * Math.PI) / 180);
  const dive = nearShare(cameraDistance(zoom), MICRO_PITCH_FROM, MICRO_PITCH_TO);
  const squash = dive > 0 ? base + (Math.max(base, low) - base) * dive : base;
  return Math.min(0.8, Math.max(0, squash));
}

/** The figure's extra backward lean in the micro tier: a cosine foreshortening, 1 with no lean. */
export function microSpriteLean(zoom: number): number {
  return Math.cos((mapVisuals.microSpriteTiltDeg * microAlpha(zoom) * Math.PI) / 180);
}

/** `sy / sx` for the ground. 1 is flat. */
export function groundRatio(zoom: number, curve: TiltCurve): number {
  return 1 - groundSquash(zoom, curve);
}

/** Camera pitch from overhead, in degrees, for a ground ratio. */
export function pitchDegrees(ratio: number): number {
  const cos = Math.min(1, Math.max(0, ratio));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Degrees the figure tips at this zoom. */
export function unitTipDegrees(zoom: number, tune: BoardTune): number {
  const share = zoomShare(zoom, tune.unit.start, tune.unit.end);
  return tune.unit.far + (tune.unit.near - tune.unit.far) * share;
}

/**
 * Height of a figure relative to a screen-facing drawing. 1 faces the screen. The feet stay put
 * and the head comes down as the angle grows.
 */
export function unitLean(zoom: number, tune: BoardTune): number {
  const radians = (unitTipDegrees(zoom, tune) * Math.PI) / 180;
  return Math.min(1, Math.max(0.45, Math.cos(radians)));
}

/** The detail the board draws after the toggles and the terrain gate. */
export function tunedBoard(detail: BoardDetail, tune: BoardTune): BoardDetail {
  const gain = (item: Knob) => (item.on ? clamp01(item.amount) : 0);
  const terrain = smooth(tune.terrainFrom, tune.terrainTo, detail.closeness);
  return {
    ...detail,
    props: terrain * gain(tune.props),
    relief: detail.relief * gain(tune.relief),
    water: detail.water * gain(tune.water),
    smoke: detail.smoke * gain(tune.smoke),
    vignette: detail.vignette * gain(tune.vignette),
    focus: detail.focus * gain(tune.focus),
  };
}

export function gradeSaturation(closeness: number, tune: BoardTune): number {
  if (tune.gradeZoom) {
    return 0.88 - 0.05 * closeness;
  }
  return Math.min(1.2, Math.max(0, tune.saturation));
}

export function gradeWarm(focus: number, dusk: boolean, tune: BoardTune): number {
  if (tune.warmZoom) {
    return dusk ? 0 : focus;
  }
  return Math.min(1, Math.max(0, tune.warm));
}

export function landColor(owner: string, tune: BoardTune): string {
  const key = resolveFaction(owner);
  const picked = tune.colors[key];
  if (picked) {
    return picked;
  }
  return tune.palette === "parchment" ? FACTION_TINT[key] : STRIP_LAND[key];
}

export function borderPasses(tune: BoardTune): readonly BorderPass[] {
  return tune.borders === "previous" ? PREVIOUS_BORDERS : CURRENT_BORDERS;
}

/** Changes when the baked land colours or borders change, so the sheet is painted again. */
export function paintSignature(tune: BoardTune): string {
  const colors = FACTION_KEYS.map((key) => `${key}:${landColor(key, tune)}`).join(",");
  const borders = borderPasses(tune).map((pass) => pass.color).join(",");
  return `${tune.palette}|${tune.borders}|${colors}|${borders}`;
}
