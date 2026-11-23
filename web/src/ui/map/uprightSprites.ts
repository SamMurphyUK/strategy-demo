// Upright side-profile sprites for LoD 2. Same palette, standing poses and faction cues as the
// battle screen, drawn at integer pixels with smoothing off, feet on the plinth centre. Guns point
// right. A stack turns on an eight-way bearing toward the nearer hostile territory, and mirrors
// rather than rolling upside down when that bearing is to the left.
import { factionPalette } from "../theme/factionPalette";
import {
  rosterCues,
  type BomberCue,
  type FighterCue,
  type GunCue,
  type Helmet,
  type RosterCues,
  type ShipCue,
  type SubCue,
  type TankCue,
} from "../theme/factionRoster";
import { MILITARY } from "../theme/militaryPalette";
import { drawHoldCircles } from "./shipHold";
import { hasQuickUnit, infantryIdlePhase, INFANTRY_IDLE_TICK_SECONDS, QUICK_TICK_SECONDS } from "../../art/quickUnitDraw";
import { quickFrameUrl, resolveQuickClip } from "../../art/quickUnitCatalog";
import type { VehicleSvgUnit } from "../../art/fieldVehicleStage";
import { quickSvgFigure } from "../../art/quickSvgFigure";
import { bakeUnitSprite, SPRITE_BAKE } from "./figureGround";
import type { Rect, Vec2 } from "./geometry";
import { SELECTED_COLOR } from "./mapStyle";
import { anchorSpan, wrapWorldX } from "./viewMath";
import { squadOffsets } from "./zoomLod";
import { landShareOf, seaLandOpacity, spriteScreenBox } from "./seaOverlap";

const CHARCOAL = MILITARY.charcoal;
const STEEL = MILITARY.steel;
const SPRUCE = MILITARY.spruce;
const TAUPE = MILITARY.taupe;
const CREAM = MILITARY.cream;
const BROWN = MILITARY.brown;
const LEATHER = MILITARY.khaki;
const BRASS = MILITARY.brass;
const PLINTH = MILITARY.charcoal;
const sheets = new Map<string, CanvasImageSource>();
const GOLD = MILITARY.brass;
const GOLD_NUM = MILITARY.cream;
const TEAL_NUM = MILITARY.spruce;

export interface UprightPaint {
  unitType: string;
  factionId: string;
  count: number;
  x: number;
  y: number;
  tokenPx: number;
  dpr: number;
  selected: boolean;
  unmoved: boolean;
  active: boolean;
  fuel: number | null;
  loaded: boolean;
  cargoCount?: number;
  /** Seconds since the page clock, present only while the upright sprites are settled. */
  idleTime?: number;
  /** Per-stack offset so neighbours do not rise together. Radians. */
  idlePhase?: number;
  /**
   * Eight-way bearing toward the nearest enemy. 0 is east, then clockwise on the map
   * (1 southeast … 4 west … 7 northeast). The plinth and badges stay put.
   */
  aim?: FaceOctant;
  /** Stable id for the vector overlay. One stack keeps its SVG node while the camera moves. */
  vectorKey?: string;
  /** Screen point to "this pixel is on the continent". Ships use it to fade the inland overlap. */
  landAt?: (x: number, y: number) => boolean;
  /** Transport seats. Null draws none. 0 draws two empty rings. */
  holds?: number | null;
}

/** The guns are drawn toward +x, so +1 faces right and -1 faces left. */
export type FaceSign = 1 | -1;

/** 0 east, then clockwise: southeast, south, southwest, west, northwest, north, northeast. */
export type FaceOctant = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface FacingStack {
  factionId: string;
  count: number;
}

/** Pieces in each region, copied at the start of a faction's combat move. */
export type FacingStacks = Record<string, readonly FacingStack[]>;

export interface FacingRegion {
  id: string;
  anchor: Vec2;
  owner: string;
  /** Factions that have a unit in the region. */
  factions: readonly string[];
  /** Pieces present when the combat-move snapshot was taken. Absent means no size weight. */
  stacks?: readonly FacingStack[];
}

/** The locked board a faction's combat move started from. Later phases keep it until the next one. */
export interface FacingHold {
  key: string;
  locked: boolean;
  stacks: FacingStacks;
}

/**
 * Opening a game takes the board as it stands. Entering combat move copies it again and holds
 * that copy through the rest of the turn, so moves and casualties do not turn the sprites around.
 */
export function nextFacingHold(
  previous: FacingHold | null,
  sameGame: boolean,
  phase: string,
  key: string,
  live: FacingStacks,
): FacingHold {
  if (!sameGame || previous == null) {
    return { key, locked: phase === "combat_move", stacks: live };
  }
  if (phase === "combat_move" && (!previous.locked || previous.key !== key)) {
    return { key, locked: true, stacks: live };
  }
  return previous;
}

/** Campaign sides, used when the map has no session team check to call. */
export function campaignSameTeam(a: string, b: string): boolean {
  if (a === "" || b === "") return false;
  const left = factionPalette(a).side;
  const right = factionPalette(b).side;
  return left !== "neutral" && left === right;
}

/** Short-way horizontal delta. Negative is left. */
function wrappedDx(from: Vec2, to: Vec2, bounds: Rect, wrap: boolean): number {
  let dx = to.x - from.x;
  if (wrap && bounds.w > 0) {
    dx = wrapWorldX(to.x, bounds) - wrapWorldX(from.x, bounds);
    const half = bounds.w / 2;
    if (dx > half) dx -= bounds.w;
    else if (dx < -half) dx += bounds.w;
  }
  return dx;
}

/** Short-way horizontal sign from `from` to `to`. Straight up or down stays facing right. */
export function facingSign(from: Vec2, to: Vec2, bounds: Rect, wrap: boolean): FaceSign {
  return wrappedDx(from, to, bounds, wrap) < -1e-6 ? -1 : 1;
}

/** Eight-way bearing from `from` to `to`. A point on top of itself stays east. */
export function facingOctant(from: Vec2, to: Vec2, bounds: Rect, wrap: boolean): FaceOctant {
  const dx = wrappedDx(from, to, bounds, wrap);
  const dy = to.y - from.y;
  if (dx * dx + dy * dy < 1e-8) return 0;
  const eighth = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  return (((eighth % 8) + 8) % 8) as FaceOctant;
}

/**
 * How to draw a right-facing picture on this bearing. Leftward bearings mirror first,
 * then turn by at most a right angle, so the head stays above the feet.
 */
export function facingPose(octant: FaceOctant): { face: FaceSign; turn: number } {
  let deg = octant * 45;
  if (deg > 180) deg -= 360;
  if (deg > 90 || deg < -90) {
    const flipped = deg > 0 ? deg - 180 : deg + 180;
    return { face: -1, turn: (flipped * Math.PI) / 180 };
  }
  return { face: 1, turn: (deg * Math.PI) / 180 };
}

/** Enemy pieces in the region. The heaviest of these wins when a territory sits between two forces. */
function enemyPieceCount(
  region: FacingRegion,
  factionId: string,
  sameTeam: (a: string, b: string) => boolean,
): number {
  let total = 0;
  for (const stack of region.stacks ?? []) {
    if (stack.factionId !== "" && stack.count > 0 && !sameTeam(stack.factionId, factionId)) {
      total += stack.count;
    }
  }
  return total;
}

/**
 * The region a stack turns toward.
 * The unit's own region is skipped: an enemy standing in it has no direction.
 * No enemy anywhere returns null, and the sprite stays facing east.
 * A territory with an enemy force on both sides turns toward the heavier one.
 * Equal forces keep the nearer. A force straight up or down does not count as a side.
 */
function nearestEnemyAnchor(
  homeId: string,
  home: Vec2,
  factionId: string,
  regions: readonly FacingRegion[],
  bounds: Rect,
  wrap: boolean,
  sameTeam?: (a: string, b: string) => boolean,
): Vec2 | null {
  if (factionId === "") return null;
  const allied = sameTeam ?? campaignSameTeam;
  let nearestSpan = Infinity;
  let nearestAnchor: Vec2 | null = null;
  let heavyCount = -1;
  let heavySpan = Infinity;
  let heavyAnchor: Vec2 | null = null;
  let leftForce = false;
  let rightForce = false;
  for (const region of regions) {
    if (region.id === homeId) continue;
    const span = anchorSpan(home, region.anchor, bounds, wrap);
    if (!(span > 0)) continue;
    if (regionIsHostile(region, factionId, allied) && span < nearestSpan) {
      nearestSpan = span;
      nearestAnchor = region.anchor;
    }
    const count = enemyPieceCount(region, factionId, allied);
    if (count <= 0) continue;
    const dx = wrappedDx(home, region.anchor, bounds, wrap);
    if (dx < -1e-6) leftForce = true;
    else if (dx > 1e-6) rightForce = true;
    else continue;
    if (count > heavyCount || (count === heavyCount && span < heavySpan)) {
      heavyCount = count;
      heavySpan = span;
      heavyAnchor = region.anchor;
    }
  }
  if (leftForce && rightForce) return heavyAnchor;
  return nearestAnchor;
}

/** Left or right toward the region `nearestEnemyOctant` uses. No enemy leaves the sprite facing right. */
export function nearestEnemyFacing(
  homeId: string,
  home: Vec2,
  factionId: string,
  regions: readonly FacingRegion[],
  bounds: Rect,
  wrap: boolean,
  sameTeam?: (a: string, b: string) => boolean,
): FaceSign {
  const anchor = nearestEnemyAnchor(homeId, home, factionId, regions, bounds, wrap, sameTeam);
  return anchor ? facingSign(home, anchor, bounds, wrap) : 1;
}

/** Eight-way bearing toward the nearest enemy. No enemy stays east. */
export function nearestEnemyOctant(
  homeId: string,
  home: Vec2,
  factionId: string,
  regions: readonly FacingRegion[],
  bounds: Rect,
  wrap: boolean,
  sameTeam?: (a: string, b: string) => boolean,
): FaceOctant {
  const anchor = nearestEnemyAnchor(homeId, home, factionId, regions, bounds, wrap, sameTeam);
  return anchor ? facingOctant(home, anchor, bounds, wrap) : 0;
}

function regionIsHostile(
  region: FacingRegion,
  factionId: string,
  sameTeam: (a: string, b: string) => boolean,
): boolean {
  if (region.owner !== "" && !sameTeam(region.owner, factionId)) return true;
  for (const other of region.factions) {
    if (other !== "" && !sameTeam(other, factionId)) return true;
  }
  return false;
}

const STILL_UNITS = new Set(["artillery", "aa", "aaa"]);
const SEA_UNITS = new Set(["submarine", "sub", "destroyer", "cruiser", "battleship", "carrier", "transport"]);
const AIR_UNITS = new Set(["fighter", "tactical_bomber", "strategic_bomber", "tac_bomber", "bomber"]);
/** Tanks and vehicles sit five pixels under the infantry line so the tracks meet the plinth. */
const VEHICLE_SINK_PX = 5;
const VEHICLE_SINK = new Set([
  "tank",
  "armor",
  "mech_infantry",
  "artillery",
  "aa",
  "aaa",
  ...SEA_UNITS,
]);
/** Placeholder figures stand about this tall, in CSS pixels, and they do not grow with a closer zoom. */
const UPRIGHT_FIGURE_PX = 24;
/** Every zoomed sprite, on top of that height. */
const UPRIGHT_BOOST = 1.4;
/** Planes and ships, on top of the boost above. */
const BULK_BOOST = 1.6;

function uprightScale(unitType: string): number {
  const bulk = AIR_UNITS.has(unitType) || SEA_UNITS.has(unitType) ? BULK_BOOST : 1;
  return UPRIGHT_BOOST * bulk;
}

interface CampaignFrame {
  vectors: VehicleSvgUnit[];
  chrome: ((ctx: CanvasRenderingContext2D) => void)[];
}

let campaignFrame: CampaignFrame | null = null;

/** The next upright draw records vectors instead of painting them into the map bitmap. */
export function beginCampaignFigures(): void {
  campaignFrame = { vectors: [], chrome: [] };
}

/** Vectors for the SVG overlay, and the badges that must sit above them. */
export function takeCampaignFigures(): CampaignFrame {
  const frame = campaignFrame ?? { vectors: [], chrome: [] };
  campaignFrame = null;
  return frame;
}

/** Stable phase in `[0, 2π)` for one stack. */
export function idlePhase(regionId: string, unitType: string): number {
  let hash = 2166136261;
  const key = `${regionId}\0${unitType}`;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) / 4294967296) * Math.PI * 2;
}

/**
 * Vertical breathe in CSS pixels. Guns stay planted. Ships move half as far as the troops.
 * `time` is seconds, matching the battle board's `sin(time * 3)` idle.
 */
export function idleBob(unitType: string, time: number, phase: number): number {
  if (STILL_UNITS.has(unitType)) {
    return 0;
  }
  const amplitude = SEA_UNITS.has(unitType) ? 0.5 : 1;
  return Math.sin(time * 3 + phase) * amplitude;
}

function withCrisp(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  draw: (at: (css: number) => number) => void,
): void {
  const scale = Math.max(1, Math.round(dpr));
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingEnabled = false;
  draw((css) => Math.round((css * dpr) / scale));
  ctx.restore();
}

function drawHardwareBadge(
  ctx: CanvasRenderingContext2D,
  label: string,
  left: number,
  top: number,
  numeral: string,
  align: "left" | "center" = "left",
): void {
  ctx.font = "700 11px Courier New, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const w = Math.max(16, Math.ceil(ctx.measureText(label).width) + 8);
  const h = 13;
  const x = align === "center" ? left - w / 2 : left;
  ctx.fillStyle = PLINTH;
  ctx.fillRect(x, top, w, h);
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, top + 0.5, w - 1, h - 1);
  ctx.fillStyle = numeral;
  ctx.textAlign = "center";
  ctx.fillText(label, x + w / 2, top + h / 2 + 0.5);
}

/** Map a cue range onto the few pixels an upright figure has. */
function fit(value: number, lo: number, hi: number, outLo: number, outHi: number): number {
  const t = hi === lo ? 0 : (value - lo) / (hi - lo);
  return Math.round(outLo + Math.max(0, Math.min(1, t)) * (outHi - outLo));
}

/** The six helmets from the battle sprites, drawn to sit on an upright head. */
function drawUprightHelmet(ctx: CanvasRenderingContext2D, helmet: Helmet, cx: number, top: number, color: string): void {
  switch (helmet) {
    case "stahlhelm":
      ctx.fillStyle = color;
      ctx.fillRect(cx - 3, top, 7, 3);
      ctx.fillRect(cx - 4, top + 2, 2, 3);
      ctx.fillStyle = CHARCOAL;
      ctx.fillRect(cx - 1, top + 2, 6, 1);
      return;
    case "ssh40":
      ctx.fillStyle = color;
      ctx.fillRect(cx - 2, top - 1, 5, 1);
      ctx.fillRect(cx - 3, top, 7, 4);
      ctx.fillStyle = CHARCOAL;
      ctx.fillRect(cx - 4, top + 3, 8, 1);
      ctx.fillStyle = MILITARY.crimson;
      ctx.fillRect(cx + 1, top + 1, 2, 2);
      return;
    case "brodie":
      ctx.fillStyle = color;
      ctx.fillRect(cx - 2, top + 1, 5, 2);
      ctx.fillRect(cx - 5, top + 2, 10, 1);
      ctx.fillStyle = CHARCOAL;
      ctx.fillRect(cx - 5, top + 3, 10, 1);
      return;
    case "m1":
      ctx.fillStyle = color;
      ctx.fillRect(cx - 2, top - 1, 5, 1);
      ctx.fillRect(cx - 3, top, 7, 4);
      ctx.fillStyle = CHARCOAL;
      ctx.fillRect(cx - 4, top + 3, 8, 1);
      ctx.fillRect(cx + 2, top + 4, 1, 2);
      return;
    case "havelock":
      ctx.fillStyle = LEATHER;
      ctx.fillRect(cx - 4, top + 2, 2, 4);
      ctx.fillStyle = color;
      ctx.fillRect(cx - 3, top, 7, 3);
      ctx.fillStyle = CHARCOAL;
      ctx.fillRect(cx - 3, top + 2, 7, 1);
      ctx.fillStyle = BRASS;
      ctx.fillRect(cx + 1, top + 1, 1, 1);
      return;
    default:
      ctx.fillStyle = color;
      ctx.fillRect(cx - 3, top, 7, 3);
      ctx.fillStyle = CHARCOAL;
      ctx.fillRect(cx - 1, top - 1, 2, 1);
      ctx.fillRect(cx - 4, top + 2, 8, 2);
  }
}

function drawInfantry(ctx: CanvasRenderingContext2D, color: string, helmet: Helmet): void {
  ctx.fillStyle = CHARCOAL;
  ctx.fillRect(-4, -5, 3, 5);
  ctx.fillRect(1, -5, 3, 5);
  ctx.fillStyle = TAUPE;
  ctx.fillRect(-4, -9, 8, 5);
  ctx.fillStyle = color;
  ctx.fillRect(-5, -16, 10, 8);
  ctx.fillStyle = LEATHER;
  ctx.fillRect(-5, -11, 10, 2);
  ctx.fillRect(-2, -16, 2, 5);
  ctx.fillStyle = CREAM;
  ctx.fillRect(-3, -20, 6, 5);
  drawUprightHelmet(ctx, helmet, 0, -23, color);
  ctx.fillStyle = BROWN;
  ctx.fillRect(-2, -13, 9, 3);
  ctx.fillStyle = STEEL;
  ctx.fillRect(7, -12, 8, 2);
  ctx.fillStyle = CREAM;
  ctx.fillRect(15, -13, 3, 1);
}

function drawArtillery(ctx: CanvasRenderingContext2D, color: string, flak: boolean, gun: GunCue, helmet: Helmet): void {
  ctx.fillStyle = CHARCOAL;
  ctx.fillRect(-8, -6, 5, 6);
  ctx.fillRect(3, -6, 5, 6);
  ctx.fillStyle = STEEL;
  ctx.fillRect(-7, -5, 3, 4);
  ctx.fillRect(4, -5, 3, 4);
  if (gun.platform) {
    ctx.fillStyle = TAUPE;
    ctx.fillRect(-10, -2, 20, 2);
  }
  ctx.fillStyle = BROWN;
  ctx.fillRect(-14, -4, 7, 2);
  ctx.fillStyle = TAUPE;
  ctx.fillRect(-6, -8, 14, 4);
  ctx.fillStyle = color;
  if (flak) {
    ctx.fillRect(1, -18, 3, 11);
    ctx.fillStyle = CHARCOAL;
    ctx.fillRect(0, -18, 5, 2);
  } else {
    const barrel = fit(gun.barrel, 14, 24, 10, 18);
    const bore = gun.bore >= 5 ? 4 : 2;
    ctx.fillRect(-2, -11, barrel, bore);
    if (gun.brake) {
      ctx.fillStyle = CHARCOAL;
      ctx.fillRect(-2 + barrel, -12, 3, bore + 2);
    }
    if (gun.shield > 0) {
      const shield = fit(gun.shield, 8, 13, 6, 10);
      ctx.fillStyle = STEEL;
      ctx.fillRect(-4, -11 - shield, 3, shield);
    }
  }
  drawUprightHelmet(ctx, helmet, -11, -16, color);
  ctx.fillStyle = CREAM;
  ctx.fillRect(-13, -13, 4, 3);
  ctx.fillStyle = TAUPE;
  ctx.fillRect(-14, -10, 5, 4);
}

function drawArmor(ctx: CanvasRenderingContext2D, color: string, cue: TankCue): void {
  const hull = fit(cue.length, 26, 40, 20, 30);
  const left = -Math.round(hull / 2);
  const trackTop = cue.highTrack ? -10 : -7;
  const trackH = cue.highTrack ? 10 : 7;
  ctx.fillStyle = CHARCOAL;
  ctx.fillRect(left, trackTop, hull, trackH);
  if (cue.highTrack) ctx.fillRect(left + hull - 2, trackTop + 2, 3, trackH - 2);
  const wheels = Math.max(4, Math.min(7, cue.wheels > 6 ? 6 : cue.wheels));
  ctx.fillStyle = STEEL;
  const gap = hull / (wheels + 1);
  const wheel = cue.wheelR >= 3.4 ? 2 : 1;
  for (let i = 1; i <= wheels; i++) {
    ctx.fillRect(left + Math.round(i * gap) - wheel, trackTop + 1, wheel * 2, trackH - 2);
  }
  const glacis = fit(cue.glacis, 0, 7, 0, 6);
  ctx.fillStyle = color;
  ctx.fillRect(left, -15, hull - glacis, 8);
  for (let i = 0; i < glacis; i++) ctx.fillRect(left + hull - glacis + i, -15 + i, 1, 8 - i);
  const tw = fit(cue.turretW, 10, 18, 7, 12);
  const th = fit(cue.turretH, 7, 10, 4, 6);
  const tx = fit(cue.turretX, -2, 3, -4, 5);
  ctx.fillRect(tx, -15 - th, tw, th);
  if (cue.castTurret) ctx.fillRect(tx + 1, -16 - th, tw - 2, 1);
  const barrel = fit(cue.barrel, 9, 23, 6, 14);
  ctx.fillStyle = CHARCOAL;
  ctx.fillRect(tx + tw - 1, -14 - th, barrel, 2);
  if (cue.brake) ctx.fillRect(tx + tw + barrel - 2, -15 - th, 3, 4);
}

function drawFighter(ctx: CanvasRenderingContext2D, color: string, cue: FighterCue): void {
  const wing = cue.roundTips ? 22 : 18;
  ctx.fillStyle = TAUPE;
  ctx.fillRect(-8, -2, 14, 2);
  ctx.fillStyle = color;
  ctx.fillRect(-wing / 2, -8, wing, 4);
  ctx.fillRect(-7, -5, 14, 3);
  if (cue.roundTips) {
    ctx.fillRect(-wing / 2 - 1, -7, 1, 2);
    ctx.fillRect(wing / 2, -7, 1, 2);
  }
  if (cue.scoop) {
    ctx.fillStyle = TAUPE;
    ctx.fillRect(-3, -2, 6, 2);
  }
  ctx.fillStyle = BRASS;
  if (cue.radial) {
    ctx.fillRect(7, -8, 4, 7);
    ctx.fillStyle = CHARCOAL;
    ctx.fillRect(7, -8, 1, 7);
  } else {
    ctx.fillRect(8, -6, 3, 4);
    ctx.fillRect(11, -5, 2, 2);
  }
  ctx.fillStyle = color;
  ctx.fillRect(-12, -12, 4, 5);
  ctx.fillStyle = SPRUCE;
  const canopy = Math.max(3, Math.min(7, cue.canopy));
  ctx.fillRect(2 - Math.floor(canopy / 2), -8, canopy, 3);
  if (cue.fixedGear) {
    ctx.fillStyle = CHARCOAL;
    ctx.fillRect(3, -1, 1, 4);
    ctx.fillRect(2, 2, 3, 1);
  }
}

function drawBomber(ctx: CanvasRenderingContext2D, color: string, cue: BomberCue, strategic: boolean): void {
  const wing = fit(Math.round(cue.span * 100), 68, 100, 16, 26) + (strategic ? 2 : 0);
  const bodyH = cue.cigar ? 6 : 4;
  ctx.fillStyle = TAUPE;
  ctx.fillRect(-12, -2, wing, 2);
  ctx.fillStyle = color;
  ctx.fillRect(-14, -2 - bodyH, wing, bodyH);
  ctx.fillRect(-6, -6 - bodyH, Math.round(wing * 0.6), 3);
  const finH = cue.tallFin ? 8 : 5;
  ctx.fillRect(-16, -2 - bodyH - finH, 4, finH + bodyH);
  if (cue.twinTail) ctx.fillRect(-16 + wing - 6, -2 - bodyH - finH + 1, 3, finH);
  ctx.fillStyle = SPRUCE;
  ctx.fillRect(-2, -4 - bodyH, cue.glazedNose ? 5 : 7, 3);
  if (cue.glazedNose) {
    ctx.fillStyle = CREAM;
    ctx.fillRect(-14 + wing - 4, -1 - bodyH, 4, 2);
  }
  ctx.fillStyle = CHARCOAL;
  const nacelles = cue.engines === 4 ? [-10, -4, 4, 10] : [-6, 6];
  for (const nx of nacelles) ctx.fillRect(nx, -bodyH, 3, 2);
}

function drawSubmarine(ctx: CanvasRenderingContext2D, color: string, cue: SubCue): void {
  const hull = fit(cue.length, 32, 56, 18, 30);
  const left = -Math.round(hull / 2);
  ctx.fillStyle = STEEL;
  ctx.fillRect(left, -4, hull, 4);
  ctx.fillStyle = CHARCOAL;
  ctx.fillRect(left + 1, -2, hull - 2, 2);
  const tower = fit(cue.tower, 8, 12, 4, 7);
  ctx.fillStyle = color;
  ctx.fillRect(-3, -4 - tower, 6, tower);
  ctx.fillStyle = STEEL;
  ctx.fillRect(-1, -4 - tower - 3, 1, 3);
  if (cue.hangar) {
    ctx.fillStyle = color;
    ctx.fillRect(3, -8, 8, 4);
    ctx.fillStyle = CHARCOAL;
    ctx.fillRect(10, -7, 1, 3);
  }
  if (cue.deckGun) {
    ctx.fillStyle = CHARCOAL;
    ctx.fillRect(cue.hangar ? -10 : 4, -7, 5, 2);
  }
}

function drawBridge(ctx: CanvasRenderingContext2D, cue: ShipCue, x: number, deck: number): void {
  switch (cue.bridge) {
    case "pagoda":
      ctx.fillStyle = TAUPE;
      ctx.fillRect(x, deck - 4, 6, 4);
      ctx.fillRect(x + 1, deck - 7, 4, 3);
      ctx.fillRect(x + 2, deck - 10, 2, 3);
      return;
    case "tripod":
      ctx.fillStyle = CHARCOAL;
      ctx.fillRect(x + 2, deck - 9, 1, 9);
      ctx.fillRect(x, deck - 3, 5, 1);
      ctx.fillRect(x + 1, deck - 6, 3, 1);
      return;
    case "tower":
      ctx.fillStyle = TAUPE;
      ctx.fillRect(x, deck - 8, 4, 8);
      ctx.fillStyle = CHARCOAL;
      ctx.fillRect(x + 1, deck - 11, 2, 3);
      return;
    default:
      ctx.fillStyle = TAUPE;
      ctx.fillRect(x, deck - 5, 7, 5);
  }
}

function drawWarship(ctx: CanvasRenderingContext2D, color: string, unitType: string, cues: RosterCues): void {
  if (unitType === "submarine") {
    drawSubmarine(ctx, color, cues.sub);
    return;
  }
  const carrier = unitType === "carrier";
  const hull = unitType === "battleship" ? 32 : unitType === "cruiser" ? 28 : 24;
  const left = -hull / 2;
  if (unitType === "transport") {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(left, -1);
    ctx.lineTo(left + 6, -7);
    ctx.lineTo(hull / 2 - 4, -7);
    ctx.lineTo(hull / 2, -1);
    ctx.lineTo(hull / 2 - 3, 2);
    ctx.lineTo(left + 1, 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = TAUPE;
    ctx.fillRect(left + 8, -11, 6, 4);
    ctx.fillRect(left + 16, -10, 5, 3);
    return;
  }
  ctx.fillStyle = color;
  ctx.fillRect(left, -5, hull, 5);
  ctx.fillStyle = CHARCOAL;
  ctx.fillRect(left, -2, hull, 2);
  if (carrier) {
    const island = cues.carrier;
    ctx.fillStyle = TAUPE;
    ctx.fillRect(left + 2, -8, hull - 4, 3);
    const ix = fit(island.islandX, 4, 14, left + 4, left + hull - 10);
    const iw = fit(island.islandW, 8, 17, 4, 8);
    const ih = fit(island.islandH, 8, 14, 4, 7);
    ctx.fillStyle = color;
    ctx.fillRect(ix, -8 - ih, iw, ih);
    if (island.funnel) {
      ctx.fillStyle = CHARCOAL;
      ctx.fillRect(ix + iw - 2, -10 - ih, 2, 3);
    }
    return;
  }
  const cue = unitType === "battleship" ? cues.battleship : unitType === "cruiser" ? cues.cruiser : cues.destroyer;
  const deck = -5;
  for (let i = 0; i < cue.turrets; i++) {
    const tx = left + 3 + Math.round((i * (hull - 10)) / Math.max(1, cue.turrets - 1));
    ctx.fillStyle = STEEL;
    ctx.fillRect(tx, deck - 3, 4, 3);
  }
  drawBridge(ctx, cue, -2, deck);
  for (let i = 0; i < cue.funnels; i++) {
    ctx.fillStyle = CHARCOAL;
    ctx.fillRect(2 + i * 4, deck - 7, 2, 4);
  }
}

function drawUprightBody(ctx: CanvasRenderingContext2D, unitType: string, color: string, factionId: string): void {
  const cues = rosterCues(factionId);
  switch (unitType) {
    case "artillery":
      drawArtillery(ctx, color, false, cues.gun, cues.helmet);
      return;
    case "aaa":
    case "aa":
      drawArtillery(ctx, color, true, cues.gun, cues.helmet);
      return;
    case "tank":
    case "armor":
      drawArmor(ctx, color, cues.tank);
      return;
    case "fighter":
      drawFighter(ctx, color, cues.fighter);
      return;
    case "tactical_bomber":
      drawBomber(ctx, color, cues.bomber, false);
      return;
    case "strategic_bomber":
      drawBomber(ctx, color, cues.bomber, true);
      return;
    case "submarine":
    case "destroyer":
    case "cruiser":
    case "battleship":
    case "carrier":
    case "transport":
      drawWarship(ctx, color, unitType, cues);
      return;
    default:
      drawInfantry(ctx, color, cues.helmet);
  }
}

function spriteSheet(unitType: string, factionId: string, face: FaceSign): CanvasImageSource | null {
  const key = `${unitType}|${factionId}|${face}`;
  const cached = sheets.get(key);
  if (cached) {
    return cached;
  }
  const baked = bakeUnitSprite(face, (ctx) => {
    drawUprightBody(ctx, unitType, factionPalette(factionId).primary, factionId);
  });
  if (!baked) {
    return null;
  }
  sheets.set(key, baked);
  return baked;
}

/** Distance between squad copies, in CSS pixels. The baked offsets suit a rifleman.
 * A tank or a plane is wider than that step, so the extra copies would sit inside the first.
 */
function squadStep(figureW: number): number {
  return Math.max(10, figureW * 0.72);
}

function placedSquad(count: number, step: number): { x: number; y: number }[] {
  const n = squadOffsets(count).length;
  if (n >= 3) {
    return [
      { x: -step, y: -3 },
      { x: 0, y: 0 },
      { x: step, y: 3 },
    ];
  }
  if (n === 2) {
    return [
      { x: -step / 2, y: -2 },
      { x: step / 2, y: 2 },
    ];
  }
  return [{ x: 0, y: 0 }];
}

/** Foreshortened baseplate, then the upright sprite standing on its centre. */
export function drawUprightStack(ctx: CanvasRenderingContext2D, paint: UprightPaint): void {
  const radius = paint.tokenPx / 2;
  const rx = radius * 1.15;
  const ry = Math.max(2, radius * 0.65);
  const { x, y } = paint;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = MILITARY.charcoal;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x, y - ry * 0.08, rx * 0.78, ry * 0.62, 0, 0, Math.PI * 2);
  ctx.fillStyle = factionPalette(paint.factionId).primary;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = GOLD;
  ctx.stroke();

  const color = factionPalette(paint.factionId).primary;
  const pose = facingPose(paint.aim ?? 0);
  const useQuick = hasQuickUnit(paint.factionId, paint.unitType);
  const resolved = useQuick ? resolveQuickClip(paint.factionId, paint.unitType) : null;
  // Shared infantry plays on the battle board. The campaign keeps the faction's own picture.
  const clip = resolved?.fallback ? null : resolved;
  const sheet = !clip && typeof ctx.drawImage === "function" ? spriteSheet(paint.unitType, paint.factionId, 1) : null;
  const bob = clip || paint.idleTime == null ? 0 : idleBob(paint.unitType, paint.idleTime, paint.idlePhase ?? 0);
  const figureScale = uprightScale(paint.unitType);
  const pixelScale = clip && clip.height > 0 ? (UPRIGHT_FIGURE_PX * figureScale) / clip.height : 1;
  const figureW = clip ? clip.width * pixelScale : 16 * figureScale;
  const sink = VEHICLE_SINK.has(paint.unitType) ? VEHICLE_SINK_PX : 0;
  const poseName = clip && clip.idle > 0 ? "idle" : "walk";
  const poseCount = clip ? clip[poseName] : 0;
  const idleTick =
    paint.unitType === "infantry" && poseName === "idle" ? INFANTRY_IDLE_TICK_SECONDS : QUICK_TICK_SECONDS;
  const frameBase = poseCount > 0 ? Math.floor((paint.idleTime ?? 0) / idleTick) % poseCount : 0;
  const staggerIdle = paint.unitType === "infantry" && poseName === "idle" && poseCount > 1;
  const asVector = campaignFrame != null && clip != null && poseCount > 0;
  withCrisp(ctx, paint.dpr, (at) => {
    const figures = placedSquad(paint.count, squadStep(figureW))
      .slice()
      .sort((a, b) => a.y - b.y);
    for (let i = 0; i < figures.length; i += 1) {
      const off = figures[i]!;
      const frameIndex = staggerIdle
        ? (frameBase + infantryIdlePhase(`${paint.vectorKey ?? paint.factionId}:${i}`, poseCount)) % poseCount
        : frameBase;
      const href = clip && poseCount > 0 ? quickFrameUrl(clip, poseName, frameIndex) : null;
      if (asVector && clip && href) {
        const figure = quickSvgFigure({
          id: `${paint.vectorKey ?? `${paint.factionId}:${paint.unitType}:${Math.round(x)}:${Math.round(y)}`}:${i}`,
          clip,
          href,
          x: x + off.x,
          y: y + off.y + sink,
          unitScale: pixelScale,
          face: pose.face,
          rootX: -clip.feet.x,
          rootY: -clip.feet.y,
        });
        if (SEA_UNITS.has(paint.unitType) && paint.landAt) {
          const box = spriteScreenBox(
            x + off.x,
            y + off.y + sink,
            clip.width,
            clip.height,
            clip.feet.x,
            clip.feet.y,
            pixelScale,
            pose.face,
          );
          const share = landShareOf(box, 8, 5, paint.landAt);
          if (seaLandOpacity(share) != null) {
            figure.shoreFade = true;
          }
        }
        campaignFrame?.vectors.push(figure);
        continue;
      }
      ctx.save();
      ctx.translate(at(x + off.x), at(y + off.y + bob + sink));
      ctx.scale(figureScale, figureScale);
      if (pose.face < 0) ctx.scale(-1, 1);
      if (sheet) {
        ctx.drawImage(sheet, -SPRITE_BAKE.originX, -SPRITE_BAKE.originY);
      } else {
        drawUprightBody(ctx, paint.unitType, color, paint.factionId);
      }
      ctx.restore();
    }
    if (!asVector && paint.count > 1) {
      drawHardwareBadge(ctx, `[${paint.count}]`, at(x), at(y + ry * 0.2) + 2, GOLD_NUM, "center");
    }
    if (!asVector && paint.fuel != null) {
      drawHardwareBadge(ctx, String(paint.fuel), at(x - rx - 4) - 20, at(y) - 6, paint.active ? TEAL_NUM : GOLD_NUM);
    }
  });

  const paintMarks = (target: CanvasRenderingContext2D) => {
    target.save();
    target.setTransform(paint.dpr, 0, 0, paint.dpr, 0, 0);
    withCrisp(target, paint.dpr, (at) => {
      if (paint.count > 1) {
        drawHardwareBadge(target, `[${paint.count}]`, at(x), at(y + ry * 0.2) + 2, GOLD_NUM, "center");
      }
      if (paint.fuel != null) {
        drawHardwareBadge(target, String(paint.fuel), at(x - rx - 4) - 20, at(y) - 6, paint.active ? TEAL_NUM : GOLD_NUM);
      }
    });
    if (paint.loaded) {
      const aboard = paint.cargoCount ?? 0;
      if (aboard > 0) {
        drawHardwareBadge(target, `⚓+${aboard}`, x - rx, y - ry - 16, GOLD_NUM);
      } else {
        const s = Math.max(3, Math.round(radius * 0.28));
        target.fillStyle = GOLD;
        target.fillRect(Math.round(x - rx * 0.55), Math.round(y - ry * 0.2), s, s);
      }
    }
    if (paint.holds != null) {
      drawHoldCircles(target, x, y, paint.tokenPx, true, paint.holds);
    }
    if (paint.selected || paint.unmoved) {
      target.beginPath();
      target.ellipse(x, y, rx + 3, ry + 2.5, 0, 0, Math.PI * 2);
      target.lineWidth = paint.selected ? 2.5 : 1.5;
      target.strokeStyle = paint.selected ? SELECTED_COLOR : "rgba(221, 207, 153, 0.9)";
      target.setLineDash(paint.selected ? [] : [4, 3]);
      target.stroke();
      target.setLineDash([]);
    }
    target.restore();
  };

  if (asVector) {
    campaignFrame?.chrome.push(paintMarks);
  } else if (paint.loaded) {
    const aboard = paint.cargoCount ?? 0;
    if (aboard > 0) {
      drawHardwareBadge(ctx, `⚓+${aboard}`, x - rx, y - ry - 16, GOLD_NUM);
    } else {
      const s = Math.max(3, Math.round(radius * 0.28));
      ctx.fillStyle = GOLD;
      ctx.fillRect(Math.round(x - rx * 0.55), Math.round(y - ry * 0.2), s, s);
    }
  }
  if (!asVector && paint.holds != null) {
    drawHoldCircles(ctx, x, y, paint.tokenPx, true, paint.holds);
  }
  if (!asVector && (paint.selected || paint.unmoved)) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx + 3, ry + 2.5, 0, 0, Math.PI * 2);
    ctx.lineWidth = paint.selected ? 2.5 : 1.5;
    ctx.strokeStyle = paint.selected ? SELECTED_COLOR : "rgba(221, 207, 153, 0.9)";
    ctx.setLineDash(paint.selected ? [] : [4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}
