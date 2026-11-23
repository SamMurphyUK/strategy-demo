/**
 * Rasterize `_QUICK` vector frames for the campaign LoD-2 sprites and the battle board.
 * Keeps facing, stack copies, and unitAnimationProfiles idle/move/fire/damaged offsets.
 * Muzzle flash and exhaust use the clip marks, scaled with the sprite.
 */

import { resolveQuickClip, quickFrameUrl, type QuickClipRef } from "./quickUnitCatalog";
import { quickAnchor, quickFxRects, quickMuzzleBloom, type QuickFxPose } from "./quickUnitFx";
import { namedAnimProfile, resolveUnitAnimProfile } from "./unitAnimationProfiles";
import { lightUnitSprite, type UnitSkyLight } from "./unitLighting";
import { MILITARY } from "../ui/theme/militaryPalette";
import { graphicsSettings } from "../ui/battle/graphicsSettings";
import {
  createVehicleAnim,
  easeVehicle,
  tickVehicle,
  vehicleOffsets,
  type VehicleAnim,
  type VehicleMode,
  type VehicleOffsets,
} from "./vehicleMotion";

const FLAT_OFFSETS: VehicleOffsets = {
  root: { x: 0, y: 0 },
  tracks: { x: 0, y: 0 },
  torso: { x: 0, y: 0 },
  head: { x: 0, y: 0 },
  weapon: { x: 0, y: 0 },
  hull: { x: 0, y: 0 },
  turret: { x: 0, y: 0 },
};

/** Walk and fire stay on the shared 8 Hz clock. Infantry idle breathes much slower. */
export const QUICK_TICK_SECONDS = 0.125;
export const INFANTRY_IDLE_TICK_SECONDS = 0.65;

function tickSecondsFor(unitTypeId: string, mode: VehicleMode): number {
  return unitTypeId === "infantry" && mode === "idle" ? INFANTRY_IDLE_TICK_SECONDS : QUICK_TICK_SECONDS;
}

const images = new Map<string, HTMLImageElement | null>();
const failedImages = new Set<string>();
const warmed = new Set<string>();
const heldByKey = new Map<string, { url: string; image: HTMLImageElement }>();
const anims = new Map<string, VehicleAnim>();
const lastTicks = new Map<string, number>();
const litSprites = new Map<string, HTMLCanvasElement>();
const LIT_SPRITE_CAP = 64;
let lastEase = 0;

function loadImage(url: string): HTMLImageElement | null {
  if (typeof Image === "undefined" || failedImages.has(url)) {
    return null;
  }
  const hit = images.get(url);
  if (hit !== undefined) {
    return hit;
  }
  const image = new Image();
  images.set(url, null);
  image.onload = () => {
    const publish = () => {
      if (image.naturalWidth > 0) images.set(url, image);
      else {
        images.delete(url);
        failedImages.add(url);
      }
    };
    if (typeof image.decode === "function") void image.decode().then(publish, publish);
    else publish();
  };
  image.onerror = () => {
    images.delete(url);
    failedImages.add(url);
  };
  image.src = url;
  return null;
}

/** Lit copy at the size on screen. The SVG's own pixels are much larger, and rebuilding them every frame stalls the battle. */
function litAtSize(
  url: string,
  image: CanvasImageSource,
  drawW: number,
  drawH: number,
  light: NonNullable<QuickDrawRequest["light"]>,
  boardX: number,
): CanvasImageSource {
  const w = Math.max(1, Math.ceil(drawW));
  const h = Math.max(1, Math.ceil(drawH));
  let rimX = 0;
  let rimK = -1;
  for (const rim of light.rims) {
    if (rim.k > rimK) {
      rimK = rim.k;
      rimX = rim.x;
    }
  }
  const key = `${url}|${light.key}|${rimX < boardX ? "R" : "L"}|${w}x${h}`;
  const hit = litSprites.get(key);
  if (hit) {
    return hit;
  }
  const lit = lightUnitSprite(image, w, h, light, boardX);
  if (!lit) {
    return image;
  }
  litSprites.set(key, lit);
  if (litSprites.size > LIT_SPRITE_CAP) {
    const oldest = litSprites.keys().next().value;
    if (oldest !== undefined) {
      litSprites.delete(oldest);
    }
  }
  return lit;
}

/** Start every frame of a clip once, so a march or a takeoff does not wait on the next picture. */
function warmClip(clip: QuickClipRef): void {
  if (warmed.has(clip.unitId)) return;
  warmed.add(clip.unitId);
  const poses = ["idle", "walk", "fire", "damaged"] as const;
  for (const pose of poses) {
    const count = clip[pose];
    for (let i = 0; i < count; i += 1) {
      const url = quickFrameUrl(clip, pose, i);
      if (url) loadImage(url);
    }
  }
}

function readyImage(url: string): HTMLImageElement | null {
  const image = loadImage(url);
  return image && image.naturalWidth > 0 ? image : null;
}

function animFor(key: string, mode: VehicleMode, damaged: boolean): VehicleAnim {
  let anim = anims.get(key);
  if (!anim) {
    // Offsets stay in art space (gun to the right). The caller mirrors with ctx.scale(face, 1).
    anim = createVehicleAnim(mode, 1);
    anim.damaged = damaged;
    anims.set(key, anim);
    return anim;
  }
  anim.damaged = damaged;
  return anim;
}

function easeAll(now: number): void {
  const dt = lastEase <= 0 ? 0 : Math.min(0.25, (now - lastEase) / 1000);
  lastEase = now;
  if (dt <= 0) {
    return;
  }
  for (const anim of anims.values()) {
    easeVehicle(anim, dt);
  }
}

export type QuickDrawMode = "idle" | "moving" | "firing";

export interface QuickDrawRequest {
  key: string;
  factionId: string;
  unitTypeId: string;
  mode: QuickDrawMode;
  damaged?: boolean;
  /** +1 guns right, -1 mirrored. Applied before `turn`. */
  face: 1 | -1;
  /** Radians, clockwise on the map, after the mirror. 0 keeps the picture upright. */
  turn?: number;
  /** Seconds for the 8 Hz frame clock. */
  time: number;
  /** CSS pixels for one art pixel. Campaign tokens pass tokenPx / artHeight. */
  pixelScale: number;
  /** Feet land on this point in the current transform. */
  feetX: number;
  feetY: number;
  /** Battle recoil, 0 to 1. Above 0.25 the muzzle blooms while the fire clip plays. */
  recoil?: number;
  /** Sky light for the unit-lighting toggle. Absent skips the tint. */
  light?: UnitSkyLight | null;
  /** Board x of the feet; picks which side the sun/moon rim falls from. */
  boardX?: number;
}

function vehicleMode(mode: QuickDrawMode): VehicleMode {
  return mode === "firing" ? "firing" : mode === "moving" ? "moving" : "idle";
}

function clipMode(mode: QuickDrawMode, clip: QuickClipRef): QuickFxPose {
  if (mode === "firing" && clip.fire > 0) {
    return "fire";
  }
  if (mode === "moving" && clip.walk > 0) {
    return "walk";
  }
  return "idle";
}

export function paintQuickFx(
  ctx: CanvasRenderingContext2D,
  clip: QuickClipRef,
  pose: QuickFxPose,
  frame: number,
  root: { x: number; y: number },
  pixelScale: number,
  recoil: number,
  damaged: boolean,
): void {
  const rects = quickFxRects(clip.fx, clip.feet, pose, frame, pixelScale, {
    damaged,
    rootX: root.x,
    rootY: root.y,
  });
  for (const rect of rects) {
    if (rect.kind !== "smoke") {
      continue;
    }
    ctx.fillStyle = rect.hex;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }
  for (const rect of rects) {
    if (rect.kind !== "muzzle") {
      continue;
    }
    ctx.fillStyle = rect.hex;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }
  const bloom = pose === "fire" && clip.fx.muzzle ? quickMuzzleBloom(clip.width, pixelScale, recoil) : null;
  if (!bloom || !clip.fx.muzzle) {
    return;
  }
  const tip = quickAnchor(clip.fx.muzzle, clip.feet, pixelScale, root.x, root.y);
  const inner = Math.min(bloom.radius * 0.35, Math.max(pixelScale, 0.5));
  if (bloom.radius > inner + 0.5) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const grad = ctx.createRadialGradient(tip.x, tip.y, inner, tip.x, tip.y, bloom.radius);
    grad.addColorStop(0, "rgba(255, 250, 210, 0.95)");
    grad.addColorStop(0.3, "rgba(255, 190, 70, 0.6)");
    grad.addColorStop(0.7, "rgba(230, 100, 30, 0.2)");
    grad.addColorStop(1, "rgba(180, 40, 10, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, bloom.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  if (bloom.core > 0) {
    ctx.fillStyle = MILITARY.cream;
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, bloom.core, 0, Math.PI * 2);
    ctx.fill();
  }
}

export interface QuickFrameStep {
  clip: QuickClipRef;
  href: string;
  pose: "idle" | "walk" | "fire" | "damaged";
  index: number;
  offsets: VehicleOffsets;
}

/** Advance the clip clock and name the SVG frame. Does not rasterize. */
export function stepQuickFrame(request: QuickDrawRequest): QuickFrameStep | null {
  const clip = resolveQuickClip(request.factionId, request.unitTypeId);
  if (!clip) {
    return null;
  }
  const now = typeof performance !== "undefined" ? performance.now() : request.time * 1000;
  easeAll(now);

  const profile = resolveUnitAnimProfile(request.unitTypeId);
  const anim = animFor(request.key, vehicleMode(request.mode), request.damaged === true);
  const wanted = vehicleMode(request.mode);
  const period = tickSecondsFor(request.unitTypeId, wanted);
  if (anim.mode !== wanted) {
    tickVehicle(anim, wanted, Math.random, profile);
    // Landing on idle starts at frame 0 (settle). Walk and fire keep their own clocks.
    lastTicks.set(request.key, Math.floor(request.time / period));
  } else {
    const tick = Math.floor(request.time / period);
    const prior = lastTicks.get(request.key) ?? tick;
    const steps = Math.max(0, Math.min(8, tick - prior));
    for (let i = 0; i < steps; i += 1) {
      tickVehicle(anim, wanted, Math.random, profile);
    }
    lastTicks.set(request.key, tick);
  }

  warmClip(clip);
  const pose = clipMode(request.mode, clip);
  const count = clip[pose];
  const useDamaged = request.damaged === true && clip.damaged > 0 && pose === "idle";
  const drawPose = useDamaged ? "damaged" : pose;
  const drawCount = useDamaged ? clip.damaged : count;
  const index = drawCount > 0 ? anim.frame % drawCount : 0;
  const href = quickFrameUrl(clip, drawPose, index);
  if (!href) {
    return null;
  }
  // A stamped vehicle still has one picture and a profile. The profile moves its layers.
  // Infantry frames already contain the step, and a type with no profile stays flat.
  const offsets =
    request.unitTypeId === "infantry" || (clip.file && !namedAnimProfile(request.unitTypeId))
      ? FLAT_OFFSETS
      : vehicleOffsets(anim, profile);
  return { clip, href, pose: drawPose, index, offsets };
}

/** Paint a frame the clock already chose. Does not advance that clock. */
export function paintQuickStep(ctx: CanvasRenderingContext2D, step: QuickFrameStep, request: QuickDrawRequest): boolean {
  const { clip, pose: drawPose, index, offsets } = step;
  const wantedUrl = step.href;
  let url = wantedUrl;
  let image = url ? readyImage(url) : null;
  if (!image) {
    const idleUrl = quickFrameUrl(clip, "idle", 0);
    const idle = idleUrl ? readyImage(idleUrl) : null;
    if (idle && idleUrl) {
      url = idleUrl;
      image = idle;
    }
  }
  if (!image || !url) {
    const held = heldByKey.get(request.key);
    if (held) {
      url = held.url;
      image = held.image;
    } else if (!wantedUrl || failedImages.has(wantedUrl)) {
      return false;
    } else {
      return true;
    }
  } else {
    heldByKey.set(request.key, { url, image });
  }

  const scale = request.pixelScale;
  const drawW = clip.width * scale;
  const drawH = clip.height * scale;
  const picture =
    graphicsSettings().unitLighting && request.light
      ? litAtSize(url, image, drawW, drawH, request.light, request.boardX ?? 0)
      : image;

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.translate(request.feetX, request.feetY);
  if (request.turn) ctx.rotate(request.turn);
  ctx.scale(request.face, 1);
  ctx.drawImage(
    picture,
    -clip.feet.x * scale + offsets.root.x * scale,
    -clip.feet.y * scale + offsets.root.y * scale,
    drawW,
    drawH,
  );
  paintQuickFx(
    ctx,
    clip,
    drawPose === "damaged" ? "idle" : drawPose,
    drawPose === "damaged" ? 0 : index,
    offsets.root,
    scale,
    request.recoil ?? 0,
    request.damaged === true,
  );
  ctx.restore();
  return true;
}

/**
 * Draw one shipped vector clip if present. Returns false when this type still uses its placeholder.
 * Callers keep facing and stack offsets in their own transforms; this places feet on (feetX, feetY).
 * Flash and exhaust are painted in the same transform, so an early caller return still shows them.
 */
export function drawQuickUnit(
  ctx: CanvasRenderingContext2D,
  request: QuickDrawRequest,
): boolean {
  const step = stepQuickFrame(request);
  if (!step) {
    return false;
  }
  return paintQuickStep(ctx, step, request);
}

/** Prefetch idle frames so the first LoD-2 paint is less empty. */
export function prefetchQuickIdle(factionId: string, unitTypeId: string): void {
  const clip = resolveQuickClip(factionId, unitTypeId);
  if (!clip) {
    return;
  }
  for (let i = 0; i < Math.min(clip.idle, 2); i += 1) {
    const url = quickFrameUrl(clip, "idle", i);
    if (url) {
      loadImage(url);
    }
  }
}

export function hasQuickUnit(factionId: string, unitTypeId: string): boolean {
  return resolveQuickClip(factionId, unitTypeId) != null;
}
