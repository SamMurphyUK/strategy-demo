import {
  INFANTRY_LAYER_KEYS,
  buildMarch,
  cloneLayerFrames,
  emptyLayerStack,
  framesFromLayers,
  type InfantryLayerFrames,
  type InfantryLayerKey,
} from "./infantryMarch";
import { MILITARY } from "../ui/theme/militaryPalette";
import { STARTER_INFANTRY_LAYERS } from "./starterParts";
import { SHEET_FOOT_ANCHOR, SPRITE_FRAME_KEYS } from "./skeletonSchema";
import type {
  FactionMilitaryMapping,
  PaletteSlotKey,
  RosterFactionId,
  SpriteFrameGrid,
  SpriteFrameKey,
  UnitSpriteSheetBlueprint,
  Vec2,
} from "./skeletonSchema";

export const PALETTE_SLOT_KEYS = [
  "primary_uniform_or_hull",
  "secondary_trim_or_webbing",
  "metallic_steel",
  "metallic_brass_or_track",
  "wood_or_leather",
  "skin_stand_in",
  "insignia_accent",
] as const satisfies readonly PaletteSlotKey[];

export const ROSTER_FACTIONS: RosterFactionId[] = ["GER", "USSR", "UK", "US", "JAP", "MINOR"];

export const SLOT_LABEL: Record<PaletteSlotKey, string> = {
  primary_uniform_or_hull: "Hull",
  secondary_trim_or_webbing: "Webbing",
  metallic_steel: "Steel",
  metallic_brass_or_track: "Track",
  wood_or_leather: "Leather",
  skin_stand_in: "Skin",
  insignia_accent: "Insignia",
};

export const FRAME_LABEL: Record<SpriteFrameKey, string> = {
  idle: "Idle",
  move_1: "Move 1",
  move_2: "Move 2",
  fire: "Fire",
};

export type Brush = PaletteSlotKey | "eraser";

export interface UnitPaintFile {
  kind: "unit-paint";
  version: 1;
  flat: boolean;
  editingFrame: SpriteFrameKey;
  editingLayer: InfantryLayerKey | null;
  blueprint: UnitSpriteSheetBlueprint;
  layers: InfantryLayerFrames | null;
}

export interface UnitPaintDocument {
  blueprint: UnitSpriteSheetBlueprint;
  editingFrame: SpriteFrameKey;
  editingLayer: InfantryLayerKey | null;
  flat: boolean;
  layers: InfantryLayerFrames | null;
}

const CANVAS = 48;

export function slotHex(mapping: FactionMilitaryMapping, slot: PaletteSlotKey): string {
  return MILITARY[mapping[slot]];
}

export function documentFromBlueprint(blueprint: UnitSpriteSheetBlueprint): UnitPaintDocument {
  const source = STARTER_INFANTRY_LAYERS[blueprint.blueprintId];
  const layers = source ? cloneLayerFrames(source) : null;
  const next = cloneBlueprint(blueprint);
  if (layers) {
    next.frames = framesFromLayers(layers);
  }
  return {
    blueprint: next,
    editingFrame: "idle",
    editingLayer: layers ? "legs" : null,
    flat: false,
    layers,
  };
}

export function blankDocument(factionId: RosterFactionId): UnitPaintDocument {
  const layers = {
    idle: emptyLayerStack(CANVAS, CANVAS),
    move_1: emptyLayerStack(CANVAS, CANVAS),
    move_2: emptyLayerStack(CANVAS, CANVAS),
    fire: emptyLayerStack(CANVAS, CANVAS),
  };
  return {
    blueprint: {
      blueprintId: "custom_unit",
      unitTypeId: "infantry",
      factionId,
      category: "land",
      canvasSize: { width: CANVAS, height: CANVAS },
      groundOrigin: { x: 24, y: 45 },
      sheetFootAnchor: { ...SHEET_FOOT_ANCHOR },
      muzzlePoint: { x: 36, y: 24 },
      nativeFacing: "right",
      recoilOffsetPx: 1,
      frames: framesFromLayers(layers),
      historicalEraTag: "custom unit",
    },
    editingFrame: "idle",
    editingLayer: "legs",
    flat: false,
    layers,
  };
}

/** Faction changes the swatches. The slot grids stay put. */
export function withFaction(doc: UnitPaintDocument, factionId: RosterFactionId): UnitPaintDocument {
  return { ...doc, blueprint: { ...doc.blueprint, factionId } };
}

export function withEditingFrame(doc: UnitPaintDocument, frame: SpriteFrameKey): UnitPaintDocument {
  if (!SPRITE_FRAME_KEYS.includes(frame)) {
    return doc;
  }
  return { ...doc, editingFrame: frame };
}

export function withEditingLayer(doc: UnitPaintDocument, layer: InfantryLayerKey): UnitPaintDocument {
  if (!doc.layers || !INFANTRY_LAYER_KEYS.includes(layer)) {
    return doc;
  }
  return { ...doc, editingLayer: layer };
}

/** Copy the open frame onto the next pose and select that pose. */
export function duplicateFrameToNext(doc: UnitPaintDocument): UnitPaintDocument {
  const next = nextFrame(doc.editingFrame);
  if (!doc.layers) {
    return {
      ...doc,
      editingFrame: next,
      blueprint: {
        ...doc.blueprint,
        frames: {
          ...doc.blueprint.frames,
          [next]: cloneGrid(doc.blueprint.frames[doc.editingFrame]),
        },
      },
    };
  }
  const layers = cloneLayerFrames(doc.layers);
  layers[next] = {
    legs: cloneGrid(doc.layers[doc.editingFrame].legs),
    torso: cloneGrid(doc.layers[doc.editingFrame].torso),
    head: cloneGrid(doc.layers[doc.editingFrame].head),
    hands_weapon: cloneGrid(doc.layers[doc.editingFrame].hands_weapon),
  };
  return withLayers(doc, layers, next);
}

/** Copy the open layer onto the next pose. The other layers on that pose stay. */
export function duplicateLayerToNext(doc: UnitPaintDocument): UnitPaintDocument {
  if (!doc.layers || !doc.editingLayer) {
    return doc;
  }
  const next = nextFrame(doc.editingFrame);
  const layers = cloneLayerFrames(doc.layers);
  layers[next] = {
    ...layers[next],
    [doc.editingLayer]: cloneGrid(doc.layers[doc.editingFrame][doc.editingLayer]),
  };
  return withLayers({ ...doc, editingFrame: next }, layers, next);
}

/** Place the idle head, tunic, and rifle onto the other three poses. Leg drawings on those poses stay. */
export function buildMarchDocument(doc: UnitPaintDocument): UnitPaintDocument {
  if (!doc.layers) {
    return doc;
  }
  return withLayers(doc, buildMarch(doc.layers, doc.blueprint.groundOrigin.x), doc.editingFrame);
}

/** Move the foot pin. The painted frames stay where they are. */
export function placeGroundOrigin(doc: UnitPaintDocument, x: number, y: number): UnitPaintDocument {
  if (!insideCanvas(doc, x, y)) {
    return doc;
  }
  return { ...doc, blueprint: { ...doc.blueprint, groundOrigin: { x, y } } };
}

export function placeMuzzle(doc: UnitPaintDocument, x: number, y: number): UnitPaintDocument {
  if (!insideCanvas(doc, x, y)) {
    return doc;
  }
  return { ...doc, blueprint: { ...doc.blueprint, muzzlePoint: { x, y } } };
}

/** Paint one cell of the open layer, or of the flat frame when the unit has no layers. */
export function paintAt(doc: UnitPaintDocument, canvasX: number, canvasY: number, brush: Brush): UnitPaintDocument {
  if (!insideCanvas(doc, canvasX, canvasY)) {
    return doc;
  }
  const slot = brush === "eraser" ? null : brush;
  if (doc.layers && doc.editingLayer) {
    const layers = cloneLayerFrames(doc.layers);
    const grid = layers[doc.editingFrame][doc.editingLayer];
    const row = grid[canvasY];
    if (!row) {
      return doc;
    }
    row[canvasX] = slot;
    return withLayers(doc, layers, doc.editingFrame);
  }
  const grid = cloneGrid(doc.blueprint.frames[doc.editingFrame]);
  const row = grid[canvasY];
  if (!row) {
    return doc;
  }
  row[canvasX] = slot;
  return {
    ...doc,
    blueprint: {
      ...doc.blueprint,
      frames: { ...doc.blueprint.frames, [doc.editingFrame]: grid },
    },
  };
}

/** The frames are already flat. Mark the document so a kept picture can be put back. */
export function flattenBlockout(doc: UnitPaintDocument): UnitPaintDocument {
  return { ...doc, flat: true };
}

export function flattenRgba(
  doc: UnitPaintDocument,
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  mapping: FactionMilitaryMapping,
): UnitPaintDocument {
  if (width !== doc.blueprint.canvasSize.width || height !== doc.blueprint.canvasSize.height) {
    throw new Error(`Candidate ${width}×${height} does not match the ${doc.blueprint.canvasSize.width}×${doc.blueprint.canvasSize.height} grid`);
  }
  const palette = activeEntries(mapping);
  const grid: SpriteFrameGrid = [];
  for (let y = 0; y < height; y++) {
    const row: (PaletteSlotKey | null)[] = [];
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      row.push(rgba[offset + 3] >= 128 ? nearestSlot(rgba[offset], rgba[offset + 1], rgba[offset + 2], palette) : null);
    }
    grid.push(row);
  }
  if (doc.layers && doc.editingLayer) {
    const layers = cloneLayerFrames(doc.layers);
    layers[doc.editingFrame] = {
      ...layers[doc.editingFrame],
      [doc.editingLayer]: grid,
    };
    return { ...withLayers(doc, layers, doc.editingFrame), flat: true };
  }
  return {
    ...doc,
    flat: true,
    blueprint: {
      ...doc.blueprint,
      frames: { ...doc.blueprint.frames, [doc.editingFrame]: grid },
    },
  };
}

export const MOTION_SPRITE_KEY = "strategy-demo.motion-sprite";

/** Remember the sprite open in the editor so the motion test can march it. */
export function saveMotionSprite(doc: UnitPaintDocument): void {
  sessionStorage.setItem(MOTION_SPRITE_KEY, JSON.stringify(toPaintFile(doc)));
}

export function loadMotionSprite(): UnitPaintDocument | null {
  try {
    const raw = sessionStorage.getItem(MOTION_SPRITE_KEY);
    if (!raw) {
      return null;
    }
    return fromPaintFile(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function toPaintFile(doc: UnitPaintDocument): UnitPaintFile {
  return {
    kind: "unit-paint",
    version: 1,
    flat: doc.flat,
    editingFrame: doc.editingFrame,
    editingLayer: doc.editingLayer,
    blueprint: doc.blueprint,
    layers: doc.layers,
  };
}

export function fromPaintFile(value: unknown): UnitPaintDocument {
  if (!isRecord(value) || value.kind !== "unit-paint" || value.version !== 1) {
    throw new Error("That file is not a unit paint JSON.");
  }
  const blueprint = value.blueprint;
  if (!isBlueprint(blueprint)) {
    throw new Error("The unit JSON has no blueprint.");
  }
  if (blueprint.canvasSize.width !== CANVAS || blueprint.canvasSize.height !== CANVAS) {
    throw new Error("The unit canvas must be 48×48.");
  }
  const editingFrame = SPRITE_FRAME_KEYS.includes(value.editingFrame as SpriteFrameKey)
    ? (value.editingFrame as SpriteFrameKey)
    : "idle";
  const width = blueprint.canvasSize.width;
  const height = blueprint.canvasSize.height;
  const layers = readLayers(value.layers, width, height);
  const next = cloneBlueprint(blueprint);
  if (layers) {
    next.frames = framesFromLayers(layers);
  }
  const editingLayer = layers && INFANTRY_LAYER_KEYS.includes(value.editingLayer as InfantryLayerKey)
    ? (value.editingLayer as InfantryLayerKey)
    : layers
      ? "legs"
      : null;
  return {
    blueprint: next,
    editingFrame,
    editingLayer,
    flat: value.flat === true,
    layers,
  };
}

function activeEntries(mapping: FactionMilitaryMapping): { slot: PaletteSlotKey; r: number; g: number; b: number }[] {
  return PALETTE_SLOT_KEYS.map((slot) => {
    const rgb = Number.parseInt(MILITARY[mapping[slot]].slice(1), 16);
    return { slot, r: (rgb >> 16) & 255, g: (rgb >> 8) & 255, b: rgb & 255 };
  });
}

function nearestSlot(
  r: number,
  g: number,
  b: number,
  palette: readonly { slot: PaletteSlotKey; r: number; g: number; b: number }[],
): PaletteSlotKey {
  let best = palette[0];
  let bestDist = Number.POSITIVE_INFINITY;
  for (const entry of palette) {
    const dr = r - entry.r;
    const dg = g - entry.g;
    const db = b - entry.b;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      best = entry;
    }
  }
  return best?.slot ?? "primary_uniform_or_hull";
}

function insideCanvas(doc: UnitPaintDocument, x: number, y: number): boolean {
  const { width, height } = doc.blueprint.canvasSize;
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < width && y < height;
}

function withLayers(doc: UnitPaintDocument, layers: InfantryLayerFrames, frame: SpriteFrameKey): UnitPaintDocument {
  return {
    ...doc,
    editingFrame: frame,
    layers,
    blueprint: {
      ...doc.blueprint,
      frames: framesFromLayers(layers),
    },
  };
}

function nextFrame(frame: SpriteFrameKey): SpriteFrameKey {
  const index = SPRITE_FRAME_KEYS.indexOf(frame);
  return SPRITE_FRAME_KEYS[(index + 1) % SPRITE_FRAME_KEYS.length] ?? "move_1";
}

function readLayers(value: unknown, width: number, height: number): InfantryLayerFrames | null {
  if (value == null) {
    return null;
  }
  if (!isRecord(value)) {
    throw new Error("The unit JSON has no layers.");
  }
  const frames = {} as InfantryLayerFrames;
  for (const frame of SPRITE_FRAME_KEYS) {
    const stack = value[frame];
    if (!isRecord(stack)) {
      throw new Error(`The ${frame} layers are missing.`);
    }
    frames[frame] = emptyLayerStack(width, height);
    for (const layer of INFANTRY_LAYER_KEYS) {
      if (!isGrid(stack[layer], width, height)) {
        throw new Error(`The ${layer} layer on ${frame} is not a ${width}×${height} grid.`);
      }
      frames[frame][layer] = cloneGrid(stack[layer]);
    }
  }
  return frames;
}

function emptyGrid(width: number, height: number): SpriteFrameGrid {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => null));
}

function cloneGrid(grid: SpriteFrameGrid): SpriteFrameGrid {
  return grid.map((row) => row.slice());
}

function cloneBlueprint(blueprint: UnitSpriteSheetBlueprint): UnitSpriteSheetBlueprint {
  return {
    ...blueprint,
    groundOrigin: { ...blueprint.groundOrigin },
    sheetFootAnchor: { ...blueprint.sheetFootAnchor },
    muzzlePoint: blueprint.muzzlePoint ? { ...blueprint.muzzlePoint } : undefined,
    referencePlatePaths: blueprint.referencePlatePaths ? [...blueprint.referencePlatePaths] : undefined,
    frames: {
      idle: cloneGrid(blueprint.frames.idle),
      move_1: cloneGrid(blueprint.frames.move_1),
      move_2: cloneGrid(blueprint.frames.move_2),
      fire: cloneGrid(blueprint.frames.fire),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isGrid(value: unknown, width: number, height: number): value is SpriteFrameGrid {
  return Array.isArray(value) && value.length === height && value.every((row) => Array.isArray(row) && row.length === width);
}

function isBlueprint(value: unknown): value is UnitSpriteSheetBlueprint {
  if (!isRecord(value) || !isRecord(value.canvasSize) || !isRecord(value.frames)) {
    return false;
  }
  const width = value.canvasSize.width;
  const height = value.canvasSize.height;
  if (typeof width !== "number" || typeof height !== "number") {
    return false;
  }
  const frames = value.frames;
  return (
    typeof value.blueprintId === "string" &&
    typeof value.factionId === "string" &&
    ROSTER_FACTIONS.includes(value.factionId as RosterFactionId) &&
    isVec(value.groundOrigin) &&
    SPRITE_FRAME_KEYS.every((key) => isGrid(frames[key], width, height))
  );
}

function isVec(value: unknown): value is Vec2 {
  return isRecord(value) && typeof value.x === "number" && typeof value.y === "number";
}
