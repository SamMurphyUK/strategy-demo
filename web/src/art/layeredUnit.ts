import { SPRITE_BAKE } from "../ui/map/figureGround";
import { MILITARY } from "../ui/theme/militaryPalette";
import {
  ARCHETYPES,
  ARCHETYPE_LAYERS,
  LEGACY_SHIFTS,
  archetypeForUnitType,
  beatStack,
  compositeStack,
  emptyFrames,
  isArchetype,
  type ArchetypeKey,
} from "./archetypeLayers";
import { rasterCardSlots } from "./blockoutCompiler";
import { deupscaleGrid, detectPixelBlockSize, scaleArtPoint, scaleArtShifts } from "./pixelGrain";
import { PLAYBACK_BEATS, type PlaybackBeat } from "./motionPreview";
import {
  MOTION_SPRITE_KEY,
  ROSTER_FACTIONS,
  animationOptions,
  buildAnimationDocument,
  documentFromLayers,
  fitPlate,
  fromPaintFile,
  isPlate,
  plateProblems,
  plateShifts,
  toPaintFile,
  withEditingLayer,
  type UnitPaintDocument,
} from "./pixelPaint";
import { SHEET_FOOT_ANCHOR, stripKeyOfSlot } from "./skeletonSchema";
import { FACTION_MILITARY_MAPPINGS } from "./starterParts";
import { EMBLEM_SLOT_GLYPH } from "./emblems";
import type { BrushSlotKey, MotionShifts, PaletteSlotKey, RosterFactionId, SpriteFrameGrid, Vec2 } from "./skeletonSchema";
import { wardrobeOf, type VehicleBuild, type VehiclePart, type VehicleWardrobe } from "./vehicleParts";

/**
 * The layered unit file is the source for a vehicle, an aircraft, or a ship.
 * It holds the idle layers at the size the plate was baked, the ground point, the muzzle mark, the
 * display divisor, and the shifts. Move 1, Move 2, and Fire are not stored: they are built from the
 * idle layers every time the file is read, so two reads always give the same poses.
 * The 80×56 card is one export of this file. Riflemen stay in the unit-paint file.
 */
export interface LayeredUnitFile {
  kind: "layered-unit";
  version: 1;
  factionId: RosterFactionId;
  /** The UNIT_DEFINITIONS key. */
  unitTypeId: string;
  blueprintId: string;
  title: string;
  archetype: Exclude<ArchetypeKey, "infantry">;
  canvasSize: { width: number; height: number };
  groundOrigin: Vec2;
  muzzlePoint: Vec2 | null;
  /** Plate pixels to one card pixel. */
  displayDivisor: number;
  shifts: MotionShifts;
  /** The picture the plate was imported from, if it was. */
  source: string | null;
  /** What each character in a layer row means. It is written out so the file can be read without this module. */
  legend: Record<string, PaletteSlotKey | null>;
  /** The idle pose, one entry a layer, bottom layer first. Each row is one string, one character a pixel. */
  layers: Record<string, string[]>;
  /**
   * Every part a layer can wear. Left out of a unit that has only the drawing in `layers`.
   * A part that is being worn has no rows: its drawing is the one in `layers`.
   */
  parts?: LayeredPartEntry[];
  /** The part id each layer wears. */
  wearing?: Record<string, string>;
  /** Saved sets of parts, each with the country whose colours it was saved in. */
  builds?: VehicleBuild[];
}

export interface LayeredPartEntry {
  id: string;
  name: string;
  layer: string;
  rows?: string[];
}

const EMPTY_GLYPH = ".";

export const SLOT_GLYPH: Record<BrushSlotKey, string> = {
  primary_uniform_or_hull: "P",
  secondary_trim_or_webbing: "S",
  metallic_steel: "M",
  metallic_brass_or_track: "T",
  wood_or_leather: "W",
  skin_stand_in: "K",
  insignia_accent: "I",
};

/** The letter for every slot a pixel can hold. The emblem letters are the ones emblems.ts draws with. */
const ANY_GLYPH: Record<PaletteSlotKey, string> = { ...SLOT_GLYPH, ...EMBLEM_SLOT_GLYPH };

const GLYPH_SLOT = new Map<string, PaletteSlotKey>(
  (Object.entries(ANY_GLYPH) as [PaletteSlotKey, string][]).map(([slot, glyph]) => [glyph, slot]),
);

/** assets/layered/<factionId>/<unitTypeId>.json, relative to web/. */
export function layeredUnitRelativePath(factionId: string, unitTypeId: string): string {
  if (!(ROSTER_FACTIONS as string[]).includes(factionId)) {
    throw new Error(`"${factionId}" is not a roster faction.`);
  }
  if (!/^[a-z0-9_]+$/.test(unitTypeId)) {
    throw new Error(`"${unitTypeId}" is not a unit type id.`);
  }
  return `assets/layered/${factionId}/${unitTypeId}.json`;
}

export function encodeLayerRows(grid: SpriteFrameGrid): string[] {
  return grid.map((row) => row.map((slot) => (slot == null ? EMPTY_GLYPH : ANY_GLYPH[slot])).join(""));
}

export function decodeLayerRows(rows: readonly string[], width: number, height: number, label: string): SpriteFrameGrid {
  if (rows.length !== height) {
    throw new Error(`The ${label} layer has ${rows.length} rows. The canvas is ${height} tall.`);
  }
  return rows.map((text, y) => {
    if (typeof text !== "string" || text.length !== width) {
      throw new Error(`Row ${y} of the ${label} layer is not ${width} characters.`);
    }
    const row: (PaletteSlotKey | null)[] = new Array(width);
    for (let x = 0; x < width; x += 1) {
      const glyph = text[x] ?? EMPTY_GLYPH;
      const slot = glyph === EMPTY_GLYPH ? null : GLYPH_SLOT.get(glyph);
      if (slot === undefined) {
        throw new Error(`Row ${y} of the ${label} layer has "${glyph}", which is not in the legend.`);
      }
      row[x] = slot;
    }
    return row;
  });
}

/** Whether a document saves as a layered unit file. A rifleman and a flat unit save as unit-paint. */
export function savesAsLayeredUnit(doc: UnitPaintDocument): boolean {
  return doc.layers !== null && doc.archetype !== "infantry" && isPlate(doc);
}

export function toLayeredFile(doc: UnitPaintDocument): LayeredUnitFile {
  if (!doc.layers || doc.archetype === "infantry") {
    throw new Error("Only a layered vehicle, aircraft, or ship saves as a layered unit.");
  }
  const layers: Record<string, string[]> = {};
  for (const layer of ARCHETYPE_LAYERS[doc.archetype]) {
    const grid = doc.layers.idle[layer];
    if (!grid) {
      throw new Error(`The ${layer} layer is missing.`);
    }
    layers[layer] = encodeLayerRows(grid);
  }
  const legend: Record<string, PaletteSlotKey | null> = { [EMPTY_GLYPH]: null };
  for (const [slot, glyph] of Object.entries(SLOT_GLYPH) as [PaletteSlotKey, string][]) {
    legend[glyph] = slot;
  }
  // The emblem letters join the legend only when a stamp is in the file, so files without one are unchanged.
  const written = Object.values(layers).flat().join("");
  for (const [slot, glyph] of Object.entries(EMBLEM_SLOT_GLYPH) as [PaletteSlotKey, string][]) {
    if (written.includes(glyph)) {
      legend[glyph] = slot;
    }
  }
  const blueprint = doc.blueprint;
  const file: LayeredUnitFile = {
    kind: "layered-unit",
    version: 1,
    factionId: blueprint.factionId,
    unitTypeId: blueprint.unitTypeId,
    blueprintId: blueprint.blueprintId,
    title: blueprint.historicalEraTag,
    archetype: doc.archetype,
    canvasSize: { ...blueprint.canvasSize },
    groundOrigin: { ...blueprint.groundOrigin },
    muzzlePoint: blueprint.muzzlePoint ? { ...blueprint.muzzlePoint } : null,
    displayDivisor: blueprint.displayDivisor ?? 1,
    shifts: { ...plateShifts(doc) },
    source: blueprint.referencePlatePaths?.[0] ?? null,
    legend,
    layers,
  };
  if (doc.wardrobe) {
    const wardrobe = wardrobeOf(doc);
    file.parts = wardrobe.parts.map((part) =>
      wardrobe.wearing[part.layer] === part.id
        ? { id: part.id, name: part.name, layer: part.layer }
        : { id: part.id, name: part.name, layer: part.layer, rows: encodeLayerRows(part.grid) },
    );
    file.wearing = { ...wardrobe.wearing };
    file.builds = wardrobe.builds.map((build) => ({ ...build, wearing: { ...build.wearing } }));
  }
  return file;
}

const PART_ID = /^[a-z0-9_]+$/;

/** The parts a layered unit file lists. The worn part of each layer takes the drawing already read into `idle`. */
function readWardrobe(
  value: Record<string, unknown>,
  archetype: Exclude<ArchetypeKey, "infantry">,
  idle: Record<string, SpriteFrameGrid>,
  width: number,
  height: number,
): VehicleWardrobe | undefined {
  if (value.parts === undefined) {
    return undefined;
  }
  if (!Array.isArray(value.parts) || !isRecord(value.wearing)) {
    throw new Error("The layered unit lists parts but not which ones are worn.");
  }
  const order = ARCHETYPE_LAYERS[archetype];
  const wearing: Record<string, string> = {};
  for (const layer of order) {
    const id = value.wearing[layer];
    if (typeof id !== "string") {
      throw new Error(`The file does not say which part the ${layer} layer wears.`);
    }
    wearing[layer] = id;
  }
  const parts: VehiclePart[] = [];
  const seen = new Set<string>();
  for (const entry of value.parts as unknown[]) {
    if (!isRecord(entry) || typeof entry.id !== "string" || !PART_ID.test(entry.id) || typeof entry.name !== "string" || typeof entry.layer !== "string") {
      throw new Error("A part in the layered unit has no id, name, or layer.");
    }
    if (!order.includes(entry.layer)) {
      throw new Error(`The part "${entry.name}" is for the ${entry.layer} layer, which this skeleton does not have.`);
    }
    if (seen.has(entry.id)) {
      throw new Error(`Two parts share the id "${entry.id}".`);
    }
    seen.add(entry.id);
    const worn = wearing[entry.layer] === entry.id;
    if (!worn && !Array.isArray(entry.rows)) {
      throw new Error(`The part "${entry.name}" has no drawing.`);
    }
    const grid = worn ? idle[entry.layer] : decodeLayerRows(entry.rows as string[], width, height, `${entry.layer} part "${entry.name}"`);
    if (!grid) {
      throw new Error(`The file has no ${entry.layer} layer.`);
    }
    parts.push({ id: entry.id, name: entry.name, layer: entry.layer, grid });
  }
  for (const layer of order) {
    if (!parts.some((part) => part.layer === layer && part.id === wearing[layer])) {
      throw new Error(`The ${layer} layer wears "${wearing[layer]}", which is not in the parts.`);
    }
  }
  const builds: VehicleBuild[] = [];
  for (const entry of Array.isArray(value.builds) ? (value.builds as unknown[]) : []) {
    if (
      !isRecord(entry) ||
      typeof entry.id !== "string" ||
      typeof entry.name !== "string" ||
      !isRecord(entry.wearing) ||
      typeof entry.colours !== "string" ||
      !(ROSTER_FACTIONS as string[]).includes(entry.colours)
    ) {
      throw new Error("A build in the layered unit has no name, parts, or colours.");
    }
    const worn: Record<string, string> = {};
    for (const layer of order) {
      const id = entry.wearing[layer];
      if (typeof id === "string") {
        worn[layer] = id;
      }
    }
    builds.push({ id: entry.id, name: entry.name, wearing: worn, colours: entry.colours as RosterFactionId });
  }
  return { parts, wearing, builds };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function wholeNumber(value: unknown, least: number, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < least) {
    throw new Error(`${label} must be a whole number of ${least} or more.`);
  }
  return value;
}

function point(value: unknown, width: number, height: number, label: string): Vec2 {
  if (!isRecord(value)) {
    throw new Error(`The file has no ${label}.`);
  }
  const x = wholeNumber(value.x, 0, `${label}.x`);
  const y = wholeNumber(value.y, 0, `${label}.y`);
  if (x >= width || y >= height) {
    throw new Error(`${label} (${x}, ${y}) is outside the ${width}×${height} canvas.`);
  }
  return { x, y };
}

/**
 * Read a layered unit file into a document. The idle layers come from the file. The other three poses
 * are built from them with the file's shifts.
 */
export function fromLayeredFile(value: unknown): UnitPaintDocument {
  if (!isRecord(value) || value.kind !== "layered-unit" || value.version !== 1) {
    throw new Error("That file is not a layered unit JSON.");
  }
  const factionId = value.factionId;
  if (typeof factionId !== "string" || !(ROSTER_FACTIONS as string[]).includes(factionId)) {
    throw new Error("The layered unit has no roster faction.");
  }
  if (typeof value.unitTypeId !== "string" || typeof value.blueprintId !== "string") {
    throw new Error("The layered unit has no unit type.");
  }
  const archetype = isArchetype(value.archetype) ? value.archetype : archetypeForUnitType(value.unitTypeId);
  if (!archetype || archetype === "infantry") {
    throw new Error("A layered unit has to be a vehicle, an aircraft, or a ship.");
  }
  if (archetypeForUnitType(value.unitTypeId) !== archetype) {
    throw new Error(`"${value.unitTypeId}" is not drawn on the ${archetype} skeleton.`);
  }
  if (!isRecord(value.canvasSize)) {
    throw new Error("The layered unit has no canvas size.");
  }
  const width = wholeNumber(value.canvasSize.width, 1, "canvasSize.width");
  const height = wholeNumber(value.canvasSize.height, 1, "canvasSize.height");
  const groundOrigin = point(value.groundOrigin, width, height, "groundOrigin");
  const muzzlePoint = value.muzzlePoint == null ? undefined : point(value.muzzlePoint, width, height, "muzzlePoint");
  const displayDivisor = wholeNumber(value.displayDivisor, 1, "displayDivisor");
  const shifts = isRecord(value.shifts) ? value.shifts : LEGACY_SHIFTS;
  const motion: MotionShifts = {
    bobPx: wholeNumber(shifts.bobPx, 0, "shifts.bobPx"),
    recoilPx: wholeNumber(shifts.recoilPx, 0, "shifts.recoilPx"),
    treadStride: wholeNumber(shifts.treadStride, 1, "shifts.treadStride"),
  };
  if (!isRecord(value.layers)) {
    throw new Error("The layered unit has no layers.");
  }
  const frames = emptyFrames(archetype, width, height);
  for (const layer of ARCHETYPE_LAYERS[archetype]) {
    const rows = value.layers[layer];
    if (!Array.isArray(rows)) {
      throw new Error(`The file has no ${layer} layer. It belongs to another skeleton.`);
    }
    frames.idle[layer] = decodeLayerRows(rows as string[], width, height, layer);
  }
  const doc = documentFromLayers(
    {
      blueprintId: value.blueprintId,
      unitTypeId: value.unitTypeId,
      factionId: factionId as RosterFactionId,
      category: ARCHETYPES[archetype].category,
      canvasSize: { width, height },
      displayDivisor,
      motion,
      groundOrigin,
      sheetFootAnchor: { ...SHEET_FOOT_ANCHOR },
      muzzlePoint,
      nativeFacing: "right",
      recoilOffsetPx: 0,
      frames: {
        idle: compositeStack(archetype, frames.idle),
        move_1: compositeStack(archetype, frames.move_1),
        move_2: compositeStack(archetype, frames.move_2),
        fire: compositeStack(archetype, frames.fire),
      },
      referencePlatePaths: typeof value.source === "string" ? [value.source] : undefined,
      historicalEraTag: typeof value.title === "string" ? value.title : "layered unit",
    },
    archetype,
    frames,
  );
  // Open the layer that holds the most ink: an uncut plate is all on one layer, and that is the one to cut from.
  let fullest = doc.editingLayer;
  let most = -1;
  for (const layer of ARCHETYPE_LAYERS[archetype]) {
    const ink = (frames.idle[layer] ?? []).reduce((sum, row) => sum + row.reduce((n, cell) => n + (cell == null ? 0 : 1), 0), 0);
    if (ink > most) {
      most = ink;
      fullest = layer;
    }
  }
  const wardrobe = readWardrobe(value, archetype, frames.idle, width, height);
  const opened = buildAnimationDocument(fullest ? withEditingLayer(doc, fullest) : doc);
  return wardrobe ? { ...opened, wardrobe } : opened;
}

/** The flat picture one playback beat shows, at the document's own size. */
export function beatGrid(doc: UnitPaintDocument, beat: PlaybackBeat): SpriteFrameGrid {
  if (!doc.layers) {
    return doc.blueprint.frames[beat.flat];
  }
  return compositeStack(doc.archetype, beatStack(doc.archetype, doc.layers, beat, animationOptions(doc)));
}

export interface CardStrip {
  /** Eight cards side by side. */
  width: number;
  height: number;
  cell: { width: number; height: number };
  /** The beat in each cell, left to right. */
  beats: string[];
  /** Straight RGBA. Painted pixels only: figureGround.ts adds the ink outline when a card is drawn. */
  rgba: Uint8ClampedArray;
  /** Why the strip is not clean. An empty list means every beat fits and every shift is a whole card pixel. */
  problems: string[];
}

/**
 * The eight beats of a unit, each scaled onto an 80×56 card with the ground point on (40, 52).
 * A card pixel takes the middle of its block of plate pixels. No outline is drawn.
 */
export function renderCardStrip(doc: UnitPaintDocument): CardStrip {
  const cell = { width: SPRITE_BAKE.width, height: SPRITE_BAKE.height };
  const width = cell.width * PLAYBACK_BEATS.length;
  const rgba = new Uint8ClampedArray(width * cell.height * 4);
  const mapping = FACTION_MILITARY_MAPPINGS[doc.blueprint.factionId];
  const placement = {
    groundOrigin: doc.blueprint.groundOrigin,
    sheetFootAnchor: doc.blueprint.sheetFootAnchor,
    displayDivisor: doc.blueprint.displayDivisor ?? 1,
  };
  PLAYBACK_BEATS.forEach((beat, index) => {
    const slots = rasterCardSlots(beatGrid(doc, beat), placement);
    for (let y = 0; y < cell.height; y += 1) {
      for (let x = 0; x < cell.width; x += 1) {
        const slot = slots[y * cell.width + x];
        if (slot == null) {
          continue;
        }
        const rgb = Number.parseInt(MILITARY[stripKeyOfSlot(mapping, slot)].slice(1), 16);
        const offset = (y * width + index * cell.width + x) * 4;
        rgba[offset] = (rgb >> 16) & 255;
        rgba[offset + 1] = (rgb >> 8) & 255;
        rgba[offset + 2] = rgb & 255;
        rgba[offset + 3] = 255;
      }
    }
  });
  return {
    width,
    height: cell.height,
    cell,
    beats: PLAYBACK_BEATS.map((beat) => beat.name),
    rgba,
    problems: plateProblems(doc),
  };
}

/** Remember the sprite open in the editor so the motion test can play it. A plate is kept as its layered file, which is far smaller. */
export function saveMotionDocument(doc: UnitPaintDocument): void {
  const file = savesAsLayeredUnit(doc) ? toLayeredFile(doc) : toPaintFile(doc);
  sessionStorage.setItem(MOTION_SPRITE_KEY, JSON.stringify(file));
}

export function loadMotionDocument(): UnitPaintDocument | null {
  try {
    const raw = sessionStorage.getItem(MOTION_SPRITE_KEY);
    if (!raw) {
      return null;
    }
    return readUnitFile(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function idleRgba(doc: UnitPaintDocument): { rgba: Uint8ClampedArray; width: number; height: number } {
  const grid = doc.layers ? compositeStack(doc.archetype, doc.layers.idle) : doc.blueprint.frames.idle;
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const mapping = FACTION_MILITARY_MAPPINGS[doc.blueprint.factionId];
  for (let y = 0; y < height; y += 1) {
    const row = grid[y] ?? [];
    for (let x = 0; x < width; x += 1) {
      const slot = row[x];
      if (slot == null) {
        continue;
      }
      const rgb = Number.parseInt(MILITARY[stripKeyOfSlot(mapping, slot)].slice(1), 16);
      const offset = (y * width + x) * 4;
      rgba[offset] = (rgb >> 16) & 255;
      rgba[offset + 1] = (rgb >> 8) & 255;
      rgba[offset + 2] = rgb & 255;
      rgba[offset + 3] = 255;
    }
  }
  return { rgba, width, height };
}

/** Shifts divided onto the new card. Each one stays a whole number of card pixels, and recoil stays even. */
function snapShifts(shifts: MotionShifts, divisor: number): MotionShifts {
  const unit = Math.max(1, Math.floor(divisor));
  const snap = (value: number, step: number, least: number) => Math.max(least, Math.round(value / step) * step);
  return {
    bobPx: snap(shifts.bobPx, unit, 0),
    recoilPx: snap(shifts.recoilPx, unit * 2, 0),
    treadStride: snap(shifts.treadStride, unit, unit),
  };
}

function deupscalePlate(doc: UnitPaintDocument, blockSize: number): UnitPaintDocument {
  if (!doc.layers || doc.archetype === "infantry") {
    return doc;
  }
  const width = Math.floor(doc.blueprint.canvasSize.width / blockSize);
  const height = Math.floor(doc.blueprint.canvasSize.height / blockSize);
  if (width < 1 || height < 1) {
    return doc;
  }
  const frames = emptyFrames(doc.archetype, width, height);
  for (const layer of ARCHETYPE_LAYERS[doc.archetype]) {
    const grid = doc.layers.idle[layer];
    frames.idle[layer] = grid ? deupscaleGrid(grid, blockSize) : frames.idle[layer];
  }
  const size = { width, height };
  const divisor = Math.max(1, Math.round((doc.blueprint.displayDivisor ?? 1) / blockSize));
  const built = buildAnimationDocument(
    documentFromLayers(
      {
        ...doc.blueprint,
        canvasSize: size,
        groundOrigin: scaleArtPoint(doc.blueprint.groundOrigin, blockSize, size),
        muzzlePoint: doc.blueprint.muzzlePoint ? scaleArtPoint(doc.blueprint.muzzlePoint, blockSize, size) : undefined,
        displayDivisor: divisor,
        motion: snapShifts(scaleArtShifts(plateShifts(doc), blockSize), divisor),
      },
      doc.archetype,
      frames,
    ),
  );
  const editing = doc.editingLayer ? withEditingLayer(built, doc.editingLayer) : built;
  // The parts in the library shrink with the canvas, so a swap still lines up afterwards.
  const kept: UnitPaintDocument = doc.wardrobe
    ? { ...editing, wardrobe: { ...doc.wardrobe, parts: doc.wardrobe.parts.map((part) => ({ ...part, grid: deupscaleGrid(part.grid, blockSize) })) } }
    : editing;
  return plateProblems(kept).length === 0 ? kept : fitPlate(kept);
}

/**
 * Collapse a plate whose pixels repeat on a 2×, 3×, or 4× grid. Pass a block size to force ÷2 or ÷3.
 * A picture that is already one art pixel per pixel comes back unchanged.
 */
export function normalizePlateGrain(doc: UnitPaintDocument, blockSize?: number): { doc: UnitPaintDocument; detected: number; applied: number } {
  if (!doc.layers || doc.archetype === "infantry") {
    return { doc, detected: 1, applied: 1 };
  }
  const picture = idleRgba(doc);
  const detected = detectPixelBlockSize(picture.rgba, picture.width, picture.height);
  const applied = blockSize == null ? detected : Math.max(1, Math.floor(blockSize));
  if (applied <= 1) {
    return { doc, detected, applied: 1 };
  }
  const next = deupscalePlate(doc, applied);
  return { doc: next, detected, applied: next === doc ? 1 : applied };
}

/** Read either kind of unit file. */
export function readUnitFile(value: unknown): UnitPaintDocument {
  return isRecord(value) && value.kind === "layered-unit" ? fromLayeredFile(value) : fromPaintFile(value);
}
