// Live picture settings for the campaign board. Pure: the store holds the copy the map reads.
//
// The ground's foreshortening is a straight line between two zooms. Below `start` the vertical
// squash is `far`. Above `end` it is `near`. 0 is a flat map. 0.15 is the shipped tip, which
// pitches the camera about 32° from overhead.
import type { FactionKey } from "../theme/factionPalette";
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

const FACTION_KEYS: readonly FactionKey[] = ["US", "UK", "GER", "JAP", "USSR", "NEUTRAL"];

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

/** How much world Y shortens at this zoom. 0 is flat. */
export function groundSquash(zoom: number, curve: TiltCurve): number {
  const share = zoomShare(zoom, curve.start, curve.end);
  const squash = curve.far + (curve.near - curve.far) * share;
  return Math.min(0.8, Math.max(0, squash));
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
