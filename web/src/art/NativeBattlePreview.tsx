import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { isVehicleUnitType, UNIT_TYPE_LABEL } from "./archetypeLayers";
import { AS_DRAWN_LUT, exhaustPuff, frameRgba, fromFrameFile, readClipsFile, type FrameClipsFile } from "./frameClips";
import { loadMotionDocument, readUnitFile } from "./layeredUnit";
import { playbackBeatAt, type PlaybackBeat } from "./motionPreview";
import {
  attackerStation,
  BATTLE_BOARD,
  battleCategory,
  COMPARE_ROW,
  contactShadow,
  depthOrder,
  depthUnitScale,
  downsampleBeatHalf,
  draggedStation,
  fieldBlit,
  fieldDampZoom,
  fieldGap,
  fieldRows,
  FIELD_PICK_KEY,
  FIELD_UNIT_SCALES,
  fieldUnitScaleLabel,
  FIELD_VIEW_SCALES,
  fieldViewScale,
  fieldWheelZoom,
  fieldZoomLabel,
  heldClipAt,
  marchDistance,
  nativeBeatPixels,
  nativeStamp,
  footprintSpan,
  opaqueFeet,
  pictureLabel,
  shadowColor,
  snapDeviceOrigin,
  stampHolds,
  walkFrameAt,
  type Footprint,
} from "./nativeBattleOverlay";
import { createVehicleStage, type VehicleSvgPart, type VehicleSvgUnit } from "./fieldVehicleStage";
import {
  FIGHTER_25D_ID,
  FIGHTER_25D_WING_ROOT,
  FIGHTER_25D_Z_ORDER,
  fighter25DAltitude,
  fighter25DLayerUrl,
  fighter25DPose,
  fighter25DTheta,
  FIGHTER_25D_ROLE_SLOT,
  isFighter25DId,
} from "./fighter25D";
import { FACTION_LUTS } from "./paperDoll";
import { foldLayerShift, resolveUnitAnimProfile, type UnitAnimProfile } from "./unitAnimationProfiles";
import { horizonShiftX } from "./horizonParallax";
import { buildPaintedRig, buildTankView, splitStillView, tankLayerSources, tankRasterLayers, type TankView } from "./tankView";
import {
  advanceVehicle,
  createPreviewClock,
  createVehicleAnim,
  easeVehicle,
  motionMode,
  previewModes,
  vehicleOffsets,
  type FieldMotion,
  type VehicleAnim,
  type VehicleMode,
  type VehicleOffsets,
} from "./vehicleMotion";
import type { UnitPaintDocument } from "./pixelPaint";
import { preferStamped, unitTypeLabel } from "./unitShelf";
import { GraphicsSettingsPanel } from "./GraphicsSettingsPanel";
import { graphicsSettings } from "../ui/battle/graphicsSettings";
import { drawSceneryEdge, drawWWIIBattlefield } from "../ui/battle/unitRenderer";
import { bakeScenery, sceneryBakeStats, sceneryForView, sceneryScaleFor } from "../ui/battle/scenery/sceneryBake";
import { sceneForRegion, sceneRegionList } from "../ui/battle/scenery/sceneRegions";
import { FACTION_PALETTE } from "../ui/theme/factionPalette";

const pictureCache = new Map<string, HTMLCanvasElement>();

/** Rasterise a vector once for this frame and this pixel size, then reuse it while neither changes. */
function cachedPicture(source: CanvasImageSource, key: string, width: number, height: number): HTMLCanvasElement | null {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const fullKey = `${key}|${w}x${h}`;
  const hit = pictureCache.get(fullKey);
  if (hit) {
    pictureCache.delete(fullKey);
    pictureCache.set(fullKey, hit);
    return hit;
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d");
  if (!g) return null;
  g.imageSmoothingEnabled = true;
  g.drawImage(source, 0, 0, w, h);
  pictureCache.set(fullKey, canvas);
  while (pictureCache.size > 32) {
    const oldest = pictureCache.keys().next().value;
    if (oldest === undefined) break;
    pictureCache.delete(oldest);
  }
  return canvas;
}

interface SavedUnit {
  factionId: string;
  unitTypeId: string;
}

interface PictureRow {
  factionId: string;
  unitTypeId: string;
  seed?: number;
  grade?: string;
  quantized: string;
}

interface PlateActor {
  kind: "plate";
  doc: UnitPaintDocument;
}

interface FrameActor {
  kind: "frames";
  title: string;
  factionId: string;
  unitTypeId: string;
  width: number;
  height: number;
  feet: { x: number; y: number };
  idle: OffscreenCanvas | null;
  /** Every idle picture. `idle` stays the first, for a frame that has nothing else to show. */
  idleFrames: OffscreenCanvas[];
  walk: OffscreenCanvas[];
  fire: OffscreenCanvas[];
  damaged: OffscreenCanvas[];
  /** Bitmap pixels along one logical pixel. A traced walk is 4; the pixel walk is 1. */
  resolution: number;
  scalableIdle: HTMLImageElement | null;
  scalableIdleFrames: HTMLImageElement[];
  scalableWalk: HTMLImageElement[];
  scalableFire: HTMLImageElement[];
  scalableDamaged: HTMLImageElement[];
  /** Exhaust, in the picture's pixels. */
  smoke: { x: number; y: number } | null;
  /** Barrel tip, in the picture's pixels. The flash is drawn in front of it. */
  muzzle: { x: number; y: number } | null;
  /** Fire-clip indexes that draw the muzzle flash. */
  flashFrames: number[];
  /** Idle and fire indexes that let the exhaust rise. */
  puffFrames: { idle: number[]; fire: number[] };
  /** Tracks, torso, head, and weapon split in memory. Null when this picture has no rig. */
  tank: TankView | null;
  /** Articulated 2.5D wing foreshortening prototype. */
  fighter25D?: boolean;
}

interface StillActor {
  kind: "still";
  title: string;
  factionId: string;
  unitTypeId: string;
  width: number;
  height: number;
  feet: { x: number; y: number };
  canvas: OffscreenCanvas;
  /** Bitmap pixels along one logical pixel. A traced SVG is 4. */
  resolution: number;
  /** The SVG itself, rasterized at the current zoom so the curves stay smooth. */
  scalable?: HTMLImageElement;
}

interface VectorRow {
  file: string;
  factionId: string;
  unitTypeId: string;
  seed?: number;
  polished?: boolean;
  stamped?: boolean;
  source?: string;
  width: number;
  height: number;
}

/** A polished or stamped candidate PNG's overnight row is filed under its quantized twin. */
function quantizedTwin(path: string): string {
  return path.replace(/\.outlined\.(polished|stamped)\.png$/, ".outlined.quantized.png");
}

type FieldActor = PlateActor | FrameActor | StillActor;

const NO_SHIFT: VehicleOffsets = {
  root: { x: 0, y: 0 },
  tracks: { x: 0, y: 0 },
  torso: { x: 0, y: 0 },
  head: { x: 0, y: 0 },
  weapon: { x: 0, y: 0 },
  hull: { x: 0, y: 0 },
  turret: { x: 0, y: 0 },
};

function actorUnitType(actor: FieldActor): string {
  return actor.kind === "plate" ? actor.doc.blueprint.unitTypeId : actor.unitTypeId;
}

function inkedOffsets(profile: UnitAnimProfile, offsets: VehicleOffsets): VehicleOffsets {
  const parts = foldLayerShift(profile, offsets);
  return { ...offsets, ...parts, hull: parts.torso, turret: parts.head };
}

function paintContact(ctx: CanvasRenderingContext2D, spot: { x: number; y: number; rx: number; ry: number }): void {
  ctx.save();
  ctx.translate(spot.x, spot.y);
  ctx.scale(1, spot.ry / spot.rx);
  const pool = ctx.createRadialGradient(0, 0, 0, 0, 0, spot.rx);
  pool.addColorStop(0, shadowColor(1));
  pool.addColorStop(0.55, shadowColor(0.75));
  pool.addColorStop(1, shadowColor(0));
  ctx.fillStyle = pool;
  ctx.beginPath();
  ctx.arc(0, 0, spot.rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

async function tankFor(
  file: FrameClipsFile,
  unitTypeId: string,
  idle: OffscreenCanvas[],
  walk: OffscreenCanvas[],
  fire: OffscreenCanvas[],
  vectorBase: string | null,
): Promise<TankView | null> {
  if (!isVehicleUnitType(unitTypeId)) {
    return null;
  }
  return buildTankView({
    rigId: file.unitId.replace(/_QUICK$/i, ""),
    artWidth: file.width,
    artHeight: file.height,
    idle,
    walk,
    fire,
    vectorBase,
  });
}

function vehiclePose(
  mode: VehicleMode,
  frame: number,
  actor: FrameActor,
): { clip: "idle" | "walk" | "fire"; index: number; firing: boolean; label: string } {
  const clip = mode === "firing" ? "fire" : mode === "idle" ? "idle" : "walk";
  const count = clip === "fire" ? actor.fire.length : clip === "walk" ? actor.walk.length : actor.idleFrames.length;
  const index = count > 0 ? frame % count : 0;
  const title = mode === "firing" ? "Firing" : mode === "idle" ? "Idle" : "Walking";
  return { clip, index, firing: mode === "firing", label: count > 1 ? `${title} ${index + 1}` : title };
}

function clipMarks(file: FrameClipsFile): Pick<FrameActor, "smoke" | "muzzle" | "flashFrames" | "puffFrames"> {
  return {
    smoke: file.smoke ?? null,
    muzzle: file.muzzle ?? null,
    flashFrames: file.flashFrames ?? [],
    puffFrames: file.puffFrames ?? { idle: [], fire: [] },
  };
}

/** The exhaust wisp, in the picture's own pixels. */
function paintSpriteMarks(
  ctx: CanvasRenderingContext2D,
  actor: FrameActor,
  blit: { x: number; y: number; width: number; height: number },
  clip: string,
  index: number,
): void {
  if (actor.width <= 0 || actor.height <= 0 || !actor.smoke) {
    return;
  }
  const listed = clip === "idle" ? actor.puffFrames.idle : clip === "fire" ? actor.puffFrames.fire : [];
  const phase = listed.indexOf(index);
  if (phase < 0) {
    return;
  }
  const pixelW = blit.width / actor.width;
  const pixelH = blit.height / actor.height;
  for (const [dx, dy, hex] of exhaustPuff(phase)) {
    ctx.fillStyle = hex;
    ctx.fillRect(blit.x + (actor.smoke.x + dx) * pixelW, blit.y + (actor.smoke.y + dy) * pixelH, pixelW, pixelH);
  }
}

interface PlacedUnit {
  id: number;
  actor: FieldActor;
  /** Empty battle pixels after this picture, kept so the row does not jump. */
  gap: number;
  /** Feet on the battle board. A drag writes this and later adds leave it alone. */
  station: { x: number; y: number };
  /** Battle pixels per art pixel. 1 draws the picture at its own size. */
  scale: number;
}

const WALK_URL = "/assets/units/frames/jap_infantry";
const WALK_V2_URL = "/assets/units/frames/jap_infantry_v2";
const POLISHED_WALK_URL = "/assets/units/frames/jap_infantry_polished";
const QUICK_TANK_URL = "/assets/units/frames/ger_tank_seed1_QUICK";
const QUICK_TANK_VECTOR_URL = "/assets/units/vector/frames/ger_tank_seed1_QUICK";
const QUICK_USSR_TANK_URL = "/assets/units/frames/ussr_tank_seed1_QUICK";
const QUICK_USSR_TANK_VECTOR_URL = "/assets/units/vector/frames/ussr_tank_seed1_QUICK";
const QUICK_UK_TANK_URL = "/assets/units/frames/uk_tank_seed1_QUICK";
const QUICK_UK_TANK_VECTOR_URL = "/assets/units/vector/frames/uk_tank_seed1_QUICK";
const QUICK_US_TANK_URL = "/assets/units/frames/us_tank_seed1_QUICK";
const QUICK_US_TANK_VECTOR_URL = "/assets/units/vector/frames/us_tank_seed1_QUICK";
const QUICK_JAP_TANK_URL = "/assets/units/frames/jap_tank_seed1_QUICK";
const QUICK_JAP_TANK_VECTOR_URL = "/assets/units/vector/frames/jap_tank_seed1_QUICK";
const VECTOR_WALK_URL = "/assets/units/vector/frames/jap_infantry";
const VECTOR_WALK_V2_URL = "/assets/units/vector/frames/jap_infantry_v2";
const POLISHED_VECTOR_WALK_URL = "/assets/units/vector/frames/jap_infantry_polished";
const FACTION_ORDER = ["GER", "UK", "US", "USSR", "JAP"];

const QUICK_FACTIONS = [
  { id: "GER", prefix: "ger" },
  { id: "USSR", prefix: "ussr" },
  { id: "UK", prefix: "uk" },
  { id: "US", prefix: "us" },
  { id: "JAP", prefix: "jap" },
] as const;

const QUICK_TYPES = [
  "mech_infantry",
  "artillery",
  "aaa",
  "fighter",
  "tac_bomber",
  "bomber",
  "battleship",
  "cruiser",
  "destroyer",
  "submarine",
  "transport",
] as const;

const QUIET_MARKS: Pick<FrameActor, "smoke" | "muzzle" | "flashFrames" | "puffFrames"> = {
  smoke: null,
  muzzle: null,
  flashFrames: [],
  puffFrames: { idle: [], fire: [] },
};

const BEAT_LABEL: Record<string, string> = {
  idle: "Idle",
  move_1: "Move 1",
  idle_2: "Idle",
  move_2: "Move 2",
  fire_windup: "Windup",
  fire_peak: "Fire",
  fire_recover: "Recover",
  idle_settle: "Idle",
};

function factionName(factionId: string): string {
  if (factionId === "US" || factionId === "UK" || factionId === "JAP" || factionId === "GER" || factionId === "USSR") {
    return FACTION_PALETTE[factionId].name;
  }
  return factionId;
}

function openingRegion(regions: ReturnType<typeof sceneRegionList>, sea: boolean): string {
  const pool = regions.filter((region) => (sea ? region.type === "sea" : region.type === "land"));
  const named = pool.find((region) => region.name === "France" || region.id === "France");
  return (named ?? pool[0] ?? regions[0])?.id ?? "";
}

function spriteTitle(doc: UnitPaintDocument): string {
  const type = UNIT_TYPE_LABEL[doc.blueprint.unitTypeId] ?? doc.blueprint.unitTypeId;
  const { width, height } = doc.blueprint.canvasSize;
  return `${factionName(doc.blueprint.factionId)} ${type.toLowerCase()}, ${width} by ${height}`;
}

function actorTitle(actor: FieldActor | null): string {
  if (!actor) {
    return "Empty field";
  }
  return actor.kind === "plate" ? spriteTitle(actor.doc) : actor.title;
}

function actorMark(actor: FieldActor): string {
  if (actor.kind === "frames") {
    return actor.resolution > 1 ? "Vector" : "Walk";
  }
  const unitTypeId = actor.kind === "plate" ? actor.doc.blueprint.unitTypeId : actor.unitTypeId;
  return UNIT_TYPE_LABEL[unitTypeId] ?? unitTypeId;
}

function actorUnit(actor: FieldActor | null): string {
  if (!actor) {
    return "tank";
  }
  return actor.kind === "plate" ? actor.doc.blueprint.unitTypeId : actor.unitTypeId;
}

function actorSize(actor: FieldActor): { width: number; height: number } {
  return actor.kind === "plate" ? actor.doc.blueprint.canvasSize : { width: actor.width, height: actor.height };
}

function actorFeet(actor: FieldActor): { x: number; y: number } {
  return actor.kind === "plate" ? actor.doc.blueprint.groundOrigin : actor.feet;
}

function fieldPiece(actor: FieldActor, gap: number) {
  const size = actorSize(actor);
  return {
    width: size.width,
    height: size.height,
    footX: actorFeet(actor).x,
    category: battleCategory(actorUnit(actor)),
    gap,
  };
}

/** Where the picture stands, at its own scale times its lane's depth multiplier (land only). */
function unitStamp(item: PlacedUnit, depth: boolean) {
  return nativeStamp(actorSize(item.actor), actorFeet(item.actor), item.station, depthUnitScale(item.scale, item.station.y, depth));
}

/** The next sprite takes the next spot on its row. Sprites already on the board keep their feet. */
function unitOnField(list: readonly PlacedUnit[], actor: FieldActor, id: number): PlacedUnit {
  const gap = fieldGap(id);
  const slots = fieldRows([...list.map((item) => fieldPiece(item.actor, item.gap)), fieldPiece(actor, gap)]);
  return {
    id,
    actor,
    gap,
    scale: 1,
    station: slots[list.length] ?? attackerStation("land", COMPARE_ROW),
  };
}

function paintRgba(rgba: Uint8ClampedArray, width: number, height: number): OffscreenCanvas {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("The browser would not open a canvas.");
  }
  const image = ctx.createImageData(width, height);
  image.data.set(rgba);
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("That picture could not be opened."));
    image.src = src;
  });
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("That sprite could not be opened.");
  }
  return response.json();
}

function rigIdOnPath(factionId: string, unitTypeId: string, path: string): string | null {
  const faction = QUICK_FACTIONS.find((item) => item.id === factionId);
  if (!faction) {
    return null;
  }
  const folder = unitTypeId === "tactical_bomber" ? "tac_bomber" : unitTypeId === "strategic_bomber" ? "bomber" : unitTypeId;
  const rigId = `${faction.prefix}_${folder}_seed1`;
  return path.includes(`/${rigId}.`) ? rigId : null;
}

async function withRigLayers(still: StillActor, canvas: OffscreenCanvas, rigId: string | null, withPictures: boolean): Promise<FieldActor> {
  if (!rigId) {
    return still;
  }
  const view = await splitStillView(rigId, canvas, withPictures);
  if (!view || view.artWidth !== still.width || view.artHeight !== still.height || view.resolution !== still.resolution) {
    return still;
  }
  return {
    kind: "frames",
    title: still.title,
    factionId: still.factionId,
    unitTypeId: still.unitTypeId,
    width: still.width,
    height: still.height,
    feet: still.feet,
    idle: canvas,
    idleFrames: [canvas],
    walk: [canvas],
    fire: [canvas],
    damaged: [],
    resolution: still.resolution,
    scalableIdle: still.scalable ?? null,
    scalableIdleFrames: still.scalable ? [still.scalable] : [],
    scalableWalk: [],
    scalableFire: [],
    scalableDamaged: [],
    ...QUIET_MARKS,
    tank: view,
  };
}

async function loadPicture(path: string, row?: PictureRow): Promise<FieldActor> {
  const image = await loadImage(`/__dev/bake-file?path=${encodeURIComponent(path)}`);
  const canvas = new OffscreenCanvas(image.naturalWidth, image.naturalHeight);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("The browser would not open a canvas.");
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const name = path.split("/").pop() ?? path;
  const polished = path.endsWith(".outlined.polished.png");
  const stamped = path.endsWith(".outlined.stamped.png");
  const grade = stamped ? "stamped" : polished ? "polished" : null;
  const still: StillActor = {
    kind: "still",
    title: `${row ? pictureLabel(grade ? { ...row, grade } : row) : name}${grade && row ? `, ${grade}` : ""}, ${canvas.width} by ${canvas.height}`,
    factionId: row?.factionId ?? "GER",
    unitTypeId: row?.unitTypeId ?? "tank",
    width: canvas.width,
    height: canvas.height,
    feet: opaqueFeet(pixels.data, canvas.width, canvas.height),
    canvas,
    resolution: 1,
  };
  return withRigLayers(still, canvas, rigIdOnPath(still.factionId, still.unitTypeId, path), false);
}

function vectorRows(value: unknown): VectorRow[] {
  const list = Array.isArray((value as { units?: unknown })?.units) ? (value as { units: unknown[] }).units : [];
  const rows: VectorRow[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as VectorRow;
    if (typeof row.file !== "string" || !row.file.endsWith(".svg") || row.file.includes("..")) {
      continue;
    }
    if (typeof row.factionId !== "string" || typeof row.unitTypeId !== "string") {
      continue;
    }
    if (typeof row.width !== "number" || typeof row.height !== "number" || row.width < 1 || row.height < 1) {
      continue;
    }
    rows.push(row);
  }
  return rows;
}

async function loadVector(file: string, row?: VectorRow): Promise<FieldActor> {
  const image = await loadImage(`/${file.replace(/^\/+/, "")}`);
  const rasterWidth = Math.max(1, image.naturalWidth);
  const rasterHeight = Math.max(1, image.naturalHeight);
  const canvas = new OffscreenCanvas(rasterWidth, rasterHeight);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("The browser would not open a canvas.");
  }
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const logicalW = row && row.width > 0 ? row.width : Math.max(1, Math.round(rasterWidth / 4));
  const logicalH = row && row.height > 0 ? row.height : Math.max(1, Math.round(rasterHeight / 4));
  const resolution = rasterWidth / logicalW;
  const feet = opaqueFeet(pixels.data, canvas.width, canvas.height);
  const name = file.split("/").pop() ?? file;
  const still: StillActor = {
    kind: "still",
    title: row ? `${pictureLabel(row)}, ${row.stamped === true ? "stamped vector" : row.polished === true ? "polished vector" : "vector"}` : `${name}, vector`,
    factionId: row?.factionId ?? "GER",
    unitTypeId: row?.unitTypeId ?? "tank",
    width: logicalW,
    height: logicalH,
    feet: {
      x: Math.round(feet.x / resolution),
      y: Math.floor(feet.y / resolution),
    },
    canvas,
    resolution,
    scalable: image,
  };
  return withRigLayers(still, canvas, rigIdOnPath(still.factionId, still.unitTypeId, file), true);
}

async function loadWalk(): Promise<FrameActor> {
  const file = readClipsFile(await fetchJson(`${WALK_URL}/clips.json`));
  const paint = async (name: string) => {
    const frame = fromFrameFile(await fetchJson(`${WALK_URL}/${name}.json`));
    return paintRgba(frameRgba(frame, AS_DRAWN_LUT), frame.width, frame.height);
  };
  const [idle, walk, fire, damaged] = await Promise.all([
    Promise.all(file.clips.idle.map(paint)),
    Promise.all(file.clips.walk.map(paint)),
    Promise.all(file.clips.fire.map(paint)),
    Promise.all(file.clips.damaged.map(paint)),
  ]);
  return {
    kind: "frames",
    title: `Japanese walk, ${file.width} by ${file.height}`,
    factionId: "JAP",
    unitTypeId: "infantry",
    width: file.width,
    height: file.height,
    feet: file.feet,
    idle: idle[0] ?? null,
    idleFrames: idle,
    walk,
    fire,
    damaged,
    resolution: 1,
    scalableIdle: null,
    scalableIdleFrames: [],
    scalableWalk: [],
    scalableFire: [],
    scalableDamaged: [],
    ...clipMarks(file),
    tank: null,
  };
}

/** A walk saved as frame pictures. The clip list names each PNG, and the battle plays those frames. */
async function loadPngWalk(base: string, title: string, factionId: string, unitTypeId: string): Promise<FrameActor> {
  const file = readClipsFile(await fetchJson(`${base}/clips.json`));
  const paint = async (name: string) => {
    const image = await loadImage(`${base}/${name}.png`);
    const canvas = new OffscreenCanvas(Math.max(1, image.naturalWidth), Math.max(1, image.naturalHeight));
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("The browser would not open a canvas.");
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, 0, 0);
    return canvas;
  };
  const [idle, walk, fire, damaged] = await Promise.all([
    Promise.all(file.clips.idle.map(paint)),
    Promise.all(file.clips.walk.map(paint)),
    Promise.all(file.clips.fire.map(paint)),
    Promise.all(file.clips.damaged.map(paint)),
  ]);
  return {
    kind: "frames",
    title: `${title}, ${file.width} by ${file.height}`,
    factionId,
    unitTypeId,
    width: file.width,
    height: file.height,
    feet: file.feet,
    idle: idle[0] ?? null,
    idleFrames: idle,
    walk,
    fire,
    damaged,
    resolution: 1,
    scalableIdle: null,
    scalableIdleFrames: [],
    scalableWalk: [],
    scalableFire: [],
    scalableDamaged: [],
    ...clipMarks(file),
    tank: await tankFor(file, unitTypeId, idle, walk, fire, null),
  };
}
function loadPolishedWalk(): Promise<FrameActor> {
  return loadPngWalk(POLISHED_WALK_URL, "Japanese walk, polished", "JAP", "infantry");
}

async function rasterVector(src: string): Promise<{ canvas: OffscreenCanvas; image: HTMLImageElement }> {
  const image = await loadImage(src);
  const canvas = new OffscreenCanvas(Math.max(1, image.naturalWidth), Math.max(1, image.naturalHeight));
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("The browser would not open a canvas.");
  }
  context.imageSmoothingEnabled = true;
  context.drawImage(image, 0, 0);
  return { canvas, image };
}

async function loadVectorWalk(
  base = VECTOR_WALK_URL,
  label = "vector",
  factionId = "JAP",
  unitTypeId = "infantry",
  name = "Japanese walk",
): Promise<FrameActor> {
  const file = readClipsFile(await fetchJson(`${base}/clips.json`));
  const load = (name: string) => rasterVector(`${base}/${name}.svg`);
  const [idle, walk, fire, damaged] = await Promise.all([
    Promise.all(file.clips.idle.map(load)),
    Promise.all(file.clips.walk.map(load)),
    Promise.all(file.clips.fire.map(load)),
    Promise.all(file.clips.damaged.map(load)),
  ]);
  const sample = idle[0] ?? walk[0] ?? fire[0];
  const resolution = sample && file.width > 0 ? sample.canvas.width / file.width : 1;
  return {
    kind: "frames",
    title: `${name}, ${label}, ${file.width} by ${file.height}`,
    factionId,
    unitTypeId,
    width: file.width,
    height: file.height,
    feet: file.feet,
    idle: idle[0]?.canvas ?? null,
    idleFrames: idle.map((frame) => frame.canvas),
    walk: walk.map((frame) => frame.canvas),
    fire: fire.map((frame) => frame.canvas),
    damaged: damaged.map((frame) => frame.canvas),
    resolution,
    scalableIdle: idle[0]?.image ?? null,
    scalableIdleFrames: idle.map((frame) => frame.image),
    scalableWalk: walk.map((frame) => frame.image),
    scalableFire: fire.map((frame) => frame.image),
    scalableDamaged: damaged.map((frame) => frame.image),
    ...clipMarks(file),
    tank: await tankFor(file, unitTypeId, idle.map((frame) => frame.canvas), walk.map((frame) => frame.canvas), fire.map((frame) => frame.canvas), base),
  };
}

function factionOfRig(rigId: string): (typeof QUICK_FACTIONS)[number]["id"] {
  const faction = QUICK_FACTIONS.find((item) => rigId.startsWith(`${item.prefix}_`));
  return faction?.id ?? "GER";
}

function typeOfRig(rigId: string): string {
  const faction = QUICK_FACTIONS.find((item) => rigId.startsWith(`${item.prefix}_`));
  const rest = faction ? rigId.slice(faction.prefix.length + 1) : rigId;
  return rest.replace(/_seed\d+(?:_25D|_QUICK)?$/i, "").replace(/_(?:25D|QUICK)$/i, "");
}

function lutFor(factionId: string): readonly string[] {
  if (factionId === "GER" || factionId === "UK" || factionId === "USSR" || factionId === "US" || factionId === "JAP") {
    return FACTION_LUTS[factionId];
  }
  return AS_DRAWN_LUT;
}

async function loadFighter25D(asVector: boolean): Promise<FrameActor> {
  const rigId = FIGHTER_25D_ID;
  const factionId = "GER";
  const unitTypeId = "fighter";
  const label = asVector ? "GER fighter, 25D, vector" : "GER fighter, 25D";
  if (asVector) {
    const painted = await buildPaintedRig(rigId, lutFor(factionId), false);
    if (!painted) {
      throw new Error("The 25D fighter rig could not be opened.");
    }
    const idleImage = await loadImage(fighter25DLayerUrl("fuselage"));
    // Composite preview plate from the flat idle clip so feet / blit stay correct.
    const clipIdle = await loadImage(`/assets/units/vector/frames/${rigId}/idle_0.svg`);
    const canvas = new OffscreenCanvas(painted.width, painted.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("The browser would not open a canvas.");
    }
    // Draw the resolution-4 SVG scaled down to 1 unit = 1 sprite pixel for the blit plate.
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(clipIdle, 0, 0, painted.width, painted.height);
    void idleImage;
    return {
      kind: "frames",
      title: `${label}, ${painted.width} by ${painted.height}`,
      factionId,
      unitTypeId,
      width: painted.width,
      height: painted.height,
      feet: painted.feet,
      idle: canvas,
      idleFrames: [canvas],
      walk: [canvas],
      fire: [canvas],
      damaged: [],
      resolution: 4,
      scalableIdle: clipIdle,
      scalableIdleFrames: [clipIdle],
      scalableWalk: [],
      scalableFire: [],
      scalableDamaged: [],
      ...QUIET_MARKS,
      muzzle: { x: 133, y: 72 },
      tank: null,
      fighter25D: true,
    };
  }
  const painted = await buildPaintedRig(rigId, lutFor(factionId), true);
  if (!painted) {
    throw new Error("The 25D fighter rig could not be opened.");
  }
  return {
    kind: "frames",
    title: `${label}, ${painted.width} by ${painted.height}`,
    factionId,
    unitTypeId,
    width: painted.width,
    height: painted.height,
    feet: painted.feet,
    idle: painted.idle,
    idleFrames: [painted.idle],
    walk: painted.walk,
    fire: painted.fire,
    damaged: [],
    resolution: 1,
    scalableIdle: null,
    scalableIdleFrames: [],
    scalableWalk: [],
    scalableFire: [],
    scalableDamaged: [],
    ...QUIET_MARKS,
    muzzle: { x: 133, y: 72 },
    tank: painted.view,
    fighter25D: true,
  };
}

async function loadQuickUnit(rigId: string, asVector: boolean): Promise<FrameActor> {
  if (isFighter25DId(rigId) || rigId === FIGHTER_25D_ID) {
    return loadFighter25D(asVector);
  }
  const factionId = factionOfRig(rigId);
  const unitTypeId = typeOfRig(rigId);
  const label = `${factionId} ${unitTypeLabel(unitTypeId).toLowerCase()}, QUICK`;
  if (asVector) {
    for (const grade of ["stamped", "polished"] as const) {
      try {
        const image = await loadImage(`/assets/units/vector/${factionId}/${rigId}.${grade}.svg`);
        const canvas = new OffscreenCanvas(Math.max(1, image.naturalWidth), Math.max(1, image.naturalHeight));
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          throw new Error("The browser would not open a canvas.");
        }
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(image, 0, 0);
        const view = await splitStillView(rigId, canvas, true);
        if (view && canvas.width === view.artWidth * view.resolution && canvas.height === view.artHeight * view.resolution) {
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const feet = opaqueFeet(pixels.data, canvas.width, canvas.height);
          return {
            kind: "frames",
            title: `${label}, vector, ${view.artWidth} by ${view.artHeight}`,
            factionId,
            unitTypeId,
            width: view.artWidth,
            height: view.artHeight,
            feet: { x: Math.round(feet.x / view.resolution), y: Math.floor(feet.y / view.resolution) },
            idle: canvas,
            idleFrames: [canvas],
            walk: [canvas],
            fire: [canvas],
            damaged: [],
            resolution: view.resolution,
            scalableIdle: image,
            scalableIdleFrames: [image],
            scalableWalk: [],
            scalableFire: [],
            scalableDamaged: [],
            ...QUIET_MARKS,
            tank: view,
          };
        }
      } catch {
        // A missing trace falls through to the rig's own drawings.
      }
    }
  }
  const painted = await buildPaintedRig(rigId, lutFor(factionId), asVector);
  if (!painted) {
    throw new Error("That sprite could not be opened.");
  }
  return {
    kind: "frames",
    title: `${label}${asVector ? ", vector" : ""}, ${painted.width} by ${painted.height}`,
    factionId,
    unitTypeId,
    width: painted.width,
    height: painted.height,
    feet: painted.feet,
    idle: painted.idle,
    idleFrames: [painted.idle],
    walk: painted.walk,
    fire: painted.fire,
    damaged: [],
    resolution: 1,
    scalableIdle: null,
    scalableIdleFrames: [],
    scalableWalk: [],
    scalableFire: [],
    scalableDamaged: [],
    ...QUIET_MARKS,
    tank: painted.view,
  };
}

function frameScalable(actor: FrameActor, clip: string, index: number): HTMLImageElement | undefined {
  if (actor.resolution <= 1) {
    return undefined;
  }
  if (clip === "damaged") {
    return actor.scalableDamaged[index] ?? actor.scalableIdle ?? undefined;
  }
  if (clip === "fire") {
    return actor.scalableFire[index] ?? actor.scalableIdle ?? undefined;
  }
  if (clip === "walk") {
    return actor.scalableWalk[index] ?? actor.scalableIdle ?? undefined;
  }
  return actor.scalableIdleFrames[index] ?? actor.scalableIdle ?? undefined;
}

/** The overnight row for a handed-over picture, so it lands on land or sea. A polished or stamped PNG uses its quantized twin's row. */
async function pickedRow(path: string): Promise<PictureRow | undefined> {
  const json: unknown = await fetch("/__dev/bake-candidates")
    .then((response) => response.json())
    .catch(() => null);
  const twin = quantizedTwin(path);
  const rows = pictureRows(json);
  return rows.find((row) => row.quantized === path) ?? rows.find((row) => row.quantized === twin);
}

function pictureRows(value: unknown): PictureRow[] {
  const list = Array.isArray((value as { candidates?: unknown })?.candidates) ? (value as { candidates: unknown[] }).candidates : [];
  const seen = new Set<string>();
  const rows: PictureRow[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as PictureRow;
    if (typeof row.quantized !== "string" || !row.quantized.endsWith(".png") || seen.has(row.quantized)) {
      continue;
    }
    seen.add(row.quantized);
    rows.push(row);
  }
  return rows.sort((a, b) => pictureLabel(a).localeCompare(pictureLabel(b), undefined, { numeric: true }));
}

/**
 * A battle board with a drawing and the vector unit on it. The drawing is copied at its own size:
 * one pixel of the picture is one pixel of the board.
 */
export function NativeBattlePreview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pausedRef = useRef(false);
  const motionRef = useRef<FieldMotion>("move");
  const damagedRef = useRef(false);
  const motionClockRef = useRef(createPreviewClock());
  const vehicleAnimsRef = useRef(new Map<number, VehicleAnim>());
  const frontRef = useRef<HTMLCanvasElement>(null);
  const creepRef = useRef(new Map<number, { time: number }>());
  const regionPicked = useRef(false);
  const ticket = useRef(0);
  const placeId = useRef(0);
  const placedRef = useRef<PlacedUnit[]>([]);
  /** Land fields have a back lane and a front lane. Sea scenes do not. */
  const depthRef = useRef(true);
  const dragRef = useRef<{ id: number; dx: number; dy: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef(1);
  const cameraRef = useRef({ x: 0, y: 0 });
  const panRef = useRef<{ pointerId: number; x: number; y: number; camX: number; camY: number } | null>(null);
  const glideRef = useRef({
    target: 1,
    raf: 0,
    last: 0,
    anchor: null as { localX: number; localY: number; boardX: number; boardY: number } | null,
  });
  const regions = useMemo(() => sceneRegionList(), []);
  const editorDoc = useMemo(() => loadMotionDocument(), []);
  const picked = useMemo(() => {
    try {
      const path = sessionStorage.getItem(FIELD_PICK_KEY);
      if (path) {
        sessionStorage.removeItem(FIELD_PICK_KEY);
      }
      return path;
    } catch {
      return null;
    }
  }, []);
  const [plates, setPlates] = useState<SavedUnit[]>([]);
  const [pictures, setPictures] = useState<PictureRow[]>([]);
  const [vectors, setVectors] = useState<VectorRow[]>([]);
  const [placed, setPlaced] = useState<PlacedUnit[]>([]);
  /** The editor hands over a candidate PNG path, or a walk key such as walk:jap:polished. */
  const pickedWalk = picked?.startsWith("walk:") ? picked : null;
  const [spriteKey, setSpriteKey] = useState(pickedWalk ?? (picked ? `pic:${picked}` : editorDoc ? "editor" : "walk:jap"));
  const [viewScale, setViewScale] = useState(1);
  const [regionId, setRegionId] = useState(() => {
    // `?region=Libya` opens on a named region and keeps the sprite picker from moving it.
    const asked = new URLSearchParams(window.location.search).get("region");
    if (asked && sceneForRegion(asked)) {
      regionPicked.current = true;
      return asked;
    }
    return openingRegion(regions, battleCategory(editorDoc?.blueprint.unitTypeId ?? "infantry") === "sea");
  });
  /** `?sky=0.68` pins the backdrop to one point of the 60 second sky cycle (0 noon, 0.5 dusk, 0.68 night). */
  const skyPin = useMemo(() => {
    const raw = new URLSearchParams(window.location.search).get("sky");
    const value = raw === null || raw === "" ? Number.NaN : Number(raw);
    return Number.isFinite(value) ? (((value % 1) + 1) % 1) * 60 : null;
  }, []);
  const [paused, setPaused] = useState(false);
  const [motion, setMotion] = useState<FieldMotion>("move");
  const [damaged, setDamaged] = useState(false);
  motionRef.current = motion;
  damagedRef.current = damaged;
  const [caption, setCaption] = useState("Moving");
  const [loadError, setLoadError] = useState("");
  const [cursor, setCursor] = useState("grab");
  placedRef.current = placed;

  function deviceRatio(): number {
    return Math.max(1, Math.round(window.devicePixelRatio || 1));
  }

  function boardUnder(localX: number, localY: number, scale = scaleRef.current): { x: number; y: number } {
    const dpr = deviceRatio();
    const span = dpr * scale;
    return {
      x: (localX * dpr - cameraRef.current.x) / span,
      y: (localY * dpr - cameraRef.current.y) / span,
    };
  }

  function aimCamera(scale: number, anchor: { localX: number; localY: number; boardX: number; boardY: number }) {
    const dpr = deviceRatio();
    const span = dpr * scale;
    cameraRef.current = {
      x: Math.round(anchor.localX * dpr - anchor.boardX * span),
      y: Math.round(anchor.localY * dpr - anchor.boardY * span),
    };
  }

  function followUnit(unitTypeId: string) {
    if (!regionPicked.current) {
      setRegionId(openingRegion(regions, battleCategory(unitTypeId) === "sea"));
    }
  }

  useEffect(() => {
    let stopped = false;
    void (async () => {
      const [plateFile, manifest, vectorFile] = await Promise.all([
        fetch("/__dev/layered-units").then((response) => response.json()).catch(() => ({ units: [] })),
        fetch("/__dev/bake-candidates").then((response) => response.json()).catch(() => ({ candidates: [] })),
        fetch("/assets/units/vector/manifest.json").then((response) => (response.ok ? response.json() : { units: [] })).catch(() => ({ units: [] })),
      ]);
      if (stopped) {
        return;
      }
      setPlates(Array.isArray(plateFile.units) ? plateFile.units : []);
      setPictures(pictureRows(manifest));
      setVectors(vectorRows(vectorFile));
    })();
    return () => {
      stopped = true;
    };
  }, []);

  useEffect(() => {
    const mine = ++ticket.current;
    void (async () => {
      const next = pickedWalk
        ? await loadActor(pickedWalk)
        : picked
          ? await loadPicture(picked, await pickedRow(picked))
          : editorDoc
            ? { kind: "plate" as const, doc: editorDoc }
            : await loadWalk();
      if (ticket.current !== mine) {
        return;
      }
      placeId.current += 1;
      setPlaced([unitOnField([], next, placeId.current)]);
      setLoadError("");
      followUnit(actorUnit(next));
    })().catch((error: unknown) => {
      if (ticket.current === mine) {
        setLoadError(error instanceof Error ? error.message : "That sprite could not be opened.");
      }
    });
    return undefined;
  }, [editorDoc, picked, regions]);

  async function loadActor(key: string): Promise<FieldActor> {
    if (key === "editor") {
      const doc = loadMotionDocument();
      if (!doc) {
        throw new Error("No sprite is open in the editor.");
      }
      return { kind: "plate", doc };
    }
    if (key === "walk:jap") {
      return loadWalk();
    }
    if (key === "walk:jap_infantry_v2") {
      return loadPngWalk(WALK_V2_URL, "Japanese walk, v2", "JAP", "infantry");
    }
    if (key === "walk:jap_infantry_v2:vector") {
      return loadVectorWalk(VECTOR_WALK_V2_URL, "vector", "JAP", "infantry", "Japanese walk, v2");
    }
    if (key === "walk:jap:polished") {
      return loadPolishedWalk();
    }
    if (key === "walk:ger_tank_seed1_QUICK") {
      return loadPngWalk(QUICK_TANK_URL, "GER tank, QUICK", "GER", "tank");
    }
    if (key === "walk:ger_tank_seed1_QUICK:vector") {
      return loadVectorWalk(QUICK_TANK_VECTOR_URL, "vector", "GER", "tank", "GER tank, QUICK");
    }
    if (key === "walk:ussr_tank_seed1_QUICK") {
      return loadPngWalk(QUICK_USSR_TANK_URL, "USSR tank, QUICK", "USSR", "tank");
    }
    if (key === "walk:ussr_tank_seed1_QUICK:vector") {
      return loadVectorWalk(QUICK_USSR_TANK_VECTOR_URL, "vector", "USSR", "tank", "USSR tank, QUICK");
    }
    if (key === "walk:uk_tank_seed1_QUICK") {
      return loadPngWalk(QUICK_UK_TANK_URL, "UK tank, QUICK", "UK", "tank");
    }
    if (key === "walk:uk_tank_seed1_QUICK:vector") {
      return loadVectorWalk(QUICK_UK_TANK_VECTOR_URL, "vector", "UK", "tank", "UK tank, QUICK");
    }
    if (key === "walk:us_tank_seed1_QUICK") {
      return loadPngWalk(QUICK_US_TANK_URL, "US tank, QUICK", "US", "tank");
    }
    if (key === "walk:us_tank_seed1_QUICK:vector") {
      return loadVectorWalk(QUICK_US_TANK_VECTOR_URL, "vector", "US", "tank", "US tank, QUICK");
    }
    if (key === "walk:jap_tank_seed1_QUICK") {
      return loadPngWalk(QUICK_JAP_TANK_URL, "JAP tank, QUICK", "JAP", "tank");
    }
    if (key === "walk:jap_tank_seed1_QUICK:vector") {
      return loadVectorWalk(QUICK_JAP_TANK_VECTOR_URL, "vector", "JAP", "tank", "JAP tank, QUICK");
    }
    if (key === "walk:ger_fighter_seed1_25D") {
      return loadFighter25D(false);
    }
    if (key === "walk:ger_fighter_seed1_25D:vector") {
      return loadFighter25D(true);
    }
    if (key === "walk:jap:vector") {
      return loadVectorWalk();
    }
    if (key === "walk:jap:polished-vector") {
      return loadVectorWalk(POLISHED_VECTOR_WALK_URL, "polished vector");
    }
    if (key.startsWith("plate:")) {
      const [faction, unit] = key.slice("plate:".length).split("/");
      const response = await fetch(`/__dev/layered-units?faction=${encodeURIComponent(faction ?? "")}&unit=${encodeURIComponent(unit ?? "")}`);
      if (!response.ok) {
        throw new Error("That plate could not be opened.");
      }
      return { kind: "plate", doc: readUnitFile(await response.json()) };
    }
    if (key.startsWith("pic:")) {
      const path = key.slice("pic:".length);
      const twin = quantizedTwin(path);
      return loadPicture(path, pictures.find((item) => item.quantized === path) ?? pictures.find((item) => item.quantized === twin));
    }
    if (key.startsWith("vec:")) {
      const file = key.slice("vec:".length);
      return loadVector(file, vectors.find((item) => item.file === file));
    }
    const quick = /^walk:([a-z0-9_]+)_QUICK(?::(vector|png|rig))?$/i.exec(key);
    if (quick?.[1]) {
      const kind = quick[2]?.toLowerCase();
      return loadQuickUnit(quick[1].toLowerCase(), kind === "vector" || kind === "rig");
    }
    throw new Error("That sprite could not be opened.");
  }

  async function addSprite() {
    setLoadError("");
    try {
      const next = await loadActor(spriteKey);
      placeId.current += 1;
      const id = placeId.current;
      setPlaced((list) => {
        const nextList = [...list, unitOnField(list, next, id)];
        placedRef.current = nextList;
        return nextList;
      });
      followUnit(actorUnit(next));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "That sprite could not be opened.");
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return undefined;
    }
    const scene = sceneForRegion(regionId);
    let scenery = scene ? bakeScenery(scene, BATTLE_BOARD.width, BATTLE_BOARD.height) : null;
    // Readout for checking by hand how often the backdrop re-bakes: `__sceneryBake()` in the console.
    (window as unknown as { __sceneryBake?: () => unknown }).__sceneryBake = () => ({ ...sceneryBakeStats(), showing: scenery?.scale });
    const theater = scene?.kind === "sea" ? "navy_test" : "normandy";
    const depth = scene?.kind !== "sea";
    depthRef.current = depth;
    const drawn = new Map<string, OffscreenCanvas>();
    const footprints = new Map<number, Footprint>();
    let stopped = false;
    let frame = 0;
    let pausedTotal = 0;
    let pauseStarted: number | null = null;
    const origin = performance.now();
    let lastElapsed: number | null = null;
    const stage = stageRef.current;
    const front = frontRef.current;
    const frontCtx = front?.getContext("2d") ?? null;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "field-test-vectors");
    svg.setAttribute("aria-hidden", "true");
    if (stage) {
      if (front) {
        stage.insertBefore(svg, front);
      } else {
        stage.appendChild(svg);
      }
    }
    const vehicleStage = createVehicleStage(svg);

    const beatCanvas = (key: string, doc: UnitPaintDocument, beat: PlaybackBeat): OffscreenCanvas | null => {
      const name = `${key}:${beat.name}`;
      const hit = drawn.get(name);
      if (hit) {
        return hit;
      }
      const pixels = nativeBeatPixels(doc, beat);
      if (pixels.width < 1 || pixels.height < 1) {
        return null;
      }
      const plate = paintRgba(pixels.rgba, pixels.width, pixels.height);
      drawn.set(name, plate);
      return plate;
    };

    const halfCanvas = (key: string, source: OffscreenCanvas): OffscreenCanvas => {
      const name = `${key}:half`;
      const hit = drawn.get(name);
      if (hit) {
        return hit;
      }
      const half = downsampleBeatHalf(source);
      drawn.set(name, half);
      return half;
    };

    const footprintOf = (id: number, source: OffscreenCanvas, resolution: number): Footprint => {
      const hit = footprints.get(id);
      if (hit) {
        return hit;
      }
      const reader = source.getContext("2d", { willReadFrequently: true });
      const pixels = reader ? reader.getImageData(0, 0, source.width, source.height).data : new Uint8ClampedArray(0);
      const span = footprintSpan(pixels, source.width, source.height);
      const fitted = resolution === 1
        ? span
        : {
            left: span.left / resolution,
            right: span.right / resolution,
            width: span.width / resolution,
            centre: span.centre / resolution,
          };
      footprints.set(id, fitted);
      return fitted;
    };

    const tick = (now: number) => {
      if (stopped) {
        return;
      }
      if (pausedRef.current) {
        if (pauseStarted === null) {
          pauseStarted = now;
        }
      } else if (pauseStarted !== null) {
        pausedTotal += now - pauseStarted;
        pauseStarted = null;
      }
      const clock = pauseStarted ?? now;
      const elapsed = (clock - origin - pausedTotal) / 1000;
      const beat = playbackBeatAt(elapsed);
      const detail = BEAT_LABEL[beat.name] ?? beat.name;
      const stage = stageRef.current;
      const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
      const cssW = stage?.clientWidth || canvas.clientWidth || 1;
      const cssH = stage?.clientHeight || canvas.clientHeight || 1;
      const bufW = Math.max(1, Math.round(cssW * dpr));
      const bufH = Math.max(1, Math.round(cssH * dpr));
      if (canvas.width !== bufW || canvas.height !== bufH) {
        canvas.width = bufW;
        canvas.height = bufH;
      }
      const viewScale = scaleRef.current;
      const cam = cameraRef.current;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const span = dpr * viewScale;
      ctx.setTransform(span, 0, 0, span, cam.x, cam.y);
      ctx.imageSmoothingEnabled = false;
      // Bake finer once the view has settled on a new whole step. Until it lands the old bake stays on screen.
      if (scene && glideRef.current.raf === 0) {
        const wanted = sceneryScaleFor(span);
        const held = scenery?.scale ?? 1;        if (wanted > held || wanted < held - 1) {
          scenery = sceneryForView(scene, BATTLE_BOARD.width, BATTLE_BOARD.height, wanted, (next) => {
            scenery = next;
          });
        }
      }
      // The skyline may trail the camera by HORIZON_PARALLAX (0 today: it stays on the ground line).
      const centreCam = (bufW / 2) * (1 - viewScale);
      const skylineShift = horizonShiftX(cam.x, centreCam, span);
      const backdropTime = skyPin ?? elapsed;
      drawWWIIBattlefield(ctx, BATTLE_BOARD.width, BATTLE_BOARD.height, backdropTime, theater, [], [], [], scenery, { horizonShiftX: skylineShift });
      if (scenery?.kind === "land") {
        drawSceneryEdge(ctx, scenery, BATTLE_BOARD.width, BATTLE_BOARD.height, backdropTime);
      }

      const units = placedRef.current;
      ctx.font = "12px Segoe UI, sans-serif";
      ctx.textAlign = "center";
      if (front && frontCtx) {
        if (front.width !== bufW || front.height !== bufH) {
          front.width = bufW;
          front.height = bufH;
        }
        frontCtx.setTransform(1, 0, 0, 1, 0, 0);
        frontCtx.clearRect(0, 0, front.width, front.height);
        frontCtx.setTransform(span, 0, 0, span, cam.x, cam.y);
        frontCtx.imageSmoothingEnabled = false;
        frontCtx.font = "12px Segoe UI, sans-serif";
        frontCtx.textAlign = "center";
      }
      const hold = motionRef.current;
      const preview = motionClockRef.current;
      const anims = vehicleAnimsRef.current;
      const rawDt = lastElapsed == null ? 0 : elapsed - lastElapsed;
      lastElapsed = elapsed;
      // Ease the kick first, then step the 8 Hz clock, so a new shot draws at full strength.
      const motionStep = previewModes(preview, hold, rawDt);
      if (motionStep.changed) {
        creepRef.current.clear();
      }
      for (const id of [...anims.keys()]) {
        if (!units.some((unit) => unit.id === id)) {
          anims.delete(id);
        }
      }
      for (const anim of anims.values()) {
        easeVehicle(anim, motionStep.dt);
      }
      for (const item of units) {
        const type = actorUnitType(item.actor);
        const profiled = isVehicleUnitType(type);
        const clocked = profiled || (item.actor.kind === "frames" && hold === "all");
        if (!clocked) {
          continue;
        }
        const profile = profiled ? resolveUnitAnimProfile(type) : undefined;
        let anim = anims.get(item.id);
        if (!anim) {
          anim = createVehicleAnim(motionMode(hold, preview.allTime));
          anim.damaged = damagedRef.current && profiled;
          anims.set(item.id, anim);
        } else {
          anim.damaged = damagedRef.current && profiled;
          advanceVehicle(anim, hold, preview.allTime, motionStep.changed, motionStep.modes, Math.random, profile);
        }
      }

      let lead = "Moving";
      const backShadows: (() => void)[] = [];
      const backSprites: (() => void)[] = [];
      const frontShadows: (() => void)[] = [];
      const frontSprites: (() => void)[] = [];
      const svgUnits: VehicleSvgUnit[] = [];
      let seenSvg = false;
      const crisp = graphicsSettings().crispPictures;
      // Back lane first, so a unit on a lower lane covers the one behind it.
      depthOrder(units).forEach((item) => {
        const index = units.indexOf(item);
        const actor = item.actor;
        let firing = beat.recoil > 0;
        let shown: OffscreenCanvas | null = null;
        let scalable: HTMLImageElement | undefined;
        let cacheKey = `${item.id}:still`;
        let markClip = "";
        let markIndex = -1;
        const unitType = actorUnitType(actor);
        const profile = isVehicleUnitType(unitType) ? resolveUnitAnimProfile(unitType) : null;
        let offsets = NO_SHIFT;
        const heldAnim = anims.get(item.id);
        if (profile && heldAnim) {
          const raw = vehicleOffsets(heldAnim, profile);
          // 25D keeps farWing/fuselage/prop/nearWing on separate ladder slots.
          offsets =
            actor.kind === "frames" && actor.fighter25D ? { ...raw, hull: raw.torso, turret: raw.head } : inkedOffsets(profile, raw);
        }
        if (actor.kind !== "frames" && profile && heldAnim && heldAnim.mode === "moving" && dragRef.current?.id !== item.id && motionStep.dt > 0) {
          item.station = { x: item.station.x + marchDistance(motionStep.dt), y: item.station.y };
        }
        if (actor.kind === "plate") {
          cacheKey = `${item.id}:${beat.name}`;
          shown = beatCanvas(String(item.id), actor.doc, beat);
        } else if (actor.kind === "frames") {
          const anim = anims.get(item.id);
          const showFalling = damagedRef.current && actor.damaged.length > 0 && profile == null;
          const clocked = !showFalling && (profile != null || hold === "all");
          const pose = showFalling
            ? heldClipAt(elapsed, actor.damaged.length, "damaged")
            : clocked && anim
              ? vehiclePose(anim.mode, anim.frame, actor)
              : hold === "idle"
                ? heldClipAt(elapsed, actor.idleFrames.length, "idle")
                : hold === "fire"
                  ? heldClipAt(elapsed, actor.fire.length, "fire")
                  : walkFrameAt(elapsed, actor.walk.length, actor.fire.length);
          if (clocked && anim && anim.mode === "moving" && dragRef.current?.id !== item.id && motionStep.dt > 0) {
            item.station = { x: item.station.x + marchDistance(motionStep.dt), y: item.station.y };
          }
          if (!clocked) {
            const prior = creepRef.current.get(item.id);
            if (prior && !showFalling && hold !== "idle" && hold !== "fire" && dragRef.current?.id !== item.id) {
              const gained = marchDistance(elapsed - prior.time);
              if (gained !== 0) {
                item.station = { x: item.station.x + gained, y: item.station.y };
              }
            }
            creepRef.current.set(item.id, { time: elapsed });
          }
          firing = pose.firing;
          markClip = pose.clip;
          markIndex = pose.index;
          cacheKey = `${item.id}:${pose.clip}:${pose.index}`;
          shown =
            pose.clip === "damaged"
              ? (actor.damaged[pose.index] ?? actor.idle)
              : pose.clip === "fire"
                ? (actor.fire[pose.index] ?? actor.walk[0] ?? actor.idle)
                : pose.clip === "walk"
                  ? (actor.walk[pose.index] ?? actor.idle)
                  : (actor.idleFrames[pose.index] ?? actor.idle);
          scalable = frameScalable(actor, pose.clip, pose.index);
          if (index === 0) {
            const body = actor.resolution > 1 ? `Vector · ${pose.label}` : pose.label;
            lead = hold === "all" ? `All · ${body}` : body;
          }
        } else {
          firing = false;
          shown = actor.canvas;
          scalable = actor.scalable;
          if (index === 0) {
            if (profile && heldAnim) {
              const title = heldAnim.mode === "firing" ? "Firing" : heldAnim.mode === "idle" ? "Idle" : "Moving";
              const body = actor.scalable ? `Vector · ${title}` : title;
              lead = hold === "all" ? `All · ${body}` : body;
            } else {
              lead = actor.scalable ? "Vector" : "Still";
            }
          }
        }
        if (index === 0 && actor.kind === "plate") {
          if (profile && heldAnim) {
            const title = heldAnim.mode === "firing" ? "Firing" : heldAnim.mode === "idle" ? "Idle" : "Moving";
            lead = hold === "all" ? `All · ${title}` : title;
          } else {
            lead = firing ? `Firing · ${detail}` : `Marching · ${detail}`;
          }
        }
        if (!shown) {
          return;
        }
        const scale = depthUnitScale(item.scale, item.station.y, depth);
        const resolution = actor.kind === "plate" ? 1 : actor.resolution;
        const useHalf = resolution === 1 && (scale <= 0.5 || viewScale <= 0.5);
        const bitmap = useHalf ? halfCanvas(cacheKey, shown) : shown;
        const pixelPicture = actor.kind !== "frames" || actor.resolution <= 1;
        const blit = fieldBlit(bitmap, actorSize(actor), actorFeet(actor), item.station, scale, viewScale, dpr, useHalf, pixelPicture);
        const art = actorSize(actor);
        const pixelW = blit.width / Math.max(1, art.width);
        const pixelH = blit.height / Math.max(1, art.height);
        let parts: VehicleSvgUnit["parts"] | null = null;
        if (actor.kind === "frames" && actor.fighter25D && crisp) {
          const bankMode: "idle" | "moving" | "firing" | "all" =
            hold === "all" ? "all" : hold === "idle" ? "idle" : hold === "fire" ? "firing" : "moving";
          const pose = fighter25DPose(fighter25DTheta(elapsed, bankMode), fighter25DAltitude(elapsed, bankMode));
          const root = FIGHTER_25D_WING_ROOT;
          const layerRes = 4;
          parts = FIGHTER_25D_Z_ORDER.map((role): VehicleSvgPart => {
            if (role === "shadow") {
              return {
                role: "shadow",
                href: fighter25DLayerUrl("shadow"),
                x: pose.shadow.dx,
                y: pose.shadow.dy + pose.shadow.groundY,
                width: actor.width,
                height: actor.height,
                resolution: layerRes,
                pivotX: root.x,
                pivotY: root.y,
                scaleX: pose.shadow.scaleX,
                scaleY: pose.shadow.scaleY,
                skewXDeg: pose.shadow.skewXDeg,
                opacity: pose.shadow.opacity,
              };
            }
            const slot = FIGHTER_25D_ROLE_SLOT[role];
            const aff = pose[role];
            return {
              role: slot,
              href: fighter25DLayerUrl(role),
              x: offsets[slot].x + aff.dx,
              y: offsets[slot].y + aff.dy,
              width: actor.width,
              height: actor.height,
              resolution: layerRes,
              pivotX: root.x,
              pivotY: root.y,
              scaleX: aff.scaleX,
              scaleY: aff.scaleY,
              skewXDeg: aff.skewXDeg,
              rotateDeg: aff.rotateDeg,
              opacity: aff.opacity,
            };
          });
        } else if (actor.kind === "frames" && crisp && (resolution > 1 || actor.tank?.raster.urls)) {
          const anim = anims.get(item.id);
          const sources = actor.tank ? tankLayerSources(actor.tank, anim?.mode ?? "moving", anim?.frame ?? 0) : null;
          if (sources) {
            parts = sources.map((source) => ({
              role: source.role,
              href: source.href,
              x: offsets[source.role].x,
              y: offsets[source.role].y,
              width: actor.width,
              height: actor.height,
              resolution: source.resolution,
            }));
          } else if (scalable && !actor.tank) {
            parts = [
              {
                role: "torso",
                href: scalable.currentSrc || scalable.src,
                x: 0,
                y: 0,
                width: actor.width,
                height: actor.height,
                resolution: actor.resolution,
              },
            ];
          }
        }
        const onFront = parts == null && seenSvg;
        if (parts) {
          seenSvg = true;
        }
        const paintCtx = onFront && frontCtx ? frontCtx : ctx;
        const shadowList = onFront && frontCtx ? frontShadows : backShadows;
        const spriteList = onFront && frontCtx ? frontSprites : backSprites;
        const spot = contactShadow(footprintOf(item.id, shown, resolution), actorFeet(actor), item.station, scale);
        const shifted = { ...spot, x: spot.x + offsets.root.x * pixelW, y: spot.y + offsets.root.y * pixelH };
        shadowList.push(() => paintContact(paintCtx, shifted));

        const paintChrome = (context: CanvasRenderingContext2D) => {
          if (dragRef.current?.id === item.id) {
            context.strokeStyle = "#f4e7b0";
            context.lineWidth = 1;
            context.strokeRect(
              blit.x + offsets.root.x * pixelW + 0.5,
              blit.y + offsets.root.y * pixelH + 0.5,
              Math.max(0, blit.width - 1),
              Math.max(0, blit.height - 1),
            );
          }
          const markX = pixelPicture ? snapDeviceOrigin(item.station.x, dpr, viewScale) : item.station.x;
          const markY = pixelPicture ? snapDeviceOrigin(item.station.y, dpr, viewScale) : item.station.y;
          context.fillStyle = "#1A1614";
          context.fillText(actorMark(actor), markX, markY + 16);
          if (actor.kind === "frames" && markClip) {
            paintSpriteMarks(
              context,
              actor,
              {
                x: blit.x + (offsets.root.x + offsets.hull.x) * pixelW,
                y: blit.y + (offsets.root.y + offsets.hull.y) * pixelH,
                width: blit.width,
                height: blit.height,
              },
              markClip,
              markIndex,
            );
          }
        };

        if (parts) {
          svgUnits.push({
            id: item.id,
            x: blit.x,
            y: blit.y,
            unitScale: scale,
            rootX: offsets.root.x,
            rootY: offsets.root.y,
            parts,
          });
          frontSprites.push(() => paintChrome(frontCtx ?? ctx));
          return;
        }

        spriteList.push(() => {
          const smooth = actor.kind === "frames" && actor.resolution > 1;
          if (actor.kind === "frames" && actor.tank) {
            const anim = anims.get(item.id);
            const layers = tankRasterLayers(actor.tank, anim?.mode ?? "moving", anim?.frame ?? 0);
            paintCtx.imageSmoothingEnabled = smooth;
            const drawLayer = (canvas: OffscreenCanvas, shift: { x: number; y: number }, name: string) => {
              const image = useHalf ? halfCanvas(`${cacheKey}:${name}`, canvas) : canvas;
              paintCtx.drawImage(
                image,
                blit.x + (offsets.root.x + shift.x) * pixelW,
                blit.y + (offsets.root.y + shift.y) * pixelH,
                blit.width,
                blit.height,
              );
            };
            drawLayer(layers.tracks, offsets.tracks, "tracks");
            drawLayer(layers.torso, offsets.torso, "torso");
            drawLayer(layers.head, offsets.head, "head");
            drawLayer(layers.weapon, offsets.weapon, "weapon");
          } else if (scalable && crisp) {
            paintCtx.save();
            paintCtx.setTransform(1, 0, 0, 1, 0, 0);
            const dw = blit.width * span;
            const dh = blit.height * span;
            const cached = cachedPicture(scalable, `${cacheKey}|crisp`, dw, dh);
            paintCtx.imageSmoothingEnabled = true;
            const originX = (blit.x + offsets.root.x * pixelW) * span + cam.x;
            const originY = (blit.y + offsets.root.y * pixelH) * span + cam.y;
            if (cached) {
              paintCtx.drawImage(cached, originX, originY, dw, dh);
            } else {
              paintCtx.drawImage(scalable, originX, originY, dw, dh);
            }
            paintCtx.restore();
          } else {
            paintCtx.imageSmoothingEnabled = smooth;
            paintCtx.drawImage(bitmap, blit.x + offsets.root.x * pixelW, blit.y + offsets.root.y * pixelH, blit.width, blit.height);
          }
          paintChrome(paintCtx);
        });
      });
      for (const paint of backShadows) {
        paint();
      }
      for (const paint of backSprites) {
        paint();
      }
      vehicleStage.sync(
        { cssWidth: cssW, cssHeight: cssH, camX: cam.x / dpr, camY: cam.y / dpr, viewScale },
        svgUnits,
      );
      for (const paint of frontShadows) {
        paint();
      }
      for (const paint of frontSprites) {
        paint();
      }

      const shownLead = units.length > 0 && damagedRef.current ? `Damaged · ${lead}` : lead;
      const captionText = units.length === 0 ? "Empty field" : units.length === 1 ? shownLead : `${units.length} units · ${shownLead}`;
      setCaption((current) => (current === captionText ? current : captionText));
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      vehicleStage.clear();
      svg.remove();
    };
  }, [regionId]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return undefined;
    }
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) {
        return;
      }
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;
      const scale = scaleRef.current;
      const board = boardUnder(localX, localY, scale);
      const glide = glideRef.current;
      const base = glide.raf !== 0 ? glide.target : scale;
      glide.target = fieldWheelZoom(base, event.deltaY, event.deltaMode);
      glide.anchor = { localX, localY, boardX: board.x, boardY: board.y };
      if (glide.raf !== 0) {
        return;
      }
      glide.last = performance.now();
      const tick = (now: number) => {
        const state = glideRef.current;
        const dt = now - state.last;
        state.last = now;
        const current = scaleRef.current;
        let next = fieldDampZoom(current, state.target, dt);
        if (Math.abs(state.target - current) < 0.0008 || Math.abs(state.target - next) < 0.0008) {
          next = state.target;
        }
        next = fieldViewScale(next);
        scaleRef.current = next;
        if (state.anchor) {
          aimCamera(next, state.anchor);
        }
        setViewScale(next);
        if (next === state.target) {
          state.raf = 0;
          return;
        }
        state.raf = requestAnimationFrame(tick);
      };
      glide.raf = requestAnimationFrame(tick);
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      stage.removeEventListener("wheel", onWheel);
      if (glideRef.current.raf !== 0) {
        cancelAnimationFrame(glideRef.current.raf);
        glideRef.current.raf = 0;
      }
    };
  }, []);

  function jumpView(scale: number) {
    const next = fieldViewScale(scale);
    const stage = stageRef.current;
    const current = scaleRef.current;
    if (stage && current > 0) {
      const localX = stage.clientWidth / 2;
      const localY = stage.clientHeight / 2;
      const board = boardUnder(localX, localY, current);
      const anchor = { localX, localY, boardX: board.x, boardY: board.y };
      glideRef.current.anchor = anchor;
      aimCamera(next, anchor);
    }
    if (glideRef.current.raf !== 0) {
      cancelAnimationFrame(glideRef.current.raf);
      glideRef.current.raf = 0;
    }
    glideRef.current.target = next;
    scaleRef.current = next;
    setViewScale(next);
  }

  function showCursor(next: string) {
    setCursor((current) => (current === next ? current : next));
  }

  function pointerOnBoard(event: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const rect = event.currentTarget.getBoundingClientRect();
    return boardUnder(event.clientX - rect.left, event.clientY - rect.top);
  }

  function hitUnit(point: { x: number; y: number }): PlacedUnit | null {
    const list = depthOrder(placedRef.current);
    for (let index = list.length - 1; index >= 0; index -= 1) {
      const item = list[index];
      if (item && stampHolds(unitStamp(item, depthRef.current), point)) {
        return item;
      }
    }
    return null;
  }

  function beginDrag(event: ReactPointerEvent<HTMLCanvasElement>) {
    const point = pointerOnBoard(event);
    const hit = hitUnit(point);
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // The drag still follows the pointer when the browser will not capture it.
    }
    if (!hit) {
      panRef.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        camX: cameraRef.current.x,
        camY: cameraRef.current.y,
      };
      showCursor("grabbing");
      return;
    }
    dragRef.current = { id: hit.id, dx: point.x - hit.station.x, dy: point.y - hit.station.y };
    showCursor("grabbing");
  }

  function movePointer(event: ReactPointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (drag) {
      const point = pointerOnBoard(event);
      const station = draggedStation({ x: drag.dx, y: drag.dy }, point);
      const next = placedRef.current.map((item) => (item.id === drag.id ? { ...item, station } : item));
      placedRef.current = next;
      setPlaced(next);
      return;
    }
    const pan = panRef.current;
    if (pan && pan.pointerId === event.pointerId) {
      const dpr = deviceRatio();
      cameraRef.current = {
        x: Math.round(pan.camX + (event.clientX - pan.x) * dpr),
        y: Math.round(pan.camY + (event.clientY - pan.y) * dpr),
      };
      const anchor = glideRef.current.anchor;
      if (anchor) {
        const board = boardUnder(anchor.localX, anchor.localY);
        anchor.boardX = board.x;
        anchor.boardY = board.y;
      }
      return;
    }
    showCursor("grab");
  }

  function endDrag() {
    dragRef.current = null;
    panRef.current = null;
    showCursor("grab");
  }

  function resizeUnit(id: number, scale: number) {
    if (!(FIELD_UNIT_SCALES as readonly number[]).includes(scale)) {
      return;
    }
    const next = placedRef.current.map((item) => (item.id === id ? { ...item, scale } : item));
    placedRef.current = next;
    setPlaced(next);
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) {
        return;
      }
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
        return;
      }
      event.preventDefault();
      pausedRef.current = !pausedRef.current;
      setPaused(pausedRef.current);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const factionGroups = [...new Set(pictures.map((row) => row.factionId))].sort((a, b) => {
    const ai = FACTION_ORDER.indexOf(a);
    const bi = FACTION_ORDER.indexOf(b);
    return (ai < 0 ? FACTION_ORDER.length : ai) - (bi < 0 ? FACTION_ORDER.length : bi);
  });

  return (
    <section className="field-test" aria-label="Battle map test">
      <header className="field-test-bar">
        <div>
          <p className="field-test-kicker">Battle map</p>
          <h2>{placed.length === 1 ? actorTitle(placed[0]?.actor ?? null) : placed.length > 1 ? `${placed.length} units` : "Empty field"}</h2>
          <p className="field-test-beat">{caption}</p>
        </div>
        <div className="field-test-actions">
          <label>
            Map
            <select
              value={regionId}
              onChange={(event) => {
                regionPicked.current = true;
                setRegionId(event.target.value);
              }}
            >
              {regions.map((region) => (
                <option key={region.id} value={region.id}>
                  {region.name} · {region.type}
                </option>
              ))}
            </select>
          </label>
          <label>
            View
            <select
              aria-label="View scale"
              value={FIELD_VIEW_SCALES.find((step) => Math.abs(step - viewScale) < 0.001) ?? "live"}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (Number.isFinite(next) && next > 0) {
                  jumpView(next);
                }
              }}
            >
              {FIELD_VIEW_SCALES.every((step) => Math.abs(step - viewScale) >= 0.001) && (
                <option value="live">{fieldZoomLabel(viewScale)}</option>
              )}
              {FIELD_VIEW_SCALES.map((scale) => (
                <option key={scale} value={scale}>
                  {scale === 1 ? "1× native" : `${scale}×`}
                </option>
              ))}
            </select>
          </label>
          <label>
            Sprite
            <select className="field-test-sprite" value={spriteKey} onChange={(event) => setSpriteKey(event.target.value)}>
              <optgroup label="Open">
                <option value="editor">{editorDoc ? "Open in the editor" : "Nothing open in the editor"}</option>
                {picked && !pickedWalk && !pictures.some((row) => row.quantized === picked) && (
                  <option value={`pic:${picked}`}>Picked in the editor: {picked.split("/").pop()}</option>
                )}
              </optgroup>
              <optgroup label="Walk">
                <option value="walk:jap">Japanese walk</option>
                <option value="walk:jap:polished">Japanese walk, polished</option>
                <option value="walk:jap:vector">Japanese walk, vector</option>
                <option value="walk:jap:polished-vector">Japanese walk, polished vector</option>
                <option value="walk:jap_infantry_v2">Japanese walk, v2</option>
                <option value="walk:jap_infantry_v2:vector">Japanese walk, v2, vector</option>
                <option value="walk:ger_tank_seed1_QUICK">GER tank, QUICK</option>
                <option value="walk:ger_tank_seed1_QUICK:vector">GER tank, QUICK, vector</option>
                <option value="walk:ussr_tank_seed1_QUICK">USSR tank, QUICK</option>
                <option value="walk:ussr_tank_seed1_QUICK:vector">USSR tank, QUICK, vector</option>
                <option value="walk:uk_tank_seed1_QUICK">UK tank, QUICK</option>
                <option value="walk:uk_tank_seed1_QUICK:vector">UK tank, QUICK, vector</option>
                <option value="walk:us_tank_seed1_QUICK">US tank, QUICK</option>
                <option value="walk:us_tank_seed1_QUICK:vector">US tank, QUICK, vector</option>
                <option value="walk:jap_tank_seed1_QUICK">JAP tank, QUICK</option>
                <option value="walk:jap_tank_seed1_QUICK:vector">JAP tank, QUICK, vector</option>
                <option value="walk:ger_fighter_seed1_25D">GER fighter, 25D</option>
                <option value="walk:ger_fighter_seed1_25D:vector">GER fighter, 25D, vector</option>
              </optgroup>
              {QUICK_FACTIONS.map((faction) => (
                <optgroup key={faction.id} label={`${faction.id}, QUICK`}>
                  {QUICK_TYPES.map((folder) => {
                    const name = `${faction.id} ${unitTypeLabel(folder).toLowerCase()}, QUICK`;
                    const id = `${faction.prefix}_${folder}_seed1_QUICK`;
                    return [
                      <option key={id} value={`walk:${id}`}>
                        {name}
                      </option>,
                      <option key={`${id}-vector`} value={`walk:${id}:vector`}>
                        {name}, vector
                      </option>,
                    ];
                  })}
                </optgroup>
              ))}
              {vectors.length > 0 && (
                <optgroup label="Vector">
                  {preferStamped(vectors).map((row) => (
                    <option key={row.file} value={`vec:${row.file}`}>
                      {pictureLabel(row)}, {row.stamped === true ? "stamped vector" : row.polished === true ? "polished vector" : "vector"}
                    </option>
                  ))}
                </optgroup>
              )}
              {plates.length > 0 && (
                <optgroup label="Plates">
                  {plates.map((item) => (
                    <option key={`${item.factionId}/${item.unitTypeId}`} value={`plate:${item.factionId}/${item.unitTypeId}`}>
                      {item.factionId} {UNIT_TYPE_LABEL[item.unitTypeId] ?? item.unitTypeId}
                    </option>
                  ))}
                </optgroup>
              )}
              {factionGroups.map((faction) => (
                <optgroup key={faction} label={factionName(faction)}>
                  {pictures
                    .filter((row) => row.factionId === faction)
                    .map((row) => (
                      <option key={row.quantized} value={`pic:${row.quantized}`}>
                        {pictureLabel(row)}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          <div className="field-test-motion-wrap">
            <span id="field-motion-label">Motion</span>
            <div className="field-test-motion" role="group" aria-labelledby="field-motion-label">
              {(
                [
                  ["move", "Move"],
                  ["idle", "Idle"],
                  ["fire", "Fire"],
                  ["all", "All"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={motion === value}
                  className={motion === value ? "is-on" : undefined}
                  onClick={() => {
                    motionRef.current = value;
                    setMotion(value);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="field-test-damaged">
              <input
                type="checkbox"
                checked={damaged}
                onChange={(event) => {
                  damagedRef.current = event.target.checked;
                  setDamaged(event.target.checked);
                }}
              />
              Damaged
            </label>
          </div>
          <button type="button" onClick={() => void addSprite()}>
            Add
          </button>
          <a href="/?bake=1">Back to the editor</a>
          <button
            type="button"
            onClick={() => {
              pausedRef.current = !pausedRef.current;
              setPaused(pausedRef.current);
            }}
          >
            {paused ? "Play" : "Pause"}
          </button>
        </div>
        <GraphicsSettingsPanel />
      </header>
      {placed.length > 0 && (
        <ul className="field-test-units">
          {placed.map((item) => (
            <li key={item.id}>
              <span>{actorTitle(item.actor)}</span>
              <label className="field-test-size">
                Size
                <select
                  aria-label={`Size of ${actorTitle(item.actor)}`}
                  value={item.scale}
                  onChange={(event) => resizeUnit(item.id, Number(event.target.value))}
                >
                  {FIELD_UNIT_SCALES.map((scale) => (
                    <option key={scale} value={scale}>
                      {fieldUnitScaleLabel(scale)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => {
                  const next = placedRef.current.filter((unit) => unit.id !== item.id);
                  placedRef.current = next;
                  setPlaced(next);
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="field-test-stage" ref={stageRef}>
        <canvas
          ref={canvasRef}
          style={{ cursor, touchAction: "none" }}
          onPointerDown={beginDrag}
          onPointerMove={movePointer}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
        <canvas ref={frontRef} className="field-test-front" aria-hidden="true" />
      </div>
      <p className="field-test-note">
        {loadError
          ? loadError
          : "The wheel zooms the map and keeps the spot under the pointer. Drag empty ground to move the view. Drag a sprite to move it. Size changes that picture only. View jumps to 1×, 2×, 3×, or 4×. Space pauses. All plays ten seconds of moving, four of idle, and one of firing. Damaged sags the unit and worsens its ride."}
      </p>
      <style>{STYLE}</style>
    </section>
  );
}

const STYLE = `
.field-test {
  position: fixed;
  inset: 12px;
  z-index: 46;
  display: flex;
  flex-direction: column;
  background: #1c1917;
  color: #f5f0e6;
  border: 1px solid #4b3d44;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
}
.field-test-bar, .field-test-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.field-test-bar { padding: 10px 14px 8px; }
.field-test-kicker {
  margin: 0;
  font: 11px/1.2 "Segoe UI", sans-serif;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #a99c8d;
}
.field-test h2 { margin: 2px 0 0; font: 600 18px/1.2 "Segoe UI", sans-serif; }
.field-test-beat { margin: 2px 0 0; font: 13px/1.3 "Segoe UI", sans-serif; color: #a99c8d; }
.field-test button, .field-test a, .field-test select {
  font: 13px/1.3 "Segoe UI", sans-serif;
  letter-spacing: 0;
  text-transform: none;
  text-decoration: none;
  padding: 6px 10px;
  background: #2a2420;
  color: #f5f0e6;
  border: 1px solid #4b3d44;
  border-radius: 2px;
}
.field-test-sprite { max-width: 320px; }
.field-test-motion-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
}
.field-test-motion { display: flex; }
.field-test-motion button { border-radius: 0; }
.field-test-motion button + button { border-left: 0; }
.field-test-motion button.is-on { background: #4b3d44; color: #f5f0e6; }
.field-test label {
  display: flex;
  align-items: center;
  gap: 6px;
  font: 13px/1.3 "Segoe UI", sans-serif;
  color: #a99c8d;
}
.field-test-units {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  padding: 0 14px 8px;
  list-style: none;
}
.field-test-units li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 2px 2px 8px;
  background: #2a2420;
  border: 1px solid #4b3d44;
  font: 12px/1.3 "Segoe UI", sans-serif;
}
.field-test-units select { padding: 2px 6px; }
.field-test-size { color: #a99c8d; }
.field-test-stage {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
}
.field-test canvas {
  display: block;
  width: 100%;
  height: 100%;
  background: #1c1917;
}
.field-test canvas.field-test-front {
  position: absolute;
  inset: 0;
  background: transparent;
  pointer-events: none;
}
.field-test-vectors {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  overflow: visible;
}
.field-test-note {
  margin: 0;
  padding: 8px 14px 10px;
  font: 13px/1.4 "Segoe UI", sans-serif;
  color: #1c1917;
  background: #f5f0e6;
}
`;
