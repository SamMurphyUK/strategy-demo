/**
 * The picture the sprite-editor battle map paints: native art pixels times the lane,
 * crisp SVG layers when that switch is on, and a contact shadow on the feet.
 */

import { isFighter25DId } from "./fighter25D";
import {
  FIGHTER_25D_ROLE_SLOT,
  FIGHTER_25D_WING_ROOT,
  FIGHTER_25D_Z_ORDER,
  fighter25DAltitude,
  fighter25DLayerUrl,
  fighter25DPose,
  fighter25DTheta,
  type Fighter25DRole,
} from "./fighter25D";
import type { VehicleSvgPart, VehicleSvgUnit } from "./fieldVehicleStage";
import { contactShadow, depthUnitScale, type ContactShadow } from "./nativeBattleOverlay";
import { quickFrameUrl, type QuickClipRef } from "./quickUnitCatalog";
import { buildTankView, splitStillView, tankLayerSources, type TankView } from "./tankView";
import { foldLayerShift, namedAnimProfile, resolveUnitAnimProfile } from "./unitAnimationProfiles";
import type { VehicleMode, VehicleOffsets } from "./vehicleMotion";

export interface FieldPictureInput {
  id: string;
  clip: QuickClipRef;
  href: string;
  offsets: VehicleOffsets;
  mode: VehicleMode;
  frame: number;
  /** Feet, or a sortie's centre, in board pixels. */
  x: number;
  y: number;
  /** Board row the lane size is read from. */
  laneY: number;
  face?: 1 | -1;
  turnDeg?: number;
  /** Sprite-pixel shift of the picture origin. Defaults to the feet plus the root offset. */
  rootX?: number;
  rootY?: number;
  crisp: boolean;
  time: number;
}

export interface FieldPicture {
  /** Board pixels per art pixel. The lane only. The battle's extra 1.2 is not included. */
  unitScale: number;
  /** Null when crisp pictures is off. The caller then paints the bitmap at unitScale. */
  figure: VehicleSvgUnit | null;
}

const tankViews = new Map<string, TankView | null>();
const tankLoads = new Map<string, Promise<void>>();
const stillViews = new Map<string, TankView | null>();
const stillLoads = new Map<string, Promise<void>>();

function seedRigId(unitId: string): string {
  return unitId.replace(/\.(?:stamped|polished)$/i, "");
}

function foldedOffsets(unitTypeId: string, offsets: VehicleOffsets): VehicleOffsets {
  const parts = foldLayerShift(resolveUnitAnimProfile(unitTypeId), offsets);
  return { ...offsets, ...parts, hull: parts.torso, turret: parts.head };
}

function fighterParts(clip: QuickClipRef, offsets: VehicleOffsets, time: number, mode: VehicleMode): VehicleSvgPart[] {
  const bankMode = mode === "firing" ? "firing" : mode === "idle" ? "idle" : "moving";
  const pose = fighter25DPose(fighter25DTheta(time, bankMode), fighter25DAltitude(time, bankMode));
  const root = FIGHTER_25D_WING_ROOT;
  const posed = { ...offsets, hull: offsets.torso, turret: offsets.head };
  return FIGHTER_25D_Z_ORDER.map((role): VehicleSvgPart => {
    if (role === "shadow") {
      return {
        role: "shadow",
        href: fighter25DLayerUrl("shadow"),
        x: pose.shadow.dx,
        y: pose.shadow.dy + pose.shadow.groundY,
        width: clip.width,
        height: clip.height,
        resolution: clip.resolution,
        pivotX: root.x,
        pivotY: root.y,
        scaleX: pose.shadow.scaleX,
        scaleY: pose.shadow.scaleY,
        skewXDeg: pose.shadow.skewXDeg,
        opacity: pose.shadow.opacity,
      };
    }
    const slot = FIGHTER_25D_ROLE_SLOT[role];
    const aff = pose[role as Exclude<Fighter25DRole, "shadow">];
    return {
      role: slot,
      href: fighter25DLayerUrl(role),
      x: posed[slot].x + aff.dx,
      y: posed[slot].y + aff.dy,
      width: clip.width,
      height: clip.height,
      resolution: clip.resolution,
      pivotX: root.x,
      pivotY: root.y,
      scaleX: aff.scaleX,
      scaleY: aff.scaleY,
      skewXDeg: aff.skewXDeg,
      rotateDeg: aff.rotateDeg,
      opacity: aff.opacity,
    };
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(url));
    image.src = url;
  });
}

async function rasterFrame(url: string): Promise<OffscreenCanvas> {
  const image = await loadImage(url);
  const canvas = new OffscreenCanvas(Math.max(1, image.naturalWidth), Math.max(1, image.naturalHeight));
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("The browser would not open a canvas.");
  }
  ctx.drawImage(image, 0, 0);
  return canvas;
}

async function rasterClip(clip: QuickClipRef, mode: "idle" | "walk" | "fire"): Promise<OffscreenCanvas[]> {
  const frames: OffscreenCanvas[] = [];
  for (let index = 0; index < clip[mode]; index += 1) {
    const url = quickFrameUrl(clip, mode, index);
    if (url) {
      frames.push(await rasterFrame(url));
    }
  }
  return frames;
}

function ensureTank(clip: QuickClipRef): TankView | null {
  if (clip.unitTypeId !== "tank" || clip.file) {
    return null;
  }
  if (tankViews.has(clip.unitId)) {
    return tankViews.get(clip.unitId) ?? null;
  }
  if (tankLoads.has(clip.unitId) || typeof Image === "undefined" || typeof OffscreenCanvas === "undefined") {
    return null;
  }
  const pending = (async () => {
    try {
      const [idle, walk, fire] = await Promise.all([
        rasterClip(clip, "idle"),
        rasterClip(clip, "walk"),
        rasterClip(clip, "fire"),
      ]);
      const view = await buildTankView({
        rigId: clip.unitId.replace(/_QUICK$/i, ""),
        artWidth: clip.width,
        artHeight: clip.height,
        idle,
        walk,
        fire,
        vectorBase: clip.dir,
      });
      tankViews.set(clip.unitId, view);
    } catch {
      tankViews.set(clip.unitId, null);
    }
  })();
  tankLoads.set(clip.unitId, pending);
  return null;
}

/** Split a stamped still with its seed rig so the profile can slide tracks, hull, turret, and gun. */
function ensureStill(clip: QuickClipRef): TankView | null {
  if (!clip.file || !namedAnimProfile(clip.unitTypeId)) {
    return null;
  }
  const key = clip.unitId;
  if (stillViews.has(key)) {
    return stillViews.get(key) ?? null;
  }
  if (stillLoads.has(key) || typeof Image === "undefined" || typeof OffscreenCanvas === "undefined") {
    return null;
  }
  const file = clip.file;
  const rigId = seedRigId(clip.unitId);
  const pending = (async () => {
    try {
      const canvas = await rasterFrame(file);
      stillViews.set(key, await splitStillView(rigId, canvas, true));
    } catch {
      stillViews.set(key, null);
    }
  })();
  stillLoads.set(key, pending);
  return null;
}

function stillParts(clip: QuickClipRef, offsets: VehicleOffsets): VehicleSvgPart[] | null {
  const view = ensureStill(clip);
  const urls = view?.raster.urls;
  if (!view || !urls) {
    return null;
  }
  const folded = foldedOffsets(clip.unitTypeId, offsets);
  const part = (role: "tracks" | "torso" | "head" | "weapon", href: string): VehicleSvgPart => ({
    role,
    href,
    x: folded[role].x,
    y: folded[role].y,
    width: clip.width,
    height: clip.height,
    resolution: view.resolution,
  });
  return [part("tracks", urls.tracksIdle), part("torso", urls.torso), part("head", urls.head), part("weapon", urls.weapon)];
}

function tankParts(clip: QuickClipRef, offsets: VehicleOffsets, mode: VehicleMode, frame: number): VehicleSvgPart[] | null {
  const view = ensureTank(clip);
  if (!view) {
    return null;
  }
  const sources = tankLayerSources(view, mode, frame);
  if (!sources) {
    return null;
  }
  const folded = foldedOffsets(clip.unitTypeId, offsets);
  return sources.map((source) => ({
    role: source.role,
    href: source.href,
    x: folded[source.role].x,
    y: folded[source.role].y,
    width: clip.width,
    height: clip.height,
    resolution: source.resolution,
  }));
}

/** Native size on this row, and the SVG the field would paint when crisp pictures is on. */
export function fieldPicture(input: FieldPictureInput): FieldPicture {
  const unitScale = depthUnitScale(1, input.laneY);
  if (!input.crisp) {
    return { unitScale, figure: null };
  }
  const layered = isFighter25DId(input.clip.unitId)
    ? fighterParts(input.clip, input.offsets, input.time, input.mode)
    : (tankParts(input.clip, input.offsets, input.mode, input.frame) ?? stillParts(input.clip, input.offsets));
  const parts: VehicleSvgPart[] = layered ?? [
    {
      role: "torso",
      href: input.href,
      x: 0,
      y: 0,
      width: input.clip.width,
      height: input.clip.height,
      resolution: input.clip.resolution,
    },
  ];
  return {
    unitScale,
    figure: {
      id: input.id,
      x: input.x,
      y: input.y,
      unitScale,
      rootX: input.rootX ?? -input.clip.feet.x + input.offsets.root.x,
      rootY: input.rootY ?? -input.clip.feet.y + input.offsets.root.y,
      face: input.face ?? 1,
      turnDeg: input.turnDeg ?? 0,
      parts,
    },
  };
}

/**
 * The contact oval in the current transform, which is already translated to the feet.
 * Facing flips the root shift. The oval itself is not scaled again by the caller.
 */
export function fieldContactLocal(
  clip: QuickClipRef,
  unitScale: number,
  face: 1 | -1,
  root: { x: number; y: number },
): ContactShadow {
  const spot = contactShadow(
    {
      left: 0,
      right: Math.max(0, clip.width - 1),
      width: Math.max(1, clip.width),
      centre: clip.feet.x,
    },
    clip.feet,
    { x: 0, y: 0 },
    unitScale,
  );
  return {
    x: spot.x + root.x * unitScale * face,
    y: spot.y + root.y * unitScale,
    rx: spot.rx,
    ry: spot.ry,
  };
}
