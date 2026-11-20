// Frontline 1941 - Tactical Combat Unit & Battlefield Visual Renderer
import {
  barrelRecoilPx,
  infantryKick,
  MARCH_RIFLE_RAD,
  marchCycle,
  stepSin,
  tankKick,
  tankVibe,
  trackScroll,
  turretSwivelRad,
} from "./figureGait";
import {
  CombatUnit,
  TheaterId,
  GroundCrater,
  GroundFire,
  BloodPuddle,
  BloodSplatter,
  FlyingDebris,
  SmokePuff,
  Shockwave,
  PlaneSortie,
  PlaneBullet,
  FloatingText,
  CasualtyRecord,
  WaterGeyser,
} from './combatTypes';
import { drawAnimatedUnitSprite } from './default_unit_matrices';
import { graphicsSettings } from './graphicsSettings';
import { drawCoastalWaveRows, drawOceanWaveRows } from './seaTile';
import { type FlagMotif, ipcLostCaption } from './flagMotif';
import { MILITARY } from '../theme/militaryPalette';
import {
  type BomberCue,
  type Bridge,
  type FighterCue,
  type Helmet,
  type RosterCues,
  type ShipCue,
  rosterCues,
} from '../theme/factionRoster';
import type { BakedScenery } from './scenery/sceneryBake';
import { toneCurve } from './scenery/toneCurve';
import {
  paintCrater,
  paintGrid,
  paintParapet,
  paintTrench,
  paintWire,
  squashPaint,
} from './scenery/groundPerspective';
import { decalRadii } from './scenery/perspective';
import {
  GROUND_BOTTOM,
  GROUND_TOP,
  groundMate,
  LAND_GRID_ALPHA,
  LAND_GROUND_WASH,
  type Paint,
} from './scenery/sceneryPaint';

/**
 * STRICT 16-COLOR VINTAGE MILITARY PALETTE
 */
export const PALETTE = {
  sandCream: MILITARY.cream,
  sandTan: MILITARY.tan,
  terracotta: MILITARY.terracotta,
  crimson: MILITARY.crimson,
  plum: MILITARY.plum,
  bunkerCharcoal: MILITARY.charcoal,
  navalSteel: MILITARY.steel,
  spruceSea: MILITARY.spruce,
  fieldSage: MILITARY.sage,
  deepTaupe: MILITARY.taupe,
  feldgrau: MILITARY.feldgrau,
  trenchMudBone: MILITARY.bone,
  oliveDrab: MILITARY.olive,
  mustardBrass: MILITARY.brass,
  earthBrown: MILITARY.brown,
  khakiLeather: MILITARY.khaki,
} as const;

/**
 * Deterministic star positions for the night sky
 */
const STARS = Array.from({length: 48}, (_, i) => ({
  x: ((i * 137.5) % 1260) + 10,
  y: ((i * 31.7) % 75) + 6,
  size: i % 5 === 0 ? 2 : 1,
  seed: i * 1.618,
}));

// ============================================================================
// CONTINUOUS RGB SKY TRANSITION ENGINE (60-SECOND CYCLE)
// ============================================================================

type RGB = [number, number, number];

function lerpRGB(c1: RGB, c2: RGB, t: number): RGB {
  return [
    Math.round(c1[0] + (c2[0] - c1[0]) * t),
    Math.round(c1[1] + (c2[1] - c1[1]) * t),
    Math.round(c1[2] + (c2[2] - c1[2]) * t),
  ];
}

function rgbStr(c: RGB, a = 1): string {
  return a === 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

interface SkyKeyframe {
  pos: number;
  top: RGB;
  mid: RGB;
  horizon: RGB;
  /**
   * What the sky does to the ground. `ambient` multiplies the baked scenery (cool and dark at night,
   * warm and bright at noon). `rim` is the colour of a soft screen glow on the side of the sun or moon,
   * `rimK` how strong it is.
   */
  ambient: RGB;
  rim: RGB;
  rimK: number;
}

const SKY_KEYFRAMES: SkyKeyframe[] = [
  // 0.00: High Noon (Day blue / warm cream)
  {
    pos: 0.0,
    top: [116, 140, 165],
    mid: [195, 185, 155],
    horizon: [228, 218, 160],
    ambient: [255, 252, 244],
    rim: [255, 238, 190],
    rimK: 0.1,
  },
  // 0.35: Late Afternoon
  {
    pos: 0.35,
    top: [104, 124, 146],
    mid: [204, 168, 122],
    horizon: [232, 186, 114],
    ambient: [255, 236, 208],
    rim: [255, 208, 140],
    rimK: 0.16,
  },
  // 0.46: Warm Golden-Orange Sunset
  {
    pos: 0.46,
    top: [94, 60, 84],
    mid: [214, 112, 54],
    horizon: [244, 166, 58],
    ambient: [226, 172, 152],
    rim: [255, 160, 72],
    rimK: 0.36,
  },
  // 0.54: Twilight into Nightfall
  {
    pos: 0.54,
    top: [46, 36, 52],
    mid: [54, 58, 76],
    horizon: [72, 82, 98],
    ambient: [138, 122, 160],
    rim: [232, 124, 76],
    rimK: 0.22,
  },
  // 0.68: Deep Navy / Charcoal Night
  {
    pos: 0.68,
    top: [22, 24, 32],
    mid: [30, 36, 48],
    horizon: [40, 50, 64],
    ambient: [88, 106, 162],
    rim: [150, 182, 232],
    rimK: 0.12,
  },
  // 0.86: Soft Dawn / First Light
  {
    pos: 0.86,
    top: [34, 40, 56],
    mid: [82, 64, 82],
    horizon: [142, 92, 84],
    ambient: [136, 118, 152],
    rim: [255, 150, 112],
    rimK: 0.22,
  },
  // 0.94: Golden Sunrise
  {
    pos: 0.94,
    top: [86, 108, 128],
    mid: [186, 142, 106],
    horizon: [226, 186, 130],
    ambient: [250, 214, 178],
    rim: [255, 202, 132],
    rimK: 0.26,
  },
  // 1.00: Wrap around to High Noon
  {
    pos: 1.0,
    top: [116, 140, 165],
    mid: [195, 185, 155],
    horizon: [228, 218, 160],
    ambient: [255, 252, 244],
    rim: [255, 238, 190],
    rimK: 0.1,
  },
];

/** The sky, and the light it throws on the ground, at one point of the 60 second cycle. */
function getSkyState(cycle: number): {
  top: RGB;
  mid: RGB;
  horizon: RGB;
  ambient: RGB;
  rim: RGB;
  rimK: number;
} {
  for (let i = 0; i < SKY_KEYFRAMES.length - 1; i++) {
    const k1 = SKY_KEYFRAMES[i];
    const k2 = SKY_KEYFRAMES[i + 1];
    if (cycle >= k1.pos && cycle <= k2.pos) {
      const t = (cycle - k1.pos) / (k2.pos - k1.pos);
      return {
        top: lerpRGB(k1.top, k2.top, t),
        mid: lerpRGB(k1.mid, k2.mid, t),
        horizon: lerpRGB(k1.horizon, k2.horizon, t),
        ambient: lerpRGB(k1.ambient, k2.ambient, t),
        rim: lerpRGB(k1.rim, k2.rim, t),
        rimK: k1.rimK + (k2.rimK - k1.rimK) * t,
      };
    }
  }
  const first = SKY_KEYFRAMES[0];
  return { top: first.top, mid: first.mid, horizon: first.horizon, ambient: first.ambient, rim: first.rim, rimK: first.rimK };
}

function getSkyColors(cycle: number): {top: RGB; mid: RGB; horizon: RGB} {
  const {top, mid, horizon} = getSkyState(cycle);
  return {top, mid, horizon};
}

// ============================================================================
// BACKDROP LIGHTING: the sky lights the baked ground, skyline and edge
// ============================================================================

const SKY_CYCLE_SECONDS = 60;
const SKY_HORIZON_Y = 114;
const SKY_BOARD_WIDTH = 1280;

function skyCycle(time: number): number {
  return (((time % SKY_CYCLE_SECONDS) + SKY_CYCLE_SECONDS) % SKY_CYCLE_SECONDS) / SKY_CYCLE_SECONDS;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Board x of the sun for a point of the cycle, or null when it is down. Mirrors the skybox. */
function sunBoardX(cycle: number, width: number): number | null {
  const p = cycle >= 0.86 ? (cycle - 0.86) / 0.68 : cycle <= 0.54 ? (cycle + 0.14) / 0.68 : -1;
  return p >= 0 && p <= 1 ? Math.round(50 + p * (width - 100)) : null;
}

/** Board x of the moon, or null. Mirrors the skybox. */
function moonBoardX(cycle: number, width: number): number | null {
  if (cycle < 0.48 || cycle > 0.94) return null;
  return Math.round(60 + ((cycle - 0.48) / 0.46) * (width - 120));
}

export interface SkyLight {
  /** Multiplied over the baked layers. */
  ambient: RGB;
  /** Screen glows, one per body in the sky: the sun and the moon trade places over dusk and dawn. */
  rims: { x: number; color: RGB; k: number }[];
  /** Coarse key. Two lights with the same key look the same, so the lit copy is rebuilt only when it changes. */
  key: string;
}

/** The light the sky throws on the ground at this time. Driven by SKY_KEYFRAMES. */
export function skyLight(time: number, width = SKY_BOARD_WIDTH): SkyLight {
  const cycle = skyCycle(time);
  const state = getSkyState(cycle);
  const rims: SkyLight['rims'] = [];
  const sunX = sunBoardX(cycle, width);
  if (sunX !== null) {
    const weight = cycle >= 0.86 ? clamp01((cycle - 0.86) / 0.08) : cycle <= 0.46 ? 1 : clamp01((0.54 - cycle) / 0.08);
    if (weight > 0.01) rims.push({x: sunX, color: state.rim, k: state.rimK * weight});
  }
  const moonX = moonBoardX(cycle, width);
  if (moonX !== null) {
    const weight = clamp01((cycle - 0.48) / 0.08) * clamp01((0.94 - cycle) / 0.08);
    if (weight > 0.01) rims.push({x: moonX, color: state.rim, k: state.rimK * weight * 0.8});
  }
  const key = `${state.ambient.map((c) => c >> 2).join(',')}|${rims
    .map((r) => `${Math.round(r.x / 32)},${r.color.map((c) => c >> 3).join(',')},${Math.round(r.k * 40)}`)
    .join(';')}`;
  return {ambient: state.ambient, rims, key};
}

/** Soft glow centred on the sun or moon, as wide as the sky and half as tall. */
function fillRims(g: CanvasRenderingContext2D, light: SkyLight, originY: number, scale: number, rimX: (x: number) => number) {
  for (const rim of light.rims) {
    if (rim.k < 0.005) continue;
    g.save();
    g.translate(rimX(rim.x) * scale, (SKY_HORIZON_Y - originY) * scale);
    g.scale(1, 0.55);
    const radius = 560 * scale;
    const glow = g.createRadialGradient(0, 0, 0, 0, 0, radius);
    glow.addColorStop(0, `rgba(${rim.color[0]},${rim.color[1]},${rim.color[2]},${rim.k})`);
    glow.addColorStop(0.45, `rgba(${rim.color[0]},${rim.color[1]},${rim.color[2]},${rim.k * 0.42})`);
    glow.addColorStop(1, `rgba(${rim.color[0]},${rim.color[1]},${rim.color[2]},0)`);
    g.fillStyle = glow;
    g.fillRect(-radius, -radius, radius * 2, radius * 2);
    g.restore();
  }
}

interface LitCopy {
  canvas: HTMLCanvasElement;
  key: string;
}

/** One cached lit copy per baked layer. The WeakMap lets it go when the bake does. */
const litCopies = new WeakMap<HTMLCanvasElement, LitCopy>();

/**
 * A copy of a baked layer with the sky's light on it: multiplied by the ambient colour, then a soft screen
 * glow on the sun's or moon's side, then cut back to the layer's own alpha so the transparent sky above a
 * skyline stays transparent. Rebuilt only when the quantised light changes.
 */
function litCopy(layer: HTMLCanvasElement, originY: number, scale: number, light: SkyLight): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const key = `${originY}|${scale}|${light.key}`;
  let entry = litCopies.get(layer);
  if (!entry) {
    const canvas = document.createElement('canvas');
    canvas.width = layer.width;
    canvas.height = layer.height;
    entry = {canvas, key: ''};
    litCopies.set(layer, entry);
  }
  if (entry.key === key) return entry.canvas;
  const g = entry.canvas.getContext('2d');
  if (!g) return null;
  const {width, height} = entry.canvas;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'copy';
  g.drawImage(layer, 0, 0);
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = rgbStr(light.ambient);
  g.fillRect(0, 0, width, height);
  g.globalCompositeOperation = 'screen';
  fillRims(g, light, originY, scale, (x) => x);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(layer, 0, 0);
  g.globalCompositeOperation = 'source-over';
  entry.key = key;
  return entry.canvas;
}

export interface LightOptions {
  /** Bitmap pixels per board pixel of the layer. 1 unless it was baked larger. */
  scale?: number;
}

/**
 * Draws a baked layer at board position (x, y) with the sky's light on it. The layer is drawn at its
 * board size whatever its bake scale. Units are drawn later and are not lit by this.
 */
export function lightScenery(
  ctx: CanvasRenderingContext2D,
  layer: HTMLCanvasElement,
  x: number,
  y: number,
  time: number,
  options: LightOptions = {},
): void {
  const scale = options.scale ?? 1;
  const w = layer.width / scale;
  const h = layer.height / scale;
  const lit = litCopy(layer, y, scale, skyLight(time, SKY_BOARD_WIDTH)) ?? layer;
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = scale > 1;
  ctx.drawImage(lit, x, y, w, h);
  ctx.imageSmoothingEnabled = smooth;
}

export interface HorizonView {
  /** Bitmap pixels per board pixel of the baked skyline. */
  scale?: number;
  /** Board pixels to slide the skyline sideways, for camera parallax. The bare edge is filled with a mirror. */
  shiftX?: number;
}

/** The lit skyline, slid by `shiftX`. The strip it uncovers is a mirror of the skyline's own edge, so no gap shows. */
function drawHorizonLayer(ctx: CanvasRenderingContext2D, layer: CanvasImageSource, time: number, view?: HorizonView) {
  if (typeof HTMLCanvasElement === 'undefined' || !(layer instanceof HTMLCanvasElement)) {
    ctx.drawImage(layer, 0, 0);
    return;
  }
  const scale = view?.scale ?? 1;
  const w = layer.width / scale;
  const h = layer.height / scale;
  const lit = litCopy(layer, 0, scale, skyLight(time, SKY_BOARD_WIDTH)) ?? layer;
  const shift = Math.max(-w / 4, Math.min(w / 4, view?.shiftX ?? 0));
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = scale > 1;
  const d = Math.abs(shift);
  // The trailing skyline must not poke out past the board edge it is trailing behind.
  if (d > 0.01) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();
  }
  ctx.drawImage(lit, shift, 0, w, h);
  if (d > 0.01) {
    if (shift > 0) {
      ctx.translate(shift, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(lit, 0, 0, d * scale, h * scale, 0, 0, d, h);
    } else {
      ctx.translate(2 * w + shift, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(lit, (w - d) * scale, 0, d * scale, h * scale, w - d, 0, d, h);
    }
    ctx.restore();
  }
  ctx.imageSmoothingEnabled = smooth;
}

/** Lights an opaque rectangle that is drawn live (open water, the coastal strip): multiply, then the glow. */
function lightRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, time: number) {
  const light = skyLight(time, SKY_BOARD_WIDTH);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = rgbStr(light.ambient);
  ctx.fillRect(x, y, w, h);
  ctx.globalCompositeOperation = 'screen';
  fillRims(ctx, light, 0, 1, (rx) => rx);
  ctx.restore();
}

/**
 * Mist along the horizon in the sky's own horizon colour: a smooth gradient, thickest on the horizon
 * line, thinning up into the skyline and down the far ground. Never past 0.36, the old haze's strength.
 */
const mistPlates = new Map<string, HTMLCanvasElement>();

export function drawHorizonMist(ctx: CanvasRenderingContext2D, width: number, time: number) {
  if (!graphicsSettings().mist) return;
  const {horizon} = getSkyState(skyCycle(time));
  const top = SKY_HORIZON_Y - 30;
  const height = 140;
  const key = `${Math.ceil(width)}|${horizon.map((channel) => channel >> 2).join(',')}`;
  let plate = mistPlates.get(key);
  if (!plate && typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(width));
    canvas.height = height;
    const g = canvas.getContext('2d');
    if (g) {
      const mist = g.createLinearGradient(0, 0, 0, height);
      const stop = (a: number) => `rgba(${horizon[0]},${horizon[1]},${horizon[2]},${a})`;
      mist.addColorStop(0, stop(0));
      mist.addColorStop(30 / 140, stop(0.34));
      mist.addColorStop(0.5, stop(0.15));
      mist.addColorStop(0.78, stop(0.04));
      mist.addColorStop(1, stop(0));
      g.fillStyle = mist;
      g.fillRect(0, 0, canvas.width, height);
    }
    plate = canvas;
    mistPlates.set(key, plate);
    while (mistPlates.size > 4) {
      const oldest = mistPlates.keys().next().value;
      if (oldest === undefined) break;
      mistPlates.delete(oldest);
    }
  }
  ctx.save();
  if (plate && plate.getContext('2d')) {
    ctx.drawImage(plate, 0, top, width, height);
  } else {
    const mist = ctx.createLinearGradient(0, top, 0, top + height);
    const stop = (a: number) => `rgba(${horizon[0]},${horizon[1]},${horizon[2]},${a})`;
    mist.addColorStop(0, stop(0));
    mist.addColorStop(30 / 140, stop(0.34));
    mist.addColorStop(0.5, stop(0.15));
    mist.addColorStop(0.78, stop(0.04));
    mist.addColorStop(1, stop(0));
    ctx.fillStyle = mist;
    ctx.fillRect(0, top, width, height);
  }
  ctx.restore();
}

let moonSprite: HTMLCanvasElement | null = null;

/** A crescent moon with a genuinely transparent dark side: the cutout is destination-out on its own canvas. */
function moonCrescent(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  if (moonSprite) return moonSprite;
  const canvas = document.createElement('canvas');
  canvas.width = 24;
  canvas.height = 24;
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.fillStyle = PALETTE.sandCream;
  g.beginPath();
  g.arc(12, 12, 6, 0, Math.PI * 2);
  g.fill();
  g.globalCompositeOperation = 'destination-out';
  g.beginPath();
  g.arc(14, 11, 5, 0, Math.PI * 2);
  g.fill();
  moonSprite = canvas;
  return canvas;
}

/** Draws the moon at (x, y) at the current globalAlpha. */
function drawMoonCrescent(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const sprite = moonCrescent();
  if (sprite) {
    ctx.drawImage(sprite, x - 12, y - 12);
    return;
  }
  ctx.fillStyle = PALETTE.sandCream;
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, Math.PI * 2);
  ctx.fill();
}

// ============================================================================
// AMBIENT OCCLUSION & DROP SHADOW HELPER
// ============================================================================

/**
 * Draws an actual smooth ambient occlusion contact shadow underneath units,
 * vehicles, trees, and ground craters for realistic depth and grounding.
 */
export function drawAmbientOcclusionShadow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  contactWidth = rx * 1.2,
  alpha = 1.0,
) {
  if (alpha <= 0.005) return;
  ctx.save();
  if (alpha < 0.999) {
    ctx.globalAlpha = (ctx.globalAlpha || 1.0) * alpha;
  }
  // Soft radial ambient occlusion drop shadow
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, rx));
  grad.addColorStop(0, 'rgba(20, 16, 22, 0.75)');
  grad.addColorStop(0.45, 'rgba(28, 22, 28, 0.45)');
  grad.addColorStop(0.8, 'rgba(40, 32, 38, 0.15)');
  grad.addColorStop(1, 'rgba(40, 32, 38, 0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
  ctx.fill();

  // Dark contact crease line directly along the footprint
  ctx.fillStyle = 'rgba(12, 10, 14, 0.85)';
  ctx.fillRect(cx - contactWidth / 2, cy - 1, contactWidth, 2);
  ctx.restore();
}

const skyPlates = new Map<string, HTMLCanvasElement>();

/** A sky plate is rebuilt only when its key changes. Eight are enough for the light steps in play. */
function skyPlate(
  key: string,
  width: number,
  height: number,
  paint: (ctx: CanvasRenderingContext2D) => void,
): HTMLCanvasElement | null {
  const w = Math.max(1, Math.ceil(width));
  const h = Math.max(1, Math.ceil(height));
  const hit = skyPlates.get(key);
  if (hit && hit.width === w && hit.height === h) return hit;
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (!g) return null;
  paint(g);
  skyPlates.delete(key);
  skyPlates.set(key, canvas);
  while (skyPlates.size > 8) {
    const oldest = skyPlates.keys().next().value;
    if (oldest === undefined) break;
    skyPlates.delete(oldest);
  }
  return canvas;
}

function nightnessAt(cycle: number): number {
  if (cycle < 0.48 || cycle > 0.92) return 0;
  return Math.sin(((cycle - 0.48) / 0.44) * Math.PI);
}

function paintSkyGradient(ctx: CanvasRenderingContext2D, width: number, horizonY: number, cycle: number) {
  const {top, mid, horizon} = getSkyColors(cycle);
  const skyGrad = ctx.createLinearGradient(0, 0, 0, horizonY);
  skyGrad.addColorStop(0, rgbStr(top));
  skyGrad.addColorStop(0.55, rgbStr(mid));
  skyGrad.addColorStop(1, rgbStr(horizon));
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, width, horizonY);
}

function paintStars(ctx: CanvasRenderingContext2D, time: number, nightness: number) {
  if (nightness <= 0.02) return;
  STARS.forEach((st) => {
    const twinkle = Math.sin(time * 3.5 + st.seed);
    if (twinkle > -0.2) {
      ctx.fillStyle = twinkle > 0.4 ? PALETTE.sandCream : PALETTE.trenchMudBone;
      ctx.globalAlpha = nightness * Math.max(0.1, (twinkle + 0.3) * 0.7);
      ctx.fillRect(st.x, st.y, st.size, st.size);
    }
  });
  ctx.globalAlpha = 1.0;
}

function paintSun(ctx: CanvasRenderingContext2D, width: number, horizonY: number, cycle: number) {
  let sunP = -1;
  if (cycle >= 0.86) {
    sunP = (cycle - 0.86) / 0.68;
  } else if (cycle <= 0.54) {
    sunP = (cycle + 0.14) / 0.68;
  }
  if (sunP < 0 || sunP > 1) return;
  const sunX = Math.round(50 + sunP * (width - 100));
  const sunY = Math.round(horizonY - 12 - Math.sin(sunP * Math.PI) * 78);
  const sunAlpha = Math.max(0, Math.sin(sunP * Math.PI));
  const isSunset = sunP > 0.62;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const sunBloomR = 48;
  const sBloom = ctx.createRadialGradient(sunX, sunY, 3, sunX, sunY, sunBloomR);
  if (isSunset) {
    sBloom.addColorStop(0, `rgba(255, 210, 110, ${0.9 * sunAlpha})`);
    sBloom.addColorStop(0.25, `rgba(245, 130, 45, ${0.55 * sunAlpha})`);
    sBloom.addColorStop(0.7, `rgba(210, 70, 20, ${0.2 * sunAlpha})`);
    sBloom.addColorStop(1, 'rgba(180, 40, 10, 0)');
  } else {
    sBloom.addColorStop(0, `rgba(255, 245, 195, ${0.85 * sunAlpha})`);
    sBloom.addColorStop(0.3, `rgba(245, 195, 105, ${0.45 * sunAlpha})`);
    sBloom.addColorStop(0.7, `rgba(215, 140, 50, ${0.15 * sunAlpha})`);
    sBloom.addColorStop(1, 'rgba(180, 90, 20, 0)');
  }
  ctx.fillStyle = sBloom;
  ctx.beginPath();
  ctx.arc(sunX, sunY, sunBloomR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = sunAlpha;
  ctx.fillStyle = isSunset ? PALETTE.terracotta : PALETTE.sandCream;
  ctx.beginPath();
  ctx.arc(sunX, sunY, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PALETTE.sandCream;
  ctx.beginPath();
  ctx.arc(sunX, sunY, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function paintMoon(ctx: CanvasRenderingContext2D, width: number, horizonY: number, cycle: number) {
  if (cycle < 0.48 || cycle > 0.94) return;
  const moonP = (cycle - 0.48) / 0.46;
  const moonX = Math.round(60 + moonP * (width - 120));
  const moonY = Math.round(horizonY - 12 - Math.sin(moonP * Math.PI) * 72);
  const moonAlpha = Math.max(0, Math.sin(moonP * Math.PI));

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const moonBloomR = 36;
  const mBloom = ctx.createRadialGradient(moonX, moonY, 2, moonX, moonY, moonBloomR);
  mBloom.addColorStop(0, `rgba(210, 235, 255, ${0.75 * moonAlpha})`);
  mBloom.addColorStop(0.35, `rgba(140, 180, 220, ${0.3 * moonAlpha})`);
  mBloom.addColorStop(0.75, `rgba(70, 100, 150, ${0.1 * moonAlpha})`);
  mBloom.addColorStop(1, 'rgba(30, 50, 90, 0)');
  ctx.fillStyle = mBloom;
  ctx.beginPath();
  ctx.arc(moonX, moonY, moonBloomR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = moonAlpha;
  drawMoonCrescent(ctx, moonX, moonY);
  ctx.restore();
}

function paintClouds(ctx: CanvasRenderingContext2D, width: number, time: number, nightness: number) {
  const clouds = [
    {baseX: 80, y: 16, w: 72, h: 14},
    {baseX: 380, y: 32, w: 96, h: 16},
    {baseX: 720, y: 18, w: 84, h: 15},
    {baseX: 1040, y: 28, w: 110, h: 18},
  ];
  ctx.save();
  ctx.globalAlpha = 0.65 - nightness * 0.35;
  clouds.forEach((cl) => {
    const cx = Math.round((cl.baseX + time * 7) % (width + cl.w * 2) - cl.w);
    ctx.fillStyle = PALETTE.sandCream;
    ctx.fillRect(cx + 8, cl.y, cl.w - 16, cl.h - 4);
    ctx.fillRect(cx + 18, cl.y - 4, cl.w - 38, 4);
    ctx.fillStyle = PALETTE.trenchMudBone;
    ctx.fillRect(cx + 4, cl.y + cl.h - 5, cl.w - 8, 4);
  });
  ctx.restore();
}

function paintTreeAo(ctx: CanvasRenderingContext2D, width: number, horizonY: number) {
  const treeAo = ctx.createLinearGradient(0, horizonY - 6, 0, horizonY + 8);
  treeAo.addColorStop(0, 'rgba(20, 16, 22, 0.7)');
  treeAo.addColorStop(0.5, 'rgba(30, 24, 32, 0.35)');
  treeAo.addColorStop(1, 'rgba(30, 24, 32, 0)');
  ctx.fillStyle = treeAo;
  ctx.fillRect(0, horizonY - 6, width, 14);
}

function paintSeagulls(ctx: CanvasRenderingContext2D, width: number, time: number) {
  SEAGULLS.forEach((gull) => {
    const progress = gull.baseX + time * gull.speed;
    const gx = Math.round((((progress % (width + 80)) + (width + 80)) % (width + 80)) - 40);
    const gy = Math.round(gull.y + Math.sin(time * 2 + gull.seed) * 3);
    const isFlapUp = Math.sin(time * gull.flapRate + gull.seed) > 0;

    ctx.save();
    ctx.translate(gx, gy);
    if (gull.dir < 0) ctx.scale(-1, 1);

    ctx.fillStyle = PALETTE.sandCream;
    ctx.fillRect(-1, 0, 3, 2);
    ctx.fillRect(2, 0, 1, 1);

    if (isFlapUp) {
      ctx.fillStyle = PALETTE.sandCream;
      ctx.fillRect(-2, -1, 1, 2);
      ctx.fillRect(1, -1, 1, 2);
      ctx.fillStyle = PALETTE.trenchMudBone;
      ctx.fillRect(-3, -3, 1, 2);
      ctx.fillRect(2, -3, 1, 2);
    } else {
      ctx.fillStyle = PALETTE.sandCream;
      ctx.fillRect(-2, 0, 1, 1);
      ctx.fillRect(1, 0, 1, 1);
      ctx.fillStyle = PALETTE.trenchMudBone;
      ctx.fillRect(-4, 1, 2, 1);
      ctx.fillRect(2, 1, 2, 1);
    }

    ctx.restore();
  });
}

function paintSeaBars(ctx: CanvasRenderingContext2D, width: number, horizonY: number) {
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(0, horizonY - 2, width, 3);
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(0, horizonY, width, 2);
}

function paintSeaGlints(ctx: CanvasRenderingContext2D, width: number, horizonY: number, time: number) {
  for (let x = 0; x < width; x += 16) {
    const glint = Math.sin(time * 3 + x * 0.12);
    if (glint > 0.45) {
      ctx.fillStyle = PALETTE.sandCream;
      ctx.fillRect(x, horizonY - 1, 7, 1);
    }
  }
}

/**
 * Renders the top skybox. The gradient stays on a plate until the light changes.
 * The sun and the moon are drawn every frame, so they glide. Stars and clouds are painted
 * over them while live sky is on, and held on a plate when it is off. The trees cover the sun.
 */
export function drawSkyboxAndTreeline(
  ctx: CanvasRenderingContext2D,
  width: number,
  time: number,
  bakedHorizon?: CanvasImageSource,
  horizonView?: HorizonView,
) {
  const horizonY = 114;
  const cycle = skyCycle(time);
  const live = graphicsSettings().liveSky;
  const night = nightnessAt(cycle);
  const plateH = horizonY + 64;
  const wKey = Math.ceil(width);
  const lightKey = skyLight(time, width).key;
  const back = skyPlate(`land-back|${wKey}|${lightKey}|${live ? 'live' : 'still'}`, width, plateH, (g) => {
    paintSkyGradient(g, width, horizonY, cycle);
    if (!live) paintStars(g, time, night);
  });
  const front = skyPlate(`land-front|${wKey}|${bakedHorizon ? 'open' : 'trees'}|${live ? 'live' : lightKey}`, width, plateH, (g) => {
    if (!live) paintClouds(g, width, time, night);
    paintTreeAo(g, width, horizonY);
    if (!bakedHorizon) drawForestSilhouette(g, width, horizonY);
  });

  ctx.save();
  if (back && front) {
    ctx.drawImage(back, 0, 0);
    if (live) paintStars(ctx, time, night);
    paintSun(ctx, width, horizonY, cycle);
    paintMoon(ctx, width, horizonY, cycle);
    if (live) paintClouds(ctx, width, time, night);
    ctx.drawImage(front, 0, 0);
    if (bakedHorizon) drawHorizonLayer(ctx, bakedHorizon, time, horizonView);
  } else {
    paintSkyGradient(ctx, width, horizonY, cycle);
    paintStars(ctx, time, night);
    paintSun(ctx, width, horizonY, cycle);
    paintMoon(ctx, width, horizonY, cycle);
    paintClouds(ctx, width, time, night);
    paintTreeAo(ctx, width, horizonY);
    if (bakedHorizon) drawHorizonLayer(ctx, bakedHorizon, time, horizonView);
    else drawForestSilhouette(ctx, width, horizonY);
  }
  ctx.restore();
}

function drawForestSilhouette(
  ctx: CanvasRenderingContext2D,
  width: number,
  baseY: number,
) {
  // Background tree row (deep bunker charcoal silhouette & deep spruce sea)
  for (let x = -8; x < width + 24; x += 18) {
    const seed = Math.sin(x * 9.17) * 1000;
    const isPine = (Math.abs(Math.floor(seed)) % 2) === 0;
    const treeH = 22 + (Math.abs(Math.floor(seed * 0.4)) % 14);
    const ty = baseY - treeH;

    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(x + 5, baseY - 8, 3, 8);

    if (isPine) {
      ctx.fillStyle = PALETTE.spruceSea;
      ctx.fillRect(x + 5, ty, 3, 4);
      ctx.fillRect(x + 3, ty + 4, 7, 5);
      ctx.fillRect(x + 1, ty + 9, 11, 6);
      ctx.fillRect(x - 1, ty + 15, 15, 7);
    } else {
      ctx.fillStyle = PALETTE.bunkerCharcoal;
      ctx.fillRect(x + 1, ty + 2, 11, treeH - 6);
      ctx.fillRect(x + 3, ty, 7, 4);
      ctx.fillStyle = PALETTE.spruceSea;
      ctx.fillRect(x + 2, ty + 3, 9, treeH - 8);
    }
  }

  // Foreground tree row (#72745C oliveDrab, #8DA082 fieldSage, #527A71 spruceSea)
  for (let x = 0; x < width + 20; x += 14) {
    const seed = Math.cos(x * 13.33) * 1000;
    const isPine = (Math.abs(Math.floor(seed)) % 3) !== 0;
    const treeH = 18 + (Math.abs(Math.floor(seed * 0.5)) % 12);
    const ty = baseY - treeH;

    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(x + 4, baseY - 6, 2, 6);

    if (isPine) {
      ctx.fillStyle = PALETTE.fieldSage;
      ctx.fillRect(x + 4, ty, 2, 2);
      ctx.fillStyle = PALETTE.oliveDrab;
      ctx.fillRect(x + 3, ty + 2, 4, 3);
      ctx.fillStyle = PALETTE.fieldSage;
      ctx.fillRect(x + 3, ty + 5, 2, 2);
      ctx.fillStyle = PALETTE.oliveDrab;
      ctx.fillRect(x + 1, ty + 6, 8, 4);
      ctx.fillStyle = PALETTE.spruceSea;
      ctx.fillRect(x - 1, ty + 10, 12, 6);
      ctx.fillStyle = PALETTE.bunkerCharcoal;
      ctx.fillRect(x, ty + 14, 10, 2);
    } else {
      ctx.fillStyle = PALETTE.fieldSage;
      ctx.fillRect(x + 2, ty, 6, 3);
      ctx.fillStyle = PALETTE.oliveDrab;
      ctx.fillRect(x, ty + 3, 10, treeH - 8);
      ctx.fillStyle = PALETTE.spruceSea;
      ctx.fillRect(x + 1, ty + 5, 8, treeH - 10);
      ctx.fillStyle = PALETTE.bunkerCharcoal;
      ctx.fillRect(x + 1, baseY - 7, 8, 2);
    }
  }

  // Embankment seam right above rank headers
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(0, baseY - 2, width, 4);
  ctx.fillStyle = PALETTE.spruceSea;
  for (let x = 0; x < width; x += 6) {
    ctx.fillRect(x, baseY - 3, 3, 2);
  }
}

/**
 * Seagull flight profiles for maritime skybox
 */
const SEAGULLS = [
  { baseX: 80, y: 35, speed: 18, flapRate: 8, seed: 0, dir: 1 },
  { baseX: 130, y: 42, speed: 16, flapRate: 7.5, seed: 1.2, dir: 1 },
  { baseX: 105, y: 50, speed: 19, flapRate: 8.2, seed: 2.5, dir: 1 },
  { baseX: 540, y: 28, speed: 15, flapRate: 7, seed: 3.8, dir: 1 },
  { baseX: 860, y: 46, speed: -17, flapRate: 8, seed: 4.4, dir: -1 },
  { baseX: 910, y: 55, speed: -16, flapRate: 7.8, seed: 5.6, dir: -1 },
];

/**
 * Renders the open sea skybox for NAVY TEST and high seas maps.
 * The gradient stays on a plate until the light changes. The sun and the moon are drawn every frame.
 * Gulls run only while live sky is on. Islands and a frozen cloud plate cover the sun when it is low.
 */
export function drawSeaSkyboxAndHorizon(
  ctx: CanvasRenderingContext2D,
  width: number,
  time: number,
  bakedHorizon?: CanvasImageSource,
  horizonView?: HorizonView,
) {
  const horizonY = 114;
  const cycle = skyCycle(time);
  const live = graphicsSettings().liveSky;
  const night = nightnessAt(cycle);
  const plateH = horizonY + 64;
  const wKey = Math.ceil(width);
  const lightKey = skyLight(time, width).key;
  const back = skyPlate(`sea-back|${wKey}|${lightKey}|${live ? 'live' : 'still'}`, width, plateH, (g) => {
    paintSkyGradient(g, width, horizonY, cycle);
    if (!live) paintStars(g, time, night);
  });
  const front = skyPlate(`sea-front|${wKey}|${bakedHorizon ? 'open' : 'islands'}|${live ? 'live' : lightKey}`, width, plateH, (g) => {
    if (!live) {
      paintClouds(g, width, time, night);
      paintSeagulls(g, width, time);
    }
    if (!bakedHorizon) drawDistantSeaIslands(g, width, horizonY);
  });

  ctx.save();
  if (back && front) {
    ctx.drawImage(back, 0, 0);
    if (live) paintStars(ctx, time, night);
    paintSun(ctx, width, horizonY, cycle);
    paintMoon(ctx, width, horizonY, cycle);
    if (live) {
      paintClouds(ctx, width, time, night);
      paintSeagulls(ctx, width, time);
    }
    ctx.drawImage(front, 0, 0);
    if (bakedHorizon) drawHorizonLayer(ctx, bakedHorizon, time, horizonView);
  } else {
    paintSkyGradient(ctx, width, horizonY, cycle);
    paintStars(ctx, time, night);
    paintSun(ctx, width, horizonY, cycle);
    paintMoon(ctx, width, horizonY, cycle);
    paintClouds(ctx, width, time, night);
    paintSeagulls(ctx, width, time);
    if (bakedHorizon) drawHorizonLayer(ctx, bakedHorizon, time, horizonView);
    else drawDistantSeaIslands(ctx, width, horizonY);
  }
  paintSeaBars(ctx, width, horizonY);
  if (live) paintSeaGlints(ctx, width, horizonY, time);
  ctx.restore();
}


/**
 * Draws occasional small distant rocky/tropical pixel islands with sandbars on the sea horizon
 * using strictly palette colors #7D6652 (earthBrown), #DFCE91 (sandCream), #72745C (oliveDrab),
 * #CAA574 (sandTan), #8DA082 (fieldSage), #423840 (bunkerCharcoal).
 */
function drawDistantSeaIslands(
  ctx: CanvasRenderingContext2D,
  width: number,
  baseY: number,
) {
  // Island 1 (Left sector, X ~ 210): Distant rocky island with sloping ridge & sand spit
  const i1X = 210;
  // Rocky knoll
  ctx.fillStyle = PALETTE.earthBrown; // #7D6652
  ctx.beginPath();
  ctx.moveTo(i1X - 32, baseY);
  ctx.lineTo(i1X - 16, baseY - 8);
  ctx.lineTo(i1X - 4, baseY - 12);
  ctx.lineTo(i1X + 8, baseY - 7);
  ctx.lineTo(i1X + 28, baseY);
  ctx.closePath();
  ctx.fill();

  // Shadow slope on the left
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(i1X - 22, baseY - 6, 12, 6);

  // Tropical vegetation crest in #72745C & #8DA082
  ctx.fillStyle = PALETTE.oliveDrab; // #72745C
  ctx.fillRect(i1X - 10, baseY - 13, 8, 3);
  ctx.fillRect(i1X - 6, baseY - 14, 4, 2);
  ctx.fillStyle = PALETTE.fieldSage;
  ctx.fillRect(i1X - 4, baseY - 13, 3, 2);

  // Sandy beach & sandbars extending into the sea in #DFCE91 & #CAA574
  ctx.fillStyle = PALETTE.sandTan;
  ctx.fillRect(i1X - 36, baseY - 2, 70, 3);
  ctx.fillStyle = PALETTE.sandCream; // #DFCE91
  ctx.fillRect(i1X - 40, baseY - 1, 78, 2);
  ctx.fillRect(i1X + 16, baseY - 2, 28, 2); // extended sandbar spit

  // Island 2 (Center sector, X ~ 670): Small low tropical atoll with sandbar
  const i2X = 670;
  ctx.fillStyle = PALETTE.earthBrown;
  ctx.fillRect(i2X - 18, baseY - 5, 36, 5);
  ctx.fillRect(i2X - 8, baseY - 8, 18, 4);

  // Lush scrub tufts
  ctx.fillStyle = PALETTE.oliveDrab;
  ctx.fillRect(i2X - 12, baseY - 9, 8, 3);
  ctx.fillRect(i2X + 2, baseY - 7, 7, 3);
  ctx.fillStyle = PALETTE.fieldSage;
  ctx.fillRect(i2X - 10, baseY - 10, 4, 2);

  // Long flat sandbar
  ctx.fillStyle = PALETTE.sandTan;
  ctx.fillRect(i2X - 26, baseY - 2, 54, 3);
  ctx.fillStyle = PALETTE.sandCream;
  ctx.fillRect(i2X - 30, baseY - 1, 62, 2);

  // Island 3 (Right sector, X ~ 1080): Distant volcanic knoll with sandy rim
  const i3X = 1080;
  ctx.fillStyle = PALETTE.earthBrown;
  ctx.beginPath();
  ctx.moveTo(i3X - 26, baseY);
  ctx.lineTo(i3X - 8, baseY - 11);
  ctx.lineTo(i3X + 4, baseY - 10);
  ctx.lineTo(i3X + 22, baseY);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(i3X - 14, baseY - 7, 8, 7);

  // Green crest
  ctx.fillStyle = PALETTE.oliveDrab;
  ctx.fillRect(i3X - 10, baseY - 12, 12, 3);
  ctx.fillStyle = PALETTE.sandCream;
  ctx.fillRect(i3X - 30, baseY - 1, 58, 2);
}

/**
 * Draws independent world-space bullets and tracers fired by aircraft
 * with actual Canvas 2D radial gradient bloom.
 */
export function drawPlaneBullets(
  ctx: CanvasRenderingContext2D,
  bullets: PlaneBullet[],
) {
  bullets.forEach((b) => {
    ctx.save();
    const bx = Math.round(b.x);
    const by = Math.round(b.y);

    // Trail
    for (let i = 0; i < b.trail.length; i++) {
      const pt = b.trail[i];
      const a = (i / b.trail.length) * 0.7;
      ctx.fillStyle = PALETTE.sandCream;
      ctx.globalAlpha = a * 0.6;
      ctx.fillRect(Math.round(pt.x) - 1, Math.round(pt.y) - 1, 3, 3);
    }

    // ACTUAL RADIAL GRADIENT BLOOM ON PLANE BULLET (lighter blend)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const bloomR = 10;
    const bGrad = ctx.createRadialGradient(bx, by, 1, bx, by, bloomR);
    bGrad.addColorStop(0, 'rgba(255, 250, 200, 0.85)');
    bGrad.addColorStop(0.3, 'rgba(255, 200, 90, 0.45)');
    bGrad.addColorStop(0.7, 'rgba(220, 120, 40, 0.15)');
    bGrad.addColorStop(1, 'rgba(180, 80, 20, 0)');
    ctx.fillStyle = bGrad;
    ctx.beginPath();
    ctx.arc(bx, by, bloomR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Solid core
    ctx.globalAlpha = 1.0;
    ctx.fillStyle = PALETTE.sandCream;
    ctx.fillRect(bx - 2, by - 1, 5, 2);

    ctx.restore();
  });
}

/**
 * Draws the WWII top-down battlefield terrain sharp and level with the troops
 * using actual ambient occlusion around craters and terrain revetments.
 */
/**
 * Renders the Open Ocean Maritime Environment for NAVY TEST.
 * Features dithered deep-navy ocean background with horizontally scrolling
 * 1-bit wave ticks and water foam to simulate dynamic open-sea swells.
 */
export function drawOpenOceanBattlefield(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  dynamicCraters?: GroundCrater[],
  bloodPuddles?: BloodPuddle[],
  casualtyRecords?: CasualtyRecord[],
  sea?: Extract<BakedScenery, { kind: 'sea' }>,
  horizonView?: HorizonView,
) {
  const look = sea?.look;
  const swellScale = look?.swell ?? 1;
  const phase = look?.phase ?? 0;

  // 1. Dynamic open sea skybox with distant islands & animated seagulls (Zero Trees!)
  drawSeaSkyboxAndHorizon(ctx, width, time, sea?.horizon, sea ? {scale: sea.scale, ...horizonView} : horizonView);

  const horizonY = 114;

  // 2. Distant open ocean horizon seam (clean ocean horizon)
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(0, horizonY - 4, width, 5);
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(0, horizonY - 2, width, 3);
  ctx.fillStyle = PALETTE.sandCream;
  if (graphicsSettings().liveSky) {
    for (let x = 0; x < width; x += 18) {
      const glint = Math.sin(time * 3 + x * 0.1);
      if (glint > 0.4) {
        ctx.fillRect(x, horizonY - 2, 8, 1);
      }
    }
  }

  // 3. Deep Navy Ocean Floor Fill (Y: 114 to height)
  const oceanGrad = ctx.createLinearGradient(0, horizonY, 0, height);
  oceanGrad.addColorStop(0, look?.surface ?? PALETTE.navalSteel);
  oceanGrad.addColorStop(0.35, look?.mid ?? PALETTE.spruceSea);
  oceanGrad.addColorStop(0.7, look?.deep ?? PALETTE.bunkerCharcoal);
  oceanGrad.addColorStop(1, look?.deep ?? PALETTE.bunkerCharcoal);
  ctx.fillStyle = oceanGrad;
  ctx.fillRect(0, horizonY, width, height - horizonY);

  // 4. One repeating strip of wave ticks per colour, scrolled when the sea is set to move.
  const [tickA, tickB] = look?.ticks ?? [PALETTE.spruceSea, PALETTE.navalSteel];
  const seaMoves = graphicsSettings().animatedSea;
  drawOceanWaveRows(ctx, width, height, horizonY, time, swellScale, phase, {
    tickA,
    tickB,
    foam: look?.foam ?? PALETTE.sandCream,
  }, seaMoves);

  // 4b. Arctic zones carry drifting ice floes
  if (look?.ice) {
    const drift = seaMoves ? time : 0;
    for (let i = 0; i < 9; i++) {
      const w = 18 + ((i * 37) % 30);
      const fx = Math.round((((i * 151 + drift * 4) % (width + 80)) + width + 80) % (width + 80)) - 40;
      const fy = horizonY + 30 + ((i * 97) % (height - horizonY - 60));
      ctx.fillStyle = PALETTE.navalSteel;
      ctx.fillRect(fx + 2, fy + 3, w, 4);
      ctx.fillStyle = PALETTE.sandCream;
      ctx.fillRect(fx, fy, w, 4);
      ctx.fillStyle = PALETTE.trenchMudBone;
      ctx.fillRect(fx + 3, fy + 3, w - 6, 1);
    }
  }

  // 5. Tactical Nautical Chart Grid Lines
  ctx.save();
  ctx.strokeStyle = PALETTE.deepTaupe;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 8]);
  for (let gx = 100; gx < width; gx += 110) {
    ctx.beginPath();
    ctx.moveTo(gx, horizonY);
    ctx.lineTo(gx, height);
    ctx.stroke();
  }
  for (let gy = 160; gy < height; gy += 95) {
    ctx.beginPath();
    ctx.moveTo(30, gy);
    ctx.lineTo(width - 30, gy);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();

  // 5b. The sky's light on the water, then mist on the horizon.
  lightRect(ctx, 0, horizonY, width, height - horizonY, time);
  drawHorizonMist(ctx, width, time);

  // 6. Underwater Depth-Charge Churns & Ocean Impact Vortices (Dynamic Craters on Sea)
  if (dynamicCraters && dynamicCraters.length > 0) {
    dynamicCraters.forEach((dc) => {
      const alpha = dc.alpha !== undefined ? dc.alpha : 1.0;
      if (alpha <= 0.001) return;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

      // Expanding concentric churned water rings
      ctx.strokeStyle = PALETTE.sandCream;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(dc.x, dc.y, dc.rx + 4, dc.ry + 2, 0, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = PALETTE.spruceSea;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(dc.x, dc.y, dc.rx, dc.ry, 0, 0, Math.PI * 2);
      ctx.stroke();

      // Deep dark underwater vortex center
      ctx.fillStyle = PALETTE.bunkerCharcoal;
      ctx.beginPath();
      ctx.ellipse(dc.x, dc.y, Math.max(2, dc.rx * 0.5), Math.max(1, dc.ry * 0.5), 0, 0, Math.PI * 2);
      ctx.fill();

      // Foam spray flecks
      ctx.fillStyle = PALETTE.sandCream;
      ctx.fillRect(Math.round(dc.x - 3), Math.round(dc.y - 1), 3, 2);
      ctx.fillRect(Math.round(dc.x + 2), Math.round(dc.y), 2, 2);
      ctx.restore();
    });
  }

  // 7. Expanding Dark Oil Slicks & Floating Wooden Wreckage from Casualties
  if (casualtyRecords && casualtyRecords.length > 0) {
    casualtyRecords.forEach((rec) => {
      if (rec.fluidAlpha <= 0.001) return;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, rec.fluidAlpha));
      const fx = Math.round(rec.x);
      const fy = Math.round(rec.y + 4);

      // Expanding dark bunker charcoal oil slick on water
      ctx.fillStyle = PALETTE.bunkerCharcoal;
      ctx.beginPath();
      ctx.ellipse(fx, fy, rec.fluidRx * 1.3, rec.fluidRy * 1.1, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = PALETTE.deepTaupe;
      ctx.beginPath();
      ctx.ellipse(fx, fy - 1, rec.fluidRx * 0.85, rec.fluidRy * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();

      // Iridescent oil sheen flecks
      ctx.fillStyle = PALETTE.navalSteel;
      ctx.fillRect(fx - 5, fy, 4, 1.5);
      ctx.fillStyle = PALETTE.mustardBrass;
      ctx.fillRect(fx + 3, fy - 1, 3, 1);
      ctx.fillStyle = PALETTE.spruceSea;
      ctx.fillRect(fx - 2, fy + 2, 3, 1);

      // Floating wooden crates & debris wreckage rocking in the swells
      const debrisBob = Math.sin(time * 3 + fx * 0.05) * 1.5;
      ctx.fillStyle = PALETTE.khakiLeather;
      ctx.fillRect(fx - 9, Math.round(fy - 3 + debrisBob), 5, 4);
      ctx.fillStyle = PALETTE.earthBrown;
      ctx.fillRect(fx - 9, Math.round(fy - 3 + debrisBob), 5, 1);
      ctx.fillRect(fx + 7, Math.round(fy - 2 - debrisBob), 6, 3);
      ctx.fillStyle = PALETTE.sandTan;
      ctx.fillRect(fx + 8, Math.round(fy - 1 - debrisBob), 4, 1);

      ctx.restore();
    });
  }

  // 8. Standalone oil puddles
  if (bloodPuddles && bloodPuddles.length > 0) {
    bloodPuddles.forEach((p) => {
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = PALETTE.bunkerCharcoal;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.rx, p.ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = PALETTE.navalSteel;
      ctx.fillRect(Math.round(p.x - 3), Math.round(p.y), 3, 1.5);
      ctx.fillStyle = PALETTE.mustardBrass;
      ctx.fillRect(Math.round(p.x + 2), Math.round(p.y - 1), 2, 1);
      ctx.restore();
    });
  }
}

/** How the backdrop is seen. The default is the plain view the combat screen has always had. */
export interface BackdropView {
  /**
   * Board pixels to slide the skyline sideways, for camera parallax. 0 draws it where it was baked. The
   * skyline is decoration: units, hit tests and the zoom anchor all use board coordinates and ignore it.
   */
  horizonShiftX?: number;
}

export function drawWWIIBattlefield(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  theater: TheaterId,
  dynamicCraters?: GroundCrater[],
  bloodPuddles?: BloodPuddle[],
  casualtyRecords?: CasualtyRecord[],
  scenery?: BakedScenery | null,
  view?: BackdropView,
) {
  const horizonView: HorizonView = {shiftX: view?.horizonShiftX ?? 0};

  // If theater is NAVY TEST or AIR STRIKE TEST: Render full open-sea maritime battleground
  if (theater === 'navy_test' || theater === 'air_strike_test' || scenery?.kind === 'sea') {
    const sea = scenery?.kind === 'sea' ? scenery : undefined;
    drawOpenOceanBattlefield(ctx, width, height, time, dynamicCraters, bloodPuddles, casualtyRecords, sea, horizonView);
    return;
  }

  if (scenery?.kind === 'land') {
    const bakedView: HorizonView = {...horizonView, scale: scenery.scale};
    if (scenery.island) {
      drawSeaSkyboxAndHorizon(ctx, width, time, scenery.horizon, bakedView);
    } else {
      drawSkyboxAndTreeline(ctx, width, time, scenery.horizon, bakedView);
    }
    // The sky lights the field. Craters and blood dug during the fight go on after, unlit.
    lightScenery(ctx, scenery.ground, 0, 114, time, {scale: scenery.scale});
    drawBattleScars(ctx, scenery.dirt, dynamicCraters, bloodPuddles, casualtyRecords);
    drawHorizonMist(ctx, width, time);
    return;
  }

  // 1. Render Skybox: Sea skybox with islands & seagulls for Pacific, or Treeline for land theaters
  if (theater === 'pacific') {
    drawSeaSkyboxAndHorizon(ctx, width, time, undefined, horizonView);
  } else {
    drawSkyboxAndTreeline(ctx, width, time);
  }

  // 2. The field. Baked once per theatre; drawn straight when there is no document to bake on.
  const tones = fallbackTones(theater);
  const baked = fallbackGround(theater, width);
  if (baked) {
    lightScenery(ctx, baked, 0, GROUND_TOP, time);
  } else {
    paintFallbackGround(ctx, width, tones);
  }

  drawBattleScars(ctx, tones.dirt, dynamicCraters, bloodPuddles, casualtyRecords);
  drawHorizonMist(ctx, width, time);
}

/**
 * The strip below the board: the baked inland edge in the sky's light, or the animated sea. The combat screen
 * and the field preview both call this where they used to blit `scenery.edge` or call `drawAnimatedSea` themselves.
 */
export function drawSceneryEdge(
  ctx: CanvasRenderingContext2D,
  scenery: BakedScenery | null | undefined,
  width: number,
  height: number,
  time: number,
) {
  if (scenery?.kind === 'land' && scenery.edge) {
    lightScenery(ctx, scenery.edge, 0, 525, time, {scale: scenery.scale});
  } else {
    drawAnimatedSea(ctx, width, height, time);
  }
}

interface FallbackTones {
  base: string;
  patch: string;
  dirt: string;
}

function fallbackTones(theater: TheaterId): FallbackTones {
  if (theater === 'eastern') {
    return { base: PALETTE.feldgrau, patch: PALETTE.trenchMudBone, dirt: PALETTE.deepTaupe };
  }
  if (theater === 'north_africa') {
    return { base: PALETTE.sandTan, patch: PALETTE.sandCream, dirt: PALETTE.terracotta };
  }
  if (theater === 'pacific') {
    return { base: PALETTE.sandCream, patch: PALETTE.fieldSage, dirt: PALETTE.sandTan };
  }
  return { base: PALETTE.oliveDrab, patch: PALETTE.fieldSage, dirt: PALETTE.earthBrown };
}

/**
 * The plain theatre field, in the same one-point perspective as the region ground:
 * trench, parapet, wire and grid lean toward the vanishing point, craters lie flat.
 * Painted in board coordinates.
 */
function paintFallbackGround(ctx: Paint, width: number, tones: FallbackTones): void {
  const flat = squashPaint(ctx);

  // A gray undercoat, then the biome colour at a wash, so the grass sits back from a 1px unit mark.
  ctx.fillStyle = groundMate(tones.base);
  ctx.fillRect(0, GROUND_TOP, width, GROUND_BOTTOM - GROUND_TOP);
  ctx.globalAlpha = LAND_GROUND_WASH;
  ctx.fillStyle = tones.base;
  ctx.fillRect(0, GROUND_TOP, width, GROUND_BOTTOM - GROUND_TOP);

  // Mottled patches of field, flattened toward the horizon.
  flat.fillStyle = tones.patch;
  for (let gx = 0; gx < width; gx += 64) {
    for (let gy = 120; gy < 520; gy += 48) {
      const hash = Math.sin(gx * 12.9898 + gy * 78.233) * 43758.5453;
      const noise = hash - Math.floor(hash);
      if (noise > 0.55) {
        flat.fillRect(gx + 4, gy + 4, 32, 20);
      }
    }
  }
  ctx.globalAlpha = 1;

  // Supply road along the horizon, behind the frontline rank headers.
  flat.fillStyle = groundMate(tones.dirt);
  flat.fillRect(0, 115, width, 6);
  ctx.globalAlpha = LAND_GROUND_WASH;
  flat.fillStyle = tones.dirt;
  flat.fillRect(0, 115, width, 6);
  ctx.globalAlpha = 1;
  flat.fillStyle = PALETTE.bunkerCharcoal;
  for (let rx = 10; rx < width; rx += 24) {
    flat.fillRect(rx, 116, 8, 4);
  }

  paintGrid(ctx, width, PALETTE.deepTaupe, LAND_GRID_ALPHA);

  paintTrench(ctx, 470, false);
  paintTrench(ctx, 810, false);

  const craters = [
    {x: 520, y: 360, r: 16},
    {x: 760, y: 380, r: 14},
    {x: 640, y: 440, r: 20},
    {x: 580, y: 490, r: 12},
    {x: 700, y: 495, r: 15},
    {x: 490, y: 420, r: 10},
    {x: 790, y: 430, r: 11},
  ];
  for (const c of craters) paintCrater(ctx, c.x, c.y, c.r, tones.dirt);

  paintWire(ctx);
  paintParapet(ctx, 470, -15);
  paintParapet(ctx, 810, 5);
  // The far haze is drawn live, smooth, by drawHorizonMist.
}

const fallbackGroundCache = new Map<string, HTMLCanvasElement>();

function fallbackGround(theater: TheaterId, width: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const key = `${theater}|${width}`;
  const hit = fallbackGroundCache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = GROUND_BOTTOM - GROUND_TOP;
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.imageSmoothingEnabled = false;
  g.translate(0, -GROUND_TOP);
  paintFallbackGround(g, width, fallbackTones(theater));
  // Same post-bake tone curve as the region fields.
  g.setTransform(1, 0, 0, 1, 0, 0);
  const painted = g.getImageData(0, 0, canvas.width, canvas.height);
  g.putImageData(new ImageData(toneCurve(painted.data), canvas.width, canvas.height), 0, 0);
  fallbackGroundCache.set(key, canvas);
  return canvas;
}

/** Craters, blood and oil left by the fight. Drawn over the field, under the units. */
function drawBattleScars(
  ctx: CanvasRenderingContext2D,
  dirtColor: string,
  dynamicCraters?: GroundCrater[],
  bloodPuddles?: BloodPuddle[],
  casualtyRecords?: CasualtyRecord[],
) {
  // 4b. Draw Dynamic Combat Craters & Small Casualty Craters (layered UNDERNEATH fluids & units!)
  if (dynamicCraters && dynamicCraters.length > 0) {
    dynamicCraters.forEach((dc) => {
      const alpha = dc.alpha !== undefined ? dc.alpha : 1.0;
      if (alpha > 0.001) {
        const { rx, ry } = decalRadii(dc.rx, dc.y);
        drawSingleCrater(ctx, dc.x, dc.y, rx, ry, dirtColor, alpha);
      }
    });
  }

  // 4c. Draw Ground Blood & Engine Oil/Fuel Puddles from casualties (anchored to fixed ground coordinates)
  if (casualtyRecords && casualtyRecords.length > 0) {
    casualtyRecords.forEach((rec) => {
      if (rec.fluidAlpha <= 0.001) return;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, rec.fluidAlpha));
      const fx = Math.round(rec.x);
      const fy = Math.round(rec.y + 4);
      const fluid = decalRadii(rec.fluidRx, fy);

      if (rec.fluidType === 'oil') {
        ctx.fillStyle = PALETTE.bunkerCharcoal;
        ctx.beginPath();
        ctx.ellipse(fx, fy, fluid.rx, fluid.ry, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = PALETTE.deepTaupe;
        ctx.beginPath();
        ctx.ellipse(fx, fy - 1, fluid.rx * 0.7, fluid.ry * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();

        // Subtle rainbow sheen flecks
        ctx.fillStyle = PALETTE.navalSteel;
        ctx.fillRect(fx - 3, fy, 3, 1.5);
        ctx.fillStyle = PALETTE.mustardBrass;
        ctx.fillRect(fx + 2, fy - 1, 2, 1);
      } else {
        ctx.fillStyle = PALETTE.crimson;
        ctx.beginPath();
        ctx.ellipse(fx, fy, fluid.rx, fluid.ry, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = PALETTE.plum;
        ctx.beginPath();
        ctx.ellipse(fx, fy, fluid.rx * 0.55, fluid.ry * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });
  }

  // 4d. Draw Standalone Blood Puddles from impacts
  if (bloodPuddles && bloodPuddles.length > 0) {
    bloodPuddles.forEach((p) => {
      ctx.save();
      ctx.globalAlpha = p.alpha;
      const pool = decalRadii(p.rx, p.y);
      if (p.type === 'oil') {
        ctx.fillStyle = PALETTE.bunkerCharcoal;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, pool.rx, pool.ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = PALETTE.deepTaupe;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y - 1, pool.rx * 0.7, pool.ry * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = PALETTE.navalSteel;
        ctx.fillRect(Math.round(p.x - 3), Math.round(p.y), 3, 1.5);
        ctx.fillStyle = PALETTE.mustardBrass;
        ctx.fillRect(Math.round(p.x + 2), Math.round(p.y - 1), 2, 1);
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, pool.rx, pool.ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = PALETTE.plum;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, pool.rx * 0.55, pool.ry * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });
  }

}

function drawSingleCrater(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  dirtColor: string,
  alpha = 1.0,
) {
  if (alpha <= 0.001) return;
  const isSmall = rx <= 6;
  const aoSpread = isSmall ? 3 : 8;
  const rimSpread = isSmall ? 1.5 : 3;

  ctx.save();
  if (alpha < 0.999) {
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  }

  // ACTUAL AMBIENT OCCLUSION: soft dark radial drop shadow / contact crease surrounding crater
  const aoGrad = ctx.createRadialGradient(cx, cy, rx * 0.5, cx, cy, rx + aoSpread);
  aoGrad.addColorStop(0, 'rgba(20, 16, 22, 0.65)');
  aoGrad.addColorStop(0.65, 'rgba(35, 28, 34, 0.28)');
  aoGrad.addColorStop(1, 'rgba(35, 28, 34, 0)');
  ctx.fillStyle = aoGrad;
  ctx.beginPath();
  ctx.ellipse(cx, cy + 1, rx + aoSpread, ry + (isSmall ? 2 : 5), 0, 0, Math.PI * 2);
  ctx.fill();

  // Uplifted rim
  ctx.fillStyle = dirtColor;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx + rimSpread, ry + rimSpread * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();
  // Inner scorch ring
  ctx.fillStyle = PALETTE.deepTaupe;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  // Deep pit
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.beginPath();
  ctx.ellipse(cx - 0.5, cy - 0.5, Math.max(1, rx * 0.55), Math.max(1, ry * 0.5), 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/**
 * Animated Coastal Sea at the edge of the troop lines (Y: 525 to 720)
 */
export function drawAnimatedSea(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
) {
  const seaTop = 525;
  const animated = graphicsSettings().animatedSea;
  const motion = animated ? time : 0;

  ctx.fillStyle = PALETTE.sandTan;
  ctx.fillRect(0, seaTop, width, 14);

  const surfLapping = Math.sin(motion * 2.2) * 4;
  ctx.fillStyle = PALETTE.khakiLeather;
  ctx.fillRect(0, seaTop + 8, width, 6);

  ctx.fillStyle = PALETTE.spruceSea;
  ctx.fillRect(0, seaTop + 14, width, height - (seaTop + 14));

  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(0, seaTop + 50, width, height - (seaTop + 50));

  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(0, seaTop + 130, width, height - (seaTop + 130));

  drawCoastalWaveRows(ctx, width, seaTop, height, time, {
    wave: PALETTE.spruceSea,
    foam: PALETTE.sandCream,
  }, animated);

  ctx.fillStyle = PALETTE.sandCream;
  for (let x = 0; x < width; x += 12) {
    const waveEdge = Math.sin(motion * 3 + x * 0.05) * 3 + surfLapping;
    ctx.fillRect(x, seaTop + 14 + waveEdge, 10, 3);
  }

  // The same sky that lights the field lights the water.
  lightRect(ctx, 0, seaTop, width, height - seaTop, time);
}

// ============================================================================
// CLEAN RANK BADGES & PIXEL-ART ROMAN NUMERALS (I, II, III, IV)
// ============================================================================

export const ROMAN_PIXEL_BITMAPS: Record<string, number[][]> = {
  'I': [
    [1, 1, 1],
    [0, 1, 0],
    [0, 1, 0],
    [0, 1, 0],
    [1, 1, 1],
  ],
  'II': [
    [1, 1, 0, 1, 1],
    [0, 1, 0, 0, 1],
    [0, 1, 0, 0, 1],
    [0, 1, 0, 0, 1],
    [1, 1, 0, 1, 1],
  ],
  'III': [
    [1, 1, 0, 1, 1, 0, 1, 1],
    [0, 1, 0, 0, 1, 0, 0, 1],
    [0, 1, 0, 0, 1, 0, 0, 1],
    [0, 1, 0, 0, 1, 0, 0, 1],
    [1, 1, 0, 1, 1, 0, 1, 1],
  ],
  'IV': [
    [1, 0, 0, 0, 1, 0, 1, 1, 1],
    [1, 0, 0, 0, 1, 0, 0, 1, 0],
    [0, 1, 0, 1, 0, 0, 0, 1, 0],
    [0, 1, 0, 1, 0, 0, 0, 1, 0],
    [0, 0, 1, 0, 0, 0, 1, 1, 1],
  ],
};

export function drawPixelRomanNumeral(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  startY: number,
  roman: 'I' | 'II' | 'III' | 'IV',
  color: string,
  shadowColor?: string,
  pixelSize = 2,
) {
  const bitmap = ROMAN_PIXEL_BITMAPS[roman];
  if (!bitmap) return;
  const h = bitmap.length;
  const w = bitmap[0].length;
  const totalW = w * pixelSize;
  const startX = Math.round(centerX - totalW / 2);

  if (shadowColor) {
    ctx.fillStyle = shadowColor;
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        if (bitmap[r][c]) {
          ctx.fillRect(startX + c * pixelSize + 1, startY + r * pixelSize + 1, pixelSize, pixelSize);
        }
      }
    }
  }

  ctx.fillStyle = color;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (bitmap[r][c]) {
        ctx.fillRect(startX + c * pixelSize, startY + r * pixelSize, pixelSize, pixelSize);
      }
    }
  }
}

/**
 * Draws a simple, crisp pixel-art Roman numeral badge ("I", "II", "III", "IV")
 * positioned cleanly at the top of each rank column without any background dimming.
 */
export function drawPixelRankBadge(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  y: number,
  roman: 'I' | 'II' | 'III' | 'IV',
  isActive: boolean,
  side: 'attacker' | 'defender',
  alpha = 1.0,
) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

  const badgeW = 44;
  const badgeH = 20;
  const bx = Math.round(centerX - badgeW / 2);
  const by = Math.round(y);

  // 1-bit drop shadow
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(bx + 1, by + 1, badgeW, badgeH);

  // Thematic background plate
  if (isActive) {
    ctx.fillStyle = side === 'attacker' ? PALETTE.crimson : PALETTE.spruceSea;
  } else {
    ctx.fillStyle = PALETTE.bunkerCharcoal;
  }
  ctx.fillRect(bx, by, badgeW, badgeH);

  // Bevel border
  ctx.strokeStyle = isActive ? PALETTE.sandCream : PALETTE.deepTaupe;
  ctx.lineWidth = isActive ? 1.5 : 1;
  ctx.strokeRect(bx, by, badgeW, badgeH);

  // Corner rivets for active state
  if (isActive) {
    ctx.fillStyle = PALETTE.mustardBrass;
    ctx.fillRect(bx + 2, by + 2, 2, 2);
    ctx.fillRect(bx + badgeW - 4, by + 2, 2, 2);
    ctx.fillRect(bx + 2, by + badgeH - 4, 2, 2);
    ctx.fillRect(bx + badgeW - 4, by + badgeH - 4, 2, 2);
  }

  // Crisp Roman numeral in pixel art
  const numColor = isActive ? PALETTE.sandCream : PALETTE.sandTan;
  const shadowColor = PALETTE.bunkerCharcoal;
  drawPixelRomanNumeral(ctx, centerX, by + 5, roman, numColor, shadowColor, 2);

  ctx.restore();
}

/**
 * A transport in a sea battle is a naval token: faction disc, waterline, hull and holds.
 * The old matrix sprite was a flat bar and read as a road.
 */
function drawNavalTransportToken(
  ctx: CanvasRenderingContext2D,
  factionColor: string,
  time: number,
): void {
  const bob = Math.sin(time * 2) * 0.6;
  ctx.save();
  ctx.translate(0, bob);
  const r = 16;
  ctx.beginPath();
  ctx.arc(0, -2, r, 0, Math.PI * 2);
  ctx.fillStyle = factionColor;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = PALETTE.bunkerCharcoal;
  ctx.stroke();
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, -2, r - 1, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = "rgba(78, 84, 99, 0.55)";
  ctx.fillRect(-r, -2, r * 2, r);
  ctx.restore();
  ctx.fillStyle = PALETTE.sandCream;
  ctx.beginPath();
  ctx.moveTo(-11, 1);
  ctx.lineTo(-7, -5);
  ctx.lineTo(7, -5);
  ctx.lineTo(11, 0);
  ctx.lineTo(7, 4);
  ctx.lineTo(-8, 4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(-6, -9, 5, 4);
  ctx.fillRect(2, -8, 4, 3);
  ctx.restore();
}

/**
 * Draws a procedural combat unit facing East (if Attacker) or West (if Defender),
 * using actual ambient occlusion drop shadows underneath and radial gradient bloom on muzzle flashes.
 */
export function drawProceduralUnit(
  ctx: CanvasRenderingContext2D,
  unit: CombatUnit,
  x: number,
  y: number,
  scale: number,
  time: number,
  factionColor: string,
  badgeImg: HTMLImageElement | null | undefined,
  isInFlight = false,
  smokeAlpha = 1.0,
  theater?: TheaterId,
  factionId?: string,
) {
  const cues = rosterCues(factionId);
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));

  const isAttacker = unit.side === 'attacker';
  if (!isAttacker) {
    ctx.scale(-1, 1);
  }

  const noPlaneShadow = theater === 'air_strike_test';
  const noFire = theater === 'air_strike_test';

  // If airborne (only actual air category planes, NEVER naval vessels or aircraft carriers!)
  if (isInFlight && unit.type !== 'carrier') {
    ctx.restore();
    return;
  }

  // 1. FREEZE CASUALTY MOVEMENT: ZERO BOBBING, ZERO SHUDDER, ZERO IDLE DRIFT
  // Static Cannons & Flak Guns (No Bobbing): Wheels, carriage, and mounts firmly anchored to ground
  const isCasualty = unit.status === 'downed' || unit.status === 'dead' || unit.isPendingCasualty;
  const isStaticMount = unit.type === 'artillery' || unit.type === 'aaa' || unit.type === 'aa';
  const bob = (isCasualty || isStaticMount) ? 0 : Math.sin(time * 3 + unit.animBobOffset) * 1.5;
  let recoilX = 0;
  let recoilY = bob;

  if (!isCasualty) {
    const isHeavyMechanized = unit.type === 'tank' || unit.type === 'artillery';
    if (isHeavyMechanized && unit.animRecoil > 0) {
      const kick = tankKick(unit.animRecoil);
      recoilX = kick.x;
      recoilY = isStaticMount ? 0 : bob + kick.y;
    } else if (unit.animRecoil > 0) {
      recoilX = infantryKick(unit.animRecoil);
      recoilY = isStaticMount ? 0 : bob;
    }
  }

  ctx.translate(Math.round(recoilX), Math.round(recoilY));

  // Apply hull listing angle (e.g. 10 deg listing if injured, 45 deg if sinking)
  if (unit.listingAngle) {
    ctx.rotate(unit.listingAngle);
  }

  if (unit.status === 'downed') {
    drawDownedUnit(ctx, unit, factionColor, time, smokeAlpha, noFire);
    ctx.restore();
    return;
  }

  if (unit.isDestroyed) {
    ctx.globalAlpha = 0.25;
  }

  switch (unit.type) {
    case 'infantry':
      drawInfantry(ctx, factionColor, unit, time, cues.helmet);
      break;
    case 'mech_infantry':
      drawAnimatedUnitSprite(ctx, 'mech_infantry', factionColor, time);
      break;
    case 'artillery':
      drawArtillery(ctx, factionColor, unit, time, cues);
      break;
    case 'tank':
    case 'armor':
      drawTank(ctx, factionColor, unit, time, cues);
      break;
    case 'fighter':
      drawFighter(ctx, factionColor, unit, time, noPlaneShadow, cues.fighter);
      break;
    case 'tactical_bomber':
      drawTacticalBomber(ctx, factionColor, unit, time, noPlaneShadow, cues.bomber);
      break;
    case 'strategic_bomber':
      drawStrategicBomber(ctx, factionColor, unit, time, noPlaneShadow, cues.bomber);
      break;
    case 'submarine':
      drawSubmarine(ctx, factionColor, unit, time, cues);
      break;
    case 'destroyer':
      drawDestroyer(ctx, factionColor, unit, time, cues.destroyer);
      break;
    case 'cruiser':
      drawCruiser(ctx, factionColor, unit, time, cues.cruiser);
      break;
    case 'carrier':
      drawCarrier(ctx, factionColor, unit, time, noFire, cues);
      break;
    case 'battleship':
      drawBattleship(ctx, factionColor, unit, time, noFire, cues.battleship);
      break;
    case 'aaa':
    case 'aa':
      drawAaaFlak(ctx, factionColor, unit, cues.helmet);
      break;
    case 'transport':
      drawNavalTransportToken(ctx, factionColor, time);
      break;
  }

  // ACTUAL RADIAL GRADIENT BLOOM ON MUZZLE FLASH
  if (unit.animRecoil > 0.25) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const muzzleBloomR = 18 * unit.animRecoil;
    const isTank = unit.type === 'tank' || unit.type === 'armor';
    const isAa = unit.type === 'aa' || unit.type === 'aaa';
    const muzzle = isTank ? tankMuzzle(cues.tank) : isAa ? aaMuzzle(unit) : { x: 18, y: -2 };
    const flashX = muzzle.x;
    const flashY = muzzle.y;
    const mGrad = ctx.createRadialGradient(flashX, flashY, 2, flashX, flashY, muzzleBloomR);
    mGrad.addColorStop(0, 'rgba(255, 250, 210, 0.95)');
    mGrad.addColorStop(0.3, 'rgba(255, 190, 70, 0.6)');
    mGrad.addColorStop(0.7, 'rgba(230, 100, 30, 0.2)');
    mGrad.addColorStop(1, 'rgba(180, 40, 10, 0)');
    ctx.fillStyle = mGrad;
    ctx.beginPath();
    ctx.arc(flashX, flashY, muzzleBloomR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Bright flash core
    ctx.fillStyle = PALETTE.sandCream;
    ctx.beginPath();
    ctx.arc(flashX, flashY, 4 * unit.animRecoil, 0, Math.PI * 2);
    ctx.fill();
  }

  // Smoking damage state
  if (unit.maxHp > 1 && unit.currentHp < unit.maxHp) {
    drawDamageSmoke(ctx, time);
  }

  // Synergy Badge
  if (unit.hasSynergyBonus) {
    ctx.save();
    if (!isAttacker) ctx.scale(-1, 1);
    ctx.fillStyle = PALETTE.mustardBrass;
    ctx.beginPath();
    ctx.arc(0, -22, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PALETTE.sandCream;
    ctx.fillRect(-2, -24, 4, 4);
    ctx.restore();
  }

  ctx.restore();
}

/**
 * A soldier's helmet, centred on `cx` with the crown at `top`. The head sits from top + 3 to top + 8.
 * Faces +x; a defender is already mirrored by the caller.
 */
function drawHelmet(ctx: CanvasRenderingContext2D, helmet: Helmet, cx: number, top: number, color: string) {
  const ink = PALETTE.bunkerCharcoal;
  switch (helmet) {
    case 'stahlhelm':
      // Coal-scuttle: dome, a skirt flaring down over the neck, a short visor.
      ctx.fillStyle = color;
      ctx.fillRect(cx - 4, top, 8, 4);
      ctx.fillRect(cx - 5, top + 2, 3, 5);
      ctx.fillStyle = ink;
      ctx.fillRect(cx - 2, top + 3, 7, 1);
      ctx.fillRect(cx - 6, top + 6, 2, 1);
      return;
    case 'ssh40':
      // Tall rounded dome, a slight flare at the rim, the red star on the front.
      ctx.fillStyle = color;
      ctx.fillRect(cx - 3, top - 2, 6, 1);
      ctx.fillRect(cx - 4, top - 1, 8, 5);
      ctx.fillStyle = ink;
      ctx.fillRect(cx - 5, top + 3, 10, 1);
      ctx.fillStyle = PALETTE.crimson;
      ctx.fillRect(cx + 1, top + 1, 2, 2);
      return;
    case 'brodie':
      // Soup bowl: a shallow dome on a wide flat brim.
      ctx.fillStyle = color;
      ctx.fillRect(cx - 3, top + 1, 6, 3);
      ctx.fillRect(cx - 6, top + 3, 12, 1);
      ctx.fillStyle = ink;
      ctx.fillRect(cx - 6, top + 4, 12, 1);
      return;
    case 'm1':
      // Deep round pot reaching the ears, a narrow rim and a chinstrap.
      ctx.fillStyle = color;
      ctx.fillRect(cx - 3, top - 1, 6, 1);
      ctx.fillRect(cx - 4, top, 8, 5);
      ctx.fillStyle = ink;
      ctx.fillRect(cx - 5, top + 4, 10, 1);
      ctx.fillRect(cx + 2, top + 5, 1, 3);
      return;
    case 'havelock':
      // Type 90 dome with the brass star, and a cloth sun flap hanging behind.
      ctx.fillStyle = PALETTE.khakiLeather;
      ctx.fillRect(cx - 5, top + 3, 3, 6);
      ctx.fillStyle = color;
      ctx.fillRect(cx - 4, top, 8, 4);
      ctx.fillStyle = ink;
      ctx.fillRect(cx - 4, top + 3, 9, 1);
      ctx.fillStyle = PALETTE.mustardBrass;
      ctx.fillRect(cx + 1, top + 1, 1, 1);
      return;
    case 'adrian':
    default:
      // Adrian: dome, a crest along the crown, front and rear peaks.
      ctx.fillStyle = color;
      ctx.fillRect(cx - 4, top, 8, 4);
      ctx.fillStyle = ink;
      ctx.fillRect(cx - 1, top - 1, 3, 1);
      ctx.fillRect(cx - 5, top + 3, 10, 2);
      return;
  }
}

function drawInfantry(
  ctx: CanvasRenderingContext2D,
  factionColor: string,
  unit: CombatUnit,
  time: number,
  helmet: Helmet = 'adrian',
) {
  // Ambient occlusion drop shadow
  drawAmbientOcclusionShadow(ctx, 0, 9, 10, 4, 11);

  if (unit.isCheering) {
    // VICTORY CELEBRATORY CHEERING ANIMATION
    const cheerBob = Math.abs(Math.sin(time * 9 + unit.animBobOffset)) * 4.5;
    ctx.translate(0, -cheerBob);

    // Boots
    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(-4, 4, 3, 5);
    ctx.fillRect(1, 4, 3, 5);

    // Trousers
    ctx.fillStyle = PALETTE.deepTaupe;
    ctx.fillRect(-4, 0, 8, 5);

    // Torso / Tunic
    ctx.fillStyle = factionColor;
    ctx.fillRect(-5, -7, 10, 8);

    // Leather web gear
    ctx.fillStyle = PALETTE.khakiLeather;
    ctx.fillRect(-5, -2, 10, 2);
    ctx.fillRect(-2, -7, 2, 5);

    // Left Arm: Raised high waving in triumph
    ctx.fillStyle = factionColor;
    ctx.fillRect(-8, -12, 3, 8);
    ctx.fillStyle = PALETTE.sandCream;
    ctx.fillRect(-8, -14, 3, 3); // hand

    // Right Arm & Raised Rifle: Held high skyward in celebratory cheer!
    ctx.save();
    ctx.translate(3, -6);
    ctx.rotate(-0.75); // tilted upward into the air
    ctx.fillStyle = factionColor;
    ctx.fillRect(0, -4, 4, 4);
    ctx.fillStyle = PALETTE.earthBrown;
    ctx.fillRect(2, -9, 3, 13);
    ctx.fillStyle = PALETTE.navalSteel;
    ctx.fillRect(3, -17, 2, 9);
    ctx.fillStyle = PALETTE.sandCream;
    ctx.fillRect(3, -20, 2, 3); // bayonet glint
    ctx.restore();

    // Head tilted back cheering
    ctx.fillStyle = PALETTE.sandCream;
    ctx.fillRect(-3, -12, 6, 5);
    // Mouth open in victory yell
    ctx.fillStyle = PALETTE.plum;
    ctx.fillRect(-1, -9, 3, 2);

    drawHelmet(ctx, helmet, 0, -15, factionColor);
    return;
  }

  // 1. OPENING DEPLOYMENT MARCHING ANIMATION: Walking gait bob & leg swinging
  if (unit.isMarching) {
    const gait = marchCycle(time, unit.animBobOffset);
    const marchBob = gait.bob;
    ctx.translate(0, -marchBob);

    const legSwing = gait.legSwing;
    // Boots
    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(-4 + legSwing, 4, 3, 5);
    ctx.fillRect(1 - legSwing, 4, 3, 5);

    // Trousers
    ctx.fillStyle = PALETTE.deepTaupe;
    ctx.fillRect(-4, 0, 8, 5);

    // Torso / Tunic
    ctx.fillStyle = factionColor;
    ctx.fillRect(-5, -7, 10, 8);

    // Leather web gear
    ctx.fillStyle = PALETTE.khakiLeather;
    ctx.fillRect(-5, -2, 10, 2);
    ctx.fillRect(-2, -7, 2, 5);

    // Head & Skin
    ctx.fillStyle = PALETTE.sandCream;
    ctx.fillRect(-3, -11, 6, 5);

    drawHelmet(ctx, helmet, 0, -14, factionColor);

    // Rifle carried at slope on shoulder while marching
    ctx.save();
    ctx.translate(1, -6);
    ctx.rotate(MARCH_RIFLE_RAD);
    ctx.fillStyle = PALETTE.earthBrown;
    ctx.fillRect(-2, -2, 8, 3);
    ctx.fillStyle = PALETTE.navalSteel;
    ctx.fillRect(6, -1, 7, 2);
    ctx.fillStyle = PALETTE.sandCream;
    ctx.fillRect(13, -2, 3, 1);
    ctx.restore();
    return;
  }

  // 2. POST-MARCH READY STATION ANIMATIONS
  if (unit.readyAnimProgress !== undefined && unit.readyAnimProgress >= 0) {
    const rp = unit.readyAnimProgress;
    if (unit.readyAnimType === 'crouch') {
      // Crouch down on knee and stand back up
      const crouchY = Math.sin(rp * Math.PI) * 4.5;
      ctx.translate(0, crouchY);

      ctx.fillStyle = PALETTE.bunkerCharcoal;
      ctx.fillRect(-4, 4, 4, 3);
      ctx.fillRect(1, 2, 3, 4);

      ctx.fillStyle = PALETTE.deepTaupe;
      ctx.fillRect(-4, 0, 8, 4);

      ctx.fillStyle = factionColor;
      ctx.fillRect(-5, -6, 10, 7);

      ctx.fillStyle = PALETTE.khakiLeather;
      ctx.fillRect(-5, -2, 10, 2);

      ctx.fillStyle = PALETTE.sandCream;
      ctx.fillRect(-3, -10, 6, 4);

      drawHelmet(ctx, helmet, 0, -13, factionColor);

      ctx.fillStyle = PALETTE.earthBrown;
      ctx.fillRect(-1, -3, 8, 3);
      ctx.fillStyle = PALETTE.navalSteel;
      ctx.fillRect(7, -2, 7, 2);
      return;
    } else if (unit.readyAnimType === 'reload') {
      // Reload bolt action rifle: tilt rifle, cycle bolt back and forward
      const boltCycle = Math.sin(rp * Math.PI);
      const rifleTilt = -0.28 * boltCycle;

      ctx.fillStyle = PALETTE.bunkerCharcoal;
      ctx.fillRect(-4, 4, 3, 5);
      ctx.fillRect(1, 4, 3, 5);

      ctx.fillStyle = PALETTE.deepTaupe;
      ctx.fillRect(-4, 0, 8, 5);

      ctx.fillStyle = factionColor;
      ctx.fillRect(-5, -7, 10, 8);

      ctx.fillStyle = PALETTE.khakiLeather;
      ctx.fillRect(-5, -2, 10, 2);

      ctx.fillStyle = PALETTE.sandCream;
      ctx.fillRect(-3, -11, 6, 5);

      drawHelmet(ctx, helmet, 0, -14, factionColor);

      ctx.save();
      ctx.rotate(rifleTilt);
      ctx.fillStyle = PALETTE.earthBrown;
      ctx.fillRect(-2, -4, 9, 3);
      ctx.fillStyle = PALETTE.navalSteel;
      ctx.fillRect(7, -3, 8, 2);
      ctx.fillStyle = PALETTE.sandCream;
      ctx.fillRect(15, -4, 3, 1);
      if (boltCycle > 0.3) {
        ctx.fillStyle = PALETTE.mustardBrass;
        ctx.fillRect(0 - boltCycle * 2, -6, 2, 3);
      }
      ctx.restore();
      return;
    } else if (unit.readyAnimType === 'scan') {
      // Look up and scan the horizon with hand to brow
      ctx.fillStyle = PALETTE.bunkerCharcoal;
      ctx.fillRect(-4, 4, 3, 5);
      ctx.fillRect(1, 4, 3, 5);

      ctx.fillStyle = PALETTE.deepTaupe;
      ctx.fillRect(-4, 0, 8, 5);

      ctx.fillStyle = factionColor;
      ctx.fillRect(-5, -7, 10, 8);

      ctx.fillStyle = PALETTE.khakiLeather;
      ctx.fillRect(-5, -2, 10, 2);

      ctx.fillStyle = PALETTE.sandCream;
      ctx.fillRect(-2, -12, 6, 5);

      drawHelmet(ctx, helmet, 1, -15, factionColor);

      // Hand to brow
      ctx.fillStyle = PALETTE.sandCream;
      ctx.fillRect(3, -13, 3, 2);

      ctx.fillStyle = PALETTE.earthBrown;
      ctx.fillRect(-2, -3, 8, 3);
      ctx.fillStyle = PALETTE.navalSteel;
      ctx.fillRect(6, -2, 7, 2);
      return;
    }
  }

  let aimOffset = 0;
  let stanceHunch = 0;
  if (unit.animAnticipation > 0) {
    aimOffset = -0.16;
    stanceHunch = Math.sin(time * 8) * 1.5;
    ctx.translate(0, stanceHunch);
  }

  // Boots
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(-4, 4, 3, 5);
  ctx.fillRect(1, 4, 3, 5);

  // Trousers
  ctx.fillStyle = PALETTE.deepTaupe;
  ctx.fillRect(-4, 0, 8, 5);

  // Torso / Tunic
  ctx.fillStyle = factionColor;
  ctx.fillRect(-5, -7, 10, 8);

  // Leather web gear
  ctx.fillStyle = PALETTE.khakiLeather;
  ctx.fillRect(-5, -2, 10, 2);
  ctx.fillRect(-2, -7, 2, 5);

  // Head & Skin
  ctx.fillStyle = PALETTE.sandCream;
  ctx.fillRect(-3, -11, 6, 5);

  drawHelmet(ctx, helmet, 0, -14, factionColor);

  // Rifle & Bayonet
  ctx.save();
  if (aimOffset !== 0) {
    ctx.rotate(aimOffset);
  }
  ctx.fillStyle = PALETTE.earthBrown;
  ctx.fillRect(-2, -4, 9, 3);
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(7, -3, 8, 2);
  ctx.fillStyle = PALETTE.sandCream;
  ctx.fillRect(15, -4, 3, 1);
  ctx.restore();
}

function drawArtillery(ctx: CanvasRenderingContext2D, factionColor: string, unit: CombatUnit, time = 0, cues?: RosterCues) {
  const gun = cues?.gun ?? { barrel: 20, bore: 4, brake: true, shield: 12, platform: false };
  // Ambient occlusion drop shadow for cannon
  drawAmbientOcclusionShadow(ctx, 0, 9, 15, 5, 18);
  // Ambient occlusion drop shadow for crewman standing behind
  drawAmbientOcclusionShadow(ctx, -17, 8, 8, 3, 10);

  // Ready Station crank tilt
  let crankTilt = 0;
  if (unit.readyAnimProgress !== undefined && unit.readyAnimProgress >= 0) {
    crankTilt = Math.sin(unit.readyAnimProgress * Math.PI) * 0.18;
  }

  // --- ARTILLERY CREW SPRITE STANDING BEHIND CANNON ---
  // Crewman boots firmly planted on the ground (or walking if marching)
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  if (unit.isMarching) {
    const marchLeg = stepSin(time, unit.animBobOffset) * 2;
    ctx.fillRect(-20 + marchLeg, 4, 3, 5);
    ctx.fillRect(-16 - marchLeg, 4, 3, 5);
  } else {
    ctx.fillRect(-20, 4, 3, 5);
    ctx.fillRect(-16, 4, 3, 5);
  }

  // Trousers
  ctx.fillStyle = PALETTE.deepTaupe;
  ctx.fillRect(-20, 0, 7, 5);

  // Torso / Tunic
  ctx.fillStyle = factionColor;
  ctx.fillRect(-21, -7, 9, 8);

  // Leather webbing & harness
  ctx.fillStyle = PALETTE.khakiLeather;
  ctx.fillRect(-21, -2, 9, 2);
  ctx.fillRect(-17, -7, 2, 5);

  // Crewman arms: manning gun trail / lanyard / breech (or crank)
  const crewLanyardPull = unit.animRecoil > 0 ? -3 : 0;
  ctx.fillStyle = factionColor;
  ctx.fillRect(-14 + crewLanyardPull, -4, 6, 3);
  ctx.fillStyle = PALETTE.sandCream; // hands on gun trail / lanyard
  ctx.fillRect(-9 + crewLanyardPull, -4, 2, 3);

  // Head & Skin
  ctx.fillStyle = PALETTE.sandCream;
  ctx.fillRect(-19, -11, 5, 4);

  drawHelmet(ctx, cues?.helmet ?? 'adrian', -16, -14, factionColor);

  // --- CANNON ASSEMBLY ---
  // The 25-pounder sits on its round firing platform.
  if (gun.platform) {
    ctx.fillStyle = PALETTE.deepTaupe;
    ctx.fillRect(-10, 9, 16, 2);
    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(-11, 10, 18, 1);
  }
  // Split Trail Carriage
  ctx.fillStyle = PALETTE.deepTaupe;
  ctx.fillRect(-13, 2, 15, 4);

  // Spoked Wheel
  ctx.save();
  ctx.translate(-2, 3);
  if (unit.isMarching) {
    ctx.rotate(time * 6);
  }
  ctx.strokeStyle = PALETTE.bunkerCharcoal;
  ctx.lineWidth = 2;
  ctx.fillStyle = PALETTE.earthBrown;
  ctx.beginPath();
  ctx.arc(0, 0, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Wheel spokes
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(-6, -1, 12, 2);
  ctx.fillRect(-1, -6, 2, 12);
  ctx.restore();

  // Hub
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(-3, 2, 3, 3);

  // Gun shield: tall on a leFH 18, low on a ZiS-3.
  if (gun.shield > 0) {
    ctx.fillStyle = factionColor;
    ctx.fillRect(-3, 4 - gun.shield, 5, gun.shield);
    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(2, 5 - gun.shield, 1, gun.shield - 2);
  }

  // Barrel with elevation adjustment: a stubby howitzer or a long field gun.
  ctx.save();
  const tiltAngle = (unit.animAnticipation > 0 ? -0.42 : -0.18) - crankTilt;
  ctx.rotate(tiltAngle);
  const barrelRecoil = unit.animRecoil > 0 ? unit.animRecoil * 4 : 0;
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(-4 - barrelRecoil, -1 - gun.bore, gun.barrel, gun.bore);
  if (gun.brake) {
    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(gun.barrel - 6 - barrelRecoil, -2 - gun.bore, 3, gun.bore + 2);
  }
  ctx.restore();
}

/** Turret box for a tank cue. The turret sits on the upper hull deck at y = -6. */
function tankTurret(cue: RosterCues['tank']) {
  const cx = cue.turretX + 2;
  const left = Math.round(cx - cue.turretW / 2);
  const top = -6 - cue.turretH;
  return { cx, left, top, right: left + cue.turretW, gunY: top + Math.floor(cue.turretH / 2) - 2 };
}

/** Where the muzzle flash blooms for this faction's tank. */
export function tankMuzzle(cue: RosterCues['tank']): { x: number; y: number } {
  const t = tankTurret(cue);
  return { x: t.right - 2 + cue.barrel + 1, y: t.gunY + 1 };
}

function drawTank(
  ctx: CanvasRenderingContext2D,
  factionColor: string,
  unit: CombatUnit,
  time: number,
  cues: RosterCues,
) {
  const cue = cues.tank;
  const half = Math.round(cue.length / 2);
  const creepX = unit.animAnticipation > 0 ? 3 : 0;
  ctx.translate(creepX, 0);

  // Marching vibration
  if (unit.isMarching) {
    const marchVibe = tankVibe(time, unit.animBobOffset);
    ctx.translate(0, marchVibe);
  }

  // Ready station turret swivel
  let turretAngle = 0;
  if (unit.readyAnimProgress !== undefined && unit.readyAnimProgress >= 0) {
    turretAngle = turretSwivelRad(unit.readyAnimProgress);
  }

  drawAmbientOcclusionShadow(ctx, 0, 11, half + 8, 8, half * 2);

  // Caterpillar treads. A Churchill's run up and over the hull sides.
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  if (cue.highTrack) {
    ctx.fillRect(-half, -4, cue.length, 15);
    ctx.fillRect(half - 2, -2, 3, 10); // track horn round the nose
  } else {
    ctx.fillRect(-half, 3, cue.length, 8);
  }

  if (unit.isMarching) {
    ctx.fillStyle = PALETTE.deepTaupe;
    const trackTick = trackScroll(time);
    for (let tx = -half + 1 + trackTick; tx <= half - 2; tx += 6) {
      ctx.fillRect(tx, 3, 2, 8);
    }
  }

  // Road wheels: many small ones on a Churchill or Chi-Ha, five big ones on a T-34.
  ctx.fillStyle = PALETTE.feldgrau;
  const span = cue.length - 8;
  const step = cue.wheels > 1 ? span / (cue.wheels - 1) : 0;
  for (let w = 0; w < cue.wheels; w++) {
    const wx = Math.round(-half + 4 + w * step);
    ctx.beginPath();
    ctx.arc(wx, 7, cue.wheelR, 0, Math.PI * 2);
    ctx.fill();
    if (unit.isMarching) {
      ctx.fillStyle = PALETTE.sandCream;
      const spinAngle = time * 14;
      ctx.fillRect(wx + Math.cos(spinAngle) * 1.5, 7 + Math.sin(spinAngle) * 1.5, 1, 1);
      ctx.fillStyle = PALETTE.feldgrau;
    }
  }

  // Lower hull
  ctx.fillStyle = PALETTE.deepTaupe;
  ctx.fillRect(-half + 1, -1, cue.length - 2, 6);

  // Upper hull. The glacis slopes back on a T-34 or Sherman and stands as a slab on a Tiger.
  ctx.fillStyle = factionColor;
  ctx.beginPath();
  ctx.moveTo(-half + 3, -6);
  ctx.lineTo(half - 3 - cue.glacis, -6);
  ctx.lineTo(half - 1, 0);
  ctx.lineTo(-half + 3, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = PALETTE.deepTaupe;
  ctx.fillRect(-half + 2, -2, 4, 3);

  const t = tankTurret(cue);
  ctx.save();
  if (turretAngle !== 0) {
    ctx.translate(t.cx, t.top + cue.turretH / 2);
    ctx.rotate(turretAngle);
    ctx.translate(-t.cx, -(t.top + cue.turretH / 2));
  }

  ctx.fillStyle = factionColor;
  if (cue.castTurret) {
    // Rounded cast turret: clipped corners and a sloped face.
    ctx.fillRect(t.left + 1, t.top, cue.turretW - 3, cue.turretH);
    ctx.fillRect(t.left, t.top + 1, cue.turretW - 1, cue.turretH - 1);
    ctx.fillRect(t.right - 2, t.top + 2, 2, cue.turretH - 2);
  } else {
    ctx.fillRect(t.left, t.top, cue.turretW, cue.turretH);
  }
  ctx.fillStyle = PALETTE.deepTaupe;
  ctx.fillRect(t.right - 3, t.top + 1, 3, cue.turretH - 2); // mantlet
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(t.left + 2, t.top - 3, Math.min(7, cue.turretW - 4), 3); // commander's cupola

  ctx.save();
  if (unit.animAnticipation > 0) {
    ctx.rotate(-0.08);
  }
  const barrelRecoil = barrelRecoilPx(unit.animRecoil);
  const bore = cue.barrel > 14 ? 4 : 3;
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(t.right - 2 - barrelRecoil, t.gunY, cue.barrel, bore);
  if (cue.brake) {
    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(t.right - 3 + cue.barrel - barrelRecoil, t.gunY - 1, 4, bore + 2);
  }
  ctx.restore();

  ctx.restore();

  const exhaustLife = (time * (unit.isMarching ? 7 : 4)) % 1;
  ctx.fillStyle = PALETTE.trenchMudBone;
  ctx.fillRect(-half - exhaustLife * 7, -3, unit.isMarching ? 4 : 3, unit.isMarching ? 4 : 3);
}

function drawFighter(
  ctx: CanvasRenderingContext2D,
  factionColor: string,
  unit: CombatUnit,
  time: number,
  noDropShadow = false,
  cue: FighterCue = { radial: false, roundTips: false, scoop: false, fixedGear: false, canopy: 6 },
) {
  // Ambient occlusion drop shadow (omitted if noDropShadow)
  if (!noDropShadow) {
    drawAmbientOcclusionShadow(ctx, 0, 18, 16, 5, 14);
  }

  const revSpeed = (unit.animAnticipation > 0 || unit.isMarching) ? 80 : 40;
  const jitter = unit.animAnticipation > 0 ? (Math.random() - 0.5) * 1.5 : 0;
  const alt = (unit.isMarching ? -10 : -6) + Math.sin(time * 4) * 2 + jitter;
  ctx.translate(0, alt);

  // Wings. A Spitfire's or Zero's tips round off; a Bf 109's are clipped square.
  ctx.fillStyle = factionColor;
  ctx.fillRect(-6, -2, 14, 5);
  ctx.fillStyle = PALETTE.deepTaupe;
  ctx.fillRect(-8, 3, 16, 2);
  if (cue.roundTips) {
    ctx.fillRect(-9, 4, 1, 1);
    ctx.fillRect(8, 4, 1, 1);
  } else {
    ctx.fillRect(-9, 3, 1, 2);
    ctx.fillRect(8, 3, 1, 2);
  }

  // Fixed spatted undercarriage, as on the Fokker D.XXI.
  if (cue.fixedGear) {
    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(4, 2, 1, 5);
    ctx.fillRect(3, 6, 3, 2);
  }

  // Fuselage
  ctx.fillStyle = factionColor;
  ctx.fillRect(-12, -4, 22, 6);

  // Belly radiator scoop: Mustang and Yak.
  if (cue.scoop) {
    ctx.fillStyle = PALETTE.deepTaupe;
    ctx.fillRect(-4, 2, 6, 2);
  }

  // Nose: a blunt radial cowl, or a pointed inline spinner.
  ctx.fillStyle = PALETTE.mustardBrass;
  if (cue.radial) {
    ctx.fillRect(9, -5, 4, 8);
    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(9, -5, 1, 8);
  } else {
    ctx.fillRect(10, -3, 3, 4);
    ctx.fillRect(13, -2, 1, 2);
  }

  // Tail Fin
  ctx.fillStyle = factionColor;
  ctx.fillRect(-12, -9, 4, 6);
  if (cue.roundTips) ctx.fillRect(-11, -10, 2, 1);

  // Canopy: the Zero's long glasshouse, the Spitfire's short bubble.
  ctx.fillStyle = PALETTE.spruceSea;
  ctx.fillRect(1 - cue.canopy / 2, -6, cue.canopy, 3);

  // Propeller Blur
  ctx.fillStyle = PALETTE.sandCream;
  const propAngle = time * revSpeed;
  ctx.save();
  ctx.translate(13, -1);
  ctx.rotate(propAngle);
  ctx.fillRect(-1, -8, 2, 16);
  ctx.restore();
}

function drawTacticalBomber(
  ctx: CanvasRenderingContext2D,
  factionColor: string,
  unit: CombatUnit,
  time: number,
  noDropShadow = false,
  cue?: BomberCue,
) {
  // Ambient occlusion drop shadow (omitted if noDropShadow)
  if (!noDropShadow) {
    drawAmbientOcclusionShadow(ctx, 0, 20, 20, 6, 18);
  }

  const revSpeed = (unit.animAnticipation > 0 || unit.isMarching) ? 70 : 35;
  const jitter = unit.animAnticipation > 0 ? (Math.random() - 0.5) * 1.5 : 0;
  const alt = (unit.isMarching ? -12 : -8) + Math.sin(time * 3 + 1) * 2 + jitter;
  ctx.translate(0, alt);

  ctx.fillStyle = factionColor;
  ctx.fillRect(-8, -4, 18, 7);
  ctx.fillRect(-16, -5, 28, 8);
  if (cue?.cigar) {
    ctx.fillRect(-13, -7, 22, 2);
    ctx.fillRect(-13, 3, 22, 2);
  }

  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(0, -9, 8, 4);
  ctx.fillRect(0, 3, 8, 4);
  if (cue?.engines === 4) {
    ctx.fillRect(-6, -8, 5, 3);
    ctx.fillRect(-6, 3, 5, 3);
  }

  ctx.fillStyle = PALETTE.sandCream;
  ctx.fillRect(8, -12, 1, 10);
  ctx.fillRect(8, 0, 1, 10);

  drawBomberTail(ctx, factionColor, -16, -5, cue);
  drawBomberNose(ctx, 10, -4, 6, cue);

  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(-2, 3, 8, 3);
}

/** Tail feathers: one fin, a B-17's tall one, or the twin fins of a Lancaster or Pe-2. `y` is the fuselage top. */
function drawBomberTail(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, cue?: BomberCue) {
  ctx.fillStyle = color;
  if (cue?.twinTail) {
    ctx.fillRect(x, y - 6, 3, 7);
    ctx.fillRect(x + 1, y + 8, 3, 6);
    ctx.fillStyle = PALETTE.deepTaupe;
    ctx.fillRect(x, y + 2, 4, 2);
  } else if (cue?.tallFin) {
    ctx.fillRect(x, y - 9, 4, 10);
    ctx.fillRect(x + 4, y - 4, 4, 4);
  } else {
    ctx.fillRect(x, y - 5, 4, 6);
    ctx.fillRect(x, y + 8, 4, 6);
  }
}

/** The nose: fully glazed on the He 111 and Betty, a solid nose with a gun turret on the Lancaster. */
function drawBomberNose(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, cue?: BomberCue) {
  if (cue && !cue.glazedNose) {
    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(x, y, 3, h);
    ctx.fillStyle = PALETTE.spruceSea;
    ctx.fillRect(x + 3, y + 1, 2, 3);
    return;
  }
  ctx.fillStyle = PALETTE.spruceSea;
  ctx.fillRect(x, y, 4, h);
  if (cue?.glazedNose) {
    ctx.fillRect(x + 4, y + 1, 2, h - 2);
    ctx.fillStyle = PALETTE.sandCream;
    ctx.fillRect(x + 1, y + 1, 1, 1);
  }
}

function drawStrategicBomber(
  ctx: CanvasRenderingContext2D,
  factionColor: string,
  unit: CombatUnit,
  time: number,
  noDropShadow = false,
  cue?: BomberCue,
) {
  // Ambient occlusion drop shadow (omitted if noDropShadow)
  if (!noDropShadow) {
    drawAmbientOcclusionShadow(ctx, 0, 22, 26, 7, 24);
  }

  const jitter = unit.animAnticipation > 0 ? (Math.random() - 0.5) * 1.5 : 0;
  const alt = (unit.isMarching ? -14 : -10) + Math.sin(time * 2.5) * 2 + jitter;
  ctx.translate(0, alt);

  ctx.fillStyle = factionColor;
  ctx.fillRect(-10, -6, 24, 10);
  ctx.fillRect(-22, -6, 40, 10);
  if (cue?.cigar) {
    // The Betty's deep rounded cigar body.
    ctx.fillRect(-18, -8, 32, 2);
    ctx.fillRect(-18, 4, 32, 2);
  }

  // Engine nacelles: four on a Lancaster or B-17, two on a He 111, Pe-2 or Betty.
  ctx.fillStyle = PALETTE.navalSteel;
  if (cue?.engines !== 2) {
    ctx.fillRect(-2, -14, 8, 4);
    ctx.fillRect(-2, 9, 8, 4);
  }
  ctx.fillRect(4, -10, 8, 4);
  ctx.fillRect(4, 5, 8, 4);

  drawBomberTail(ctx, factionColor, -22, -6, cue);
  drawBomberNose(ctx, 14, -5, 5, cue);

  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(-22, -3, 3, 3);
  ctx.fillRect(2, -9, 4, 3);
}

function drawSubmarine(
  ctx: CanvasRenderingContext2D,
  factionColor: string,
  unit: CombatUnit,
  time: number,
  cues?: RosterCues,
) {
  const cue = cues?.sub ?? { length: 46, tower: 12, hangar: false, deckGun: true };
  const half = Math.round(cue.length / 2);

  // Ambient occlusion and submerged hull shadow
  drawAmbientOcclusionShadow(ctx, 0, 5, half + 3, 6, cue.length / 2);

  // Submerged dark hull shadow underwater in bunker charcoal / spruce sea
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.beginPath();
  ctx.ellipse(0, 4, half + 2, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  // Waterline hull (slate / faction color)
  ctx.fillStyle = factionColor;
  ctx.beginPath();
  ctx.moveTo(-half + 1, 3);
  ctx.lineTo(half + 1, 3);
  ctx.lineTo(half - 1, 0);
  ctx.lineTo(-half + 3, 0);
  ctx.closePath();
  ctx.fill();

  // The I-400's long aircraft hangar runs forward from the tower.
  if (cue.hangar) {
    ctx.fillStyle = factionColor;
    ctx.fillRect(4, -5, 16, 5);
    ctx.fillStyle = PALETTE.deepTaupe;
    ctx.fillRect(4, -5, 16, 1);
    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(19, -4, 1, 4); // hangar door
    ctx.fillStyle = PALETTE.navalSteel;
    ctx.fillRect(20, -1, half - 22, 1); // catapult rail
  }

  // Conning tower: low on a Type VII, tall on a T-class or I-400.
  const towerH = Math.round(cue.tower * 0.6);
  ctx.fillStyle = PALETTE.deepTaupe;
  ctx.fillRect(-4, -towerH, cue.tower, towerH + 1);
  ctx.fillStyle = factionColor;
  ctx.fillRect(-2, 1 - towerH, cue.tower - 4, towerH - 1);

  // Periscope shears & searchlight
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(1, -towerH - 6, 2, 7);
  ctx.fillStyle = PALETTE.sandCream;
  ctx.fillRect(1, -towerH - 6, 3, 2); // Periscope lens glint

  // Foredeck deck gun, ahead of the tower or the hangar.
  if (cue.deckGun) {
    const gx = cue.hangar ? -12 : cue.tower;
    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(gx, -2, 4, 2);
    ctx.fillStyle = PALETTE.navalSteel;
    ctx.fillRect(gx + 2, -3, 6, 1.5);
  }

  // Bow torpedo tube shutter caps
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(half - 2, 1, 2, 2);

  // Bow wave and churning water wake ripples
  ctx.fillStyle = PALETTE.sandCream;
  const wakeW = Math.sin(time * 3) * 2;
  ctx.fillRect(half - 1, 3, 6 + wakeW, 1.5);
  ctx.fillRect(-half - 3, 3, 8, 1.5);
  ctx.fillStyle = PALETTE.spruceSea;
  ctx.fillRect(-half - 1, 4, 18, 1.5);

  // Torpedo launch bubbles on fire
  if (unit.animRecoil > 0) {
    ctx.fillStyle = PALETTE.sandCream;
    ctx.fillRect(half + 2, 0, 4, 3);
    ctx.fillRect(half + 6, 1, 3, 2);
  }
}

/** Funnels with smoke caps, spaced aft from `x`. */
function drawFunnels(ctx: CanvasRenderingContext2D, count: number, x: number, top: number, h: number, w: number, gap: number) {
  for (let i = 0; i < count; i++) {
    const fx = x - i * (w + gap);
    ctx.fillStyle = PALETTE.deepTaupe;
    ctx.fillRect(fx, top, w, h);
    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(fx, top - 1, w, 2);
  }
}

/**
 * The bridge and mast above the citadel. `x` is its centre, `deck` the citadel top, `scale` grows it with the hull.
 * A pagoda for Yamato and Takao, a tower for Bismarck and Iowa, a tripod mast, or a boxy British bridge.
 */
function drawBridge(ctx: CanvasRenderingContext2D, bridge: Bridge, x: number, deck: number, scale: number) {
  const s = (n: number) => Math.round(n * scale);
  switch (bridge) {
    case 'pagoda':
      for (let tier = 0; tier < 4; tier++) {
        const w = s(12 - tier * 2);
        ctx.fillStyle = tier % 2 === 0 ? PALETTE.feldgrau : PALETTE.navalSteel;
        ctx.fillRect(x - Math.round(w / 2), deck - s(4) * (tier + 1), w, s(4));
      }
      ctx.fillStyle = PALETTE.spruceSea;
      ctx.fillRect(x - s(3), deck - s(14), s(6), 1);
      ctx.fillStyle = PALETTE.bunkerCharcoal;
      ctx.fillRect(x - s(5), deck - s(17), s(10), 2); // rangefinder
      return;
    case 'tower':
      ctx.fillStyle = PALETTE.feldgrau;
      ctx.fillRect(x - s(5), deck - s(8), s(10), s(8));
      ctx.fillStyle = PALETTE.navalSteel;
      ctx.fillRect(x - s(3), deck - s(13), s(6), s(5));
      ctx.fillStyle = PALETTE.spruceSea;
      ctx.fillRect(x - s(4), deck - s(6), s(8), 2);
      ctx.fillStyle = PALETTE.bunkerCharcoal;
      ctx.fillRect(x - s(4), deck - s(14), s(8), 2);
      return;
    case 'tripod':
      ctx.fillStyle = PALETTE.feldgrau;
      ctx.fillRect(x - s(5), deck - s(5), s(10), s(5));
      ctx.fillStyle = PALETTE.spruceSea;
      ctx.fillRect(x - s(3), deck - s(3), s(7), 2);
      ctx.fillStyle = PALETTE.bunkerCharcoal;
      ctx.fillRect(x, deck - s(11), 2, s(7));
      ctx.fillRect(x - s(3), deck - s(10), s(8), 1.5);
      return;
    case 'block':
    default:
      ctx.fillStyle = PALETTE.feldgrau;
      ctx.fillRect(x - s(6), deck - s(6), s(12), s(6));
      ctx.fillStyle = PALETTE.spruceSea;
      ctx.fillRect(x - s(5), deck - s(4), s(10), 2);
      ctx.fillStyle = PALETTE.bunkerCharcoal;
      ctx.fillRect(x - s(1), deck - s(10), 2, s(4));
      ctx.fillRect(x - s(4), deck - s(9), s(8), 1.5);
      return;
  }
}

function drawDestroyer(
  ctx: CanvasRenderingContext2D,
  factionColor: string,
  unit: CombatUnit,
  time: number,
  cue: ShipCue = { funnels: 1, bridge: 'tripod', turrets: 2 },
) {
  // Ambient occlusion drop shadow under hull
  drawAmbientOcclusionShadow(ctx, 0, 7, 28, 6, 24);

  // Red Boot-topping waterline bottom
  ctx.fillStyle = PALETTE.crimson;
  ctx.fillRect(-22, 5, 48, 2);

  // Sleek raked clipper bow & main hull
  ctx.fillStyle = factionColor;
  ctx.beginPath();
  ctx.moveTo(-24, 5);
  ctx.lineTo(24, 5);
  ctx.lineTo(28, 0); // clipper bow
  ctx.lineTo(16, -2); // forecastle
  ctx.lineTo(-24, -2);
  ctx.closePath();
  ctx.fill();

  // Dark armor belt strip
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(-23, 3, 49, 1.5);

  // A superfiring B turret stands just behind the bridge front.
  if (cue.turrets >= 3) drawNavalTurret(ctx, 10, -6, unit.animRecoil > 0 ? -0.26 : 0, 0, 8, false, 0);

  // Superstructure citadel, then this navy's bridge on top.
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(-6, -9, 14, 8);
  drawBridge(ctx, cue.bridge, 1, -8, 0.85);

  drawFunnels(ctx, cue.funnels, -12, -10, 8, 4, 2);

  // Midships Torpedo Tube Bank
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(-5, -2, 8, 3);

  // Stern Depth Charge Racks
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(-24, -3, 3, 3);

  // Water wake along hull
  ctx.fillStyle = PALETTE.sandCream;
  const bowFoam = Math.sin(time * 3.5) * 2;
  ctx.fillRect(26, 4, 7 + bowFoam, 2);
  ctx.fillRect(-27, 4, 6, 2);

  // Gun Turrets: Forward Turret (x = 14, y = -4) and Aft Turret (x = -17, y = -4)
  const isFiring = unit.animRecoil > 0;
  const turretAngle = isFiring ? -0.26 : 0;
  const barrelRecoil = isFiring ? unit.animRecoil * 3.5 : 0;

  // Forward Turret
  drawNavalTurret(ctx, 14, -4, turretAngle, barrelRecoil, 10, isFiring, unit.animRecoil);
  // Aft Turret
  drawNavalTurret(ctx, -17, -4, isFiring ? -0.15 : 0, isFiring ? barrelRecoil * 0.7 : 0, 9, false, 0);
}

function drawCruiser(
  ctx: CanvasRenderingContext2D,
  factionColor: string,
  unit: CombatUnit,
  time: number,
  cue: ShipCue = { funnels: 2, bridge: 'tripod', turrets: 3 },
) {
  // Ambient occlusion drop shadow under hull
  drawAmbientOcclusionShadow(ctx, 0, 8, 34, 7, 30);

  // Red Boot-topping waterline bottom
  ctx.fillStyle = PALETTE.crimson;
  ctx.fillRect(-28, 6, 60, 2);

  // Heavy cruiser armored hull
  ctx.fillStyle = factionColor;
  ctx.beginPath();
  ctx.moveTo(-30, 6);
  ctx.lineTo(30, 6);
  ctx.lineTo(34, 0); // bow prow
  ctx.lineTo(20, -3); // forecastle
  ctx.lineTo(-30, -3);
  ctx.closePath();
  ctx.fill();

  // Dark armor belt
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(-29, 3, 61, 2);

  // Superstructure citadel and this navy's bridge: Takao's great pagoda, the County's boxy bridge.
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(-9, -12, 18, 9);
  drawBridge(ctx, cue.bridge, 1, -11, 1);

  // Funnels: one big one on a Hipper, three tall stacks on a County.
  drawFunnels(ctx, cue.funnels, -8, -13, 10, 5, cue.funnels === 3 ? 1 : 3);

  // Aircraft Catapult on quarterdeck
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(-23, -6, 5, 3);

  // Bow wave and hull wake
  ctx.fillStyle = PALETTE.sandCream;
  const bowFoam = Math.sin(time * 3.5) * 3;
  ctx.fillRect(32, 5, 8 + bowFoam, 2);
  ctx.fillRect(-33, 5, 7, 2);

  // Turrets:
  // Turret A (Forward, x = 20, y = -5)
  // Turret B (Superfiring forward, x = 8, y = -9)
  // Turret C (Aft, x = -21, y = -5)
  const isFiring = unit.animRecoil > 0;
  const turretAngle = isFiring ? -0.24 : 0;
  const barrelRecoil = isFiring ? unit.animRecoil * 4.2 : 0;

  drawNavalTurret(ctx, 20, -5, turretAngle, barrelRecoil, 12, isFiring, unit.animRecoil);
  if (cue.turrets >= 3) drawNavalTurret(ctx, 8, -9, turretAngle, barrelRecoil, 12, isFiring, unit.animRecoil);
  if (cue.turrets >= 4) drawNavalTurret(ctx, -16, -9, isFiring ? -0.12 : 0, 0, 10, false, 0);
  drawNavalTurret(ctx, cue.turrets >= 4 ? -26 : -21, -5, isFiring ? -0.12 : 0, isFiring ? barrelRecoil * 0.6 : 0, 11, false, 0);
}

function drawCarrier(
  ctx: CanvasRenderingContext2D,
  factionColor: string,
  unit: CombatUnit,
  time: number,
  noFire = false,
  cues?: RosterCues,
) {
  const island = cues?.carrier ?? { islandW: 10, islandH: 10, islandX: 9, funnel: true };
  // Ambient occlusion drop shadow under hull
  drawAmbientOcclusionShadow(ctx, 0, 8, 38, 7, 34);

  // Red boot-topping bottom
  ctx.fillStyle = PALETTE.crimson;
  ctx.fillRect(-34, 6, 70, 2);

  // Lower hull
  ctx.fillStyle = factionColor;
  ctx.beginPath();
  ctx.moveTo(-34, 6);
  ctx.lineTo(34, 6);
  ctx.lineTo(37, -1);
  ctx.lineTo(-34, -1);
  ctx.closePath();
  ctx.fill();

  // Dark armor belt
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(-34, 3, 70, 2);

  // Secondary 5-inch deck gun & flak sponsor casemates along hull
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(-22, 0, 5, 3);
  ctx.fillRect(20, 0, 5, 3);
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(-20, -1, 4, 1.5);
  ctx.fillRect(22, -1, 4, 1.5);

  // FLAT FLIGHT DECK (long teak wood flight deck with runway lines)
  ctx.fillStyle = PALETTE.khakiLeather;
  ctx.fillRect(-36, -6, 74, 5);

  // Teak planking lines & runway centerline dashes
  ctx.fillStyle = PALETTE.sandCream;
  for (let i = -30; i < 32; i += 8) {
    ctx.fillRect(i, -5, 5, 1);
  }

  // White arresting wires across aft flight deck
  ctx.fillStyle = PALETTE.sandCream;
  ctx.fillRect(-26, -6, 1, 5);
  ctx.fillRect(-20, -6, 1, 5);
  ctx.fillRect(-14, -6, 1, 5);

  // Starboard island: Essex's big block, Shokaku's small one far forward, Graf Zeppelin's long one.
  const il = Math.round(island.islandX - island.islandW / 2);
  const it = -5 - island.islandH;
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(il, it, island.islandW, island.islandH);
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(il + 2, it + 1, island.islandW - 3, Math.max(3, island.islandH - 4));
  ctx.fillStyle = PALETTE.feldgrau;
  const mastX = il + Math.floor(island.islandW / 2);
  ctx.fillRect(mastX - 1, it - 4, 2, 5); // Radar mast
  ctx.fillRect(mastX - 4, it - 3, 8, 1.5);

  // Funnel trunked into the island. Shokaku vents down the hull side instead.
  ctx.fillStyle = PALETTE.deepTaupe;
  if (island.funnel) {
    ctx.fillRect(il - 3, it + 3, 3, island.islandH - 3);
  } else {
    ctx.fillRect(il - 2, -1, 3, 4);
    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(il - 2, 3, 3, 1);
  }

  // --- CARRIER PLANE CAPACITY & AIRPLANE SYMBOLS ---
  // Count active planes carried (default max 2)
  const maxPlanes = unit.maxPlanesCarried !== undefined ? unit.maxPlanesCarried : 2;
  const planesCount = unit.planesCarried !== undefined ? unit.planesCarried : maxPlanes;

  // Render miniature pixel-art airplane icons cleanly on / beside the island status
  const iconBaseX = -32;
  const iconBaseY = -16;

  // Thematic tactical mini badge plate for plane count
  ctx.fillStyle = 'rgba(35, 28, 34, 0.85)';
  ctx.fillRect(iconBaseX - 3, iconBaseY - 3, maxPlanes * 11 + 5, 9);
  ctx.strokeStyle = PALETTE.deepTaupe;
  ctx.lineWidth = 1;
  ctx.strokeRect(iconBaseX - 3, iconBaseY - 3, maxPlanes * 11 + 5, 9);

  for (let p = 0; p < maxPlanes; p++) {
    const ix = iconBaseX + p * 11;
    const iy = iconBaseY;
    const isCarried = p < planesCount;
    drawMiniAirplaneIcon(ctx, ix, iy, isCarried);
  }

  // --- CARRIER LOGISTICS: PARKED FIGHTER PLANES ON FLIGHT DECK ---
  // Parked planes rest physically on the flight deck when onboard!
  for (let p = 0; p < Math.min(2, planesCount); p++) {
    const px = p === 0 ? -6 : 18;
    const py = -8;
    drawParkedCarrierFighter(ctx, px, py, time, p);
  }

  // Bow wave and hull wake
  ctx.fillStyle = PALETTE.sandCream;
  const bowFoam = Math.sin(time * 3) * 2;
  ctx.fillRect(36, 5, 8 + bowFoam, 2);
  ctx.fillRect(-37, 5, 6, 2);

  // Water wake when floating back astern
  if (unit.carrierFloatState === 'FLOATING_BACK') {
    ctx.fillStyle = PALETTE.sandCream;
    const wakePulse = (time * 4) % 1;
    ctx.fillRect(-44 - wakePulse * 6, 5, 8, 1.5);
    ctx.fillRect(35 + wakePulse * 4, 6, 6, 1.5);
    ctx.fillStyle = PALETTE.spruceSea;
    ctx.fillRect(-48, 6, 12, 1.5);
  }

  // Injured listing state (1st Hit)
  if (unit.maxHp > 1 && unit.currentHp === 1) {
    // Continuous rising dithered black smoke & flame plume (smoke only if noFire)
    drawShipDamageFireSmoke(ctx, time, -12, -8, noFire);
  }
}

/**
 * Draws miniature 6x5 pixel-art airplane silhouette for carrier capacity tracking.
 * Active plane: #DFCE91 (sandCream) with #495462 (navalSteel) tail & #A1A258 tip.
 * Launched plane: darkened silhouette #5E4E54 / #423840.
 */
function drawMiniAirplaneIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  isActive: boolean,
) {
  ctx.save();
  ctx.translate(x, y);

  if (isActive) {
    // 6x5 tiny fighter silhouette using palette colors #DFCE91 / #495462
    // Fuselage
    ctx.fillStyle = PALETTE.sandCream;
    ctx.fillRect(0, 1, 6, 2);
    // Wings
    ctx.fillRect(2, -1, 2, 6);
    // Tail fin
    ctx.fillStyle = PALETTE.navalSteel;
    ctx.fillRect(0, 0, 1, 4);
    // Propeller tip
    ctx.fillStyle = PALETTE.mustardBrass;
    ctx.fillRect(6, 1, 1, 2);
  } else {
    // Dimmed/dark silhouette when plane is launched/airborne
    ctx.fillStyle = PALETTE.deepTaupe;
    ctx.fillRect(1, 1, 4, 2);
    ctx.fillRect(2, 0, 2, 4);
    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(2, 1, 2, 2);
  }

  ctx.restore();
}

function drawParkedCarrierFighter(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  time: number,
  index: number,
) {
  ctx.save();
  ctx.translate(px, py);

  // Tiny parked fighter sprite (facing forward east)
  // Shadow on flight deck
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(-4, 2, 8, 2);

  // Wings (folded slightly or flat)
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(-3, -1, 6, 4);

  // Fuselage
  ctx.fillStyle = PALETTE.fieldSage;
  ctx.fillRect(-5, 0, 11, 2.5);

  // Tail
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(-5, -2, 2, 3);

  // Propeller spinner (yellow)
  ctx.fillStyle = PALETTE.mustardBrass;
  ctx.fillRect(6, 0.5, 2, 1.5);

  ctx.restore();
}

function drawBattleship(
  ctx: CanvasRenderingContext2D,
  factionColor: string,
  unit: CombatUnit,
  time: number,
  noFire = false,
  cue: ShipCue = { funnels: 2, bridge: 'tripod', turrets: 3 },
) {
  // Massive broadside capital ship (~88px long)
  // Ambient occlusion drop shadow under massive hull
  drawAmbientOcclusionShadow(ctx, 0, 10, 44, 8, 40);

  // Red Antifouling Boot-topping bottom
  ctx.fillStyle = PALETTE.crimson;
  ctx.fillRect(-40, 7, 82, 3);

  // Massive Armored Dreadnought Hull
  ctx.fillStyle = factionColor;
  ctx.beginPath();
  ctx.moveTo(-42, 7);
  ctx.lineTo(40, 7);
  ctx.lineTo(46, 0); // clipper bow prow
  ctx.lineTo(26, -4); // raised forecastle
  ctx.lineTo(-42, -4);
  ctx.closePath();
  ctx.fill();

  // Heavy Charcoal Armor Belt Strip
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(-41, 4, 82, 3);

  // Armored citadel, then this navy's bridge: Yamato's pagoda, Bismarck's tower, King George V's block.
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(-15, -14, 28, 10);

  // Heavy funnels behind the bridge. Yamato's single raked stack, Iowa's pair.
  const fourTurrets = cue.turrets >= 4;
  drawFunnels(ctx, cue.funnels, fourTurrets ? -9 : -15, -16, 12, cue.funnels === 1 ? 9 : 7, 2);
  drawBridge(ctx, cue.bridge, 0, -13, 1.4);

  // Secondary 5-inch Casemate Battery Ports
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(-8, -2, 4, 2);
  ctx.fillRect(4, -2, 4, 2);

  // Bow wave and churning broadside wake
  ctx.fillStyle = PALETTE.sandCream;
  const bowFoam = Math.sin(time * 3.5) * 3;
  ctx.fillRect(43, 6, 11 + bowFoam, 3);
  ctx.fillRect(-46, 6, 9, 2);

  // HEAVY MAIN BATTERY TRIPLE TURRETS
  // Turret A (Forward, x = 24, y = -6)
  // Turret B (Superfiring Forward, x = 10, y = -11)
  // Turret C (Aft, x = -28, y = -6)
  const isFiring = unit.animRecoil > 0;
  const turretAngle = isFiring ? -0.28 : 0;
  const barrelRecoil = isFiring ? unit.animRecoil * 5.2 : 0;

  drawNavalTurret(ctx, 24, -6, turretAngle, barrelRecoil, 15, isFiring, unit.animRecoil, true);
  if (cue.turrets >= 3) drawNavalTurret(ctx, 10, -11, turretAngle, barrelRecoil, 15, isFiring, unit.animRecoil, true);
  if (fourTurrets) drawNavalTurret(ctx, -20, -11, isFiring ? -0.15 : 0, isFiring ? barrelRecoil * 0.7 : 0, 14, false, 0, true);
  drawNavalTurret(ctx, fourTurrets ? -33 : -28, -6, isFiring ? -0.15 : 0, isFiring ? barrelRecoil * 0.7 : 0, 14, false, 0, true);

  // 1st Hit (Injured Phase):
  // Permanently tilted 10 degrees, continuous rising dithered black smoke (no fire if in AIR STRIKE TEST)!
  if (unit.maxHp > 1 && unit.currentHp === 1) {
    drawShipDamageFireSmoke(ctx, time, -4, -12, noFire);
  }
}

/**
 * Procedural Gun Turret with physical rotation toward target,
 * recoiling barrels, and massive yellow/white muzzle circles.
 */
function drawNavalTurret(
  ctx: CanvasRenderingContext2D,
  tx: number,
  ty: number,
  angle: number,
  recoil: number,
  barrelLen: number,
  showMuzzleFlash: boolean,
  recoilVal = 0,
  isHeavyBattleship = false,
) {
  ctx.save();
  ctx.translate(tx, ty);

  // Barbette ring
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(-7, 1, 14, 3);

  // Turret House (armored gunhouse)
  ctx.fillStyle = PALETTE.feldgrau;
  ctx.beginPath();
  ctx.moveTo(-9, 2);
  ctx.lineTo(8, 2);
  ctx.lineTo(10, -3);
  ctx.lineTo(-8, -3);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(-7, -2, 14, 4);

  // Rotating Barrels
  ctx.save();
  ctx.translate(5, -1);
  ctx.rotate(angle);

  const barrelRecoil = recoil;
  const bHeight = isHeavyBattleship ? 2.5 : 2;

  // Dual or Triple Barrels
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(0 - barrelRecoil, -2, barrelLen, bHeight);
  ctx.fillRect(0 - barrelRecoil, 1, barrelLen, bHeight);
  if (isHeavyBattleship) {
    ctx.fillRect(0 - barrelRecoil, -0.5, barrelLen + 1, bHeight);
  }

  // Massive Muzzle Flash Circles on Firing
  if (showMuzzleFlash && recoilVal > 0.15) {
    const mx = barrelLen - barrelRecoil;
    const my = 0;

    // Actual Canvas 2D Radial Gradient Bloom
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const bloomR = (isHeavyBattleship ? 26 : 18) * recoilVal;
    const mGrad = ctx.createRadialGradient(mx, my, 2, mx, my, bloomR);
    mGrad.addColorStop(0, 'rgba(255, 250, 200, 0.95)');
    mGrad.addColorStop(0.3, 'rgba(255, 190, 70, 0.65)');
    mGrad.addColorStop(0.7, 'rgba(220, 100, 30, 0.2)');
    mGrad.addColorStop(1, 'rgba(180, 40, 10, 0)');
    ctx.fillStyle = mGrad;
    ctx.beginPath();
    ctx.arc(mx, my, bloomR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Hot Core White/Yellow Flash Circle
    ctx.fillStyle = PALETTE.sandCream;
    ctx.beginPath();
    ctx.arc(mx, my, (isHeavyBattleship ? 7 : 5) * recoilVal, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
  ctx.restore();
}

/**
 * Continuous rising dithered black smoke & flame plume for injured ships (1st Hit)
 */
function drawShipDamageFireSmoke(
  ctx: CanvasRenderingContext2D,
  time: number,
  baseX: number,
  baseY: number,
  noFire = false,
) {
  // Flickering Fire at the breach point (omitted if noFire)
  if (!noFire) {
    const flamePulse = Math.sin(time * 14) * 2;
    ctx.fillStyle = PALETTE.crimson;
    ctx.fillRect(baseX - 3, baseY - 4 - flamePulse, 7, 5 + flamePulse);
    ctx.fillStyle = PALETTE.mustardBrass;
    ctx.fillRect(baseX - 1, baseY - 3 - flamePulse * 0.7, 4, 3 + flamePulse * 0.7);
    ctx.fillStyle = PALETTE.sandCream;
    ctx.fillRect(baseX, baseY - 2 - flamePulse * 0.5, 2, 2);
  }

  // Continuous Rising Dithered Black Smoke Plume
  for (let s = 0; s < 5; s++) {
    const phase = (time * 1.8 + s * 0.22) % 1;
    const sx = baseX - 2 + Math.sin(phase * 4) * 4 + phase * 6;
    const sy = baseY - 6 - phase * 26;
    const r = 3 + phase * 7;

    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - phase * 0.8);
    ctx.fillStyle = phase > 0.4 ? PALETTE.deepTaupe : PALETTE.bunkerCharcoal;
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(1, r), 0, Math.PI * 2);
    ctx.fill();

    // 1-bit dither flecks around smoke edge
    if (phase > 0.25) {
      ctx.fillStyle = PALETTE.trenchMudBone;
      ctx.fillRect(Math.round(sx + r * 0.6), Math.round(sy - 2), 2, 2);
      ctx.fillRect(Math.round(sx - r * 0.5), Math.round(sy - 3), 2, 2);
    }
    ctx.restore();
  }
}

/**
 * Draws the massive offshore support BATTLESHIP for European Test (Coast / Forest).
 * Sits down in the lower sea lane on attacker's left edge, roughly 2-3 ranks wide (~220px long).
 * Multi-tier grey/slate hull (#495462, #857577, #A69C90), armored barbettes, multiple rotating
 * gun turrets with recoiling long barrels, bridge superstructure, radar mast, and water wake.
 */
export function drawOffshoreBattleship(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  recoilX: number,
  recoilTrauma: number,
  turretAngle: number,
  turretRecoil: number,
  muzzleFlash: number,
  time: number,
) {
  ctx.save();
  ctx.translate(Math.round(x + recoilX), Math.round(y));

  // 1. Water Wake & Foam along the hull
  ctx.save();
  const wakeBob = Math.sin(time * 2.4) * 1.5;
  ctx.translate(0, wakeBob);

  // Forward bow wave & waterline foam
  ctx.fillStyle = PALETTE.sandCream;
  const foamAlpha = 0.5 + Math.sin(time * 4) * 0.2;
  ctx.globalAlpha = foamAlpha;
  ctx.fillRect(85, 16, 28, 3);
  ctx.fillRect(100, 14, 18, 2);
  ctx.fillRect(115, 18, 14, 2);

  // Waterline wash
  ctx.fillStyle = PALETTE.spruceSea;
  ctx.fillRect(-120, 18, 230, 4);
  ctx.fillStyle = PALETTE.sandCream;
  ctx.fillRect(-110, 19, 210, 2);
  ctx.restore();

  // 2. Ambient occlusion contact shadow under hull
  drawAmbientOcclusionShadow(ctx, 0, 18, 110, 8, 180);

  // 3. Lower Hull & Red Antifouling Boot-Topping Waterline
  ctx.fillStyle = PALETTE.crimson;
  ctx.beginPath();
  ctx.moveTo(-120, 18);
  ctx.lineTo(105, 18);
  ctx.lineTo(126, 14); // clipper bow prow
  ctx.lineTo(-120, 14);
  ctx.closePath();
  ctx.fill();

  // Dark armor belt strip
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(-120, 11, 230, 3);

  // Main Hull (slate blue naval steel #495462)
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.beginPath();
  ctx.moveTo(-120, 11);
  ctx.lineTo(105, 11);
  ctx.lineTo(128, 5); // sloping bow
  ctx.lineTo(135, -2); // prow beak
  ctx.lineTo(100, -2); // forecastle deck
  ctx.lineTo(-120, -2); // quarterdeck
  ctx.closePath();
  ctx.fill();

  // Forecastle and Quarterdeck armor plating highlight (#857577)
  ctx.fillStyle = PALETTE.feldgrau;
  ctx.fillRect(-115, -4, 215, 2);
  ctx.fillStyle = PALETTE.trenchMudBone;
  ctx.fillRect(-60, -5, 150, 1); // teak deck planking line

  // Prow anchor hawsehole & jackstaff
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(116, 2, 4, 3);
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(128, -8, 2, 7);

  // 4. Superstructure Bridge Island & Tower
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(-35, -18, 42, 14);
  ctx.fillStyle = PALETTE.feldgrau;
  ctx.fillRect(-30, -24, 32, 7);
  // Armored Conning Tower
  ctx.fillStyle = PALETTE.deepTaupe;
  ctx.fillRect(-12, -28, 18, 5);
  ctx.fillStyle = PALETTE.spruceSea; // bridge observation slits
  ctx.fillRect(-10, -26, 14, 2);

  // Radar Mast & Rangefinder
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(-5, -38, 3, 11);
  ctx.fillRect(-10, -36, 13, 2);
  ctx.fillStyle = PALETTE.trenchMudBone;
  ctx.fillRect(-8, -34, 9, 1);

  // Heavy Funnel / Smoke Stack
  ctx.fillStyle = PALETTE.deepTaupe;
  ctx.fillRect(-38, -26, 12, 10);
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(-38, -27, 12, 2);

  // Boiler exhaust vapor from funnel
  ctx.fillStyle = PALETTE.trenchMudBone;
  const steamP = (time * 3) % 1;
  ctx.globalAlpha = 0.5 * (1 - steamP);
  ctx.beginPath();
  ctx.arc(-32, -30 - steamP * 12, 2 + steamP * 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1.0;

  // 5. Armored Main Battery Turrets
  // Turret 1 (Forward Turret A, x = 65, y = -3)
  drawSuperTurret(ctx, 65, -3, turretAngle, turretRecoil);
  // Turret 2 (Superfiring Turret B, x = 25, y = -8)
  drawSuperTurret(ctx, 25, -8, turretAngle, turretRecoil);
  // Turret 3 (Aft Turret, x = -70, y = -3)
  drawSuperTurret(ctx, -70, -3, turretAngle * 0.5, turretRecoil * 0.6);

  // 6. Massive Muzzle Flash Bloom on the forward turrets
  if (muzzleFlash > 0.05) {
    const flashMuzzles = [
      {tx: 65, ty: -3},
      {tx: 25, ty: -8},
    ];

    flashMuzzles.forEach(({tx, ty}) => {
      const barrelLen = 34;
      const mx = tx + Math.cos(turretAngle) * barrelLen;
      const my = ty + Math.sin(turretAngle) * barrelLen;

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const bloomR = 48 * muzzleFlash;
      const mGrad = ctx.createRadialGradient(mx, my, 4, mx, my, bloomR);
      mGrad.addColorStop(0, 'rgba(255, 250, 210, 0.95)');
      mGrad.addColorStop(0.25, 'rgba(255, 180, 50, 0.7)');
      mGrad.addColorStop(0.65, 'rgba(220, 90, 20, 0.25)');
      mGrad.addColorStop(1, 'rgba(180, 30, 10, 0)');
      ctx.fillStyle = mGrad;
      ctx.beginPath();
      ctx.arc(mx, my, bloomR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = PALETTE.sandCream;
      ctx.beginPath();
      ctx.arc(mx, my, 8 * muzzleFlash, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  ctx.restore();
}

function drawSuperTurret(
  ctx: CanvasRenderingContext2D,
  tx: number,
  ty: number,
  angle: number,
  recoil: number,
) {
  // Barbette ring
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(tx - 12, ty + 1, 24, 4);

  // Armored Turret House
  ctx.fillStyle = PALETTE.feldgrau;
  ctx.beginPath();
  ctx.moveTo(tx - 14, ty + 2);
  ctx.lineTo(tx + 12, ty + 2);
  ctx.lineTo(tx + 15, ty - 5);
  ctx.lineTo(tx - 12, ty - 5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(tx - 11, ty - 4, 23, 5);

  // Triple Long Heavy Naval Barrels with Recoil
  ctx.save();
  ctx.translate(tx + 8, ty - 2);
  ctx.rotate(angle);

  const barrelRecoil = recoil * 7;
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(0 - barrelRecoil, -4, 28, 2.5);
  ctx.fillRect(0 - barrelRecoil, -1, 30, 2.5);
  ctx.fillRect(0 - barrelRecoil, 2, 28, 2.5);

  // Blast bags
  ctx.fillStyle = PALETTE.deepTaupe;
  ctx.fillRect(-2, -5, 4, 10);
  ctx.restore();
}

/** Resting elevation, then a steeper skyward angle while the gun is firing. */
function aaTilt(unit: CombatUnit): number {
  return unit.animRecoil > 0 || unit.animAnticipation > 0 ? -1.05 : -0.72;
}

/** Muzzle of the elevated AA barrel. The trunnion is at (0, -1) and the tube is 22px. */
function aaMuzzle(unit: CombatUnit): { x: number; y: number } {
  const tilt = aaTilt(unit);
  return { x: Math.cos(tilt) * 22, y: -1 + Math.sin(tilt) * 22 };
}

/**
 * A towed anti-aircraft gun: one wheel, a cruciform, a faction shield, and one barrel
 * on the trunnion. The old twin tubes rotated around the ground point and came off the carriage.
 */
function drawAaaFlak(ctx: CanvasRenderingContext2D, factionColor: string, unit: CombatUnit, helmet: Helmet) {
  drawAmbientOcclusionShadow(ctx, 2, 10, 16, 4, 18);

  ctx.fillStyle = PALETTE.deepTaupe;
  ctx.fillRect(-18, 6, 16, 3);
  ctx.fillRect(8, 7, 10, 2);
  ctx.fillStyle = PALETTE.earthBrown;
  ctx.fillRect(-20, 8, 4, 2);
  ctx.fillRect(16, 8, 3, 2);

  ctx.save();
  ctx.translate(-1, 4);
  ctx.fillStyle = PALETTE.earthBrown;
  ctx.beginPath();
  ctx.arc(0, 0, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = PALETTE.bunkerCharcoal;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(-5, -1, 10, 2);
  ctx.fillRect(-1, -5, 2, 10);
  ctx.restore();
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(-3, 2, 4, 4);

  ctx.fillStyle = factionColor;
  ctx.fillRect(-3, -10, 6, 14);
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(3, -8, 1, 10);

  ctx.save();
  ctx.translate(0, -1);
  ctx.rotate(aaTilt(unit));
  const kick = unit.animRecoil > 0 ? unit.animRecoil * 4 : 0;
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(-kick, -1.5, 22, 3);
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(20 - kick, -3, 3, 6);
  if (unit.animRecoil > 0.15) {
    ctx.fillStyle = PALETTE.sandCream;
    ctx.fillRect(23 - kick, -2, 5 * unit.animRecoil, 4);
  }
  ctx.restore();

  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(-16, 5, 3, 5);
  ctx.fillRect(-12, 5, 3, 5);
  ctx.fillStyle = PALETTE.deepTaupe;
  ctx.fillRect(-16, 1, 7, 5);
  ctx.fillStyle = factionColor;
  ctx.fillRect(-17, -6, 8, 8);
  ctx.fillStyle = PALETTE.khakiLeather;
  ctx.fillRect(-17, -1, 8, 2);
  ctx.fillStyle = PALETTE.sandCream;
  ctx.fillRect(-15, -10, 5, 4);
  drawHelmet(ctx, helmet, -12, -13, factionColor);
}

function drawDamageSmoke(ctx: CanvasRenderingContext2D, time: number) {
  for (let i = 0; i < 3; i++) {
    const smokePhase = (time * 2 + i * 0.33) % 1;
    const sx = -6 + Math.sin(smokePhase * 5) * 4;
    const sy = -8 - smokePhase * 16;
    const radius = 2 + smokePhase * 5;

    ctx.fillStyle = smokePhase > 0.5 ? PALETTE.trenchMudBone : PALETTE.bunkerCharcoal;
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(1, radius), 0, Math.PI * 2);
    ctx.fill();

    if (smokePhase < 0.3) {
      ctx.fillStyle = PALETTE.mustardBrass;
      ctx.fillRect(sx, sy + 4, 2, 2);
    }
  }
}

function drawDownedUnit(
  ctx: CanvasRenderingContext2D,
  unit: CombatUnit,
  factionColor: string,
  time: number,
  smokeAlpha = 1.0,
  noFire = false,
) {
  const alpha = unit.fadeAlpha !== undefined ? unit.fadeAlpha : 1.0;
  if (alpha <= 0.001) return;
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

  if (unit.type === 'infantry') {
    ctx.save();
    ctx.translate(1, 4);
    ctx.rotate(0.82);

    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(-6, 2, 4, 3);
    ctx.fillRect(-6, 6, 4, 3);
    ctx.fillStyle = PALETTE.deepTaupe;
    ctx.fillRect(-3, 2, 6, 5);
    ctx.fillStyle = factionColor;
    ctx.fillRect(2, 0, 7, 6);
    ctx.fillStyle = PALETTE.sandCream;
    ctx.fillRect(7, 2, 4, 4);
    ctx.fillStyle = factionColor;
    ctx.fillRect(9, 0, 6, 4);
    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(8, 3, 7, 1.5);
    ctx.restore();

    ctx.fillStyle = PALETTE.earthBrown;
    ctx.fillRect(-9, 7, 9, 2);
    ctx.fillStyle = PALETTE.navalSteel;
    ctx.fillRect(0, 7, 7, 1.5);
    ctx.fillStyle = PALETTE.sandCream;
    ctx.fillRect(7, 7, 2, 1);
  } else if (unit.type === 'tank') {
    ctx.save();
    ctx.rotate(0.12);
    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(-20, 6, 16, 4);
    ctx.fillRect(-3, 8, 20, 3);
    ctx.fillRect(-18, 1, 35, 7);
    ctx.fillStyle = PALETTE.deepTaupe;
    ctx.fillRect(-15, -4, 30, 6);
    ctx.fillStyle = factionColor;
    ctx.fillRect(-8, -4, 13, 5);

    ctx.save();
    ctx.translate(2, -7);
    ctx.rotate(-0.24);
    ctx.fillStyle = PALETTE.deepTaupe;
    ctx.fillRect(-8, -5, 15, 6);
    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(-3, -6, 5, 3);
    ctx.fillStyle = PALETTE.navalSteel;
    ctx.fillRect(6, -3, 16, 3.5);
    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(21, -2, 4, 4);
    ctx.restore();
    ctx.restore();

    drawThinWreckageSmoke(ctx, time, -4, -7, smokeAlpha);
  } else if (unit.type === 'artillery' || unit.type === 'aaa') {
    ctx.save();
    ctx.rotate(0.2);
    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(-12, 3, 14, 3);
    ctx.fillStyle = PALETTE.deepTaupe;
    ctx.beginPath();
    ctx.arc(-2, 5, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = factionColor;
    ctx.fillRect(-2, -4, 4, 8);
    ctx.fillStyle = PALETTE.navalSteel;
    ctx.save();
    ctx.rotate(0.38);
    ctx.fillRect(0, -1, 16, 3);
    ctx.restore();
    ctx.restore();

    drawThinWreckageSmoke(ctx, time, 0, 0, smokeAlpha);
  } else if (unit.type === 'fighter' || unit.type === 'tactical_bomber' || unit.type === 'strategic_bomber') {
    ctx.save();
    ctx.rotate(0.16);
    ctx.fillStyle = PALETTE.deepTaupe;
    ctx.fillRect(-10, 0, 20, 6);
    ctx.fillStyle = factionColor;
    ctx.fillRect(-4, -1, 8, 4);
    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(-6, -6, 12, 4);
    ctx.restore();

    drawThinWreckageSmoke(ctx, time, 2, 0, smokeAlpha);
  } else if (
    unit.type === 'battleship' ||
    unit.type === 'carrier' ||
    unit.type === 'cruiser' ||
    unit.type === 'destroyer' ||
    unit.type === 'submarine'
  ) {
    // --- NAVAL SINKING PHASE (LETHAL HIT) ---
    ctx.save();
    const sinkProgress = unit.sinkingProgress || 0;
    // 45 degrees tilt (0.785 rad)
    ctx.rotate(0.785);

    // Hull silhouette submerging into the waves
    const isBattleship = unit.type === 'battleship';
    const isCarrier = unit.type === 'carrier';
    const hullLen = isBattleship ? 76 : isCarrier ? 68 : unit.type === 'cruiser' ? 56 : 42;

    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(-hullLen / 2, 0, hullLen, 8);
    ctx.fillStyle = factionColor;
    ctx.fillRect(-hullLen / 2 + 2, -4, hullLen - 4, 6);
    ctx.fillStyle = PALETTE.crimson;
    ctx.fillRect(-hullLen / 2, 6, hullLen, 2); // boot-topping

    // Superstructure wreckage
    ctx.fillStyle = PALETTE.navalSteel;
    ctx.fillRect(-10, -10, 20, 8);

    // Secondary deck explosions (flashes omitted if noFire)
    if (!noFire) {
      const popSeed = Math.sin(time * 12 + unit.animBobOffset);
      if (popSeed > 0.3) {
        ctx.fillStyle = PALETTE.mustardBrass;
        ctx.fillRect(-6, -8, 5, 5);
        ctx.fillStyle = PALETTE.sandCream;
        ctx.fillRect(-4, -6, 3, 3);
      }
      if (Math.cos(time * 15 + unit.animBobOffset) > 0.4) {
        ctx.fillStyle = PALETTE.crimson;
        ctx.fillRect(8, -5, 6, 5);
        ctx.fillStyle = PALETTE.sandCream;
        ctx.fillRect(10, -3, 3, 3);
      }
    }

    ctx.restore();

    // Billowing black smoke plume rising from sinking ship (smoke only if noFire)
    drawShipDamageFireSmoke(ctx, time, -4, -6, noFire);

    // Churning sea foam and water waves lapping over submerging deck
    ctx.save();
    ctx.fillStyle = PALETTE.sandCream;
    const foamBob = Math.sin(time * 4) * 3;
    ctx.fillRect(-18, 4, 36, 2);
    ctx.fillRect(-12 + foamBob, 2, 24, 2);
    ctx.restore();
  } else {
    ctx.save();
    ctx.rotate(0.22);
    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(-18, 1, 36, 5);
    ctx.fillStyle = factionColor;
    ctx.fillRect(-14, -2, 26, 4);
    ctx.fillStyle = PALETTE.navalSteel;
    ctx.fillRect(-6, -6, 10, 4);
    ctx.restore();

    drawThinWreckageSmoke(ctx, time, 0, -2, smokeAlpha);
  }
}

function drawThinWreckageSmoke(
  ctx: CanvasRenderingContext2D,
  time: number,
  baseX: number,
  baseY: number,
  smokeAlpha = 1.0,
) {
  if (smokeAlpha <= 0.01) return;
  for (let s = 0; s < 3; s++) {
    const p = (time * 1.6 + s * 0.33) % 1;
    const sx = baseX + Math.sin(p * 4) * 3 + p * 4;
    const sy = baseY - p * 15;
    const r = 2 + p * 3;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, smokeAlpha * (1 - p * 0.5)));
    ctx.fillStyle = p > 0.5 ? PALETTE.deepTaupe : PALETTE.bunkerCharcoal;
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(1, r), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ============================================================================
// COMBAT VFX RENDERERS (ACTUAL RADIAL GRADIENT BLOOM & AMBIENT OCCLUSION)
// ============================================================================

export function drawBloodSplatters(ctx: CanvasRenderingContext2D, splatters: BloodSplatter[]) {
  splatters.forEach((b) => {
    ctx.save();
    ctx.globalAlpha = Math.max(0, b.life / b.maxLife);
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.arc(b.x, b.y, Math.max(1, b.size), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

export function drawFlyingDebris(ctx: CanvasRenderingContext2D, debrisList: FlyingDebris[]) {
  debrisList.forEach((d) => {
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.rotate(d.rot);
    ctx.fillStyle = d.color;

    if (d.type === 'helmet') {
      ctx.beginPath();
      ctx.ellipse(0, 0, d.size + 1, d.size * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = PALETTE.bunkerCharcoal;
      ctx.fillRect(-d.size, 1, (d.size + 1) * 2, 1.5);
    } else if (d.type === 'rifle') {
      ctx.fillRect(-d.size * 2, -1, d.size * 4, 2.5);
      ctx.fillStyle = PALETTE.earthBrown;
      ctx.fillRect(-d.size * 2, -1, d.size * 2, 3);
    } else {
      ctx.fillRect(-d.size, -d.size, d.size * 2, d.size * 2);
      ctx.fillStyle = PALETTE.mustardBrass;
      ctx.fillRect(-1, -1, 2, 2);
    }
    ctx.restore();
  });
}

/**
 * Draws billowing smoke puffs with support for the 2.0s post-casualty smooth dissipation fade.
 */
export function drawSmokePuffs(ctx: CanvasRenderingContext2D, puffs: SmokePuff[]) {
  puffs.forEach((p) => {
    ctx.save();
    const progress = Math.max(0, Math.min(1, 1 - p.life / p.maxLife));
    const r = Math.max(2, p.radius + progress * (p.maxRadius - p.radius));
    const cx = Math.round(p.x);
    const cy = Math.round(p.y);

    // Smooth post-casualty fade factor if fadeTimer is active
    let fadeMult = 1.0;
    if (p.fadeTimer !== undefined) {
      fadeMult = Math.max(0, Math.min(1, p.fadeTimer / (p.maxFadeTimer || 2.0)));
    }

    if (progress < 0.3) {
      ctx.globalAlpha = 0.95 * fadeMult;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();

      const lobeR = Math.max(2, r * 0.75);
      ctx.beginPath();
      ctx.arc(cx - lobeR * 0.35, cy - lobeR * 0.3, lobeR, 0, Math.PI * 2);
      ctx.arc(cx + lobeR * 0.4, cy - lobeR * 0.25, lobeR * 0.85, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = PALETTE.bunkerCharcoal;
      ctx.beginPath();
      ctx.arc(cx, cy + 1, Math.max(1, r * 0.45), 0, Math.PI * 2);
      ctx.fill();
    } else if (progress < 0.7) {
      ctx.globalAlpha = Math.max(0.08, (0.9 - progress * 0.65) * fadeMult);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(1, r * 0.58), 0, Math.PI * 2);
      ctx.arc(cx + r * 0.3, cy - r * 0.25, Math.max(1, r * 0.45), 0, Math.PI * 2);
      ctx.fill();

      // Outer soft ring
      const step = 2;
      const intR = Math.round(r);
      const innerR2 = (r * 0.45) * (r * 0.45);
      const outerR2 = r * r;
      for (let dy = -intR; dy <= intR; dy += step) {
        for (let dx = -intR; dx <= intR; dx += step) {
          const d2 = dx * dx + dy * dy;
          if (d2 >= innerR2 && d2 <= outerR2) {
            if (((Math.floor(cx + dx) + Math.floor(cy + dy)) & 2) === 0) {
              ctx.fillRect(cx + dx, cy + dy, step, step);
            }
          }
        }
      }
    } else {
      ctx.globalAlpha = Math.max(0.04, ((1 - progress) * 0.75) * fadeMult);
      ctx.fillStyle =
        p.color === PALETTE.sandCream || p.color === PALETTE.trenchMudBone
          ? PALETTE.trenchMudBone
          : PALETTE.deepTaupe;

      const step = 2;
      const intR = Math.round(r);
      const outerR2 = r * r;
      for (let dy = -intR; dy <= intR; dy += step) {
        for (let dx = -intR; dx <= intR; dx += step) {
          const d2 = dx * dx + dy * dy;
          if (d2 <= outerR2) {
            if (((Math.floor(cx + dx) ^ Math.floor(cy + dy)) & 3) === 0) {
              ctx.fillRect(cx + dx, cy + dy, 2, 2);
            }
          }
        }
      }
    }

    ctx.restore();
  });
}

/**
 * Draws persistent burning ground fires with ACTUAL AMBIENT OCCLUSION SOOT at base
 * and ACTUAL CANVAS 2D RADIAL GRADIENT BLOOM GLOW around flames.
 * Supports smooth 2.0s post-casualty dissipation fade.
 */
export function drawGroundFires(
  ctx: CanvasRenderingContext2D,
  fires: GroundFire[],
  time: number,
) {
  fires.forEach((fire) => {
    ctx.save();
    const cx = Math.round(fire.x);
    const cy = Math.round(fire.y);
    const fireAlpha = fire.alpha !== undefined ? Math.max(0, Math.min(1, fire.alpha)) : 1.0;
    const baseIntensity = fire.intensity !== undefined ? fire.intensity : 1.0;
    const intensity = baseIntensity * fireAlpha;
    if (intensity <= 0.01 || fireAlpha <= 0.01) {
      ctx.restore();
      return;
    }
    ctx.globalAlpha = fireAlpha;

    const r = fire.radius * Math.max(0.25, intensity);
    const charR = fire.charredRadius * Math.max(0.35, intensity);

    // 1. ACTUAL AMBIENT OCCLUSION & CHARRED SOOT DROP SHADOW AT THE BASE
    const aoGrad = ctx.createRadialGradient(cx, cy + 2, charR * 0.15, cx, cy + 2, charR * 1.15);
    aoGrad.addColorStop(0, 'rgba(20, 16, 22, 0.85)');
    aoGrad.addColorStop(0.5, 'rgba(38, 30, 36, 0.55)');
    aoGrad.addColorStop(0.85, 'rgba(55, 45, 52, 0.18)');
    aoGrad.addColorStop(1, 'rgba(55, 45, 52, 0)');
    ctx.fillStyle = aoGrad;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 2, charR * 1.15, Math.max(3, charR * 0.65), 0, 0, Math.PI * 2);
    ctx.fill();

    // Dark contact crevice line
    ctx.fillStyle = 'rgba(12, 10, 14, 0.9)';
    ctx.fillRect(cx - Math.round(r * 0.8), cy + 1, Math.round(r * 1.6), 2);

    // 2. ACTUAL RADIAL GRADIENT BLOOM GLOW (replaces pure dither pattern)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const bloomPulse = Math.sin(time * 12 + fire.flickerOffset) * 2;
    const bloomOuterR = Math.max(4, (charR * 1.6 + bloomPulse) * Math.max(0.3, intensity));
    const fireBloom = ctx.createRadialGradient(cx, cy - 2, 2, cx, cy - 2, bloomOuterR);
    fireBloom.addColorStop(0, `rgba(255, 220, 110, ${0.75 * intensity})`);
    fireBloom.addColorStop(0.3, `rgba(245, 140, 45, ${0.45 * intensity})`);
    fireBloom.addColorStop(0.65, `rgba(200, 60, 20, ${0.18 * intensity})`);
    fireBloom.addColorStop(1, 'rgba(150, 30, 10, 0)');
    ctx.fillStyle = fireBloom;
    ctx.beginPath();
    ctx.arc(cx, cy - 2, bloomOuterR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 3. BURNING EMBER COAL BED
    ctx.fillStyle = PALETTE.plum;
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.max(2, r * 0.85), Math.max(1, r * 0.48), 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = PALETTE.crimson;
    ctx.beginPath();
    ctx.ellipse(cx, cy - 1, Math.max(1, r * 0.55), Math.max(1, r * 0.32), 0, 0, Math.PI * 2);
    ctx.fill();

    // 4. PROCEDURAL FLICKERING FLAME TONGUES
    const flameCount = 4;
    for (let f = 0; f < flameCount; f++) {
      const tongueOffset = (f - (flameCount - 1) / 2) * (r * 0.42);
      const flameSeed = time * 13 + fire.flickerOffset + f * 2.2;
      const flickerH = Math.sin(flameSeed) * 0.35 + Math.cos(flameSeed * 1.7) * 0.25 + 0.65;
      const flameHeight = Math.max(3, r * 1.65 * flickerH * intensity);
      const flameWidth = Math.max(1.5, (r * 0.38) * (1 - f * 0.1) * intensity);

      const tx = Math.round(cx + tongueOffset);
      const ty = Math.round(cy);

      // Deep Crimson outer flame
      ctx.fillStyle = PALETTE.crimson;
      ctx.fillRect(tx - flameWidth, ty - flameHeight, flameWidth * 2, flameHeight);

      // Warm Terracotta mid layer
      ctx.fillStyle = PALETTE.terracotta;
      ctx.fillRect(
        tx - Math.max(1, flameWidth - 1),
        ty - Math.round(flameHeight * 0.85),
        Math.max(2, (flameWidth - 1) * 2),
        Math.round(flameHeight * 0.85),
      );

      // Mustard Brass hot core
      ctx.fillStyle = PALETTE.mustardBrass;
      ctx.fillRect(
        tx - Math.max(1, flameWidth * 0.5),
        ty - Math.round(flameHeight * 0.65),
        Math.max(1, flameWidth),
        Math.round(flameHeight * 0.65),
      );

      // Sand Cream tip
      ctx.fillStyle = PALETTE.sandCream;
      ctx.fillRect(
        tx - 1,
        ty - Math.round(flameHeight + 1),
        2,
        Math.max(1, Math.round(flameHeight * 0.35)),
      );

      if (Math.sin(flameSeed * 2.3) > 0.3 && intensity > 0.4) {
        ctx.fillRect(tx, ty - Math.round(flameHeight + 4), 2, 2);
      }
    }

    ctx.restore();
  });
}

export function drawDroppingBombs(
  ctx: CanvasRenderingContext2D,
  bombs: {x: number; y: number; vx: number; vy: number}[],
) {
  bombs.forEach((b) => {
    ctx.save();
    ctx.translate(Math.round(b.x), Math.round(b.y));
    const angle = Math.atan2(b.vy, b.vx);
    ctx.rotate(angle);

    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(-5, -2.5, 10, 5);
    ctx.fillStyle = PALETTE.navalSteel;
    ctx.fillRect(-3, -2, 6, 4);

    ctx.fillStyle = PALETTE.trenchMudBone;
    ctx.fillRect(4, -1.5, 2, 3);

    ctx.fillStyle = PALETTE.mustardBrass;
    ctx.fillRect(-7, -3.5, 2, 7);
    ctx.fillStyle = PALETTE.crimson;
    ctx.fillRect(-6, -2, 1, 4);

    ctx.restore();
  });
}

export function drawShockwaves(ctx: CanvasRenderingContext2D, shockwaves: Shockwave[]) {
  shockwaves.forEach((sw) => {
    ctx.save();
    const alpha = Math.max(0, sw.life / sw.maxLife);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = sw.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sw.x, sw.y, Math.max(1, sw.radius), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  });
}

/**
 * Draws water geyser splash explosions from torpedo impacts and heavy naval ordnance
 */
export function drawWaterGeysers(
  ctx: CanvasRenderingContext2D,
  geysers: WaterGeyser[],
) {
  geysers.forEach((g) => {
    ctx.save();
    const progress = Math.max(0, Math.min(1, 1 - g.life / g.maxLife));
    const alpha = Math.max(0, Math.min(1, g.life / g.maxLife));
    ctx.globalAlpha = alpha;

    const gx = Math.round(g.x);
    const gy = Math.round(g.y);

    // Height envelope: erupts quickly up, lingers, then collapses
    const hProgress = progress < 0.28 ? progress / 0.28 : Math.max(0, 1 - (progress - 0.28) / 0.72);
    const curH = Math.round(g.maxHeight * hProgress);

    // 1. Concentric Water Surface Ripple Rings
    const ringR = Math.max(4, g.width * (0.5 + progress * 1.6));
    ctx.strokeStyle = PALETTE.sandCream;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(gx, gy, ringR, ringR * 0.45, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = PALETTE.spruceSea;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(gx, gy, ringR * 0.65, ringR * 0.3, 0, 0, Math.PI * 2);
    ctx.stroke();

    // 2. Churning Vertical Water Geyser Column
    if (curH > 2) {
      // Spruce sea core
      ctx.fillStyle = PALETTE.spruceSea;
      ctx.beginPath();
      ctx.moveTo(gx - g.width * 0.5, gy);
      ctx.lineTo(gx - g.width * 0.3, gy - curH * 0.6);
      ctx.lineTo(gx - g.width * 0.15, gy - curH);
      ctx.lineTo(gx + g.width * 0.15, gy - curH);
      ctx.lineTo(gx + g.width * 0.3, gy - curH * 0.6);
      ctx.lineTo(gx + g.width * 0.5, gy);
      ctx.closePath();
      ctx.fill();

      // White foam outer spray
      ctx.fillStyle = PALETTE.sandCream;
      ctx.fillRect(gx - 4, gy - curH, 8, Math.max(3, curH * 0.35));
      ctx.fillRect(gx - 2, gy - curH - 3, 4, 3); // Geyser crown

      // Spray droplets showering in fountain arc
      const dropletCount = 6;
      for (let i = 0; i < dropletCount; i++) {
        const spreadX = ((i - 2.5) / 2.5) * (g.width * (0.8 + progress));
        const dropY = gy - curH * (0.3 + 0.6 * (1 - Math.abs(i - 2.5) / 3)) + progress * 14;
        ctx.fillStyle = i % 2 === 0 ? PALETTE.sandCream : PALETTE.trenchMudBone;
        ctx.fillRect(Math.round(gx + spreadX), Math.round(dropY), 2.5, 2.5);
      }
    }

    ctx.restore();
  });
}

export function drawPlaneSortie(
  ctx: CanvasRenderingContext2D,
  sortie: PlaneSortie,
  time: number,
  factionColor: string,
  noPlaneShadow = false,
) {
  ctx.save();

  // Smooth fade out drop shadows during takeoff / attack runs, and fade back in on return / landing
  if (!noPlaneShadow) {
    let shadowAlpha = 1.0;
    if (sortie.progress < 0.22) {
      shadowAlpha = Math.max(0, 1.0 - (sortie.progress / 0.22));
    } else if (sortie.progress > 0.78) {
      shadowAlpha = Math.min(1.0, (sortie.progress - 0.78) / 0.22);
    } else {
      shadowAlpha = 0;
    }

    if (shadowAlpha > 0.005) {
      // Ground drop shadow follows plane X while staying grounded near home base level
      const groundShadowY = Math.round(sortie.homeY + 18 + (sortie.currentY + 28 - (sortie.homeY + 18)) * (1 - shadowAlpha));
      drawAmbientOcclusionShadow(
        ctx,
        Math.round(sortie.currentX),
        groundShadowY,
        22 + (1 - shadowAlpha) * 6,
        6 + (1 - shadowAlpha) * 2,
        18,
        shadowAlpha,
      );
    }
  }

  // Plane position & rotation
  ctx.translate(Math.round(sortie.currentX), Math.round(sortie.currentY));
  ctx.rotate(sortie.currentRot);

  if (sortie.side === 'defender') {
    ctx.scale(-1, 1);
  }

  if (sortie.unitType === 'fighter') {
    ctx.fillStyle = factionColor;
    ctx.fillRect(-10, -4, 20, 8);
    ctx.fillRect(-4, -14, 10, 28);
    ctx.fillStyle = PALETTE.mustardBrass;
    ctx.fillRect(10, -3, 3, 6);
    ctx.fillStyle = PALETTE.spruceSea;
    ctx.fillRect(-2, -3, 5, 6);

    // Muzzle flash at gun port during firing bursts
    if (sortie.bulletBurstsFired > 0) {
      const wingOffsets = [-8, 8];
      wingOffsets.forEach((wingY) => {
        // Actual small radial bloom flash
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const fGrad = ctx.createRadialGradient(12, wingY, 1, 12, wingY, 8);
        fGrad.addColorStop(0, 'rgba(255, 250, 200, 0.9)');
        fGrad.addColorStop(0.4, 'rgba(240, 180, 60, 0.45)');
        fGrad.addColorStop(1, 'rgba(200, 100, 20, 0)');
        ctx.fillStyle = fGrad;
        ctx.beginPath();
        ctx.arc(12, wingY, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        ctx.fillStyle = PALETTE.sandCream;
        ctx.fillRect(10, wingY - 1.5, 4, 3);
      });
    }
  } else {
    ctx.fillStyle = factionColor;
    ctx.fillRect(-16, -6, 32, 12);
    ctx.fillRect(-6, -20, 16, 40);
    ctx.fillStyle = PALETTE.navalSteel;
    ctx.fillRect(0, -14, 8, 4);
    ctx.fillRect(0, 10, 8, 4);
    ctx.fillStyle = PALETTE.spruceSea;
    ctx.fillRect(10, -4, 5, 8);

    if (sortie.bombsDropped > 0) {
      ctx.fillStyle = PALETTE.bunkerCharcoal;
      ctx.fillRect(-4, -2, 10, 5);
      ctx.fillStyle = PALETTE.terracotta;
      ctx.fillRect(-6, -2, 2, 5);
      ctx.fillRect(6, -2, 2, 5);
    }
  }

  ctx.restore();
}

/**
 * Full 3x5 Pixel Font Matrix for Retro Combat HUD, VICTORY Banners & Hit Numbers
 */
export const PIXEL_GLYPHS: Record<string, number[][]> = {
  'A': [
    [0, 1, 0],
    [1, 0, 1],
    [1, 1, 1],
    [1, 0, 1],
    [1, 0, 1],
  ],
  'B': [
    [1, 1, 0],
    [1, 0, 1],
    [1, 1, 0],
    [1, 0, 1],
    [1, 1, 0],
  ],
  'C': [
    [0, 1, 1],
    [1, 0, 0],
    [1, 0, 0],
    [1, 0, 0],
    [0, 1, 1],
  ],
  'D': [
    [1, 1, 0],
    [1, 0, 1],
    [1, 0, 1],
    [1, 0, 1],
    [1, 1, 0],
  ],
  'E': [
    [1, 1, 1],
    [1, 0, 0],
    [1, 1, 0],
    [1, 0, 0],
    [1, 1, 1],
  ],
  'F': [
    [1, 1, 1],
    [1, 0, 0],
    [1, 1, 0],
    [1, 0, 0],
    [1, 0, 0],
  ],
  'G': [
    [0, 1, 1],
    [1, 0, 0],
    [1, 0, 1],
    [1, 0, 1],
    [0, 1, 1],
  ],
  'H': [
    [1, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [1, 0, 1],
    [1, 0, 1],
  ],
  'I': [
    [1, 1, 1],
    [0, 1, 0],
    [0, 1, 0],
    [0, 1, 0],
    [1, 1, 1],
  ],
  'J': [
    [0, 0, 1],
    [0, 0, 1],
    [0, 0, 1],
    [1, 0, 1],
    [0, 1, 0],
  ],
  'K': [
    [1, 0, 1],
    [1, 1, 0],
    [1, 0, 0],
    [1, 1, 0],
    [1, 0, 1],
  ],
  'L': [
    [1, 0, 0],
    [1, 0, 0],
    [1, 0, 0],
    [1, 0, 0],
    [1, 1, 1],
  ],
  'M': [
    [1, 0, 1],
    [1, 1, 1],
    [1, 0, 1],
    [1, 0, 1],
    [1, 0, 1],
  ],
  'N': [
    [1, 0, 1],
    [1, 1, 1],
    [1, 1, 1],
    [1, 0, 1],
    [1, 0, 1],
  ],
  'O': [
    [0, 1, 0],
    [1, 0, 1],
    [1, 0, 1],
    [1, 0, 1],
    [0, 1, 0],
  ],
  'P': [
    [1, 1, 0],
    [1, 0, 1],
    [1, 1, 0],
    [1, 0, 0],
    [1, 0, 0],
  ],
  'Q': [
    [0, 1, 0],
    [1, 0, 1],
    [1, 0, 1],
    [1, 1, 0],
    [0, 1, 1],
  ],
  'R': [
    [1, 1, 0],
    [1, 0, 1],
    [1, 1, 0],
    [1, 0, 1],
    [1, 0, 1],
  ],
  'S': [
    [0, 1, 1],
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 1, 0],
  ],
  'T': [
    [1, 1, 1],
    [0, 1, 0],
    [0, 1, 0],
    [0, 1, 0],
    [0, 1, 0],
  ],
  'U': [
    [1, 0, 1],
    [1, 0, 1],
    [1, 0, 1],
    [1, 0, 1],
    [0, 1, 1],
  ],
  'V': [
    [1, 0, 1],
    [1, 0, 1],
    [1, 0, 1],
    [1, 0, 1],
    [0, 1, 0],
  ],
  'W': [
    [1, 0, 1],
    [1, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [1, 0, 1],
  ],
  'X': [
    [1, 0, 1],
    [1, 0, 1],
    [0, 1, 0],
    [1, 0, 1],
    [1, 0, 1],
  ],
  'Y': [
    [1, 0, 1],
    [1, 0, 1],
    [0, 1, 0],
    [0, 1, 0],
    [0, 1, 0],
  ],
  'Z': [
    [1, 1, 1],
    [0, 0, 1],
    [0, 1, 0],
    [1, 0, 0],
    [1, 1, 1],
  ],
  '0': [
    [1, 1, 1],
    [1, 0, 1],
    [1, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
  ],
  '1': [
    [0, 1, 0],
    [1, 1, 0],
    [0, 1, 0],
    [0, 1, 0],
    [1, 1, 1],
  ],
  '2': [
    [1, 1, 0],
    [0, 0, 1],
    [0, 1, 0],
    [1, 0, 0],
    [1, 1, 1],
  ],
  '3': [
    [1, 1, 0],
    [0, 0, 1],
    [0, 1, 0],
    [0, 0, 1],
    [1, 1, 0],
  ],
  '4': [
    [1, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 0, 1],
    [0, 0, 1],
  ],
  '5': [
    [1, 1, 1],
    [1, 0, 0],
    [1, 1, 0],
    [0, 0, 1],
    [1, 1, 0],
  ],
  '6': [
    [0, 1, 1],
    [1, 0, 0],
    [1, 1, 0],
    [1, 0, 1],
    [0, 1, 0],
  ],
  '7': [
    [1, 1, 1],
    [0, 0, 1],
    [0, 1, 0],
    [0, 1, 0],
    [0, 1, 0],
  ],
  '8': [
    [0, 1, 0],
    [1, 0, 1],
    [0, 1, 0],
    [1, 0, 1],
    [0, 1, 0],
  ],
  '9': [
    [0, 1, 0],
    [1, 0, 1],
    [0, 1, 1],
    [0, 0, 1],
    [0, 1, 0],
  ],
  '+': [
    [0, 1, 0],
    [1, 1, 1],
    [0, 1, 0],
    [0, 0, 0],
    [0, 0, 0],
  ],
  '-': [
    [0, 0, 0],
    [0, 0, 0],
    [1, 1, 1],
    [0, 0, 0],
    [0, 0, 0],
  ],
  ':': [
    [0, 0, 0],
    [0, 1, 0],
    [0, 0, 0],
    [0, 1, 0],
    [0, 0, 0],
  ],
  '!': [
    [0, 1, 0],
    [0, 1, 0],
    [0, 1, 0],
    [0, 0, 0],
    [0, 1, 0],
  ],
  ' ': [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ],
};

export function drawPixelString(
  ctx: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  startY: number,
  pixelSize = 3,
  color: string = PALETTE.sandCream,
  shadowColor: string = PALETTE.bunkerCharcoal,
) {
  const glyphW = 3;
  const glyphH = 5;
  const letterSpacing = pixelSize;

  const totalWidth = text.length * (glyphW * pixelSize + letterSpacing) - letterSpacing;
  let curX = Math.round(centerX - totalWidth / 2);
  const curY = Math.round(startY);

  for (let i = 0; i < text.length; i++) {
    const char = text[i].toUpperCase();
    const bitmap = PIXEL_GLYPHS[char];
    if (bitmap) {
      if (shadowColor) {
        ctx.fillStyle = shadowColor;
        for (let r = 0; r < glyphH; r++) {
          for (let c = 0; c < glyphW; c++) {
            if (bitmap[r][c]) {
              ctx.fillRect(
                curX + c * pixelSize + 1,
                curY + r * pixelSize + 1,
                pixelSize,
                pixelSize,
              );
            }
          }
        }
      }

      ctx.fillStyle = color;
      for (let r = 0; r < glyphH; r++) {
        for (let c = 0; c < glyphW; c++) {
          if (bitmap[r][c]) {
            ctx.fillRect(
              curX + c * pixelSize,
              curY + r * pixelSize,
              pixelSize,
              pixelSize,
            );
          }
        }
      }
    }
    curX += glyphW * pixelSize + letterSpacing;
  }
}

export function drawPixelText(
  ctx: CanvasRenderingContext2D,
  text: string,
  startX: number,
  startY: number,
  color: string,
  accentColor: string,
) {
  const pixelSize = 2;
  const glyphW = 3;
  const glyphH = 5;
  const letterSpacing = 2;

  const totalWidth = text.length * (glyphW * pixelSize + letterSpacing) - letterSpacing;
  let curX = Math.round(startX - totalWidth / 2);
  const curY = Math.round(startY);

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const bitmap = PIXEL_GLYPHS[char];
    if (bitmap) {
      ctx.fillStyle = PALETTE.bunkerCharcoal;
      for (let r = 0; r < glyphH; r++) {
        for (let c = 0; c < glyphW; c++) {
          if (bitmap[r][c]) {
            ctx.fillRect(curX + c * pixelSize + 1, curY + r * pixelSize + 1, pixelSize, pixelSize);
            ctx.fillRect(curX + c * pixelSize + 2, curY + r * pixelSize + 2, pixelSize, pixelSize);
          }
        }
      }

      ctx.fillStyle = accentColor;
      for (let r = 0; r < glyphH; r++) {
        for (let c = 0; c < glyphW; c++) {
          if (bitmap[r][c]) {
            ctx.fillRect(curX + c * pixelSize, curY + r * pixelSize + 1, pixelSize, pixelSize);
          }
        }
      }

      ctx.fillStyle = color;
      for (let r = 0; r < glyphH; r++) {
        for (let c = 0; c < glyphW; c++) {
          if (bitmap[r][c]) {
            ctx.fillRect(curX + c * pixelSize, curY + r * pixelSize, pixelSize, pixelSize);
          }
        }
      }
    }
    curX += glyphW * pixelSize + letterSpacing;
  }
}

export function drawFloatingTexts(
  ctx: CanvasRenderingContext2D,
  texts: FloatingText[],
) {
  texts.forEach((ft) => {
    ctx.save();
    const alpha = Math.max(0, ft.life / ft.maxLife);
    ctx.globalAlpha = alpha;
    drawPixelText(ctx, ft.text, ft.x, ft.y, ft.color, ft.accentColor);
    ctx.restore();
  });
}

// ============================================================================
// PROCEDURAL FULL-SCREEN WAVING FLAG & VICTORY SEQUENCE RENDERER
// ============================================================================

/**
 * Renders a full-screen dynamic procedural waving flag in an infinite loop
 * using the 16-color military palette with cloth ripples and fold shading.
 */
export function drawProceduralWavingFlag(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  theater: TheaterId,
  motif?: FlagMotif,
) {
  ctx.save();

  // Flag parameters: 13 stripes standard / faction motif
  const stripeCount = 13;
  const stripeH = height / stripeCount;
  const cantonW = Math.round(width * 0.42);
  const cantonH = Math.round(stripeH * 7);

  // Column-based wave displacement and lighting
  const colStep = 5; // Fast rendering across screen width
  const totalCols = Math.ceil(width / colStep);

  for (let c = 0; c < totalCols; c++) {
    const colX = c * colStep;

    // Overlapping sine waves for fluid silk/wool banner drape
    const wave1 = Math.sin(colX * 0.011 - time * 3.4) * 24;
    const wave2 = Math.sin(colX * 0.026 - time * 4.6 + 1.2) * 12;
    const waveY = wave1 + wave2;

    // Surface gradient / slope for lighting calculation
    const slope =
      Math.cos(colX * 0.011 - time * 3.4) * 24 * 0.011 +
      Math.cos(colX * 0.026 - time * 4.6 + 1.2) * 12 * 0.026;

    // 1. Draw Flag Stripes / Field for this vertical slice
    for (let s = 0; s < stripeCount; s++) {
      const baseSy = s * stripeH;
      const sy = baseSy + waveY;

      // Color scheme: the attacker's faction when a motif is given, otherwise the theater.
      let stripeColor: string;
      if (motif) {
        stripeColor = motif.stripes[s % motif.stripes.length];
      } else if (theater === 'eastern') {
        // Red Army Guard: Soviet Crimson field with subtle tone variations
        stripeColor = s % 2 === 0 ? PALETTE.crimson : PALETTE.plum;
      } else if (theater === 'north_africa') {
        // Desert Rats: Alternating Khaki Leather & Sand Tan stripes
        stripeColor = s % 2 === 0 ? PALETTE.khakiLeather : PALETTE.sandTan;
      } else if (theater === 'pacific' || theater === 'navy_test' || theater === 'air_strike_test') {
        // US Navy Task Force / Air Strike: Naval Steel & Sand Cream stripes
        stripeColor = s % 2 === 0 ? PALETTE.navalSteel : PALETTE.sandCream;
      } else {
        // European Test (Coast / Forest) / Allied Forces: Crimson & Sand Cream stripes
        stripeColor = s % 2 === 0 ? PALETTE.crimson : PALETTE.sandCream;
      }

      ctx.fillStyle = stripeColor;
      ctx.fillRect(colX, sy, colStep + 0.5, stripeH + 1);
    }

    // 2. Draw Canton (Upper Left Section)
    if (colX < cantonW) {
      const cantonSliceH = cantonH + waveY;
      let cantonColor: string = motif ? motif.canton : PALETTE.navalSteel;

      if (!motif && theater === 'eastern') {
        cantonColor = PALETTE.plum;
      } else if (!motif && theater === 'north_africa') {
        cantonColor = PALETTE.earthBrown;
      }

      ctx.fillStyle = cantonColor;
      ctx.fillRect(colX, waveY, colStep + 0.5, cantonH);

      // Gold canton border line
      ctx.fillStyle = PALETTE.sandCream;
      ctx.fillRect(colX, cantonSliceH - 2, colStep + 0.5, 3);
    }

    // 3. Cloth Ripple Fold Shading Overlay
    // Light highlights on wave crests, dark shadows in wave troughs
    if (slope < -0.12) {
      // Deep shadow fold
      const shadowAlpha = Math.min(0.55, (-slope - 0.12) * 0.75);
      ctx.fillStyle = PALETTE.bunkerCharcoal;
      ctx.globalAlpha = shadowAlpha;
      ctx.fillRect(colX, 0, colStep + 0.5, height);
      ctx.globalAlpha = 1.0;
    } else if (slope > 0.12) {
      // Raised ridge highlight
      const highlightAlpha = Math.min(0.35, (slope - 0.12) * 0.55);
      ctx.fillStyle = PALETTE.sandCream;
      ctx.globalAlpha = highlightAlpha;
      ctx.fillRect(colX, 0, colStep + 0.5, height);
      ctx.globalAlpha = 1.0;
    }
  }

  // 4. Canton Emblem / Stars (Drawn on top with wave offset)
  const cantonCenterX = Math.round(cantonW / 2);
  const cantonWave =
    Math.sin(cantonCenterX * 0.011 - time * 3.4) * 24 +
    Math.sin(cantonCenterX * 0.026 - time * 4.6 + 1.2) * 12;

  const drawStarGrid = () => {
    const starCols = 6;
    const starRows = 4;
    const stepX = (cantonW - 40) / (starCols - 1);
    const stepY = (cantonH - 40) / (starRows - 1);

    for (let r = 0; r < starRows; r++) {
      for (let c = 0; c < starCols; c++) {
        const sx = 20 + c * stepX;
        const starWave =
          Math.sin(sx * 0.011 - time * 3.4) * 24 +
          Math.sin(sx * 0.026 - time * 4.6 + 1.2) * 12;
        const sy = 20 + r * stepY + starWave;
        drawPixelStar(ctx, Math.round(sx), Math.round(sy), 4, PALETTE.sandCream);
      }
    }
  };

  if (motif) {
    const cx = cantonCenterX;
    const cy = Math.round(cantonH / 2 + cantonWave);
    if (motif.emblem === 'star') drawGoldStarEmblem(ctx, cx, cy, 32, true);
    else if (motif.emblem === 'cross') drawFlagCross(ctx, cx, cy, 28);
    else if (motif.emblem === 'disc') drawFlagDisc(ctx, cx, cy, 34);
    else drawStarGrid();
  } else if (theater === 'eastern') {
    // Red Army Golden Star & Laurel Wreath in Canton
    const starX = cantonCenterX;
    const starY = Math.round(cantonH / 2 + cantonWave);
    drawGoldStarEmblem(ctx, starX, starY, 32, true);
  } else {
    drawStarGrid();
  }

  // 5. Subtle horizontal cloth weave line texture
  ctx.fillStyle = 'rgba(0, 0, 0, 0.06)';
  for (let y = 0; y < height; y += 4) {
    ctx.fillRect(0, y, width, 1);
  }

  ctx.restore();
}

/**
 * Draws a 5-point retro pixel star
 */
function drawPixelStar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  color: string,
) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const angle = (i * 4 * Math.PI) / 5 - Math.PI / 2;
    const px = cx + Math.cos(angle) * r;
    const py = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * Draws a prominent golden victory star & laurel wreath
 */
function drawGoldStarEmblem(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  withWreath = true,
) {
  ctx.save();

  if (withWreath) {
    // Laurel Wreath
    ctx.strokeStyle = PALETTE.mustardBrass;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 1.25, 0.4, Math.PI - 0.4);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 1.25, Math.PI + 0.4, 2 * Math.PI - 0.4);
    ctx.stroke();

    // Wreath leaf clusters
    ctx.fillStyle = PALETTE.sandCream;
    for (let a = 0.5; a < Math.PI - 0.5; a += 0.45) {
      const lx1 = cx + Math.cos(a) * radius * 1.25;
      const ly1 = cy + Math.sin(a) * radius * 1.25;
      ctx.fillRect(lx1 - 2, ly1 - 2, 4, 4);

      const lx2 = cx + Math.cos(a + Math.PI) * radius * 1.25;
      const ly2 = cy + Math.sin(a + Math.PI) * radius * 1.25;
      ctx.fillRect(lx2 - 2, ly2 - 2, 4, 4);
    }
  }

  // Central Gold Star
  ctx.fillStyle = PALETTE.mustardBrass;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const angle = (i * 4 * Math.PI) / 5 - Math.PI / 2;
    const px = cx + Math.cos(angle) * radius;
    const py = cy + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();

  // Inner Bright Star Core
  ctx.fillStyle = PALETTE.sandCream;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const angle = (i * 4 * Math.PI) / 5 - Math.PI / 2;
    const px = cx + Math.cos(angle) * (radius * 0.55);
    const py = cy + Math.sin(angle) * (radius * 0.55);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

/**
 * Draws the Expanding VICTORY Modal with Regional Banner,
 * Circular Faction Emblems, IPC lost in the battle, and "RETURN TO COMBAT" Button.
 */
export function drawVictorySequenceModal(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  flagElapsed: number,
  regionName: string,
  attackerIpc: number,
  defenderIpc: number,
  returnLabel = 'RETURN TO COMBAT',
  defeat = false,
): {returnButtonRect: {x: number; y: number; w: number; h: number}} {
  ctx.save();

  // Expansion animation: smoothly scales outward from center
  const expandDuration = 0.65;
  const progress = Math.min(1, Math.max(0, (flagElapsed - 0.15) / expandDuration));
  // Cubic ease-out
  const ease = 1 - Math.pow(1 - progress, 3);

  const targetW = 760;
  const targetH = 190;
  const curW = Math.round(targetW * ease);
  const curH = Math.round(targetH * ease);

  const centerX = Math.round(width / 2);
  const centerY = Math.round(height / 2 - 25);

  const bx = centerX - Math.round(curW / 2);
  const by = centerY - Math.round(curH / 2);

  // Return button coordinates
  const btnW = 270;
  const btnH = 54;
  const btnX = centerX - Math.round(btnW / 2);
  const btnY = centerY + Math.round(targetH / 2) + 26;
  const returnButtonRect = {x: btnX, y: btnY, w: btnW, h: btnH};

  if (curW > 10 && curH > 10) {
    // 1. Drop shadow behind the expanding central box
    ctx.fillStyle = 'rgba(20, 16, 22, 0.85)';
    ctx.fillRect(bx + 6, by + 6, curW, curH);

    // 2. Leather & Brass Bevel Frame
    ctx.fillStyle = PALETTE.khakiLeather;
    ctx.fillRect(bx - 4, by - 4, curW + 8, curH + 8);

    ctx.fillStyle = PALETTE.mustardBrass;
    ctx.fillRect(bx - 2, by - 2, curW + 4, curH + 4);

    // 3. Deep Bunker Charcoal Felt interior
    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(bx, by, curW, curH);

    // Corner rivet details in sand cream
    ctx.fillStyle = PALETTE.sandCream;
    ctx.fillRect(bx + 4, by + 4, 3, 3);
    ctx.fillRect(bx + curW - 7, by + 4, 3, 3);
    ctx.fillRect(bx + 4, by + curH - 7, 3, 3);
    ctx.fillRect(bx + curW - 7, by + curH - 7, 3, 3);

    // Inner subtle dividing hairline
    ctx.strokeStyle = PALETTE.deepTaupe;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bx + 18, by + 74);
    ctx.lineTo(bx + curW - 18, by + 74);
    ctx.stroke();
  }

  // Content fades in once the box has expanded sufficiently (progress > 0.65)
  const contentAlpha = Math.min(1, Math.max(0, (progress - 0.65) / 0.35));

  if (contentAlpha > 0.01) {
    ctx.globalAlpha = contentAlpha;

    // Above the box: the player took the region, or failed to.
    const upperTextY = by - 18;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const banner = defeat
      ? `YOU FAILED TO TAKE ${regionName.toUpperCase()}`
      : `YOU SUCCESSFULLY TOOK ${regionName.toUpperCase()}`;

    // Drop shadow
    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.font = 'bold 15px "Courier New", monospace';
    ctx.fillText(banner, centerX + 1, upperTextY + 1);

    // Brass/Sand Cream Main Text
    ctx.fillStyle = PALETTE.sandCream;
    ctx.fillText(banner, centerX, upperTextY);

    // Center of the box: VICTORY, or DEFEAT when the other side held.
    const victoryY = by + 22;
    drawPixelString(
      ctx,
      defeat ? 'DEFEAT' : 'VICTORY',
      centerX,
      victoryY,
      6, // Large 6x pixel size
      PALETTE.sandCream,
      PALETTE.plum,
    );

    // --- CIRCULAR EMBLEMS & IPC DISPLAY ---
    // ATTACKER EMBLEM (LEFT SIDE)
    const atkCenterX = centerX - 190;
    const emblemsY = by + 124;

    // Attacker Circular Emblem
    ctx.save();
    // Outer brass rim
    ctx.fillStyle = PALETTE.mustardBrass;
    ctx.beginPath();
    ctx.arc(atkCenterX, emblemsY, 26, 0, Math.PI * 2);
    ctx.fill();

    // Inner naval steel / spruce circle
    ctx.fillStyle = PALETTE.navalSteel;
    ctx.beginPath();
    ctx.arc(atkCenterX, emblemsY, 22, 0, Math.PI * 2);
    ctx.fill();

    // Golden 5-point star inside emblem
    drawGoldStarEmblem(ctx, atkCenterX, emblemsY, 12, false);

    // Attacker IPC Number & Label
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = PALETTE.trenchMudBone;
    ctx.font = 'bold 11px monospace';
    ctx.fillText('ATTACKER', atkCenterX + 36, emblemsY - 10);

    // IPC destroyed on this side in the battle.
    ctx.fillStyle = PALETTE.sandCream;
    ctx.font = 'bold 18px monospace';
    ctx.fillText(ipcLostCaption(attackerIpc), atkCenterX + 36, emblemsY + 10);
    ctx.restore();

    // DEFENDER EMBLEM (RIGHT SIDE)
    const defCenterX = centerX + 60;

    // Defender Circular Emblem
    ctx.save();
    // Outer steel rim
    ctx.fillStyle = PALETTE.feldgrau;
    ctx.beginPath();
    ctx.arc(defCenterX, emblemsY, 26, 0, Math.PI * 2);
    ctx.fill();

    // Inner deep plum / wine circle
    ctx.fillStyle = PALETTE.plum;
    ctx.beginPath();
    ctx.arc(defCenterX, emblemsY, 22, 0, Math.PI * 2);
    ctx.fill();

    // Crossed Swords / Fortress Iron Shield
    ctx.fillStyle = PALETTE.terracotta;
    ctx.fillRect(defCenterX - 11, emblemsY - 2, 22, 4);
    ctx.fillRect(defCenterX - 2, emblemsY - 11, 4, 22);
    ctx.fillStyle = PALETTE.sandCream;
    ctx.fillRect(defCenterX - 4, emblemsY - 4, 8, 8);

    // Defender IPC Number & Label
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = PALETTE.trenchMudBone;
    ctx.font = 'bold 11px monospace';
    ctx.fillText('DEFENDER', defCenterX + 36, emblemsY - 10);

    // IPC destroyed on this side in the battle.
    ctx.fillStyle = PALETTE.terracotta;
    ctx.font = 'bold 18px monospace';
    ctx.fillText(ipcLostCaption(defenderIpc), defCenterX + 36, emblemsY + 10);
    ctx.restore();
  }

  // --- UNDERNEATH: "RETURN TO COMBAT" BUTTON ---
  // Fades in smoothly when the flag appears (flagElapsed > 0.4s)
  const buttonAlpha = Math.min(1, Math.max(0, (flagElapsed - 0.4) / 0.5));

  if (buttonAlpha > 0.01) {
    ctx.globalAlpha = buttonAlpha;

    // Drop shadow in bunker charcoal
    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(btnX + 4, btnY + 4, btnW, btnH);

    // Red background: #9A4E48 (Crimson)
    ctx.fillStyle = PALETTE.crimson;
    ctx.fillRect(btnX, btnY, btnW, btnH);

    // Bevel light top/left edges
    ctx.fillStyle = PALETTE.terracotta;
    ctx.fillRect(btnX, btnY, btnW, 2);
    ctx.fillRect(btnX, btnY, 2, btnH);

    // Bevel dark bottom/right edges
    ctx.fillStyle = PALETTE.plum;
    ctx.fillRect(btnX, btnY + btnH - 2, btnW, 2);
    ctx.fillRect(btnX + btnW - 2, btnY, 2, btnH);

    // Pulsing radiant border #DFCE91 / #A1A258
    const pulse = (Math.sin(time * 6) + 1) / 2;
    ctx.strokeStyle = pulse > 0.4 ? PALETTE.sandCream : PALETTE.terracotta;
    ctx.lineWidth = 2;
    ctx.strokeRect(btnX + 2, btnY + 2, btnW - 4, btnH - 4);

    // Corner rivets
    ctx.fillStyle = PALETTE.sandCream;
    ctx.fillRect(btnX + 4, btnY + 4, 2, 2);
    ctx.fillRect(btnX + btnW - 6, btnY + 4, 2, 2);
    ctx.fillRect(btnX + 4, btnY + btnH - 6, 2, 2);
    ctx.fillRect(btnX + btnW - 6, btnY + btnH - 6, 2, 2);

    // "RETURN TO COMBAT" in pixel text
    drawPixelString(
      ctx,
      returnLabel,
      centerX,
      btnY + 13,
      3,
      PALETTE.sandCream,
      PALETTE.plum,
    );

    // Subtitle prompt
    ctx.fillStyle = PALETTE.sandCream;
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('[ CLICK OR SPACE TO ADVANCE ]', centerX, btnY + 40);
  }

  ctx.restore();
  return {returnButtonRect};
}

function drawFlagCross(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number) {
  ctx.save();
  ctx.fillStyle = PALETTE.sandCream;
  ctx.fillRect(cx - radius, cy - 4, radius * 2, 8);
  ctx.fillRect(cx - 4, cy - radius, 8, radius * 2);
  ctx.fillStyle = PALETTE.mustardBrass;
  ctx.fillRect(cx - 6, cy - 6, 12, 12);
  ctx.restore();
}

function drawFlagDisc(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number) {
  ctx.save();
  ctx.fillStyle = PALETTE.sandCream;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PALETTE.plum;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function pixelLineWidth(text: string, pixelSize: number): number {
  if (text.length === 0) return 0;
  return text.length * (3 * pixelSize + pixelSize) - pixelSize;
}

/**
 * The attack card, in the same brass frame and pixel lettering as the victory panel.
 * `lines` joined with spaces are "[FACTION] IS ATTACKING [FACTION] AT [REGION]".
 */
export function drawAttackBriefing(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  flagElapsed: number,
  lines: readonly string[],
): {button: {x: number; y: number; w: number; h: number}} {
  ctx.save();

  const expandDuration = 0.65;
  const progress = Math.min(1, Math.max(0, (flagElapsed - 0.15) / expandDuration));
  const ease = 1 - Math.pow(1 - progress, 3);

  const targetW = 760;
  const targetH = 176;
  const curW = Math.round(targetW * ease);
  const curH = Math.round(targetH * ease);

  const centerX = Math.round(width / 2);
  const centerY = Math.round(height / 2 - 25);
  const bx = centerX - Math.round(curW / 2);
  const by = centerY - Math.round(curH / 2);

  const btnW = 270;
  const btnH = 54;
  const btnX = centerX - Math.round(btnW / 2);
  const btnY = centerY + Math.round(targetH / 2) + 26;
  const button = {x: btnX, y: btnY, w: btnW, h: btnH};

  if (curW > 10 && curH > 10) {
    ctx.fillStyle = 'rgba(20, 16, 22, 0.85)';
    ctx.fillRect(bx + 6, by + 6, curW, curH);

    ctx.fillStyle = PALETTE.khakiLeather;
    ctx.fillRect(bx - 4, by - 4, curW + 8, curH + 8);

    ctx.fillStyle = PALETTE.mustardBrass;
    ctx.fillRect(bx - 2, by - 2, curW + 4, curH + 4);

    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(bx, by, curW, curH);

    ctx.fillStyle = PALETTE.sandCream;
    ctx.fillRect(bx + 4, by + 4, 3, 3);
    ctx.fillRect(bx + curW - 7, by + 4, 3, 3);
    ctx.fillRect(bx + 4, by + curH - 7, 3, 3);
    ctx.fillRect(bx + curW - 7, by + curH - 7, 3, 3);
  }

  const contentAlpha = Math.min(1, Math.max(0, (progress - 0.65) / 0.35));
  if (contentAlpha > 0.01) {
    ctx.globalAlpha = contentAlpha;
    const sizes = lines.map((line) => (pixelLineWidth(line, 4) <= targetW - 64 ? 4 : 3));
    const gap = 14;
    const heights = sizes.map((size) => size * 5);
    const block = heights.reduce((sum, h) => sum + h, 0) + gap * Math.max(0, lines.length - 1);
    let y = by + Math.round((curH - block) / 2);
    lines.forEach((line, i) => {
      drawPixelString(ctx, line, centerX, y, sizes[i], PALETTE.sandCream, PALETTE.plum);
      y += heights[i] + gap;
    });
  }

  const buttonAlpha = Math.min(1, Math.max(0, (flagElapsed - 0.4) / 0.5));
  if (buttonAlpha > 0.01) {
    ctx.globalAlpha = buttonAlpha;

    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(btnX + 4, btnY + 4, btnW, btnH);

    ctx.fillStyle = PALETTE.crimson;
    ctx.fillRect(btnX, btnY, btnW, btnH);

    ctx.fillStyle = PALETTE.terracotta;
    ctx.fillRect(btnX, btnY, btnW, 2);
    ctx.fillRect(btnX, btnY, 2, btnH);

    ctx.fillStyle = PALETTE.plum;
    ctx.fillRect(btnX, btnY + btnH - 2, btnW, 2);
    ctx.fillRect(btnX + btnW - 2, btnY, 2, btnH);

    const pulse = (Math.sin(time * 6) + 1) / 2;
    ctx.strokeStyle = pulse > 0.4 ? PALETTE.sandCream : PALETTE.terracotta;
    ctx.lineWidth = 2;
    ctx.strokeRect(btnX + 2, btnY + 2, btnW - 4, btnH - 4);

    ctx.fillStyle = PALETTE.sandCream;
    ctx.fillRect(btnX + 4, btnY + 4, 2, 2);
    ctx.fillRect(btnX + btnW - 6, btnY + 4, 2, 2);
    ctx.fillRect(btnX + 4, btnY + btnH - 6, 2, 2);
    ctx.fillRect(btnX + btnW - 6, btnY + btnH - 6, 2, 2);

    drawPixelString(ctx, 'BEGIN BATTLE', centerX, btnY + 13, 3, PALETTE.sandCream, PALETTE.plum);

    ctx.fillStyle = PALETTE.sandCream;
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('[ CLICK OR SPACE TO ADVANCE ]', centerX, btnY + 40);
  }

  ctx.restore();
  return {button};
}
