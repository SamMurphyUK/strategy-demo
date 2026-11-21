/**
 * Rasterize `_QUICK` vector frames for the campaign LoD-2 sprites and the battle board.
 * Keeps facing, stack copies, and unitAnimationProfiles idle/move/fire/damaged offsets.
 * Muzzle flash and exhaust use the clip marks, scaled with the sprite.
 */

import { resolveQuickClip, quickFrameUrl, type QuickClipRef } from "./quickUnitCatalog";
import { quickAnchor, quickFxRects, quickMuzzleBloom, type QuickFxPose } from "./quickUnitFx";
import { resolveUnitAnimProfile } from "./unitAnimationProfiles";
import { MILITARY } from "../ui/theme/militaryPalette";
import {
  createVehicleAnim,
  easeVehicle,
  tickVehicle,
  vehicleOffsets,
  type VehicleAnim,
  type VehicleMode,
} from "./vehicleMotion";

const images = new Map<string, HTMLImageElement | null>();
const anims = new Map<string, VehicleAnim>();
const lastTicks = new Map<string, number>();
let lastEase = 0;

function loadImage(url: string): HTMLImageElement | null {
  if (typeof Image === "undefined") {
    return null;
  }
  const hit = images.get(url);
  if (hit !== undefined) {
    return hit;
  }
  const image = new Image();
  images.set(url, null);
  image.onload = () => {
    images.set(url, image);
  };
  image.onerror = () => {
    images.set(url, null);
  };
  image.src = url;
  return null;
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
  /** +1 guns right, -1 mirrored. */
  face: 1 | -1;
  /** Seconds for the 8 Hz frame clock. */
  time: number;
  /** CSS pixels for one art pixel. Campaign tokens pass tokenPx / artHeight. */
  pixelScale: number;
  /** Feet land on this point in the current transform. */
  feetX: number;
  feetY: number;
  /** Battle recoil, 0 to 1. Above 0.25 the muzzle blooms while the fire clip plays. */
  recoil?: number;
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

function paintQuickFx(
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

/**
 * Draw one `_QUICK` vector if present. Returns false when this type still uses its placeholder.
 * Callers keep facing and stack offsets in their own transforms; this places feet on (feetX, feetY).
 * Flash and exhaust are painted in the same transform, so an early caller return still shows them.
 */
export function drawQuickUnit(
  ctx: CanvasRenderingContext2D,
  request: QuickDrawRequest,
): boolean {
  if (request.unitTypeId === "infantry" || request.unitTypeId === "carrier") {
    return false;
  }
  const clip = resolveQuickClip(request.factionId, request.unitTypeId);
  if (!clip) {
    return false;
  }
  const now = typeof performance !== "undefined" ? performance.now() : request.time * 1000;
  easeAll(now);

  const profile = resolveUnitAnimProfile(request.unitTypeId);
  const anim = animFor(request.key, vehicleMode(request.mode), request.damaged === true);
  const wanted = vehicleMode(request.mode);
  if (anim.mode !== wanted) {
    tickVehicle(anim, wanted, Math.random, profile);
    lastTicks.set(request.key, Math.floor(request.time / 0.125));
  } else {
    const tick = Math.floor(request.time / 0.125);
    const prior = lastTicks.get(request.key) ?? tick;
    const steps = Math.max(0, Math.min(8, tick - prior));
    for (let i = 0; i < steps; i += 1) {
      tickVehicle(anim, wanted, Math.random, profile);
    }
    lastTicks.set(request.key, tick);
  }

  const pose = clipMode(request.mode, clip);
  const count = clip[pose];
  const index = count > 0 ? anim.frame % count : 0;
  const url = quickFrameUrl(clip, pose, index);
  if (!url) {
    return false;
  }
  const image = loadImage(url) ?? images.get(url);
  if (!image) {
    loadImage(url);
    return true;
  }

  const offsets = vehicleOffsets(anim, profile);
  const scale = request.pixelScale;
  const drawW = clip.width * scale;
  const drawH = clip.height * scale;

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.translate(request.feetX, request.feetY);
  ctx.scale(request.face, 1);
  ctx.drawImage(
    image,
    -clip.feet.x * scale + offsets.root.x * scale,
    -clip.feet.y * scale + offsets.root.y * scale,
    drawW,
    drawH,
  );
  paintQuickFx(ctx, clip, pose, index, offsets.root, scale, request.recoil ?? 0, request.damaged === true);
  ctx.restore();
  return true;
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
